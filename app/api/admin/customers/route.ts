/**
 * GET  /api/admin/customers       列出代理商名下客户
 * POST /api/admin/customers       创建客户
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { hashLoginPassword } from "@/lib/password";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const customers = await prisma.user.findMany({
      where: { parentId: user.id, role: "customer" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        username: true,
        displayName: true,
        status: true,
        remark: true,
        phone: true,
        email: true,
        createdAt: true,
        lastLoginAt: true,
        _count: { select: { assignmentsAsCustomer: { where: { status: "active" } } } },
      },
    });

    return ok({
      items: customers.map((c) => ({
        id: c.id,
        username: c.username,
        displayName: c.displayName,
        status: c.status,
        remark: c.remark,
        phone: c.phone,
        email: c.email,
        createdAt: c.createdAt,
        lastLoginAt: c.lastLoginAt,
        serverCount: c._count.assignmentsAsCustomer,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

const CreateBody = z.object({
  name: z.string().min(1).max(100),
  username: z
    .string()
    .min(3)
    .max(50)
    .regex(/^[A-Za-z0-9_.-]+$/, "登录账号仅允许字母数字、下划线、点、横线"),
  password: z.string().min(8).max(64),
  remark: z.string().max(500).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.string().email().max(100).optional().nullable(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const json = await req.json().catch(() => null);
    const parsed = CreateBody.safeParse(json);
    if (!parsed.success) {
      return err("INVALID_INPUT", parsed.error.issues[0]?.message ?? "参数错误", 400);
    }
    const b = parsed.data;

    const exists = await prisma.user.findUnique({ where: { username: b.username } });
    if (exists) return err("USERNAME_TAKEN", "登录账号已存在", 409);

    const passwordHash = await hashLoginPassword(b.password);
    const c = await prisma.user.create({
      data: {
        parentId: user.id,
        role: "customer",
        username: b.username,
        passwordHash,
        displayName: b.name,
        status: "active",
        remark: b.remark ?? null,
        phone: b.phone ?? null,
        email: b.email ?? null,
      },
    });

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "create_customer",
      requestPayload: { customerId: c.id, username: c.username },
    });

    return ok(
      {
        id: c.id,
        username: c.username,
        displayName: c.displayName,
        status: c.status,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}
