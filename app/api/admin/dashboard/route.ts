/**
 * GET /api/admin/dashboard
 *   代理商后台首页统计。
 */
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { getExpiryInfo } from "@/lib/expiry";
import { ok, handleError } from "@/lib/api";

export async function GET() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const [totalServers, assignedServers, customerCount, token, lastLog, expireRows] =
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
        prisma.serverCache.findMany({
          where: { resellerId: user.id, expireTime: { not: null } },
          select: { expireTime: true },
        }),
      ]);

    // 到期状态统计（回收站 3 天保留规则见 lib/expiry.ts）
    const now = new Date();
    let expiringSoon = 0;
    let recycled = 0;
    for (const r of expireRows) {
      const st = getExpiryInfo(r.expireTime, now).state;
      if (st === "expiring") expiringSoon++;
      else if (st === "recycled" || st === "destroyed") recycled++;
    }

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
        expiringSoon,
        recycled,
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
