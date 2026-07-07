/**
 * POST /api/admin/servers/sync
 *   调用上游 /instance/list 同步代理商名下服务器到 server_cache。
 *   限流：1 次 / 60 秒。
 */
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { listInstances, type InstanceListItem } from "@/lib/cloud";
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

    const list = await listInstances(user.id);
    if (!Array.isArray(list)) {
      return err("SYNC_PARSE_FAILED", "解析上游返回数据失败", 502);
    }

    const now = new Date();
    let upserted = 0;
    let total = list.length;

    // 单个事务批量 upsert
    await prisma.$transaction(async (tx) => {
      for (const it of list) {
        const uuid = it.ecsResourceUUID;
        if (!uuid) continue;
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
    });

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "sync_server",
      requestPayload: { total, upserted },
      requestIp: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return ok({ total, upserted, syncedAt: now });
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
