/**
 * GET /api/servers/:uuid/images
 *   查询该服务器所在地域的可用系统镜像（供重装系统选择）。
 *   仅代理商主账号可调用：镜像列表只服务于重装系统，
 *   重装权限已从最终客户收回，此接口一并收回以减少暴露面。
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
    // 与 reinstall 同步收权：客户侧无重装入口，镜像列表也不再开放
    if (user.role !== "reseller_admin") {
      return err("FORBIDDEN", "仅管理员可查询镜像列表", 403);
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
      select: { regionCode: true },
    });

    const regionCode = cache?.regionCode ?? undefined;
    // 标准镜像 + 应用镜像都拉进来（品牌镜像已在 listAllImages 内强制屏蔽）
    const [system, application] = await Promise.all([
      listAllImages(resellerId, { regionCode, imageType: "System" }),
      listAllImages(resellerId, { regionCode, imageType: "Application" }),
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
