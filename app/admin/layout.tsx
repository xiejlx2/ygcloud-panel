import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getBranding } from "@/lib/branding";
import { AdminShell } from "@/components/AdminShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role !== "reseller_admin") redirect("/client/servers");
  const b = await getBranding();
  return (
    <AdminShell panelName={b.panelName} logoDataUrl={b.logoDataUrl}>
      {children}
    </AdminShell>
  );
}
