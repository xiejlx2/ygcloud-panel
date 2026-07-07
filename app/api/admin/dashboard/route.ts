/**
 * GET /api/admin/dashboard
 *   代理商后台首页统计。
 */
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { ok, handleError } from "@/lib/api";

export async function GET() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const [totalServers, assignedServers, customerCount, token, lastLog] =
      await Promise.all([
        prisma.serverCache.count({ where: { resellerId: user.id } }),
        prisma.serverAssignment.count({
          where: { resellerId: user.id, status: "active" },
        }),
        prisma.user.count({
          where: { parentId: user.id, role: "customer" },
        }),
        prisma.resellerApiToken.findUnique({
          where: { resellerId: user.id },
          select: {
            status: true,
            tokenSuffix: true,
            lastVerifiedAt: true,
            tokenKeyHint: true,
          },
        }),
        prisma.operationLog.findFirst({
          where: { resellerId: user.id },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            action: true,
            createdAt: true,
            user: { select: { displayName: true } },
          },
        }),
      ]);

    const recentLogs = lastLog
      ? [
          {
            id: lastLog.id,
            action: lastLog.action,
            createdAt: lastLog.createdAt,
            userName: lastLog.user.displayName,
          },
        ]
      : [];

    return ok({
      servers: {
        total: totalServers,
        assigned: assignedServers,
        unassigned: Math.max(0, totalServers - assignedServers),
      },
      customers: customerCount,
      token: token
        ? {
            configured: true,
            status: token.status,
            tokenSuffix: token.tokenSuffix,
            lastVerifiedAt: token.lastVerifiedAt,
          }
        : { configured: false },
      recentLogs,
    });
  } catch (e) {
    return handleError(e);
  }
}
