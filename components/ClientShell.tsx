"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "@/components/Logo";
import { UserMenu } from "@/components/UserMenu";
import { IconServer, IconLogs } from "@/components/Icons";

const NAV = [
  { href: "/client/servers", label: "我的服务器", icon: IconServer },
  { href: "/client/logs", label: "操作记录", icon: IconLogs },
];

export function ClientShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-4">
          <Link href="/client/servers" className="flex items-center gap-2">
            <LogoMark className="h-7 w-7" />
            <span className="hidden text-sm font-semibold tracking-tight text-slate-900 sm:block">
              服务器控制台
            </span>
          </Link>
          <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:block" />
          <nav className="flex flex-1 items-center gap-0.5 overflow-x-auto">
            {NAV.map((n) => {
              const active = pathname?.startsWith(n.href);
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
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
          <UserMenu />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-7">{children}</main>
    </div>
  );
}
