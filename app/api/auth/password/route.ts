/**
 * POST /api/auth/password
 *   当前登录用户（代理商 / 客户通用）自助修改登录密码。
 *   请求体：{ oldPassword, newPassword }
 *   - 必须先验证旧密码，防止拿到未锁屏会话的人直接改密。
 *   - 成功后 tokenVersion +1 使该用户所有旧会话立即失效，
 *     并用新版本重签当前会话 cookie，本人无需重新登录。
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, signSession, setSessionCookie } from "@/lib/auth";
import {
  hashLoginPassword,
  verifyLoginPassword,
  validateLoginPassword,
} from "@/lib/password";
import { ok, err, handleError, getRequestIp, getUserAgent } from "@/lib/api";
import { rateLimit, RL } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

const Body = z.object({
  oldPassword: z.string().min(1).max(128),
  newPassword: z.string().min(1).max(128),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return err("UNAUTHORIZED", "未登录", 401);

    if (!rateLimit(`loginPwdChange:${user.id}`, RL.loginPwdChange)) {
      return err("RATE_LIMIT", "修改过于频繁，请稍后再试", 429);
    }

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) return err("INVALID_INPUT", "参数错误", 400);
    const { oldPassword, newPassword } = parsed.data;

    const strength = validateLoginPassword(newPassword);
    if (!strength.ok) {
      return err("PASSWORD_TOO_WEAK", strength.reasons.join("；"), 400);
    }
    if (newPassword === oldPassword) {
      return err("PASSWORD_UNCHANGED", "新密码不能与旧密码相同", 400);
    }

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!row) return err("UNAUTHORIZED", "未登录", 401);

    const oldOk = await verifyLoginPassword(oldPassword, row.passwordHash);
    if (!oldOk) return err("OLD_PASSWORD_WRONG", "旧密码不正确", 400);

    // tokenVersion +1：所有旧会话（其他设备/浏览器）立即失效
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashLoginPassword(newPassword),
        tokenVersion: { increment: 1 },
      },
      select: { tokenVersion: true },
    });

    // 用新版本重签当前会话，本人不被踢出
    await setSessionCookie(signSession(user, updated.tokenVersion));

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "change_login_password",
      requestIp: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return ok({ changed: true });
  } catch (e) {
    return handleError(e);
  }
}
