/**
 * POST /api/servers/:uuid/reinstall
 *   重装服务器操作系统（异步、破坏性）。
 *   - 仅代理商主账号可执行：重装会清空全部数据，为防止客户误操作导致数据丢失，
 *     该权限不下放给最终客户（客户如需重装，联系其代理商操作）。
 *   - 严格限流 1 次 / 5 分钟。
 *   - 强制密码强度校验（重装会重置 root/Administrator 密码）。
 *   - 上游要求服务器需先关机；未关机时由上游返回错误，前端透传。
 *   请求体：{ imageResourceUUID, password }
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertCanAccessServer } from "@/lib/permissions";
import { reinstallSystem } from "@/lib/cloud";
import { validateInstancePassword } from "@/lib/password";
import { ok, err, handleError, getRequestIp, getUserAgent } from "@/lib/api";
import { rateLimit, RL } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

type Ctx = { params: { uuid: string } };

const Body = z.object({
  imageResourceUUID: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    if (!user) return err("UNAUTHORIZED", "未登录", 401);
    // 重装为破坏性操作。代理商始终可用；客户仅当被代理商授予 canReinstall 时可用。
    // 前端隐藏按钮不算权限控制，必须在此硬校验（回查数据库当前权限，防旧会话/篡改）。
    if (user.role !== "reseller_admin") {
      const me = await prisma.user.findUnique({
        where: { id: user.id },
        select: { canReinstall: true },
      });
      if (!me?.canReinstall) {
        return err("FORBIDDEN", "重装系统未对你开放，如有需要请联系您的服务商", 403);
      }
    }
    await assertCanAccessServer(user, ctx.params.uuid);

    if (!rateLimit(`reinstall:${ctx.params.uuid}`, RL.reinstall)) {
      return err("REINSTALL_RATE_LIMIT", "重装操作过于频繁，请 5 分钟后再试", 429);
    }

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return err("INVALID_INPUT", "参数错误", 400);

    const strength = validateInstancePassword(parsed.data.password);
    if (!strength.ok) {
      return err("PASSWORD_TOO_WEAK", strength.reasons.join("；"), 400);
    }

    const resellerId =
      user.role === "reseller_admin" ? user.id : (user.parentId ?? "");
    const cache = await prisma.serverCache.findUnique({
      where: {
        resellerId_ecsResourceUuid: {
          resellerId,
          ecsResourceUuid: ctx.params.uuid,
        },
      },
      select: { regionCode: true, zoneCode: true },
    });
    if (!cache?.regionCode) {
      return err("REGION_UNKNOWN", "缺少服务器地域信息，请先在管理端同步服务器", 400);
    }

    const result = await reinstallSystem(resellerId, ctx.params.uuid, {
      imageResourceUUID: parsed.data.imageResourceUUID,
      password: parsed.data.password,
      regionCode: cache.regionCode,
      zoneCode: cache.zoneCode ?? undefined,
    });
    const taskUuid =
      (result?.asyncTaskUUID as string | undefined) ??
      (result as { asyncTaskUuid?: string })?.asyncTaskUuid ??
      null;

    await writeAudit({
      user,
      ecsResourceUuid: ctx.params.uuid,
      action: "reinstall_system",
      asyncTaskUuid: taskUuid,
      taskStatus: "PENDING",
      requestIp: getRequestIp(req),
      userAgent: getUserAgent(req),
      // 记录目标镜像，绝不记录密码明文
      requestPayload: { imageResourceUUID: parsed.data.imageResourceUUID },
    });

    return ok({ asyncTaskUUID: taskUuid, status: "PENDING" });
  } catch (e) {
    return handleError(e);
  }
}
