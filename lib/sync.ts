/**
 * 服务器缓存同步的共享逻辑：把上游实例列表落库（upsert）+ 清理已销毁机器。
 * 被「同步服务器」与「更新地域库」两个入口复用。
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { getExpiryInfo } from "@/lib/expiry";
import {
  CloudApiError,
  getInstanceDetail,
  listInstancesDetailed,
  type InstanceListItem,
  type ZoneFetchFailure,
} from "@/lib/cloud";

export interface SyncWriteResult {
  total: number;
  upserted: number;
  purged: string[];
}

export interface CloudAccountSyncResult extends SyncWriteResult {
  apiTokenId: string;
  accountName: string;
  ok: boolean;
  complete: boolean;
  tokenBroken: boolean;
  zoneFailures: ZoneFetchFailure[];
  error?: string;
}

/** 上游详情接口确认“这台机器已不存在”的业务错误码。 */
const INSTANCE_GONE_BIZ_CODES = new Set([
  "InvalidEcsStatus.Deleted",
  "InvalidInstanceEntity.NotFound",
]);

/**
 * 判断详情接口错误是否代表“实例已删除/不存在”。
 * 只有这类错误才允许从缓存清理；网络/超时/限流等一律保守保留。
 */
function isInstanceGoneError(error: unknown): boolean {
  if (!(error instanceof CloudApiError)) return false;
  if (error.code !== "UPSTREAM_BIZ_ERROR") return false;
  if (error.bizCode && INSTANCE_GONE_BIZ_CODES.has(error.bizCode)) return true;
  return /已删除|不存在|找不到/.test(error.message);
}

/** 将失败地域压缩为适合提示框展示的安全摘要。 */
export function summarizeZoneFailures(
  failures: ZoneFetchFailure[],
  limit = 3,
): string {
  const shown = failures
    .slice(0, limit)
    .map((f) => `${f.regionCode}/${f.zoneCode}（${f.errorCode}）`);
  const remaining = failures.length - shown.length;
  return `${shown.join("、")}${remaining > 0 ? `，另有 ${remaining} 个地域` : ""}`;
}

/**
 * 将实例列表写入 server_cache，并按需清理已销毁机器。
 *
 * 清理策略：
 *  1) 对“缓存里有、本轮列表里没有”的机器，逐台调用上游 /instance/detail 确认。
 *     详情明确返回“已删除/不存在”时才立即清除（含分配记录）；
 *     详情仍返回数据（如 EXPIRED）则更新缓存状态；详情临时报错则保留。
 *  2) 列表完整且缓存到期时间已过“回收站保留期”的机器，作为兜底清除
 *     （保留原有防误删语义）。
 * @param complete 本轮上游拉取是否完整。仅用于兜底清理，不阻止详情确认。
 */
export async function syncServerCache(
  resellerId: string,
  apiTokenId: string,
  instances: InstanceListItem[],
  complete: boolean,
  now: Date = new Date(),
): Promise<SyncWriteResult> {
  let upserted = 0;
  let purged: string[] = [];

  const seen = new Set<string>();
  for (const it of instances) {
    if (it.ecsResourceUUID) seen.add(it.ecsResourceUUID);
  }

  // 1. 本轮列表中的机器直接 upsert。
  await prisma.$transaction(async (tx) => {
    for (const it of instances) {
      const uuid = it.ecsResourceUUID;
      if (!uuid) continue;
      const payload = toCachePayload(it, now);
      await tx.serverCache.upsert({
        where: {
          resellerId_ecsResourceUuid: { resellerId, ecsResourceUuid: uuid },
        },
        create: { resellerId, apiTokenId, ecsResourceUuid: uuid, ...payload },
        update: { apiTokenId, ...payload },
      });
      upserted++;
    }
  });

  // 2. 找出缓存里有、本轮列表里没有的机器，逐台向上游确认。
  const cached = await prisma.serverCache.findMany({
    where: { resellerId, apiTokenId },
    select: {
      ecsResourceUuid: true,
      regionCode: true,
      zoneCode: true,
      expireTime: true,
      publicIpAddress: true,
      internalIpAddress: true,
    },
  });
  const missing = cached.filter((c) => !seen.has(c.ecsResourceUuid));
  const confirmedGone = new Set<string>();
  const aliveUpdates: {
    uuid: string;
    data: ReturnType<typeof toCachePayload>;
  }[] = [];

  const CONFIRM_CONCURRENCY = 5;
  for (let i = 0; i < missing.length; i += CONFIRM_CONCURRENCY) {
    const batch = missing.slice(i, i + CONFIRM_CONCURRENCY);
    await Promise.all(
      batch.map(async (row) => {
        try {
          const live = await getInstanceDetail(resellerId, row.ecsResourceUuid, {
            regionCode: row.regionCode ?? undefined,
            zoneCode: row.zoneCode ?? undefined,
            apiTokenId,
          });
          if (live) {
            // 上游仍能查到（含已过期进回收站）：用最新状态刷新缓存。
            aliveUpdates.push({
              uuid: row.ecsResourceUuid,
              data: {
                ...toCachePayload(live, now),
                // 部分详情响应（如已过期实例）不含公网/内网 IP，
                // 保留缓存里的原值，避免把面板里的 IP 清空。
                publicIpAddress: live.publicIpAddress ?? row.publicIpAddress,
                internalIpAddress:
                  live.internalIpAddress ?? row.internalIpAddress,
              },
            });
          }
        } catch (e) {
          if (isInstanceGoneError(e)) confirmedGone.add(row.ecsResourceUuid);
        }
      }),
    );
  }

  // 3. 兜底：列表完整且缓存到期时间已过“回收站保留期”的机器仍视为销毁。
  if (complete) {
    for (const row of missing) {
      if (
        !confirmedGone.has(row.ecsResourceUuid) &&
        !aliveUpdates.some((u) => u.uuid === row.ecsResourceUuid) &&
        getExpiryInfo(row.expireTime, now).state === "destroyed"
      ) {
        confirmedGone.add(row.ecsResourceUuid);
      }
    }
  }

  purged = Array.from(confirmedGone);
  if (aliveUpdates.length > 0 || purged.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const u of aliveUpdates) {
        await tx.serverCache.update({
          where: {
            resellerId_ecsResourceUuid: { resellerId, ecsResourceUuid: u.uuid },
          },
          data: u.data,
        });
      }
      if (purged.length > 0) {
        // 分配记录引用了 server_cache（FK Restrict），需一并删除；
        // 操作历史保留在 operation_logs（无外键，按 uuid 记录），不受影响。
        await tx.serverAssignment.deleteMany({
          where: { resellerId, ecsResourceUuid: { in: purged } },
        });
        await tx.serverCache.deleteMany({
          where: { resellerId, apiTokenId, ecsResourceUuid: { in: purged } },
        });
      }
    });
  }

  return { total: instances.length, upserted, purged };
}

function toCachePayload(it: InstanceListItem, now: Date) {
  return {
    instanceName: it.instanceName ?? null,
    publicIpAddress: it.publicIpAddress ?? null,
    internalIpAddress: it.internalIpAddress ?? null,
    regionCode: it.regionCode ?? null,
    regionName: it.regionName ?? null,
    zoneCode: it.zoneCode ?? null,
    zoneName: it.zoneName ?? null,
    cpu: numOrNull(it.cpu),
    memory: numOrNull(it.memory),
    bandwidth: numOrNull(it.bandwidth),
    osName: it.osName ?? null,
    osVersionDetail: it.osVersionDetail ?? null,
    ecsStatus: it.ecsStatus ?? null,
    ecsPendingStatus: it.ecsPendingStatus ?? null,
    expireTime: parseDate(it.expireTime),
    rawJson: safeJson(it),
    lastSyncedAt: now,
  };
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function parseDate(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function safeJson(it: unknown): string {
  try {
    return JSON.stringify(it);
  } catch {
    return "{}";
  }
}

/** 读取某代理商已知地域表，转成 listInstancesDetailed 需要的形态。 */
export async function getKnownZones(
  resellerId: string,
  apiTokenId: string,
): Promise<{ region: string; zone: string }[]> {
  const rows = await prisma.resellerKnownZone.findMany({
    where: { resellerId, apiTokenId },
    select: { regionCode: true, zoneCode: true },
  });
  return rows.map((r) => ({ region: r.regionCode, zone: r.zoneCode }));
}

const TOKEN_FAILURE_CODES = new Set([
  "TOKEN_NOT_CONFIGURED",
  "TOKEN_DECRYPT_FAILED",
  "UPSTREAM_HTTP_ERROR",
  "UPSTREAM_BIZ_ERROR",
]);

/** 是否属于需要把云账户标记为 invalid 的凭据/鉴权类错误。 */
export function isCloudAccountCredentialError(e: unknown): boolean {
  return e instanceof CloudApiError && TOKEN_FAILURE_CODES.has(e.code);
}

/**
 * 同步某代理商下的全部云账户。
 * 每个账户独立拉取、写入和清理：一个账户失败不会阻断其他账户，
 * 更不会把其他账户未出现在本轮结果中的服务器误判为已销毁。
 */
export async function syncAllServerCaches(
  resellerId: string,
  now: Date = new Date(),
): Promise<CloudAccountSyncResult[]> {
  const accounts = await prisma.resellerApiToken.findMany({
    where: { resellerId, status: { not: "revoked" } },
    select: { id: true, accountName: true },
    orderBy: { createdAt: "asc" },
  });

  const results: CloudAccountSyncResult[] = [];
  for (const account of accounts) {
    try {
      const knownZones = await getKnownZones(resellerId, account.id);
      const { instances, complete, zoneFailures } =
        await listInstancesDetailed(resellerId, {
          apiTokenId: account.id,
          allowInvalidToken: true,
          knownZones,
        });
      const written = await syncServerCache(
        resellerId,
        account.id,
        instances,
        complete,
        now,
      );
      // 只有完整覆盖所有地域时才确认 Key 健康；部分地域失败时保留原状态，
      // 避免把权限不完整的 Key 错标为 active。
      if (complete) {
        await prisma.resellerApiToken.update({
          where: { id: account.id },
          data: { status: "active", lastVerifiedAt: now },
        });
      }
      results.push({
        apiTokenId: account.id,
        accountName: account.accountName,
        ok: true,
        complete,
        tokenBroken: false,
        zoneFailures,
        ...written,
      });
    } catch (e) {
      const tokenBroken = isCloudAccountCredentialError(e);
      if (tokenBroken) {
        await prisma.resellerApiToken
          .updateMany({
            where: { id: account.id, resellerId },
            data: { status: "invalid" },
          })
          .catch(() => void 0);
      }
      results.push({
        apiTokenId: account.id,
        accountName: account.accountName,
        ok: false,
        complete: false,
        tokenBroken,
        zoneFailures: [],
        total: 0,
        upserted: 0,
        purged: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
