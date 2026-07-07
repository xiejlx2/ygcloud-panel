/**
 * GET /api/client/logs
 *   客户查看自己的操作日志（强制按 userId 过滤，绝不能看其他人）。
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ok, err, handleError } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return err("UNAUTHORIZED", "未登录", 401);
    if (user.role !== "customer") {
      return err("FORBIDDEN", "仅客户可访问该端点", 403);
    }

    const sp = req.nextUrl.searchParams;
    const page = Math.max(1, Number(sp.get("page") || "1"));
    const pageSize = Math.min(100, Math.max(1, Number(sp.get("pageSize") || "20")));

    const where = { userId: user.id };
    const [total, rows] = await Promise.all([
      prisma.operationLog.count({ where }),
      prisma.operationLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return ok({
      page,
      pageSize,
      total,
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        ecsResourceUUID: r.ecsResourceUuid,
        action: r.action,
        taskStatus: r.taskStatus,
        processResult: r.processResult,
        errMsg: r.errMsg,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
