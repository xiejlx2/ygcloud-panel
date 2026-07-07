import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export default async function Root() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role === "reseller_admin") redirect("/admin/dashboard");
  redirect("/client/servers");
}
