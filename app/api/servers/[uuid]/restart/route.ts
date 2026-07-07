import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertCanAccessServer } from "@/lib/permissions";
import { restartInstance } from "@/lib/cloud";
import { ok, err, handleError, getRequestIp, getUserAgent } from "@/lib/api";
import { rateLimit, RL } from "@/lib/ratelimit";
import { writeAudit } from "@/lib/audit";

type Ctx = { params: { uuid: string } };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    if (!user) return err("UNAUTHORIZED", "未登录", 401);
    await assertCanAccessServer(user, ctx.params.uuid);

    if (!rateLimit(`power:restart:${ctx.params.uuid}`, RL.powerOp)) {
      return err("POWER_RATE_LIMIT", "操作过于频繁，请稍后再试", 429);
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
    const result = await restartInstance(resellerId, ctx.params.uuid, {
      regionCode: cache?.regionCode ?? undefined,
      zoneCode: cache?.zoneCode ?? undefined,
    });
    const taskUuid =
      (result?.asyncTaskUUID as string | undefined) ??
      (result as { asyncTaskUuid?: string })?.asyncTaskUuid ??
      null;

    await writeAudit({
      user,
      ecsResourceUuid: ctx.params.uuid,
      action: "restart",
      asyncTaskUuid: taskUuid,
      taskStatus: "PENDING",
      requestIp: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    return ok({ asyncTaskUUID: taskUuid, status: "PENDING" });
  } catch (e) {
    return handleError(e);
  }
}
