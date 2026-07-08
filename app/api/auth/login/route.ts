/**
 * POST /api/auth/login
 * 请求体：{ username, password }
 * 成功返回：{ token, user: { id, role, name } }，并以 httpOnly cookie 下发会话。
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyLoginPassword } from "@/lib/password";
import { signSession, setSessionCookie } from "@/lib/auth";
import { getSession } from "@/lib/auth";
import { ok, err, handleError, getRequestIp, getUserAgent } from "@/lib/api";
import { rateLimit, RL } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

const Body = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(128),
});

// 取不到客户端 IP 时打一次服务端告警（不随请求刷屏），提示运维检查部署配置。
let warnedNoIp = false;
function warnNoIpOnce(): void {
  if (warnedNoIp) return;
  warnedNoIp = true;
  console.warn(
    "[login] 无法获取客户端 IP，登录限流已降级为用户名维度。" +
      "若部署在可信反代（Nginx/Caddy/CF）之后，请设置 TRUST_PROXY_HEADERS=true。",
  );
}

export async function POST(req: NextRequest) {
  try {
    // 已登录则拒绝再次登录（防误用）
    const cur = await getSession();
    if (cur) return err("ALREADY_LOGGED_IN", "已登录，请先退出", 400);

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return err("INVALID_INPUT", "账号或密码格式错误", 400);
    }
    const { username, password } = parsed.data;

    // 限流：以 IP 为主要防线；用户名仅在“同 IP”维度限流。
    // 不对“裸用户名”做全局硬限流 —— 否则攻击者狂发某个已知账号(如 admin)
    // 即可把该账号锁死，造成针对合法用户的账号锁定型 DoS。
    const ip = getRequestIp(req);
    if (ip) {
      if (!rateLimit(`login:ip:${ip}`, RL.login)) {
        return err("LOGIN_RATE_LIMIT", "登录尝试过于频繁，请稍后再试", 429);
      }
      // 用户名+IP 组合：限制单一来源对同一账号的爆破，但不影响其他来源的合法登录
      if (!rateLimit(`login:combo:${username}:${ip}`, RL.login)) {
        return err("LOGIN_RATE_LIMIT", "登录尝试过于频繁，请稍后再试", 429);
      }
    } else {
      // 取不到客户端 IP（直连部署且运行时未提供对端地址，或未配置
      // TRUST_PROXY_HEADERS）：不能让所有人共享一个 5 次的小桶 ——
      // 那等于攻击者发 5 个请求就能锁死全站登录。降级策略：
      //  1) 按用户名限流：单个账号仍只有 5 次 / 10 分钟，阻断定向爆破；
      //  2) 全局宽松兜底：阻断跨大量用户名的无差别爆破。
      // 代价：攻击者可锁定“他知道的某个用户名”（无 IP 信息时无法避免）。
      // 生产环境应部署在可信反代后并设置 TRUST_PROXY_HEADERS=true 以启用 IP 维度限流。
      warnNoIpOnce();
      if (!rateLimit(`login:user:${username}`, RL.login)) {
        return err("LOGIN_RATE_LIMIT", "登录尝试过于频繁，请稍后再试", 429);
      }
      if (!rateLimit("login:global", RL.loginGlobal)) {
        return err("LOGIN_RATE_LIMIT", "登录尝试过于频繁，请稍后再试", 429);
      }
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || user.status !== "active") {
      return err("LOGIN_FAILED", "账号或密码错误", 401);
    }
    const pwdOk = await verifyLoginPassword(password, user.passwordHash);
    if (!pwdOk) {
      return err("LOGIN_FAILED", "账号或密码错误", 401);
    }

    // 签发 JWT 并写入 httpOnly cookie（携带当前会话版本）
    const token = signSession(
      {
        id: user.id,
        role: user.role as "reseller_admin" | "customer",
        parentId: user.parentId,
        displayName: user.displayName,
      },
      user.tokenVersion,
    );
    await setSessionCookie(token);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 登录也写一条日志（ecs 用占位）
    await writeAudit({
      user: {
        id: user.id,
        role: user.role as "reseller_admin" | "customer",
        parentId: user.parentId,
        displayName: user.displayName,
      },
      ecsResourceUuid: "-",
      action: "login",
      requestIp: ip,
      userAgent: getUserAgent(req),
    });

    // 不在响应体返回 token：会话完全依赖 httpOnly cookie，
    // body 里再带一份只会徒增泄露面（易被日志/前端存储无意留存）。
    return ok({
      user: {
        id: user.id,
        role: user.role,
        name: user.displayName,
        parentId: user.parentId,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
