/**
 * GET /api/servers/:uuid/images
 *   查询该服务器所在地域的可用系统镜像（供重装系统选择）。
 *   代理商始终可调用；客户仅在被代理商授予 canReinstall 后可调用，
 *   且仍必须拥有该服务器的有效分配。
 */
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertCanAccessServer } from "@/lib/permissions";
import { listAllImages } from "@/lib/cloud";
import { ok, err, handleError } from "@/lib/api";

type Ctx = { params: { uuid: string } };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const user = await getSession();
    if (!user) return err("UNAUTHORIZED", "未登录", 401);
    // 与 reinstall 使用同一授权规则，避免“按钮已开放但镜像列表 403”。
    if (user.role !== "reseller_admin") {
      const me = await prisma.user.findUnique({
        where: { id: user.id },
        select: { canReinstall: true },
      });
      if (!me?.canReinstall) {
        return err("FORBIDDEN", "重装系统未对你开放", 403);
      }
    }
    await assertCanAccessServer(user, ctx.params.uuid);

    const resellerId =
      user.role === "reseller_admin" ? user.id : (user.parentId ?? "");
    const cache = await prisma.serverCache.findUnique({
      where: {
        resellerId_ecsResourceUuid: {
          resellerId,
          ecsResourceUuid: ctx.params.uuid,
        },
      },
      select: { regionCode: true, apiTokenId: true },
    });

    const regionCode = cache?.regionCode ?? undefined;
    // 标准镜像 + 应用镜像都拉进来（品牌镜像已在 listAllImages 内强制屏蔽）
    const [system, application] = await Promise.all([
      listAllImages(resellerId, {
        regionCode,
        imageType: "System",
        apiTokenId: cache?.apiTokenId ?? undefined,
      }),
      listAllImages(resellerId, {
        regionCode,
        imageType: "Application",
        apiTokenId: cache?.apiTokenId ?? undefined,
      }),
    ]);

    const toItem = (i: (typeof system)[number], fallbackType: string) => ({
      imageResourceUUID: i.imageResourceUUID,
      imageName: i.imageName ?? null,
      osVersion: i.osVersion ?? null,
      osVersionDetail: i.osVersionDetail ?? null,
      imageType: i.imageType ?? fallbackType,
      imageAccount: i.imageAccount ?? null,
    });

    return ok({
      items: [
        ...system.map((i) => toItem(i, "System")),
        ...application.map((i) => toItem(i, "Application")),
      ],
    });
  } catch (e) {
    return handleError(e);
  }
}
