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
  ecsResourceUUID: string;
  action: string;
  taskStatus: string | null;
  processResult: string | null;
  errMsg: string | null;
}

const COLS = 5;

export default function ClientLogsPage() {
  const { data, isLoading } = useSWR<{ items: Row[] }>("/api/client/logs", api);
  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader title="操作记录" subtitle="你对服务器执行过的操作" />
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作</th>
                <th>服务器</th>
                <th>结果</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton cols={COLS} rows={5} />}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={COLS}>
                    <EmptyState icon={<IconLogs />} title="暂无记录" />
                  </td>
                </tr>
              )}
              {items.map((r) => (
                <tr key={r.id} className="text-xs">
                  <td className="whitespace-nowrap text-slate-500">
                    {new Date(r.createdAt).toLocaleString()}
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
                  <td className="max-w-[220px] truncate text-red-600">{r.errMsg ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
