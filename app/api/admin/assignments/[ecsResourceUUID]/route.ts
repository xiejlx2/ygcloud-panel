/**
 * DELETE /api/admin/assignments/:ecsResourceUUID
 *   取消某台服务器的分配（无论分给谁）。
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

type Ctx = { params: { ecsResourceUUID: string } };

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const result = await prisma.serverAssignment.updateMany({
      where: {
        resellerId: user.id,
        ecsResourceUuid: ctx.params.ecsResourceUUID,
        status: "active",
      },
      data: { status: "revoked", unassignedAt: new Date() },
    });

    if (result.count === 0) {
      return err("NOT_FOUND", "未找到该服务器的活跃分配", 404);
    }

    await writeAudit({
      user,
      ecsResourceUuid: ctx.params.ecsResourceUUID,
      action: "unassign_server",
    });

    return ok({ revoked: result.count });
  } catch (e) {
    return handleError(e);
  }
}
