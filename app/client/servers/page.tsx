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

const COLS = 8;

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
                <th>名称</th>
                <th>公网 IP</th>
                <th>状态</th>
                <th>配置</th>
                <th>地区</th>
                <th>系统</th>
                <th>到期</th>
                <th>操作</th>
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
                    <div className="font-mono text-[11px] text-slate-400">{s.ecsResourceUUID}</div>
                  </td>
                  <td className="font-mono text-xs">{s.publicIpAddress || "—"}</td>
                  <td>
                    <StatusBadge value={s.ecsStatus} />
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-600">
                    {s.cpu ?? "—"} vCPU / {s.memory ?? "—"} GB
                    {s.bandwidth != null && ` / ${s.bandwidth}M`}
                  </td>
                  <td className="whitespace-nowrap text-xs">{s.regionName || "—"}</td>
                  <td className="text-xs">{s.osVersionDetail || "—"}</td>
                  <td className="whitespace-nowrap text-xs text-slate-500">
                    {s.expireTime ? new Date(s.expireTime).toLocaleDateString() : "—"}
                  </td>
                  <td>
                    <ServerActionButtons
                      uuid={s.ecsResourceUUID}
                      role="customer"
                      canModifyPassword={false}
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
