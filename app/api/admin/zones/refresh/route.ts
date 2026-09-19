/**
 * POST /api/admin/zones/refresh  「更新地域库」
 *
 * 手动触发（管理员确认当前 Token 已开放全部地域权限后再点）：
 *   1) 对每个云账户遍历“当前在售地域 ∪ 该账户已知地域 ∪ EXTRA_SYNC_ZONES”；
 *   2) 把各账户“有机器的地域”分别写入 reseller_known_zones（只增不删）；
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
import {
  listInstancesDetailed,
  zonesFromInstances,
  type ZoneFetchFailure,
} from "@/lib/cloud";
import {
  getKnownZones,
  isCloudAccountCredentialError,
  logCloudAccountStatusChange,
  summarizeZoneFailures,
  syncServerCache,
} from "@/lib/sync";
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

    const accounts = await prisma.resellerApiToken.findMany({
      where: { resellerId: user.id, status: { not: "revoked" } },
      select: { id: true, accountName: true, status: true },
      orderBy: { createdAt: "asc" },
    });
    if (accounts.length === 0) {
      return err("TOKEN_NOT_CONFIGURED", "尚未配置任何云账户", 400);
    }

    const now = new Date();
    const results: {
      id: string;
      name: string;
      ok: boolean;
      complete: boolean;
      zones: number;
      added: number;
      total: number;
      upserted: number;
      purged: string[];
      zoneFailures: ZoneFetchFailure[];
      error?: string;
    }[] = [];

    for (const account of accounts) {
      try {
        const knownZones = await getKnownZones(user.id, account.id);
        const { instances, complete, zoneFailures } =
          await listInstancesDetailed(user.id, {
            apiTokenId: account.id,
            allowInvalidToken: true,
            knownZones,
          });
        const written = await syncServerCache(
          user.id,
          account.id,
          instances,
          complete,
          now,
        );

        let added = 0;
        const zones = zonesFromInstances(instances);
        // 拉取不完整时仍安全写缓存，但不更新地域库，避免把不完整结果当成可信地域集。
        if (complete) {
          const existing = new Set(
            (
              await prisma.resellerKnownZone.findMany({
                where: { resellerId: user.id, apiTokenId: account.id },
                select: { regionCode: true, zoneCode: true },
              })
            ).map((r) => `${r.regionCode}|${r.zoneCode}`),
          );
          for (const z of zones) {
            if (!existing.has(`${z.regionCode}|${z.zoneCode}`)) added++;
            await prisma.resellerKnownZone.upsert({
              where: {
                apiTokenId_regionCode_zoneCode: {
                  apiTokenId: account.id,
                  regionCode: z.regionCode,
                  zoneCode: z.zoneCode,
                },
              },
              create: {
                resellerId: user.id,
                apiTokenId: account.id,
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
        }
        if (complete) {
          await prisma.resellerApiToken.update({
            where: { id: account.id },
            data: { status: "active", lastVerifiedAt: now },
          });
          if (account.status === "invalid") {
            await logCloudAccountStatusChange({
              resellerId: user.id,
              accountId: account.id,
              accountName: account.accountName,
              from: "invalid",
              to: "active",
              trigger: "zones_refresh",
              detail: `更新地域库时完整同步成功，共 ${instances.length} 台服务器`,
            });
          }
        }
        results.push({
          id: account.id,
          name: account.accountName,
          ok: true,
          complete,
          zoneFailures,
          zones: complete ? zones.length : 0,
          added,
          ...written,
        });
      } catch (e) {
        if (isCloudAccountCredentialError(e)) {
          const flipped = await prisma.resellerApiToken
            .updateMany({
              where: { id: account.id, resellerId: user.id, status: { not: "invalid" } },
              data: { status: "invalid" },
            })
            .catch(() => ({ count: 0 }));
          if (flipped.count > 0) {
            await logCloudAccountStatusChange({
              resellerId: user.id,
              accountId: account.id,
              accountName: account.accountName,
              from: account.status,
              to: "invalid",
              trigger: "zones_refresh",
              detail: e instanceof Error ? e.message : String(e),
            });
          }
        }
        results.push({
          id: account.id,
          name: account.accountName,
          ok: false,
          complete: false,
          zoneFailures: [],
          zones: 0,
          added: 0,
          total: 0,
          upserted: 0,
          purged: [],
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const succeeded = results.filter((r) => r.ok);
    if (succeeded.length === 0) {
      return err(
        "ZONES_REFRESH_FAILED",
        results.map((r) => `${r.name}：${r.error}`).join("；"),
        502,
      );
    }
    const zonesTotal = succeeded.reduce((n, r) => n + r.zones, 0);
    const zonesAdded = succeeded.reduce((n, r) => n + r.added, 0);
    const total = succeeded.reduce((n, r) => n + r.total, 0);
    const upserted = succeeded.reduce((n, r) => n + r.upserted, 0);
    const purged = succeeded.flatMap((r) => r.purged);
    const warnings = results
      .filter((r) => !r.ok || !r.complete)
      .map((r) =>
        r.ok
          ? `${r.name}：部分地域拉取失败（${summarizeZoneFailures(r.zoneFailures)}），未更新该账户地域库`
          : `${r.name}：${r.error}`,
      );

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "refresh_zones",
      requestPayload: {
        zonesTotal,
        zonesAdded,
        machines: total,
        upserted,
        purged: purged.length,
        accounts: results,
      },
      requestIp: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return ok({
      zonesTotal,
      zonesAdded,
      machines: total,
      upserted,
      purged: purged.length,
      accountsTotal: results.length,
      accountsSucceeded: succeeded.length,
      warnings,
      syncedAt: now,
    });
  } catch (e) {
    return handleError(e);
  }
}
