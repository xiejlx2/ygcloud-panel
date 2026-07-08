/**
 * POST /api/admin/customers/:id/reset
 *   代理商重置客户登录密码。请求体：{ password }
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin, assertCanManageCustomer } from "@/lib/permissions";
import { hashLoginPassword } from "@/lib/password";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

const Body = z.object({ password: z.string().min(8).max(64) });

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);
    await assertCanManageCustomer(user, ctx.params.id);

    const json = await req.json().catch(() => null);
    const parsed = Body.safeParse(json);
    if (!parsed.success) return err("INVALID_INPUT", "密码至少 8 位", 400);

    const hash = await hashLoginPassword(parsed.data.password);
    await prisma.user.update({
      where: { id: ctx.params.id },
      // tokenVersion +1：让该客户所有已登录会话立即失效，必须用新密码重新登录
      data: { passwordHash: hash, tokenVersion: { increment: 1 } },
    });

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "reset_customer_password",
      requestPayload: { customerId: ctx.params.id },
    });

    return ok({ reset: true });
  } catch (e) {
    return handleError(e);
  }
}
