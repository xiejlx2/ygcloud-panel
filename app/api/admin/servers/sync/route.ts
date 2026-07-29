/**
 * POST /api/admin/servers/sync
 *   日常同步：逐个调用代理商所有云账户的 /instance/list，同步到 server_cache。
 *   遍历“当前在售地域 ∪ 已知地域表”，覆盖已售罄下架但仍有存量机器的地域。
 *   每个账户独立使用自己的已知地域，不写入地域表（那是「更新地域库」按钮的职责）。
 *   限流：1 次 / 60 秒。
 */
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { syncAllServerCaches } from "@/lib/sync";
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

    const now = new Date();
    const accounts = await syncAllServerCaches(user.id, now);
    if (accounts.length === 0) {
      return err("TOKEN_NOT_CONFIGURED", "尚未配置任何云账户", 400);
    }
    const succeeded = accounts.filter((a) => a.ok);
    const failed = accounts.filter((a) => !a.ok);
    if (succeeded.length === 0) {
      return err(
        "SYNC_FAILED",
        failed.map((a) => `${a.accountName}：${a.error}`).join("；") ||
          "所有云账户同步失败",
        502,
      );
    }
    const total = succeeded.reduce((n, a) => n + a.total, 0);
    const upserted = succeeded.reduce((n, a) => n + a.upserted, 0);
    const purged = succeeded.flatMap((a) => a.purged);

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
      requestPayload: {
        total,
        upserted,
        purged: purged.length,
        accounts: accounts.map((a) => ({
          id: a.apiTokenId,
          name: a.accountName,
          ok: a.ok,
          complete: a.complete,
          error: a.error,
        })),
      },
      requestIp: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return ok({
      total,
      upserted,
      purged: purged.length,
      accountsTotal: accounts.length,
      accountsSucceeded: succeeded.length,
      accountsFailed: failed.length,
      warnings: accounts
        .filter((a) => !a.ok || !a.complete)
        .map((a) =>
          a.ok
            ? `${a.accountName}：部分地域拉取失败，本次未执行销毁清理`
            : `${a.accountName}：${a.error}`,
        ),
      syncedAt: now,
    });
  } catch (e) {
    return handleError(e);
  }
}
