/**
 * 服务器缓存同步的共享逻辑：把上游实例列表落库（upsert）+ 清理已销毁机器。
 * 被「同步服务器」与「更新地域库」两个入口复用。
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { getExpiryInfo } from "@/lib/expiry";
import type { InstanceListItem } from "@/lib/cloud";

export interface SyncWriteResult {
  total: number;
  upserted: number;
  purged: string[];
}

/**
 * 将实例列表写入 server_cache，并按需清理已销毁机器。
 * @param complete 本轮上游拉取是否完整。仅完整时才执行销毁清理，
 *                 否则“某机器不在结果里”不能作为已销毁依据（防误删）。
 */
export async function syncServerCache(
  resellerId: string,
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
        create: { resellerId, ecsResourceUuid: uuid, ...payload },
        update: payload,
      });
      upserted++;
    }

    // 清理“已销毁”的机器：已过预计销毁时间（到期 + 回收站 3 天，第 4 天 0 点）
    // 且本轮上游已不再返回。仅在本轮拉取完整时执行。
    if (complete) {
      const cached = await tx.serverCache.findMany({
        where: { resellerId },
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
          where: { resellerId, ecsResourceUuid: { in: purged } },
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
): Promise<{ region: string; zone: string }[]> {
  const rows = await prisma.resellerKnownZone.findMany({
    where: { resellerId },
    select: { regionCode: true, zoneCode: true },
  });
  return rows.map((r) => ({ region: r.regionCode, zone: r.zoneCode }));
}
