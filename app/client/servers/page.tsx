"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { api } from "@/components/Api";
import { StatusBadge, statusLabel } from "@/components/StatusBadge";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import {
  FilterHead,
  SortHead,
  nextSortDir,
  type SortDir,
} from "@/components/TableHead";
import { ServerActionButtons } from "@/components/ServerActionButtons";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { IconServer, IconAlert } from "@/components/Icons";
import { getExpiryInfo } from "@/lib/expiry";

interface Server {
  ecsResourceUUID: string;
  instanceName: string | null;
  customerAlias: string | null;
  customerNote: string | null;
  publicIpAddress: string | null;
  regionName: string | null;
  cpu: number | null;
  memory: number | null;
  bandwidth: number | null;
  osVersionDetail: string | null;
  ecsStatus: string | null;
  expireTime: string | null;
  lastSyncedAt: string | null;
}

const COLS = 5;

export default function ClientServersPage() {
  const { data, error, isLoading, mutate } = useSWR<{ items: Server[] }>(
    "/api/client/servers",
    api,
    { refreshInterval: 15_000 }, // 后台静默刷新状态
  );
  const { data: me } = useSWR<{ canReinstall?: boolean }>("/api/auth/me", api);
  const items = useMemo(() => data?.items ?? [], [data]);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expireSort, setExpireSort] = useState<SortDir>(null);

  // 状态筛选选项：由当前数据里实际出现的状态动态生成
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of items) if (s.ecsStatus) set.add(s.ecsStatus);
    return Array.from(set).map((v) => ({ value: v, label: statusLabel(v) }));
  }, [items]);

  const shown = useMemo(() => {
    let list = items;
    if (statusFilter !== null) {
      list = list.filter((s) => s.ecsStatus === statusFilter);
    }
    if (expireSort) {
      list = [...list].sort((a, b) => {
        const ta = a.expireTime ? new Date(a.expireTime).getTime() : null;
        const tb = b.expireTime ? new Date(b.expireTime).getTime() : null;
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return expireSort === "asc" ? ta - tb : tb - ta;
      });
    }
    return list;
  }, [items, statusFilter, expireSort]);

  // 到期/回收站统计（回收站机器仍在列表中展示，销毁前可续费恢复）
  const expiringCount = items.filter(
    (s) => getExpiryInfo(s.expireTime).state === "expiring",
  ).length;
  const recycledCount = items.filter((s) => {
    const st = getExpiryInfo(s.expireTime).state;
    return st === "recycled" || st === "destroyed";
  }).length;

  return (
    <div className="space-y-5">
      <PageHeader title="我的服务器" subtitle="管理分配给你的服务器" />

      {(expiringCount > 0 || recycledCount > 0) && (
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {expiringCount > 0 && (
              <>你有 <b>{expiringCount}</b> 台服务器将在 7 天内到期；</>
            )}
            {recycledCount > 0 && (
              <>你有 <b>{recycledCount}</b> 台服务器已到期进入回收站，
              到期超过 3 天将被<b>永久销毁且数据无法找回</b>；</>
            )}
            如需续费，请尽快联系为你开通账号的管理员。
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>服务器</th>
                <th>配置</th>
                <th>
                  <FilterHead
                    label="状态"
                    value={statusFilter}
                    options={statusOptions}
                    onChange={setStatusFilter}
                  />
                </th>
                <th>
                  <SortHead
                    label="到期时间"
                    dir={expireSort}
                    onToggle={() => setExpireSort(nextSortDir(expireSort))}
                  />
                </th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton cols={COLS} rows={4} />}
              {!isLoading && shown.length === 0 && (
                <tr>
                  <td colSpan={COLS}>
                    <EmptyState
                      icon={<IconServer />}
                      title={statusFilter !== null ? "没有匹配的服务器" : "暂无已分配的服务器"}
                      description={
                        statusFilter !== null
                          ? "换个筛选条件试试。"
                          : "如有疑问，请联系为你开通账号的管理员。"
                      }
                    />
                  </td>
                </tr>
              )}
              {shown.map((s) => (
                <tr key={s.ecsResourceUUID}>
                  <td>
                    <Link
                      href={`/client/servers/${encodeURIComponent(s.ecsResourceUUID)}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {s.customerAlias || s.instanceName || "—"}
                    </Link>
                    {s.customerAlias && s.instanceName && (
                      <div className="text-[11px] text-slate-400">{s.instanceName}</div>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                      <span className="font-mono text-slate-500">
                        {s.publicIpAddress || "无公网 IP"}
                      </span>
                      <span className="font-mono text-slate-300">{s.ecsResourceUUID}</span>
                    </div>
                    {s.customerNote && (
                      <div className="mt-0.5 text-xs text-slate-500">📝 {s.customerNote}</div>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <span className="chip">{s.cpu ?? "—"} vCPU</span>
                      <span className="chip">{s.memory ?? "—"} GB</span>
                      {s.bandwidth != null && <span className="chip">{s.bandwidth} Mbps</span>}
                    </div>
                    <div className="mt-1 text-xs text-slate-400">
                      {s.regionName || "—"}
                      {s.osVersionDetail ? ` · ${s.osVersionDetail}` : ""}
                    </div>
                  </td>
                  <td>
                    <StatusBadge value={s.ecsStatus} />
                  </td>
                  <td>
                    <div className="text-sm text-slate-700">
                      {s.expireTime
                        ? new Date(s.expireTime).toLocaleDateString()
                        : <span className="text-slate-400">—</span>}
                    </div>
                    <div className="mt-1">
                      <ExpiryBadge expireTime={s.expireTime} />
                    </div>
                  </td>
                  <td>
                    <ServerActionButtons
                      uuid={s.ecsResourceUUID}
                      role="customer"
                      variant="menu"
                      allowCustomerReinstall={!!me?.canReinstall}
                      showNote
                      noteAlias={s.customerAlias}
                      noteText={s.customerNote}
                      onDone={() => mutate()}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
