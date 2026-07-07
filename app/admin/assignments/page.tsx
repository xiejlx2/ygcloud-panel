"use client";

import useSWR from "swr";
import Link from "next/link";
import { api, ApiError } from "@/components/Api";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { IconLink } from "@/components/Icons";

interface Row {
  id: string;
  customerId: string;
  customerName: string;
  customerUsername: string;
  ecsResourceUUID: string;
  instanceName: string | null;
  publicIpAddress: string | null;
  ecsStatus: string | null;
  regionName: string | null;
  assignedAt: string;
}

const COLS = 8;

export default function AdminAssignmentsPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, mutate, isLoading } = useSWR<{ items: Row[] }>(
    "/api/admin/assignments",
    api,
  );
  const items = data?.items ?? [];

  async function revoke(uuid: string, name: string) {
    const ok = await confirm({
      title: "取消分配",
      message: `确认取消该服务器（当前归属 ${name}）的分配？`,
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="分配关系"
        subtitle="一台服务器同时只能分配给一个客户"
        actions={
          <Link href="/admin/servers" className="btn-default">
            <IconLink className="h-4 w-4" />
            去分配
          </Link>
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
                <th>客户</th>
                <th>登录账号</th>
                <th>服务器</th>
                <th>公网 IP</th>
                <th>状态</th>
                <th>地区</th>
                <th>分配时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton cols={COLS} rows={5} />}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={COLS}>
                    <EmptyState
                      icon={<IconLink />}
                      title="暂无分配"
                      description="前往服务器列表勾选机器并分配给客户。"
                      action={
                        <Link href="/admin/servers" className="btn-primary btn-sm">
                          去分配
                        </Link>
                      }
                    />
                  </td>
                </tr>
              )}
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-slate-800">{r.customerName}</td>
                  <td className="font-mono text-xs">{r.customerUsername}</td>
                  <td>
                    <div className="text-slate-800">{r.instanceName || "—"}</div>
                    <div className="font-mono text-[11px] text-slate-400">{r.ecsResourceUUID}</div>
                  </td>
                  <td className="font-mono text-xs">{r.publicIpAddress || "—"}</td>
                  <td>
                    <StatusBadge value={r.ecsStatus} />
                  </td>
                  <td className="whitespace-nowrap text-xs">{r.regionName || "—"}</td>
                  <td className="whitespace-nowrap text-xs text-slate-500">
                    {new Date(r.assignedAt).toLocaleString()}
                  </td>
                  <td>
                    <button
                      className="text-xs text-red-600 hover:underline"
                      onClick={() => revoke(r.ecsResourceUUID, r.customerName)}
                    >
                      取消分配
                    </button>
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
