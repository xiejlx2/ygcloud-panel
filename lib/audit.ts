/**
 * 操作日志写入。所有服务器操作 / 分配 / 同步 / Token 配置都必须写入。
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import type { SessionUser } from "@/lib/types";

export interface AuditInput {
  user: SessionUser;
  ecsResourceUuid: string;
  action: string;
  requestPayload?: unknown;
  asyncTaskUuid?: string | null;
  taskStatus?: string | null;
  processResult?: string | null;
  errMsg?: string | null;
  requestIp?: string | null;
  userAgent?: string | null;
}

/**
 * 一个 reseller_id：客户场景下取 user.parentId，代理商场景下取 user.id。
 */
export async function writeAudit(input: AuditInput): Promise<void> {
  const resellerId =
    input.user.role === "customer"
      ? (input.user.parentId ?? input.user.id)
      : input.user.id;
  await prisma.operationLog.create({
    data: {
      resellerId,
      userId: input.user.id,
      userRole: input.user.role,
      ecsResourceUuid: input.ecsResourceUuid,
      action: input.action,
      requestPayload: input.requestPayload
        ? safeStringify(input.requestPayload)
        : null,
      asyncTaskUuid: input.asyncTaskUuid ?? null,
      taskStatus: input.taskStatus ?? null,
      processResult: input.processResult ?? null,
      errMsg: input.errMsg ?? null,
      requestIp: input.requestIp ?? null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function updateAudit(
  logId: string,
  patch: Partial<{
    asyncTaskUuid: string;
    taskStatus: string;
    processResult: string;
    errMsg: string;
  }>,
): Promise<void> {
  await prisma.operationLog.update({ where: { id: logId }, data: patch });
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
