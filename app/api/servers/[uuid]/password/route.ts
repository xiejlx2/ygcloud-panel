/**
 * POST /api/servers/:uuid/password
 *   修改服务器系统密码。
 *   - 默认仅代理商。客户需通过 PATCH status 之外的方式开启（暂未实现，默认禁止）。
 *   - 限流 3 次/10 分钟。
 *   - 严格强度校验，避免来回请求上游。
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertCanAccessServer } from "@/lib/permissions";
import { modifyInstancePassword } from "@/lib/cloud";
import { validateInstancePassword } from "@/lib/password";
import { ok, err, handleError, getRequestIp, getUserAgent } from "@/lib/api";
import { rateLimit, RL } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

type Ctx = { params: { uuid: string } };

const Body = z.object({ password: z.string().min(1) });

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    if (!user) return err("UNAUTHORIZED", "未登录", 401);

    // 默认仅代理商；客户暂不允许
    if (user.role !== "reseller_admin") {
      return err("FORBIDDEN", "客户暂不允许修改服务器系统密码", 403);
    }
    await assertCanAccessServer(user, ctx.params.uuid);

    if (!rateLimit(`pwd:${ctx.params.uuid}`, RL.modifyPwd)) {
      return err("PWD_RATE_LIMIT", "修改密码操作过于频繁", 429);
    }

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) return err("INVALID_INPUT", "密码必填", 400);

    const strength = validateInstancePassword(parsed.data.password);
    if (!strength.ok) {
      return err("PASSWORD_TOO_WEAK", strength.reasons.join("；"), 400);
    }

    const cache = await prisma.serverCache.findUnique({
      where: {
        resellerId_ecsResourceUuid: {
          resellerId: user.id,
          ecsResourceUuid: ctx.params.uuid,
        },
      },
      select: { regionCode: true, zoneCode: true },
    });
    const result = await modifyInstancePassword(
      user.id,
      ctx.params.uuid,
      parsed.data.password,
      {
        regionCode: cache?.regionCode ?? undefined,
        zoneCode: cache?.zoneCode ?? undefined,
      },
    );
    const taskUuid =
      (result?.asyncTaskUUID as string | undefined) ??
      (result as { asyncTaskUuid?: string })?.asyncTaskUuid ??
      null;

    await writeAudit({
      user,
      ecsResourceUuid: ctx.params.uuid,
      action: "modify_password",
      asyncTaskUuid: taskUuid,
      taskStatus: "PENDING",
      requestIp: getRequestIp(req),
      userAgent: getUserAgent(req),
      // 不记录密码明文
      requestPayload: { length: parsed.data.password.length },
    });

    return ok({ asyncTaskUUID: taskUuid, status: "PENDING" });
  } catch (e) {
    return handleError(e);
  }
}
