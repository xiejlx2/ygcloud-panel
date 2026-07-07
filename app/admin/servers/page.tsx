"use client";

import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/components/Api";
import { StatusBadge } from "@/components/StatusBadge";
import { ServerActionButtons } from "@/components/ServerActionButtons";
import { AssignDialog } from "@/components/AssignDialog";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { IconServer, IconRefresh, IconLink, IconSpinner } from "@/components/Icons";

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
  assigned: boolean;
  assignedCustomerId: string | null;
  assignedCustomerName: string | null;
}

const COLS = 10;

export default function AdminServersPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, isLoading, error, mutate } = useSWR<{ items: Server[] }>(
    "/api/admin/servers",
    api,
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignOpen, setAssignOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const items = data?.items ?? [];

  function toggle(uuid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  }

  async function sync() {
    setSyncing(true);
    try {
      const r = await api<{ upserted: number; total: number }>(
        "/api/admin/servers/sync",
        { method: "POST" },
      );
      toast.success(`同步完成：共 ${r.total} 台，更新 ${r.upserted} 台`);
      mutate();
    } catch (e) {
      toast.error((e as ApiError).message || "同步失败");
    } finally {
      setSyncing(false);
    }
  }

  async function unassign(uuid: string, name: string | null) {
    const ok = await confirm({
      title: "取消分配",
      message: `确认取消该服务器${name ? `（当前归属 ${name}）` : ""}的分配？取消后该客户将无法再访问。`,
      confirmText: "取消分配",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/assignments/${uuid}`, { method: "DELETE" });
      toast.success("已取消分配");
      mutate();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  const allChecked = items.length > 0 && selected.size === items.length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="服务器"
        subtitle="同步、查看并把服务器分配给客户"
        actions={
          <>
            <button className="btn-default" disabled={syncing} onClick={sync}>
              {syncing ? <IconSpinner className="h-4 w-4" /> : <IconRefresh className="h-4 w-4" />}
              {syncing ? "同步中…" : "同步服务器"}
            </button>
            <button
              className="btn-primary"
              disabled={selected.size === 0}
              onClick={() => setAssignOpen(true)}
            >
              <IconLink className="h-4 w-4" />
              批量分配{selected.size > 0 ? `（${selected.size}）` : ""}
            </button>
          </>
        }
      />

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
                <th className="w-10">
                  <input
                    type="checkbox"
                    className="accent-brand"
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? new Set(items.map((i) => i.ecsResourceUUID))
                          : new Set(),
                      )
                    }
                    checked={allChecked}
                  />
                </th>
                <th>名称</th>
                <th>公网 IP</th>
                <th>状态</th>
                <th>配置</th>
                <th>地区</th>
                <th>系统</th>
                <th>到期</th>
                <th>分配</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton cols={COLS} rows={6} />}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={COLS}>
                    <EmptyState
                      icon={<IconServer />}
                      title="暂无服务器"
                      description="点击右上角「同步服务器」拉取云端资源。"
                    />
                  </td>
                </tr>
              )}
              {items.map((s) => (
                <tr key={s.ecsResourceUUID}>
                  <td>
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={selected.has(s.ecsResourceUUID)}
                      onChange={() => toggle(s.ecsResourceUUID)}
                    />
                  </td>
                  <td>
                    <div className="font-medium text-slate-800">{s.instanceName || "—"}</div>
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
                    {s.assigned ? (
                      <div className="text-xs">
                        <div className="font-medium text-slate-700">{s.assignedCustomerName}</div>
                        <button
                          className="text-red-600 hover:underline"
                          onClick={() => unassign(s.ecsResourceUUID, s.assignedCustomerName)}
                        >
                          取消分配
                        </button>
                      </div>
                    ) : (
                      <span className="chip">未分配</span>
                    )}
                  </td>
                  <td>
                    <ServerActionButtons
                      uuid={s.ecsResourceUUID}
                      role="reseller_admin"
                      onDone={() => mutate()}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <AssignDialog
        open={assignOpen}
        uuids={Array.from(selected)}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => {
          setSelected(new Set());
          mutate();
        }}
      />
    </div>
  );
}
