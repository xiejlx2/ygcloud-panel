/**
 * POST /api/client/notify/test
 *   客户向自己已保存的通知渠道发一条测试消息。
 */
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit, RL } from "@/lib/ratelimit";
import { sendToConfig, hasAnyChannel } from "@/lib/notify";
import { getBranding } from "@/lib/branding";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export async function POST() {
  try {
    const user = await getSession();
    if (!user) return err("UNAUTHORIZED", "未登录", 401);
    if (user.role !== "customer") return err("FORBIDDEN", "仅客户可访问该端点", 403);

    if (!rateLimit(`notifyTest:${user.id}`, RL.notifyTest)) {
      return err("RATE_LIMIT", "测试过于频繁，请稍后再试", 429);
    }

    const cfg = await prisma.resellerNotifyConfig.findUnique({ where: { resellerId: user.id } });
    if (!cfg || !hasAnyChannel(cfg)) {
      return err("NO_CHANNEL", "尚未配置任何通知渠道", 400);
    }

    const branding = await getBranding();
    const text = `【${branding.panelName}】测试消息：通知渠道已连通 ✅（${new Date().toLocaleString("zh-CN")}）`;
    const { ok: sent, results } = await sendToConfig(cfg, text);

    await writeAudit({ user, ecsResourceUuid: "-", action: "notify_test", requestPayload: { results } });
    return ok({ sent, results });
  } catch (e) {
    return handleError(e);
  }
}
