/**
 * GET /api/servers/:uuid
 *   服务器详情。代理商 / 客户通用，但权限校验不同：
 *   - reseller_admin：必须属于该代理商
 *   - customer：必须被分配给该客户
 *   返回前先调用上游 /instance/detail 拿最新状态（失败则回退到本地缓存）。
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertCanAccessServer } from "@/lib/permissions";
import { getInstanceDetail, CloudApiError } from "@/lib/cloud";
import { ok, handleError } from "@/lib/api";

type Ctx = { params: { uuid: string } };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    if (!user) {
      return Response.json(
        { ok: false, error: { code: "UNAUTHORIZED", message: "未登录" } },
        { status: 401 },
      );
    }
    await assertCanAccessServer(user, ctx.params.uuid);

    // 本地缓存
    const cached = await prisma.serverCache.findUnique({
      where: {
        resellerId_ecsResourceUuid: {
          resellerId: user.role === "reseller_admin" ? user.id : (user.parentId ?? ""),
          ecsResourceUuid: ctx.params.uuid,
        },
      },
    });

    // 取最新详情（失败回退本地缓存）
    const resellerId = user.role === "reseller_admin" ? user.id : (user.parentId ?? "");
    let live: Awaited<ReturnType<typeof getInstanceDetail>> = null;
    try {
      live = await getInstanceDetail(resellerId, ctx.params.uuid, {
        regionCode: cached?.regionCode ?? undefined,
        zoneCode: cached?.zoneCode ?? undefined,
      });
    } catch (e) {
      // 客户可能因为 Token 没配置/网络抖动等情况无法拉到，回退缓存
      if (!(e instanceof CloudApiError)) throw e;
    }

    const merged = {
      ecsResourceUUID: ctx.params.uuid,
      instanceName: live?.instanceName ?? cached?.instanceName ?? null,
      publicIpAddress: live?.publicIpAddress ?? cached?.publicIpAddress ?? null,
      internalIpAddress: live?.internalIpAddress ?? cached?.internalIpAddress ?? null,
      regionCode: live?.regionCode ?? cached?.regionCode ?? null,
      regionName: live?.regionName ?? cached?.regionName ?? null,
      zoneCode: live?.zoneCode ?? cached?.zoneCode ?? null,
      zoneName: live?.zoneName ?? cached?.zoneName ?? null,
      cpu: live?.cpu ?? cached?.cpu ?? null,
      memory: live?.memory ?? cached?.memory ?? null,
      bandwidth: live?.bandwidth ?? cached?.bandwidth ?? null,
      osName: live?.osName ?? cached?.osName ?? null,
      osVersionDetail: live?.osVersionDetail ?? cached?.osVersionDetail ?? null,
      ecsStatus: live?.ecsStatus ?? cached?.ecsStatus ?? null,
      ecsPendingStatus: live?.ecsPendingStatus ?? cached?.ecsPendingStatus ?? null,
      expireTime: live?.expireTime ?? cached?.expireTime?.toISOString() ?? null,
      lastSyncedAt: cached?.lastSyncedAt ?? null,
    };

    return ok(merged);
  } catch (e) {
    return handleError(e);
  }
}
