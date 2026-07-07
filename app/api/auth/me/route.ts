import { getSession } from "@/lib/auth";
import { ok, err } from "@/lib/api";

export async function GET() {
  const s = await getSession();
  if (!s) return err("UNAUTHORIZED", "未登录", 401);
  return ok({
    id: s.id,
    role: s.role,
    name: s.displayName,
    parentId: s.parentId,
  });
}
