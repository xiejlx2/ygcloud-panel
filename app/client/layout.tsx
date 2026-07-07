import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ClientShell } from "@/components/ClientShell";

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role !== "customer") redirect("/admin/dashboard");
  return <ClientShell>{children}</ClientShell>;
}
