/**
 * POST /api/admin/notify/test
 *   立即向当前代理商已保存的通知渠道发一条测试消息，返回每个渠道的成功/失败。
 *   用途：配好后一键验证渠道可达性（尤其 Telegram 从服务器能否直连 api.telegram.org）。
 */
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { rateLimit, RL } from "@/lib/ratelimit";
import { sendToConfig, hasAnyChannel } from "@/lib/notify";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export async function POST() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    if (!rateLimit(`notifyTest:${user.id}`, RL.notifyTest)) {
      return err("RATE_LIMIT", "测试过于频繁，请稍后再试", 429);
    }

    const cfg = await prisma.resellerNotifyConfig.findUnique({ where: { resellerId: user.id } });
    if (!cfg || !hasAnyChannel(cfg)) {
      return err("NO_CHANNEL", "尚未配置任何通知渠道", 400);
    }

    const text = `【服务器控制台】测试消息：通知渠道已连通 ✅（${new Date().toLocaleString("zh-CN")}）`;
    const { ok: sent, results } = await sendToConfig(cfg, text);

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "notify_test",
      requestPayload: { results },
    });

    return ok({ sent, results });
  } catch (e) {
    return handleError(e);
  }
}
