/**
 * PATCH /api/servers/:uuid/note
 *   设置服务器的本地别名 / 备注（面板内自定义，不回写上游云平台）。
 *   代理商与客户均可对自己有权访问的服务器设置；同步不会覆盖这两个字段。
 *   请求体：{ alias?: string|null, note?: string|null }
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertCanAccessServer } from "@/lib/permissions";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

type Ctx = { params: { uuid: string } };

const Body = z.object({
  alias: z.string().max(60).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    if (!user) return err("UNAUTHORIZED", "未登录", 401);
    await assertCanAccessServer(user, ctx.params.uuid);

    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return err("INVALID_INPUT", "参数错误", 400);
    if (parsed.data.alias === undefined && parsed.data.note === undefined) {
      return err("INVALID_INPUT", "无可更新字段", 400);
    }

    // 归属代理商：客户取其上级
    const resellerId =
      user.role === "reseller_admin" ? user.id : (user.parentId ?? "");

    const data: Record<string, unknown> = {};
    if (parsed.data.alias !== undefined) data.customerAlias = parsed.data.alias?.trim() || null;
    if (parsed.data.note !== undefined) data.customerNote = parsed.data.note?.trim() || null;

    await prisma.serverCache.update({
      where: { resellerId_ecsResourceUuid: { resellerId, ecsResourceUuid: ctx.params.uuid } },
      data,
    });

    await writeAudit({
      user,
      ecsResourceUuid: ctx.params.uuid,
      action: "set_server_note",
      requestPayload: { alias: data.customerAlias ?? undefined, noteSet: data.customerNote !== undefined },
    });

    return ok({ saved: true });
  } catch (e) {
    return handleError(e);
  }
}
