/**
 * GET /api/tasks/:uuid
 *   轮询异步任务结果。后端调用上游 /asynctask/getResult。
 *   同时回写最近一条对应日志的 taskStatus/processResult/errMsg。
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getAsyncTaskResult } from "@/lib/cloud";
import { ok, err, handleError } from "@/lib/api";

type Ctx = { params: { uuid: string } };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    if (!user) return err("UNAUTHORIZED", "未登录", 401);

    // 找到对应日志（用于鉴权 + 后续回写）
    const log = await prisma.operationLog.findFirst({
      where: { asyncTaskUuid: ctx.params.uuid },
      orderBy: { createdAt: "desc" },
    });

    // 无归属日志 = 无权。绝不能在 log 为空时放行 —— 否则客户可枚举任意
    // asyncTaskUUID，借代理商 Token 查询到不属于自己的任务结果（越权信息泄露）。
    if (!log) return err("FORBIDDEN", "无权查看该任务", 403);

    // 鉴权：代理商只能查自己名下日志；客户只能查自己发起的日志
    if (user.role === "reseller_admin") {
      if (log.resellerId !== user.id) return err("FORBIDDEN", "无权查看该任务", 403);
    } else {
      if (log.userId !== user.id) return err("FORBIDDEN", "无权查看该任务", 403);
    }

    // 以日志归属的代理商发起调用，确保用到的 Token 与任务所属租户一致
    const resellerId = log.resellerId;
    const t = await getAsyncTaskResult(resellerId, ctx.params.uuid);

    if (log && t.taskStatus) {
      await prisma.operationLog
        .update({
          where: { id: log.id },
          data: {
            taskStatus: t.taskStatus ?? log.taskStatus,
            processResult: t.processResult ?? log.processResult,
            errMsg: t.errMsg ?? log.errMsg,
          },
        })
        .catch(() => void 0);
    }

    return ok({
      taskStatus: t.taskStatus ?? null,
      processResult: t.processResult ?? null,
      errMsg: t.errMsg ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
}
