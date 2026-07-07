"use client";

import useSWR from "swr";
import Link from "next/link";
import { api } from "@/components/Api";
import { StatusBadge } from "@/components/StatusBadge";
import { ServerActionButtons } from "@/components/ServerActionButtons";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { IconServer } from "@/components/Icons";

interface Server {
  ecsResourceUUID: string;
  instanceName: string | null;
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

const COLS = 4;

export default function ClientServersPage() {
  const { data, error, isLoading, mutate } = useSWR<{ items: Server[] }>(
    "/api/client/servers",
    api,
    { refreshInterval: 15_000 }, // 后台静默刷新状态
  );
  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="我的服务器" subtitle="管理分配给你的服务器" />
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
                <th>状态</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton cols={COLS} rows={4} />}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={COLS}>
                    <EmptyState
                      icon={<IconServer />}
                      title="暂无已分配的服务器"
                      description="如有疑问，请联系为你开通账号的管理员。"
                    />
                  </td>
                </tr>
              )}
              {items.map((s) => (
                <tr key={s.ecsResourceUUID}>
                  <td>
                    <Link
                      href={`/client/servers/${encodeURIComponent(s.ecsResourceUUID)}`}
                      className="font-medium text-brand hover:underline"
                    >
                      {s.instanceName || "—"}
                    </Link>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                      <span className="font-mono text-slate-500">
                        {s.publicIpAddress || "无公网 IP"}
                      </span>
                      <span className="font-mono text-slate-300">{s.ecsResourceUUID}</span>
                    </div>
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
                    {s.expireTime && (
                      <div className="mt-1 text-xs text-slate-400">
                        到期 {new Date(s.expireTime).toLocaleDateString()}
                      </div>
                    )}
                  </td>
                  <td>
                    <ServerActionButtons
                      uuid={s.ecsResourceUUID}
                      role="customer"
                      variant="menu"
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
