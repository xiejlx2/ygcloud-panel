/**
 * 代理商通知渠道配置。仅 reseller_admin 可调用。
 *
 * GET    /api/admin/notify  → 读取配置状态（绝不返回 bot token / webhook url 明文）
 * POST   /api/admin/notify  → 保存配置（enabled / chat id / webhook 类型；密钥仅在填了新值时更新）
 * DELETE /api/admin/notify?target=telegram|webhook → 清除某渠道
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { encryptToken, keyHint, keyHintMatchesCurrent, tokenSuffix } from "@/lib/crypto";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const row = await prisma.resellerNotifyConfig.findUnique({
      where: { resellerId: user.id },
    });
    if (!row) {
      return ok({ configured: false, enabled: true, telegram: { configured: false }, webhook: { configured: false } });
    }
    return ok({
      configured: true,
      enabled: row.enabled,
      telegram: {
        configured: !!(row.telegramBotTokenEncrypted && row.telegramChatId),
        suffix: row.telegramTokenSuffix,
        chatId: row.telegramChatId,
        keyMatches: keyHintMatchesCurrent(row.telegramKeyHint),
      },
      webhook: {
        configured: !!(row.webhookType && row.webhookUrlEncrypted),
        type: row.webhookType,
        keyMatches: keyHintMatchesCurrent(row.webhookKeyHint),
      },
      lastRunAt: row.lastRunAt,
      lastError: row.lastError,
    });
  } catch (e) {
    return handleError(e);
  }
}

const PostBody = z.object({
  enabled: z.boolean().optional(),
  telegramChatId: z.string().max(64).nullable().optional(),
  // 只在填了新值时更新；不传/空表示保持原值
  telegramBotToken: z.string().min(10).max(200).optional(),
  webhookType: z.enum(["wecom", "dingtalk", "feishu"]).nullable().optional(),
  webhookUrl: z.string().url().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const json = await req.json().catch(() => null);
    const parsed = PostBody.safeParse(json);
    if (!parsed.success) return err("INVALID_INPUT", "参数错误", 400);
    const b = parsed.data;

    const data: Record<string, unknown> = {};
    if (b.enabled !== undefined) data.enabled = b.enabled;
    if (b.telegramChatId !== undefined) data.telegramChatId = b.telegramChatId || null;
    if (b.webhookType !== undefined) data.webhookType = b.webhookType || null;
    if (b.telegramBotToken) {
      data.telegramBotTokenEncrypted = encryptToken(b.telegramBotToken);
      data.telegramTokenSuffix = tokenSuffix(b.telegramBotToken);
      data.telegramKeyHint = keyHint();
    }
    if (b.webhookUrl) {
      data.webhookUrlEncrypted = encryptToken(b.webhookUrl);
      data.webhookKeyHint = keyHint();
    }

    await prisma.resellerNotifyConfig.upsert({
      where: { resellerId: user.id },
      create: { resellerId: user.id, ...data },
      update: data,
    });

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "notify_config_update",
      requestPayload: {
        enabled: b.enabled,
        telegramChatIdSet: b.telegramChatId !== undefined,
        telegramTokenSet: !!b.telegramBotToken,
        webhookType: b.webhookType,
        webhookUrlSet: !!b.webhookUrl,
      },
    });

    return ok({ saved: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const target = req.nextUrl.searchParams.get("target");
    if (target !== "telegram" && target !== "webhook") {
      return err("INVALID_INPUT", "target 必须是 telegram 或 webhook", 400);
    }

    const data =
      target === "telegram"
        ? {
            telegramBotTokenEncrypted: null,
            telegramTokenSuffix: null,
            telegramKeyHint: null,
            telegramChatId: null,
          }
        : { webhookType: null, webhookUrlEncrypted: null, webhookKeyHint: null };

    await prisma.resellerNotifyConfig.updateMany({ where: { resellerId: user.id }, data });

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "notify_config_clear",
      requestPayload: { target },
    });

    return ok({ cleared: target });
  } catch (e) {
    return handleError(e);
  }
}
