/**
 * 通知渠道发送（后端专用）。
 * 支持 Telegram Bot 与企业 webhook（企业微信 / 钉钉 / 飞书）。
 * bot token / webhook url 在库中 AES-256-GCM 加密存储，这里解密后使用，绝不出前端。
 *
 * 外呼模式对齐 lib/cloud.ts 的 cloudRequest：AbortController 超时、no-store、错误分类。
 */
import "server-only";
import { decryptToken } from "@/lib/crypto";

export type WebhookType = "wecom" | "dingtalk" | "feishu";

export interface ChannelResult {
  channel: string; // telegram | wecom | dingtalk | feishu
  ok: boolean;
  error?: string;
}

const TIMEOUT_MS = 15000;

/** 通用 POST JSON，返回 { status, text }，网络/超时错误抛出带简短说明的 Error。 */
async function postJson(
  url: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await resp.text();
    return { status: resp.status, text };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error("请求超时");
    throw new Error(`网络错误：${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

function parse(text: string): Record<string, unknown> | null {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Telegram sendMessage。返回 { ok, error? }。 */
export async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { status, text: body } = await postJson(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      { chat_id: chatId, text, disable_web_page_preview: true },
    );
    const json = parse(body);
    if (status === 200 && json?.ok === true) return { ok: true };
    const desc = (json?.description as string) || `HTTP ${status}`;
    return { ok: false, error: desc };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 企业 webhook（企业微信 / 钉钉 / 飞书）。返回 { ok, error? }。 */
export async function sendWebhook(
  type: WebhookType,
  url: string,
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  let payload: unknown;
  if (type === "feishu") {
    payload = { msg_type: "text", content: { text } };
  } else {
    // 企业微信、钉钉 文本消息结构一致
    payload = { msgtype: "text", text: { content: text } };
  }
  try {
    const { status, text: body } = await postJson(url, payload);
    const json = parse(body);
    if (status !== 200) return { ok: false, error: `HTTP ${status}` };
    // 各家成功码：企业微信/钉钉 errcode=0；飞书 code=0 或 StatusCode=0
    const errcode = json?.errcode;
    const code = json?.code;
    const statusCode = json?.StatusCode;
    const ok =
      errcode === 0 ||
      code === 0 ||
      statusCode === 0 ||
      // 飞书部分返回 { code:0, msg:"success" }；其余无可辨识字段时按 200 放行
      (errcode === undefined && code === undefined && statusCode === undefined);
    if (ok) return { ok: true };
    const msg =
      (json?.errmsg as string) || (json?.msg as string) || `返回 ${body.slice(0, 120)}`;
    return { ok: false, error: msg };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** 通知配置行里与发送相关的字段（来自 prisma reseller_notify_configs）。 */
export interface NotifyConfigRow {
  enabled: boolean;
  telegramBotTokenEncrypted: string | null;
  telegramChatId: string | null;
  webhookType: string | null;
  webhookUrlEncrypted: string | null;
}

/** 该配置是否至少有一个可用渠道。 */
export function hasAnyChannel(cfg: NotifyConfigRow): boolean {
  const tg = !!(cfg.telegramBotTokenEncrypted && cfg.telegramChatId);
  const wh = !!(cfg.webhookType && cfg.webhookUrlEncrypted);
  return tg || wh;
}

/**
 * 按配置把同一条文本发到所有已配置渠道，聚合每个渠道的结果。
 * 任一渠道成功即视为整体送达（ok=true），但每个渠道的成败都在 results 里。
 */
export async function sendToConfig(
  cfg: NotifyConfigRow,
  text: string,
): Promise<{ ok: boolean; results: ChannelResult[] }> {
  const results: ChannelResult[] = [];

  if (cfg.telegramBotTokenEncrypted && cfg.telegramChatId) {
    let botToken: string | null = null;
    try {
      botToken = decryptToken(cfg.telegramBotTokenEncrypted);
    } catch {
      results.push({ channel: "telegram", ok: false, error: "bot token 解密失败（密钥可能已变更）" });
    }
    if (botToken) {
      const r = await sendTelegram(botToken, cfg.telegramChatId, text);
      results.push({ channel: "telegram", ok: r.ok, error: r.error });
    }
  }

  if (cfg.webhookType && cfg.webhookUrlEncrypted) {
    let url: string | null = null;
    try {
      url = decryptToken(cfg.webhookUrlEncrypted);
    } catch {
      results.push({ channel: cfg.webhookType, ok: false, error: "webhook url 解密失败（密钥可能已变更）" });
    }
    if (url) {
      const r = await sendWebhook(cfg.webhookType as WebhookType, url, text);
      results.push({ channel: cfg.webhookType, ok: r.ok, error: r.error });
    }
  }

  return { ok: results.some((r) => r.ok), results };
}
