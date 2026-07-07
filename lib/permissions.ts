/**
 * 权限校验：所有针对服务器的操作都必须走这里。
 * 前端隐藏按钮 ≠ 权限控制；后端必须每次校验。
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/types";

export class Forbidden extends Error {
  code = "FORBIDDEN";
  constructor(message = "无权访问该资源") {
    super(message);
  }
}

export class NotFound extends Error {
  code = "NOT_FOUND";
  constructor(message = "资源不存在") {
    super(message);
  }
}

export function assertIsResellerAdmin(user: SessionUser | null): asserts user {
  if (!user) throw new Forbidden("未登录");
  if (user.role !== "reseller_admin") {
    throw new Forbidden("仅代理商主账号可执行该操作");
  }
}

/** 仅校验当前 user 是否为 reseller_admin；不抛出。 */
export function isResellerAdmin(user: SessionUser | null): boolean {
  return !!user && user.role === "reseller_admin";
}

/**
 * 校验某台服务器属于当前代理商。
 * 代理商主账号对其 reseller_id 名下所有 server_cache 都视为有权。
 */
export async function serverBelongsToReseller(
  resellerId: string,
  ecsResourceUuid: string,
): Promise<boolean> {
  const cnt = await prisma.serverCache.count({
    where: { resellerId, ecsResourceUuid },
  });
  return cnt > 0;
}

/** 校验某台服务器当前是否被分配给某客户。 */
export async function serverAssignedToCustomer(
  customerId: string,
  ecsResourceUuid: string,
): Promise<boolean> {
  const cnt = await prisma.serverAssignment.count({
    where: {
      customerId,
      ecsResourceUuid,
      status: "active",
    },
  });
  return cnt > 0;
}

/**
 * 统一入口：任何对单台服务器的操作都要先调用。
 * - reseller_admin：服务器必须存在于该代理商名下，否则视为不存在（防止越权探测）
 * - customer：必须当前 active 分配给该客户
 */
export async function assertCanAccessServer(
  user: SessionUser,
  ecsResourceUuid: string,
): Promise<void> {
  if (user.role === "reseller_admin") {
    const ok = await serverBelongsToReseller(user.id, ecsResourceUuid);
    if (!ok) throw new NotFound("服务器不存在或未同步");
    return;
  }
  if (user.role === "customer") {
    if (!user.parentId) throw new Forbidden("客户缺少代理商归属");
    const ok = await serverAssignedToCustomer(user.id, ecsResourceUuid);
    if (!ok) throw new Forbidden("该服务器未分配给当前客户");
    return;
  }
  throw new Forbidden();
}

/** 校验对某客户的操作权限：代理商可管理自己名下客户。 */
export async function assertCanManageCustomer(
  user: SessionUser,
  customerId: string,
): Promise<void> {
  assertIsResellerAdmin(user);
  const c = await prisma.user.findFirst({
    where: { id: customerId, parentId: user.id, role: "customer" },
    select: { id: true },
  });
  if (!c) throw new NotFound("客户不存在或不属于当前代理商");
}
