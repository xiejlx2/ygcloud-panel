/**
 * 服务器缓存同步的共享逻辑：把上游实例列表落库（upsert）+ 清理已销毁机器。
 * 被「同步服务器」与「更新地域库」两个入口复用。
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { getExpiryInfo } from "@/lib/expiry";
import {
  CloudApiError,
  listInstancesDetailed,
  type InstanceListItem,
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
  error?: string;
}

/**
 * 将实例列表写入 server_cache，并按需清理已销毁机器。
 * @param complete 本轮上游拉取是否完整。仅完整时才执行销毁清理，
 *                 否则“某机器不在结果里”不能作为已销毁依据（防误删）。
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

  await prisma.$transaction(async (tx) => {
    const seen = new Set<string>();
    for (const it of instances) {
      const uuid = it.ecsResourceUUID;
      if (!uuid) continue;
      seen.add(uuid);
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

    // 清理“已销毁”的机器：已过预计销毁时间（到期 + 回收站 3 天，第 4 天 0 点）
    // 且本轮上游已不再返回。仅在本轮拉取完整时执行。
    if (complete) {
      const cached = await tx.serverCache.findMany({
        where: { resellerId, apiTokenId },
        select: { ecsResourceUuid: true, expireTime: true },
      });
      purged = cached
        .filter(
          (c) =>
            !seen.has(c.ecsResourceUuid) &&
            getExpiryInfo(c.expireTime, now).state === "destroyed",
        )
        .map((c) => c.ecsResourceUuid);
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
    }
  });

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
      const { instances, complete } = await listInstancesDetailed(resellerId, {
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
        total: 0,
        upserted: 0,
        purged: [],
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}
