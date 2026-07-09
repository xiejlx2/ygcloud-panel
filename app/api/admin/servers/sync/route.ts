/**
 * POST /api/admin/servers/sync
 *   日常同步：调用上游 /instance/list 同步代理商名下服务器到 server_cache。
 *   遍历“当前在售地域 ∪ 已知地域表”，覆盖已售罄下架但仍有存量机器的地域。
 *   不写入已知地域表（那是「更新地域库」按钮的职责）。
 *   限流：1 次 / 60 秒。
 */
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { listInstancesDetailed } from "@/lib/cloud";
import { syncServerCache, getKnownZones } from "@/lib/sync";
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

    // 已知地域（含曾经有机器、后来下架的地域）并入遍历范围
    const knownZones = await getKnownZones(user.id);
    const { instances, complete } = await listInstancesDetailed(user.id, {
      knownZones,
    });

    const now = new Date();
    const { total, upserted, purged } = await syncServerCache(
      user.id,
      instances,
      complete,
      now,
    );

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
