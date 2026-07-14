/**
 * GET /api/admin/servers
 *   返回代理商名下全部服务器（合并 server_cache + server_assignments）。
 *
 * POST /api/admin/servers/sync  → 见 /api/admin/servers/sync/route.ts
 */
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { ok, handleError } from "@/lib/api";

export async function GET() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const servers = await prisma.serverCache.findMany({
      where: { resellerId: user.id },
      orderBy: { createdAt: "desc" },
    });

    const assignments = await prisma.serverAssignment.findMany({
      where: { resellerId: user.id, status: "active" },
      include: { customer: { select: { id: true, displayName: true, username: true } } },
    });
    const map = new Map(assignments.map((a) => [a.ecsResourceUuid, a]));

    const items = servers.map((s) => {
      const a = map.get(s.ecsResourceUuid);
      return {
        ecsResourceUUID: s.ecsResourceUuid,
        instanceName: s.instanceName,
        customerAlias: s.customerAlias,
        customerNote: s.customerNote,
        publicIpAddress: s.publicIpAddress,
        internalIpAddress: s.internalIpAddress,
        regionCode: s.regionCode,
        regionName: s.regionName,
        zoneCode: s.zoneCode,
        zoneName: s.zoneName,
        cpu: s.cpu,
        memory: s.memory,
        bandwidth: s.bandwidth,
        osName: s.osName,
        osVersionDetail: s.osVersionDetail,
        ecsStatus: s.ecsStatus,
        ecsPendingStatus: s.ecsPendingStatus,
        expireTime: s.expireTime,
        lastSyncedAt: s.lastSyncedAt,
        assigned: !!a,
        assignedCustomerId: a?.customerId ?? null,
        assignedCustomerName: a?.customer.displayName ?? null,
      };
    });

    return ok({ items });
  } catch (e) {
    return handleError(e);
  }
}
