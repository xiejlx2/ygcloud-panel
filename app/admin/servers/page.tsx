"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/components/Api";
import { StatusBadge, statusLabel } from "@/components/StatusBadge";
import { ExpiryBadge } from "@/components/ExpiryBadge";
import { getExpiryInfo } from "@/lib/expiry";
import {
  FilterHead,
  SortHead,
  nextSortDir,
  type SortDir,
} from "@/components/TableHead";
import { ServerActionButtons } from "@/components/ServerActionButtons";
import { AssignDialog } from "@/components/AssignDialog";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import {
  IconServer,
  IconRefresh,
  IconLink,
  IconSpinner,
  IconSearch,
  IconX,
} from "@/components/Icons";

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
  assigned: boolean;
  assignedCustomerId: string | null;
  assignedCustomerName: string | null;
}

const COLS = 7;

// 到期状态快捷筛选：expiring=7天内到期；recycled=回收站（含已过销毁时间待清理的）
type ExpiryFilter = "expiring" | "recycled" | null;

function matchExpiry(expireTime: string | null, f: Exclude<ExpiryFilter, null>): boolean {
  const st = getExpiryInfo(expireTime).state;
  if (f === "expiring") return st === "expiring";
  return st === "recycled" || st === "destroyed";
}

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
  const [refreshingZones, setRefreshingZones] = useState(false);
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [expireSort, setExpireSort] = useState<SortDir>(null);
  const [expiryFilter, setExpiryFilter] = useState<ExpiryFilter>(null);

  // 支持从概览页统计卡跳转：/admin/servers?expiry=expiring|recycled
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get("expiry");
    if (v === "expiring" || v === "recycled") setExpiryFilter(v);
  }, []);

  const items = useMemo(() => data?.items ?? [], [data]);

  // 到期状态计数（用于快捷筛选 chip 上的数字）
  const expiryCounts = useMemo(() => {
    let expiring = 0;
    let recycled = 0;
    for (const s of items) {
      if (matchExpiry(s.expireTime, "expiring")) expiring++;
      else if (matchExpiry(s.expireTime, "recycled")) recycled++;
    }
    return { expiring, recycled };
  }, [items]);

  // 状态筛选选项：由当前数据里实际出现的状态动态生成。
  // “选项 ⟺ 有该状态的机器”，不会出现点了却是空结果的死选项。
  const statusOptions = useMemo(() => {
    const set = new Set<string>();
    for (const s of items) if (s.ecsStatus) set.add(s.ecsStatus);
    return Array.from(set).map((v) => ({ value: v, label: statusLabel(v) }));
  }, [items]);

  const filtered = useMemo(() => {
    const kw = q.trim().toLowerCase();
    let list = items;
    if (kw) {
      list = list.filter((s) =>
        [s.instanceName, s.customerAlias, s.customerNote, s.publicIpAddress, s.ecsResourceUUID, s.regionName, s.assignedCustomerName]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(kw)),
      );
    }
    if (statusFilter !== null) {
      list = list.filter((s) => s.ecsStatus === statusFilter);
    }
    if (expiryFilter !== null) {
      list = list.filter((s) => matchExpiry(s.expireTime, expiryFilter));
    }
    if (expireSort) {
      list = [...list].sort((a, b) => {
        // 无到期时间的始终排在最后
        const ta = a.expireTime ? new Date(a.expireTime).getTime() : null;
        const tb = b.expireTime ? new Date(b.expireTime).getTime() : null;
        if (ta === null && tb === null) return 0;
        if (ta === null) return 1;
        if (tb === null) return -1;
        return expireSort === "asc" ? ta - tb : tb - ta;
      });
    }
    return list;
  }, [items, q, statusFilter, expiryFilter, expireSort]);

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

  async function refreshZones() {
    const ok = await confirm({
      title: "更新地域库",
      message:
        "将扫描当前 Token 可访问的全部地域，把有机器的地域记入地域库（含已售罄下架、" +
        "但仍有存量机器的地域），并做一次全量同步。请先确认该 Token 已开放全部地域权限，" +
        "否则可能漏记地域。此操作较慢，请耐心等待。",
      confirmText: "开始更新",
    });
    if (!ok) return;
    setRefreshingZones(true);
    try {
      const r = await api<{
        zonesTotal: number;
        zonesAdded: number;
        machines: number;
      }>("/api/admin/zones/refresh", { method: "POST" });
      toast.success(
        `地域库已更新：覆盖 ${r.zonesTotal} 个地域（新增 ${r.zonesAdded}），共 ${r.machines} 台机器`,
      );
      mutate();
    } catch (e) {
      toast.error((e as ApiError).message || "更新地域库失败");
    } finally {
      setRefreshingZones(false);
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

  const filteredUuids = filtered.map((i) => i.ecsResourceUUID);
  const allChecked =
    filtered.length > 0 && filteredUuids.every((u) => selected.has(u));

  return (
    <div className="space-y-5">
      <PageHeader
        title="服务器"
        subtitle="同步、查看并把服务器分配给客户"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-default"
              disabled={refreshingZones || syncing}
              onClick={refreshZones}
              title="扫描全部地域并把有机器的地域记入地域库（应对售罄下架地域）"
            >
              {refreshingZones ? (
                <IconSpinner className="h-4 w-4" />
              ) : (
                <IconRefresh className="h-4 w-4" />
              )}
              {refreshingZones ? "更新中…" : "更新地域库"}
            </button>
            <button
              className="btn-primary"
              disabled={syncing || refreshingZones}
              onClick={sync}
            >
              {syncing ? <IconSpinner className="h-4 w-4" /> : <IconRefresh className="h-4 w-4" />}
              {syncing ? "同步中…" : "同步服务器"}
            </button>
          </div>
        }
      />

      {/* 搜索 + 计数 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            placeholder="搜索名称 / IP / 地区 / 客户"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {/* 到期状态快捷筛选：有命中才显示对应 chip，点击切换 */}
        {expiryCounts.expiring > 0 && (
          <button
            className={`badge cursor-pointer transition-colors ${
              expiryFilter === "expiring"
                ? "bg-amber-500 text-white"
                : "bg-amber-50 text-amber-700 hover:bg-amber-100"
            }`}
            onClick={() => setExpiryFilter(expiryFilter === "expiring" ? null : "expiring")}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${expiryFilter === "expiring" ? "bg-white" : "bg-amber-500"}`} />
            7 天内到期 {expiryCounts.expiring}
          </button>
        )}
        {expiryCounts.recycled > 0 && (
          <button
            className={`badge cursor-pointer transition-colors ${
              expiryFilter === "recycled"
                ? "bg-red-500 text-white"
                : "bg-red-50 text-red-700 hover:bg-red-100"
            }`}
            onClick={() => setExpiryFilter(expiryFilter === "recycled" ? null : "recycled")}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${expiryFilter === "recycled" ? "bg-white" : "bg-red-500 animate-pulse"}`} />
            回收站 {expiryCounts.recycled}
          </button>
        )}
        <span className="text-sm text-slate-400">
          共 {items.length} 台
          {(q || statusFilter !== null || expiryFilter !== null) && `，匹配 ${filtered.length} 台`}
        </span>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      {/* 选择操作条 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2.5">
          <span className="text-sm font-medium text-brand-700">
            已选 {selected.size} 台
          </span>
          <button className="btn-primary btn-sm" onClick={() => setAssignOpen(true)}>
            <IconLink className="h-4 w-4" />
            批量分配
          </button>
          <button
            className="ml-auto inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
            onClick={() => setSelected(new Set())}
          >
            <IconX className="h-4 w-4" />
            清除选择
          </button>
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
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) filteredUuids.forEach((u) => next.add(u));
                        else filteredUuids.forEach((u) => next.delete(u));
                        return next;
                      })
                    }
                    checked={allChecked}
                  />
                </th>
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
                <th>归属客户</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton cols={COLS} rows={6} />}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={COLS}>
                    <EmptyState
                      icon={<IconServer />}
                      title={q || statusFilter !== null || expiryFilter !== null ? "没有匹配的服务器" : "暂无服务器"}
                      description={
                        q || statusFilter !== null || expiryFilter !== null
                          ? "换个关键词或筛选条件试试。"
                          : "点击右上角「同步服务器」拉取云端资源。"
                      }
                    />
                  </td>
                </tr>
              )}
              {filtered.map((s) => (
                <tr key={s.ecsResourceUUID}>
                  <td>
                    <input
                      type="checkbox"
                      className="accent-brand"
                      checked={selected.has(s.ecsResourceUUID)}
                      onChange={() => toggle(s.ecsResourceUUID)}
                    />
                  </td>

                  {/* 服务器：名称 / IP / uuid */}
                  <td>
                    <div className="font-medium text-slate-800">
                      {s.customerAlias || s.instanceName || "—"}
                    </div>
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

                  {/* 配置：规格 chips + 地区 · 系统 */}
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

                  {/* 状态 */}
                  <td>
                    <StatusBadge value={s.ecsStatus} />
                  </td>

                  {/* 到期时间 */}
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

                  {/* 归属客户 */}
                  <td>
                    {s.assigned ? (
                      <div>
                        <div className="text-sm font-medium text-slate-700">
                          {s.assignedCustomerName}
                        </div>
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => unassign(s.ecsResourceUUID, s.assignedCustomerName)}
                        >
                          取消分配
                        </button>
                      </div>
                    ) : (
                      <span className="chip">未分配</span>
                    )}
                  </td>

                  {/* 操作下拉 */}
                  <td>
                    <ServerActionButtons
                      uuid={s.ecsResourceUUID}
                      role="reseller_admin"
                      variant="menu"
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
