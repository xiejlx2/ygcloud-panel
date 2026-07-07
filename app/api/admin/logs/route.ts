/**
 * GET /api/admin/logs
 *   代理商查看全部操作日志。支持分页与过滤。
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { ok, handleError } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") || "1"));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") || "20")));
    const action = sp.get("action") || undefined;
    const userId = sp.get("userId") || undefined;
    const ecs = sp.get("ecsResourceUUID") || undefined;

    const where = {
      resellerId: user.id,
      ...(action ? { action } : {}),
      ...(userId ? { userId } : {}),
      ...(ecs ? { ecsResourceUuid: ecs } : {}),
    };

    const [total, rows] = await Promise.all([
      prisma.operationLog.count({ where }),
      prisma.operationLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { displayName: true, username: true } },
        },
      }),
    ]);

    return ok({
      page,
      pageSize,
      total,
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        userId: r.userId,
        userName: r.user.displayName,
        userUsername: r.user.username,
        userRole: r.userRole,
        ecsResourceUUID: r.ecsResourceUuid,
        action: r.action,
        taskStatus: r.taskStatus,
        processResult: r.processResult,
        asyncTaskUUID: r.asyncTaskUuid,
        errMsg: r.errMsg,
        requestIp: r.requestIp,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
