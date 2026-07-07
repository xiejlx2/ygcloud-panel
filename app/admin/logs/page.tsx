"use client";

import useSWR from "swr";
import { api } from "@/components/Api";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { IconLogs } from "@/components/Icons";

interface Row {
  id: string;
  createdAt: string;
  userName: string;
  userUsername: string;
  userRole: string;
  ecsResourceUUID: string;
  action: string;
  taskStatus: string | null;
  processResult: string | null;
  errMsg: string | null;
  asyncTaskUUID: string | null;
  requestIp: string | null;
}

const COLS = 9;

export default function AdminLogsPage() {
  const { data, error, isLoading } = useSWR<{ items: Row[] }>(
    "/api/admin/logs",
    api,
  );
  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="操作日志" subtitle="所有登录、配置与服务器操作的审计记录" />
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
                <th>时间</th>
                <th>操作者</th>
                <th>角色</th>
                <th>操作</th>
                <th>服务器</th>
                <th>结果</th>
                <th>任务 ID</th>
                <th>来源 IP</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton cols={COLS} rows={8} />}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={COLS}>
                    <EmptyState icon={<IconLogs />} title="暂无日志" />
                  </td>
                </tr>
              )}
              {items.map((r) => (
                <tr key={r.id} className="text-xs">
                  <td className="whitespace-nowrap text-slate-500">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td>
                    <div className="text-slate-700">{r.userName}</div>
                    <div className="text-slate-400">{r.userUsername}</div>
                  </td>
                  <td>
                    <span className="chip">
                      {r.userRole === "reseller_admin" ? "管理员" : "客户"}
                    </span>
                  </td>
                  <td>
                    <span className="chip font-mono">{r.action}</span>
                  </td>
                  <td className="font-mono text-[11px] text-slate-500">
                    {r.ecsResourceUUID === "-" ? "—" : r.ecsResourceUUID}
                  </td>
                  <td>
                    {r.processResult ? (
                      <span
                        className={
                          r.processResult === "SUCCESS"
                            ? "font-medium text-emerald-600"
                            : "font-medium text-red-600"
                        }
                      >
                        {r.processResult === "SUCCESS" ? "成功" : "失败"}
                      </span>
                    ) : (
                      <span className="text-slate-400">{r.taskStatus ?? "—"}</span>
                    )}
                  </td>
                  <td className="font-mono text-[11px] text-slate-400">
                    {r.asyncTaskUUID ? r.asyncTaskUUID.slice(0, 12) + "…" : "—"}
                  </td>
                  <td className="font-mono text-slate-500">{r.requestIp ?? "—"}</td>
                  <td className="max-w-[200px] truncate text-red-600">{r.errMsg ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
