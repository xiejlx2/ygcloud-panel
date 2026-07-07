"use client";

/** 右上角用户菜单：显示名首字母头像 + 下拉（角色 / 退出）。 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api } from "@/components/Api";
import { IconChevronDown, IconLogout } from "@/components/Icons";

interface Me {
  id: string;
  role: string;
  name: string;
}

export function UserMenu() {
  const router = useRouter();
  const { data } = useSWR<Me>("/api/auth/me", api);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => void 0);
    router.replace("/login");
  }

  const name = data?.name || "…";
  const roleLabel =
    data?.role === "reseller_admin" ? "管理员" : data?.role === "customer" ? "客户" : "";
  const initial = name.trim().charAt(0).toUpperCase() || "U";

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 text-sm transition-colors hover:bg-slate-100"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
          {initial}
        </span>
        <span className="hidden max-w-[120px] truncate text-slate-700 sm:block">
          {name}
        </span>
        <IconChevronDown className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 w-48 animate-fade-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
          <div className="border-b border-slate-100 px-3.5 py-3">
            <div className="truncate text-sm font-medium text-slate-800">{name}</div>
            {roleLabel && (
              <div className="mt-0.5 text-xs text-slate-400">{roleLabel}</div>
            )}
          </div>
          <button
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-red-600"
            onClick={logout}
          >
            <IconLogout className="h-4 w-4" />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
