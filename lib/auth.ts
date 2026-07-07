/**
 * JWT 签发与校验 + Next.js 侧的 session 读取。
 * Token 只放在 httpOnly + SameSite=Lax 的 cookie 里，
 * 不放入 localStorage / sessionStorage / URL 参数。
 */
import "server-only";
import jwt, { JwtPayload } from "jsonwebtoken";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/types";

const COOKIE_NAME = "rp_session";

export interface SessionPayload extends SessionUser {}

export function signSession(user: SessionUser): string {
  return jwt.sign(user, env.JWT_SECRET, {
    expiresIn: `${env.JWT_EXPIRES_HOURS}h`,
    algorithm: "HS256",
  });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (
      typeof payload.id === "string" &&
      (payload.role === "reseller_admin" || payload.role === "customer")
    ) {
      return {
        id: payload.id,
        role: payload.role,
        parentId: payload.parentId ?? null,
        displayName: payload.displayName ?? "",
      };
    }
    return null;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifySession(token);
  if (!payload) return null;

  // 会话有效性以数据库为准：JWT 是无状态的，仅验签不足以在“禁用/删除/降权”后
  // 让旧令牌立即失效。这里回查一次（主键索引，代价极小）：
  //  - 账号不存在 / 已禁用 → 会话失效
  //  - 角色与令牌不一致（被降权/改动）→ 会话失效
  // 同时用库中最新的 parentId / displayName 覆盖令牌旧值。
  const u = await prisma.user.findUnique({
    where: { id: payload.id },
    select: { status: true, role: true, parentId: true, displayName: true },
  });
  if (!u || u.status !== "active") return null;
  if (u.role !== payload.role) return null;

  return {
    id: payload.id,
    role: u.role as "reseller_admin" | "customer",
    parentId: u.parentId,
    displayName: u.displayName,
  };
}

export async function setSessionCookie(token: string): Promise<void> {
  // 默认生产环境强制 Secure（仅 HTTPS 传输）；
  // 若部署在纯 HTTP（如直接用 IP 访问、未配 HTTPS），可设 COOKIE_SECURE=false 关闭。
  const secureFlag =
    process.env.COOKIE_SECURE === "false"
      ? false
      : process.env.NODE_ENV === "production";
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureFlag,
    path: "/",
    maxAge: env.JWT_EXPIRES_HOURS * 3600,
  });
}

export async function clearSessionCookie(): Promise<void> {
  cookies().delete(COOKIE_NAME);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
