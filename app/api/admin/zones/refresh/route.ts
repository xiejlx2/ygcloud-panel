/**
 * POST /api/admin/zones/refresh  「更新地域库」
 *
 * 手动触发（管理员确认当前 Token 已开放全部地域权限后再点）：
 *   1) 遍历“当前在售地域 ∪ 已知地域 ∪ EXTRA_SYNC_ZONES”，翻页拉全部机器；
 *   2) 把“有机器的地域”写入 reseller_known_zones（只增不改删，union）；
 *   3) 顺带做一次全量 server_cache 同步（等价于一次完整「同步服务器」）。
 *
 * 之所以独立成按钮而非每次同步自动更新：不同 Token 的地域权限可能不同，
 * 自动更新可能在权限不全时记录到不完整的地域集；交由管理员在确认权限齐全后手动触发。
 * 限流：1 次 / 60 秒。
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { listInstancesDetailed, zonesFromInstances } from "@/lib/cloud";
import { syncServerCache, getKnownZones } from "@/lib/sync";
import { ok, err, handleError, getRequestIp, getUserAgent } from "@/lib/api";
import { rateLimit, RL } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    if (!rateLimit(`zones:refresh:${user.id}`, RL.syncServer)) {
      return err("SYNC_RATE_LIMIT", "操作过于频繁，请 60 秒后再试", 429);
    }

    // 遍历范围含已有的已知地域，避免这次因权限/临时故障漏了某地域就把它弄丢
    const knownZones = await getKnownZones(user.id);
    const { instances, complete } = await listInstancesDetailed(user.id, {
      knownZones,
    });

    // 拉取不完整时不更新地域库：可能有地域因权限/故障没查到，
    // 此时“有机器的地域集”不可信，直接记录会缺失。提示管理员稍后重试。
    if (!complete) {
      return err(
        "ZONES_INCOMPLETE",
        "部分地域拉取失败（可能是 Token 尚未开放全部地域权限或上游临时故障），" +
          "为避免记录到不完整的地域，本次未更新地域库，请稍后重试。",
        503,
      );
    }

    const now = new Date();

    // 1) 更新地域库（union：只增不删）
    const zones = zonesFromInstances(instances);
    const existing = new Set(
      (
        await prisma.resellerKnownZone.findMany({
          where: { resellerId: user.id },
          select: { regionCode: true, zoneCode: true },
        })
      ).map((r) => `${r.regionCode}|${r.zoneCode}`),
    );
    let added = 0;
    for (const z of zones) {
      if (!existing.has(`${z.regionCode}|${z.zoneCode}`)) added++;
      await prisma.resellerKnownZone.upsert({
        where: {
          resellerId_regionCode_zoneCode: {
            resellerId: user.id,
            regionCode: z.regionCode,
            zoneCode: z.zoneCode,
          },
        },
        create: {
          resellerId: user.id,
          regionCode: z.regionCode,
          regionName: z.regionName ?? null,
          zoneCode: z.zoneCode,
          zoneName: z.zoneName ?? null,
          machineCount: z.machineCount,
          lastSeenAt: now,
        },
        update: {
          regionName: z.regionName ?? undefined,
          zoneName: z.zoneName ?? undefined,
          machineCount: z.machineCount,
          lastSeenAt: now,
        },
      });
    }

    // 2) 顺带全量同步 server_cache
    const { total, upserted, purged } = await syncServerCache(
      user.id,
      instances,
      complete,
      now,
    );

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "refresh_zones",
      requestPayload: {
        zonesTotal: zones.length,
        zonesAdded: added,
        machines: total,
        upserted,
        purged: purged.length,
      },
      requestIp: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return ok({
      zonesTotal: zones.length,
      zonesAdded: added,
      machines: total,
      upserted,
      purged: purged.length,
      syncedAt: now,
    });
  } catch (e) {
    return handleError(e);
  }
}
