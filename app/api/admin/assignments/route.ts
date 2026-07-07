/**
 * GET    /api/admin/assignments        列出当前代理商名下所有分配关系
 * POST   /api/admin/assignments        批量分配：{ customerId, ecsResourceUUIDs: [] }
 *
 * 校验：
 *  - 客户存在且属于当前代理商
 *  - 客户未禁用
 *  - 每台服务器必须在该代理商 server_cache 名下
 *  - 同一台服务器同时只能分配给一个客户（DB UNIQUE）
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const rows = await prisma.serverAssignment.findMany({
      where: { resellerId: user.id, status: "active" },
      include: {
        customer: { select: { id: true, displayName: true, username: true } },
        server: {
          select: {
            instanceName: true,
            publicIpAddress: true,
            ecsStatus: true,
            regionName: true,
          },
        },
      },
      orderBy: { assignedAt: "desc" },
    });

    return ok({
      items: rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        customerName: r.customer.displayName,
        customerUsername: r.customer.username,
        ecsResourceUUID: r.ecsResourceUuid,
        instanceName: r.server?.instanceName ?? null,
        publicIpAddress: r.server?.publicIpAddress ?? null,
        ecsStatus: r.server?.ecsStatus ?? null,
        regionName: r.server?.regionName ?? null,
        assignedAt: r.assignedAt,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

const AssignBody = z.object({
  customerId: z.string().min(1),
  ecsResourceUUIDs: z.array(z.string().min(1)).min(1).max(100),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const json = await req.json().catch(() => null);
    const parsed = AssignBody.safeParse(json);
    if (!parsed.success) return err("INVALID_INPUT", "参数错误", 400);
    const { customerId, ecsResourceUUIDs } = parsed.data;

    // 1) 客户校验
    const customer = await prisma.user.findFirst({
      where: { id: customerId, parentId: user.id, role: "customer" },
      select: { id: true, status: true, displayName: true },
    });
    if (!customer) return err("CUSTOMER_NOT_FOUND", "客户不存在", 404);
    if (customer.status !== "active") {
      return err("CUSTOMER_DISABLED", "客户已被禁用，无法分配", 400);
    }

    // 2) 服务器必须在该代理商名下
    const owned = await prisma.serverCache.findMany({
      where: { resellerId: user.id, ecsResourceUuid: { in: ecsResourceUUIDs } },
      select: { ecsResourceUuid: true },
    });
    const ownedSet = new Set(owned.map((s) => s.ecsResourceUuid));
    const unknown = ecsResourceUUIDs.filter((u) => !ownedSet.has(u));
    if (unknown.length > 0) {
      return err(
        "SERVER_NOT_FOUND",
        `以下服务器不属于当前代理商或未同步：${unknown.join(", ")}`,
        400,
      );
    }

    // 3) 已分配给其他客户的先拒绝
    const conflict = await prisma.serverAssignment.findMany({
      where: {
        resellerId: user.id,
        ecsResourceUuid: { in: ecsResourceUUIDs },
        status: "active",
        customerId: { not: customerId },
      },
      select: { ecsResourceUuid: true, customerId: true },
    });
    if (conflict.length > 0) {
      return err(
        "ALREADY_ASSIGNED",
        `以下服务器已分配给其他客户：${conflict
          .map((c) => `${c.ecsResourceUuid} → ${c.customerId}`)
          .join(", ")}`,
        409,
      );
    }

    // 4) 写入：对已存在（同客户、被撤销的）记录重新激活
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      for (const uuid of ecsResourceUUIDs) {
        await tx.serverAssignment.upsert({
          where: {
            resellerId_ecsResourceUuid: {
              resellerId: user.id,
              ecsResourceUuid: uuid,
            },
          },
          create: {
            resellerId: user.id,
            customerId,
            ecsResourceUuid: uuid,
            status: "active",
            assignedAt: now,
          },
          update: {
            customerId,
            status: "active",
            assignedAt: now,
            unassignedAt: null,
          },
        });
      }
    });

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "assign_server",
      requestPayload: { customerId, ecsResourceUUIDs },
    });

    return ok({ assigned: ecsResourceUUIDs.length });
  } catch (e) {
    return handleError(e);
  }
}
