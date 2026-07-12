/**
 * 登录页（服务端外壳）：
 * 已登录用户访问 /login 时不再展示表单，直接按角色跳转到各自首页
 * （与 app/admin/layout.tsx / app/client/layout.tsx 的服务端重定向逻辑一致）。
 */
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export default async function LoginPage() {
  const s = await getSession();
  if (s) {
    redirect(s.role === "reseller_admin" ? "/admin/dashboard" : "/client/servers");
  }
  return <LoginForm />;
}
