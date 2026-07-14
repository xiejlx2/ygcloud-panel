/**
 * GET /api/client/servers
 *   客户子账号查看分配给自己的服务器。
 *   后端必须按分配关系过滤，不能只靠前端隐藏。
 *
 *   流程：
 *   1) 取当前登录客户 id
 *   2) 查 server_assignments(status=active, customerId=me)
 *   3) 命中的 ecsResourceUuid 列表
 *   4) 合并 server_cache（含 lastSyncedAt 缓存数据）
 *   5) 可选后台刷新：调用上游 /instance/list 更新状态（异步、不阻塞响应）
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ok, err, handleError } from "@/lib/api";
import { rateLimit, RL } from "@/lib/ratelimit";

// 缓存被视为“新鲜”的窗口：此窗口内不触发后台刷新
const CACHE_FRESH_MS = 60 * 1000;

export async function GET(req: NextRequest) {
  try {
    const user = await getSession();
    if (!user) return err("UNAUTHORIZED", "未登录", 401);
    if (user.role !== "customer") {
      return err("FORBIDDEN", "仅客户可访问该端点", 403);
    }

    const assignments = await prisma.serverAssignment.findMany({
      where: { customerId: user.id, status: "active" },
      select: { ecsResourceUuid: true },
    });
    const uuids = assignments.map((a) => a.ecsResourceUuid);
    if (uuids.length === 0) return ok({ items: [] });

    const servers = await prisma.serverCache.findMany({
      where: {
        // 代理商维度（resellerId = parent）+ 命中分配
        resellerId: user.parentId ?? "",
        ecsResourceUuid: { in: uuids },
      },
      orderBy: { instanceName: "asc" },
    });

    // 静默后台刷新状态：不 await，不影响响应。
    // 双重节流：① 缓存仍新鲜则不刷新；② 按代理商维度限流，
    // 无论多少客户同时刷新，60 秒内对上游最多扇出一轮，避免放大攻击/打挂 Token。
    const freshestSync = servers.reduce(
      (max, s) => Math.max(max, s.lastSyncedAt.getTime()),
      0,
    );
    const stale = Date.now() - freshestSync > CACHE_FRESH_MS;
    if (
      user.parentId &&
      stale &&
      rateLimit(`clientRefresh:${user.parentId}`, RL.clientRefresh)
    ) {
      void refreshInBackground(user.parentId, uuids).catch(() => void 0);
    }

    return ok({
      items: servers.map((s) => ({
        ecsResourceUUID: s.ecsResourceUuid,
        instanceName: s.instanceName,
        customerAlias: s.customerAlias,
        customerNote: s.customerNote,
        publicIpAddress: s.publicIpAddress,
        internalIpAddress: s.internalIpAddress,
        regionName: s.regionName,
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
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

async function refreshInBackground(
  resellerId: string | null,
  uuids: string[],
) {
  if (!resellerId) return;
  // 仅刷新状态字段（最简实现：调用 listInstances 后批量更新命中项）
  const { listInstances } = await import("@/lib/cloud");
  const list = await listInstances(resellerId);
  const set = new Set(uuids);
  const now = new Date();
  for (const it of list) {
    if (!it.ecsResourceUUID || !set.has(it.ecsResourceUUID)) continue;
    await prisma.serverCache
      .update({
        where: {
          resellerId_ecsResourceUuid: {
            resellerId,
            ecsResourceUuid: it.ecsResourceUUID,
          },
        },
        data: {
          ecsStatus: it.ecsStatus ?? undefined,
          ecsPendingStatus: it.ecsPendingStatus ?? undefined,
          // 到期时间一并刷新：续费后客户侧的到期/回收站提示能及时消除
          expireTime: parseExpire(it.expireTime),
          lastSyncedAt: now,
        },
      })
      .catch(() => void 0);
  }
}

/** 无效/缺失的到期时间返回 undefined（保持库中原值不动）。 */
function parseExpire(v?: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
