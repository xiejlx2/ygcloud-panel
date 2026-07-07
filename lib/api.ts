/**
 * Route Handler 通用工具：统一响应、错误转换、请求元数据。
 */
import "server-only";
import { NextResponse } from "next/server";
import type { ApiResult } from "@/lib/types";
import { Forbidden, NotFound } from "@/lib/permissions";
import { CloudApiError } from "@/lib/cloud";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiResult<T>>({ ok: true, data }, init);
}

export function err(code: string, message: string, httpStatus = 400) {
  return NextResponse.json<ApiResult<never>>(
    { ok: false, error: { code, message } },
    { status: httpStatus },
  );
}

/** 将抛出的 Error 转换为统一 JSON 响应。 */
export function handleError(e: unknown) {
  if (e instanceof Forbidden) return err(e.code, e.message, 403);
  if (e instanceof NotFound) return err(e.code, e.message, 404);
  if (e instanceof CloudApiError) {
    return err(e.code, e.message, e.httpStatus >= 400 && e.httpStatus < 600 ? e.httpStatus : 502);
  }
  // 未预期的内部错误：细节只写服务端日志，绝不回显给客户端
  // （避免泄露 Prisma / 堆栈 / 内部实现信息）。
  const detail = e instanceof Error ? e.stack || e.message : String(e);
  console.error("[api] 未处理的内部错误:", detail);
  return err("INTERNAL_ERROR", "服务器内部错误", 500);
}

/**
 * 从请求取客户端 IP。
 *
 * 安全：x-forwarded-for / x-real-ip / cf-connecting-ip 都是客户端可伪造的头。
 * 只有当应用确实部署在“会重写这些头”的可信反代（Nginx / CF 等）之后时，才应信任它们。
 * 因此默认不信任，需显式设置 TRUST_PROXY_HEADERS=true 才读取转发头，
 * 否则回退到运行时提供的对端地址（如有），避免攻击者轮换 XFF 绕过 IP 维度限流。
 */
export function getRequestIp(req: Request): string | null {
  if (process.env.TRUST_PROXY_HEADERS === "true") {
    const h = req.headers;
    // 单一可信反代（如 Caddy / Nginx）会把它“观测到的真实客户端 IP”追加到
    // X-Forwarded-For 的末尾；客户端自己伪造的值只会出现在左侧。
    // 因此取最后一跳（最右）而非最左，才不会被 XFF 伪造绕过限流。
    // 注意：若前面叠了 N 层可信代理，应改取倒数第 N 段。
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1];
    }
    return h.get("x-real-ip") || h.get("cf-connecting-ip") || null;
  }
  // 直连部署：仅使用运行时对端地址（部分适配器会填充 req.ip），不信任任何请求头
  const peer = (req as { ip?: string | null }).ip;
  return peer || null;
}

export function getUserAgent(req: Request): string | null {
  return req.headers.get("user-agent");
}
