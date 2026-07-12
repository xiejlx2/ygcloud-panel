"use client";

import useSWR from "swr";
import Link from "next/link";
import { api } from "@/components/Api";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { StatSkeleton, Skeleton } from "@/components/Skeleton";
import {
  IconServer,
  IconLink,
  IconKey,
  IconUsers,
  IconAlert,
} from "@/components/Icons";

interface Dashboard {
  servers: {
    total: number;
    assigned: number;
    unassigned: number;
    expiringSoon: number;
    recycled: number;
  };
  customers: number;
  token: {
    configured: boolean;
    status?: string;
    tokenSuffix?: string;
    lastVerifiedAt?: string;
  };
  recentLogs: { id: string; action: string; createdAt: string; userName: string }[];
}

const STATS = [
  { key: "total", label: "服务器总数", icon: IconServer, color: "text-brand bg-brand-50", href: "/admin/servers" },
  { key: "assigned", label: "已分配", icon: IconLink, color: "text-emerald-600 bg-emerald-50", href: null },
  { key: "unassigned", label: "未分配", icon: IconServer, color: "text-amber-600 bg-amber-50", href: null },
  { key: "customers", label: "客户数量", icon: IconUsers, color: "text-indigo-600 bg-indigo-50", href: "/admin/customers" },
  { key: "expiringSoon", label: "7 天内到期", icon: IconAlert, color: "text-amber-600 bg-amber-50", href: "/admin/servers?expiry=expiring" },
  { key: "recycled", label: "回收站", icon: IconAlert, color: "text-red-600 bg-red-50", href: "/admin/servers?expiry=recycled" },
] as const;

export default function DashboardPage() {
  const { data, error, isLoading } = useSWR<Dashboard>(
    "/api/admin/dashboard",
    api,
  );

  const values: Record<string, number> = data
    ? {
        total: data.servers.total,
        assigned: data.servers.assigned,
        unassigned: data.servers.unassigned,
        customers: data.customers,
        expiringSoon: data.servers.expiringSoon,
        recycled: data.servers.recycled,
      }
    : {};

  const expiryAlert =
    data && (data.servers.expiringSoon > 0 || data.servers.recycled > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="概览" subtitle="资源与客户的整体情况" />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      {expiryAlert && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {data!.servers.expiringSoon > 0 && (
              <>有 <b>{data!.servers.expiringSoon}</b> 台服务器将在 7 天内到期；</>
            )}
            {data!.servers.recycled > 0 && (
              <>有 <b>{data!.servers.recycled}</b> 台已到期进入回收站，
              超过 3 天将被<b>永久销毁</b>；</>
            )}
            请尽快前往云平台续费，或在{" "}
            <Link className="font-medium underline" href="/admin/servers">
              服务器列表
            </Link>{" "}
            查看明细。
          </div>
        </div>
      )}

      {data && !data.token.configured && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            尚未配置 API 接入凭据，请前往{" "}
            <Link className="font-medium underline" href="/admin/token">
              接入配置
            </Link>{" "}
            完成配置后同步服务器。
          </div>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {isLoading
          ? STATS.map((s) => <StatSkeleton key={s.key} />)
          : STATS.map((s) => {
              const Icon = s.icon;
              const inner = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-500">{s.label}</span>
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.color}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                  </div>
                  <div className="mt-2 text-2xl font-semibold text-slate-900">
                    {values[s.key] ?? 0}
                  </div>
                </>
              );
              // 有跳转目标的卡片整卡可点（如 回收站 → 服务器列表按回收站筛选）
              return s.href ? (
                <Link
                  key={s.key}
                  href={s.href}
                  className="card p-4 transition-shadow hover:shadow-md"
                  title="点击查看明细"
                >
                  {inner}
                </Link>
              ) : (
                <div key={s.key} className="card p-4">
                  {inner}
                </div>
              );
            })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Token 状态 */}
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <IconKey className="h-4 w-4 text-slate-400" />
            API 接入凭据
          </div>
          {isLoading ? (
            <Skeleton className="h-5 w-40" />
          ) : data?.token.configured ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                状态 <StatusBadge value={data.token.status} />
              </span>
              {data.token.tokenSuffix && (
                <span className="text-slate-400">末 4 位 ****{data.token.tokenSuffix}</span>
              )}
              {data.token.lastVerifiedAt && (
                <span className="text-slate-400">
                  校验于 {new Date(data.token.lastVerifiedAt).toLocaleString()}
                </span>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-400">未配置</div>
          )}
          <div className="mt-4">
            <Link href="/admin/token" className="btn-default btn-sm">
              前往配置
            </Link>
          </div>
        </div>

        {/* 最近操作 */}
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold text-slate-800">最近操作</div>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-4 w-full" />
              ))}
            </div>
          ) : !data || data.recentLogs.length === 0 ? (
            <div className="text-sm text-slate-400">暂无记录</div>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {data.recentLogs.map((l) => (
                <li key={l.id} className="flex items-center gap-2 py-2">
                  <span className="chip font-mono">{l.action}</span>
                  <span className="text-slate-600">{l.userName}</span>
                  <span className="ml-auto text-xs text-slate-400">
                    {new Date(l.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
