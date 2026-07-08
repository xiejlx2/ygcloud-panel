/**
 * POST /api/admin/servers/sync
 *   调用上游 /instance/list 同步代理商名下服务器到 server_cache。
 *   限流：1 次 / 60 秒。
 */
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { listInstancesDetailed, type InstanceListItem } from "@/lib/cloud";
import { getExpiryInfo } from "@/lib/expiry";
import { ok, err, handleError, getRequestIp, getUserAgent } from "@/lib/api";
import { rateLimit, RL } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    if (!rateLimit(`sync:${user.id}`, RL.syncServer)) {
      return err("SYNC_RATE_LIMIT", "同步过于频繁，请 60 秒后再试", 429);
    }

    const { instances: list, complete } = await listInstancesDetailed(user.id);
    if (!Array.isArray(list)) {
      return err("SYNC_PARSE_FAILED", "解析上游返回数据失败", 502);
    }

    const now = new Date();
    let upserted = 0;
    let total = list.length;
    let purged: string[] = [];

    // 单个事务批量 upsert
    await prisma.$transaction(async (tx) => {
      const seen = new Set<string>();
      for (const it of list) {
        const uuid = it.ecsResourceUUID;
        if (!uuid) continue;
        seen.add(uuid);
        const payload = toCachePayload(it, now);
        await tx.serverCache.upsert({
          where: {
            resellerId_ecsResourceUuid: {
              resellerId: user.id,
              ecsResourceUuid: uuid,
            },
          },
          create: { resellerId: user.id, ecsResourceUuid: uuid, ...payload },
          update: payload,
        });
        upserted++;
      }

      // 清理“已销毁”的机器：已过预计销毁时间（到期 + 回收站 3 天，第 4 天 0 点）
      // 且本轮上游已不再返回。仅在本轮拉取完整时执行——若有可用区拉取失败，
      // “不在返回结果里”不能作为已销毁的依据，跳过清理等待下一轮。
      if (complete) {
        const cached = await tx.serverCache.findMany({
          where: { resellerId: user.id },
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
            where: { resellerId: user.id, ecsResourceUuid: { in: purged } },
          });
          await tx.serverCache.deleteMany({
            where: { resellerId: user.id, ecsResourceUuid: { in: purged } },
          });
        }
      }
    });

    if (purged.length > 0) {
      await writeAudit({
        user,
        ecsResourceUuid: "-",
        action: "purge_destroyed",
        requestPayload: { count: purged.length, uuids: purged },
        requestIp: getRequestIp(req),
        userAgent: getUserAgent(req),
      });
    }

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "sync_server",
      requestPayload: { total, upserted, purged: purged.length, complete },
      requestIp: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return ok({ total, upserted, purged: purged.length, syncedAt: now });
  } catch (e) {
    return handleError(e);
  }
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
