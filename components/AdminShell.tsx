"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import {
  IconDashboard,
  IconServer,
  IconUsers,
  IconLink,
  IconLogs,
  IconKey,
  IconBell,
  IconBrush,
  IconRefresh,
} from "@/components/Icons";

const NAV = [
  { href: "/admin/dashboard", label: "概览", icon: IconDashboard },
  { href: "/admin/servers", label: "服务器", icon: IconServer },
  { href: "/admin/customers", label: "客户", icon: IconUsers },
  { href: "/admin/assignments", label: "分配", icon: IconLink },
  { href: "/admin/logs", label: "操作日志", icon: IconLogs },
  { href: "/admin/notify", label: "通知设置", icon: IconBell },
  { href: "/admin/branding", label: "品牌设置", icon: IconBrush },
  { href: "/admin/token", label: "接入配置", icon: IconKey },
  { href: "/admin/update", label: "系统更新", icon: IconRefresh },
];

export function AdminShell({
  children,
  panelName = "服务器控制台",
  logoDataUrl = null,
}: {
  children: React.ReactNode;
  panelName?: string;
  logoDataUrl?: string | null;
}) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="relative mx-auto max-w-[1440px]">
          <div className="mx-auto grid min-w-0 max-w-6xl grid-cols-[minmax(0,1fr)] items-center gap-x-2 gap-y-1 px-4 py-2 2xl:h-14 2xl:grid-cols-[auto_auto_minmax(0,1fr)] 2xl:gap-y-0 2xl:py-0">
            <Link
              href="/admin/dashboard"
              className="col-start-1 row-start-1 flex min-w-0 max-w-full items-center gap-2 overflow-hidden justify-self-start sm:max-w-[14rem]"
              title={panelName}
            >
              <LogoMark className="h-7 w-7" logoDataUrl={logoDataUrl} />
              <span className="hidden min-w-0 truncate text-sm font-semibold tracking-tight text-slate-900 sm:block">
                {panelName}
              </span>
            </Link>
            <span className="mx-1 hidden h-5 w-px shrink-0 bg-slate-200 2xl:col-start-2 2xl:row-start-1 2xl:block" />
            <nav className="col-start-1 row-start-2 flex min-w-0 items-center gap-0.5 overflow-x-auto overflow-y-hidden pb-0.5 [scrollbar-width:none] 2xl:col-start-3 2xl:row-start-1 2xl:pb-0 [&::-webkit-scrollbar]:hidden">
              {NAV.map((n) => {
                const active = pathname?.startsWith(n.href);
                const Icon = n.icon;
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? "bg-brand-50 font-medium text-brand-700"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {n.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="absolute right-4 top-2 2xl:top-1/2 2xl:-translate-y-1/2">
            <UserMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-7">{children}</main>
    </div>
  );
}
