/**
 * 客户通知渠道配置。仅 customer 可调用。
 * 复用 reseller_notify_configs 表（resellerId 列存 owner 用户 id，客户 id 亦合法）。
 * 与 /api/admin/notify 结构一致，仅 owner=当前客户、无 Token 相关。
 *
 * GET    /api/client/notify
 * POST   /api/client/notify
 * DELETE /api/client/notify?target=telegram|webhook
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Forbidden } from "@/lib/permissions";
import { encryptToken, keyHint, keyHintMatchesCurrent, tokenSuffix } from "@/lib/crypto";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import type { SessionUser } from "@/lib/types";

function assertCustomer(user: SessionUser | null): asserts user {
  if (!user) throw new Forbidden("未登录");
  if (user.role !== "customer") throw new Forbidden("仅客户可访问该端点");
}

export async function GET() {
  try {
    const user = await getSession();
    assertCustomer(user);

    const row = await prisma.resellerNotifyConfig.findUnique({ where: { resellerId: user.id } });
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
  telegramBotToken: z.string().min(10).max(200).optional(),
  webhookType: z.enum(["wecom", "dingtalk", "feishu"]).nullable().optional(),
  webhookUrl: z.string().url().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    assertCustomer(user);

    const parsed = PostBody.safeParse(await req.json().catch(() => null));
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

    await writeAudit({ user, ecsResourceUuid: "-", action: "notify_config_update", requestPayload: { self: true } });
    return ok({ saved: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getSession();
    assertCustomer(user);

    const target = req.nextUrl.searchParams.get("target");
    if (target !== "telegram" && target !== "webhook") {
      return err("INVALID_INPUT", "target 必须是 telegram 或 webhook", 400);
    }
    const data =
      target === "telegram"
        ? { telegramBotTokenEncrypted: null, telegramTokenSuffix: null, telegramKeyHint: null, telegramChatId: null }
        : { webhookType: null, webhookUrlEncrypted: null, webhookKeyHint: null };

    await prisma.resellerNotifyConfig.updateMany({ where: { resellerId: user.id }, data });
    await writeAudit({ user, ecsResourceUuid: "-", action: "notify_config_clear", requestPayload: { target } });
    return ok({ cleared: target });
  } catch (e) {
    return handleError(e);
  }
}
