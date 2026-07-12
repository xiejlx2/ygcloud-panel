/**
 * POST /api/cron/notify
 *   定时通知任务入口。由系统 crontab 调用，靠 x-cron-secret 头校验，无 session。
 *   遍历所有启用通知的代理商，逐个做「同步 + 到期/回收站/Token 告警扫描 + 推送」。
 *
 * 安全：端点经反代公网可达，必须靠 CRON_SECRET 保护；未配置 secret 时直接 503。
 */
import { NextRequest } from "next/server";
import crypto from "node:crypto";
import { env } from "@/lib/env";
import { runNotifyForAll } from "@/lib/notifyScan";
import { ok, err, handleError } from "@/lib/api";

function secretMatches(provided: string | null): boolean {
  if (!provided || !env.CRON_SECRET) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(env.CRON_SECRET);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    if (!env.CRON_SECRET) {
      return err("CRON_NOT_CONFIGURED", "未配置 CRON_SECRET，通知任务不可用", 503);
    }
    if (!secretMatches(req.headers.get("x-cron-secret"))) {
      return err("UNAUTHORIZED", "无效的调用密钥", 401);
    }

    const results = await runNotifyForAll(new Date());
    const totalAlerts = results.reduce((n, r) => n + r.alertsSent, 0);
    return ok({
      resellers: results.length,
      totalAlerts,
      results,
    });
  } catch (e) {
    return handleError(e);
  }
}
