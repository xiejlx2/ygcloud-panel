"use client";

import useSWR from "swr";
import Link from "next/link";
import { useParams } from "next/navigation";
import { api } from "@/components/Api";
import { StatusBadge } from "@/components/StatusBadge";
import { ServerActionButtons } from "@/components/ServerActionButtons";
import { Skeleton } from "@/components/Skeleton";

interface Detail {
  ecsResourceUUID: string;
  instanceName: string | null;
  publicIpAddress: string | null;
  internalIpAddress: string | null;
  regionCode: string | null;
  regionName: string | null;
  zoneCode: string | null;
  zoneName: string | null;
  cpu: number | null;
  memory: number | null;
  bandwidth: number | null;
  osName: string | null;
  osVersionDetail: string | null;
  ecsStatus: string | null;
  ecsPendingStatus: string | null;
  expireTime: string | null;
  lastSyncedAt: string | null;
}

export default function ClientServerDetailPage() {
  const params = useParams<{ uuid: string }>();
  const uuid = decodeURIComponent(params.uuid);
  const { data, error, isLoading, mutate } = useSWR<Detail>(
    `/api/servers/${encodeURIComponent(uuid)}`,
    api,
  );

  return (
    <div className="space-y-5">
      <div>
        <Link href="/client/servers" className="text-xs text-slate-400 hover:text-slate-600">
          ← 返回我的服务器
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-slate-900">
          {isLoading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            data?.instanceName || data?.ecsResourceUUID || uuid
          )}
        </h1>
        {data && (
          <div className="font-mono text-xs text-slate-400">{data.ecsResourceUUID}</div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      {isLoading ? (
        <div className="card grid grid-cols-2 gap-4 p-5 md:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-3 w-14" />
              <Skeleton className="mt-2 h-4 w-24" />
            </div>
          ))}
        </div>
      ) : data ? (
        <>
          <div className="card grid grid-cols-2 gap-4 p-5 text-sm md:grid-cols-3">
            <Field label="公网 IP" value={data.publicIpAddress} mono />
            <Field label="内网 IP" value={data.internalIpAddress} mono />
            <Field label="状态" valueNode={<StatusBadge value={data.ecsStatus} />} />
            <Field label="地区" value={data.regionName} />
            <Field label="可用区" value={data.zoneName} />
            <Field
              label="配置"
              value={
                data.cpu != null || data.memory != null
                  ? `${data.cpu ?? "—"} vCPU / ${data.memory ?? "—"} GB${
                      data.bandwidth != null ? ` / ${data.bandwidth} Mbps` : ""
                    }`
                  : null
              }
            />
            <Field label="操作系统" value={data.osVersionDetail || data.osName} />
            <Field
              label="到期时间"
              value={data.expireTime ? new Date(data.expireTime).toLocaleString() : null}
            />
            <Field
              label="最近同步"
              value={data.lastSyncedAt ? new Date(data.lastSyncedAt).toLocaleString() : null}
            />
          </div>

          <div className="card p-5">
            <div className="mb-3 text-sm font-semibold text-slate-800">服务器操作</div>
            <ServerActionButtons
              uuid={data.ecsResourceUUID}
              role="customer"
              onDone={() => mutate()}
            />
            <p className="mt-3 text-xs text-slate-400">
              操作执行后请等待任务完成；如长时间未生效可返回列表刷新查看。
            </p>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  valueNode,
  mono,
}: {
  label: string;
  value?: string | null;
  valueNode?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-slate-800 ${mono ? "font-mono text-xs" : ""}`}>
        {valueNode ??
          (value && value !== "" ? value : <span className="text-slate-400">—</span>)}
      </div>
    </div>
  );
}
