import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ok, err } from "@/lib/api";

export async function GET() {
  const s = await getSession();
  if (!s) return err("UNAUTHORIZED", "未登录", 401);
  // 客户是否被授予自助重装权限（前端据此显示/隐藏重装入口；后端仍会硬校验）
  const me = await prisma.user.findUnique({
    where: { id: s.id },
    select: { canReinstall: true },
  });
  return ok({
    id: s.id,
    role: s.role,
    name: s.displayName,
    parentId: s.parentId,
    canReinstall: !!me?.canReinstall,
  });
}
