/**
 * GET    /api/admin/customers/:id        客户详情（含分配的服务器列表）
 * PATCH  /api/admin/customers/:id        编辑（备注/手机/邮箱/status）
 * POST   /api/admin/customers/:id/reset  重置密码（独立 route）
 * DELETE /api/admin/customers/:id        禁用账号（status=disabled）
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin, assertCanManageCustomer } from "@/lib/permissions";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

type Ctx = { params: { id: string } };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);
    await assertCanManageCustomer(user, ctx.params.id);

    const c = await prisma.user.findFirst({
      where: { id: ctx.params.id, parentId: user.id, role: "customer" },
      include: {
        assignmentsAsCustomer: {
          where: { status: "active" },
          include: { server: true },
        },
      },
    });
    if (!c) return err("NOT_FOUND", "客户不存在", 404);

    return ok({
      id: c.id,
      username: c.username,
      displayName: c.displayName,
      status: c.status,
      remark: c.remark,
      phone: c.phone,
      email: c.email,
      createdAt: c.createdAt,
      lastLoginAt: c.lastLoginAt,
      servers: c.assignmentsAsCustomer.map((a) => ({
        ecsResourceUUID: a.ecsResourceUuid,
        instanceName: a.server?.instanceName ?? null,
        publicIpAddress: a.server?.publicIpAddress ?? null,
        ecsStatus: a.server?.ecsStatus ?? null,
        assignedAt: a.assignedAt,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

const PatchBody = z.object({
  displayName: z.string().min(1).max(100).optional(),
  remark: z.string().max(500).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.string().email().max(100).nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);
    await assertCanManageCustomer(user, ctx.params.id);

    const json = await req.json().catch(() => null);
    const parsed = PatchBody.safeParse(json);
    if (!parsed.success) return err("INVALID_INPUT", "参数错误", 400);

    const updated = await prisma.user.update({
      where: { id: ctx.params.id },
      data: parsed.data,
      select: { id: true, displayName: true, status: true, remark: true },
    });
    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "update_customer",
      requestPayload: { customerId: ctx.params.id, patch: parsed.data },
    });
    return ok(updated);
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);
    await assertCanManageCustomer(user, ctx.params.id);

    // 软删除：仅标记禁用，并撤销该客户名下所有分配
    await prisma.$transaction([
      prisma.user.update({
        where: { id: ctx.params.id },
        data: { status: "disabled" },
      }),
      prisma.serverAssignment.updateMany({
        where: { customerId: ctx.params.id, status: "active" },
        data: { status: "revoked", unassignedAt: new Date() },
      }),
    ]);

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "disable_customer",
      requestPayload: { customerId: ctx.params.id },
    });
    return ok({ disabled: true });
  } catch (e) {
    return handleError(e);
  }
}
