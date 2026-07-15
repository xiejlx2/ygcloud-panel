"use client";

import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/components/Api";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { IconRefresh, IconSpinner, IconCheck, IconAlert } from "@/components/Icons";

interface PendingCommit {
  commit: string;
  subject: string;
}
interface GitVersion {
  commit: string;
  subject: string;
  committedAt: string;
  behind: number;
  pending: PendingCommit[];
  fetchError?: string;
}
type UpdatePhase =
  | "starting"
  | "backup"
  | "pull"
  | "install"
  | "migrate"
  | "build"
  | "restart"
  | "rollback"
  | "done"
  | "error";
interface UpdateStatus {
  phase: UpdatePhase;
  startedAt: string;
  finishedAt: string | null;
  oldCommit: string | null;
  newCommit: string | null;
  ok: boolean | null;
  error: string | null;
  logTail: string | null;
  triggeredBy: string | null;
}
interface UpdateResp {
  enabled: boolean;
  branch?: string;
  canRestart?: boolean;
  version?: GitVersion;
  status?: UpdateStatus | null;
  running?: boolean;
}

// 展示用阶段顺序（starting 归入首格；rollback/done/error 单独处理）
const STEPS: { key: UpdatePhase; label: string }[] = [
  { key: "backup", label: "备份数据" },
  { key: "pull", label: "拉取代码" },
  { key: "install", label: "安装依赖" },
  { key: "migrate", label: "数据库迁移" },
  { key: "build", label: "构建" },
  { key: "restart", label: "重启服务" },
];

function stepIndex(phase: UpdatePhase): number {
  if (phase === "starting") return -1;
  const i = STEPS.findIndex((s) => s.key === phase);
  return i;
}

export default function AdminUpdatePage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, mutate, isLoading } = useSWR<UpdateResp>("/api/admin/update", api, {
    // 更新进行中时每 2s 轮询；期间服务重启导致的短暂 fetch 失败会被 SWR 吞掉并继续轮询
    refreshInterval: (d) => (d?.running ? 2000 : 0),
    shouldRetryOnError: true,
  });
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function check() {
    setChecking(true);
    try {
      const r = await api<UpdateResp>("/api/admin/update?check=1");
      await mutate(r, { revalidate: false });
      if (r.version && r.version.behind > 0) {
        toast.success(`发现新版本，落后 ${r.version.behind} 个提交`);
      } else {
        toast.success("已是最新版本");
      }
      if (r.version?.fetchError) toast.error("拉取远端失败：" + r.version.fetchError);
    } catch (e) {
      toast.error((e as ApiError).message || "检查失败");
    } finally {
      setChecking(false);
    }
  }

  async function doUpdate() {
    const behind = data?.version?.behind ?? 0;
    const ok = await confirm({
      title: "立即更新面板",
      message: `将拉取并部署最新代码（落后 ${behind} 个提交）：备份数据 → 拉取 → 安装依赖 → 数据库迁移 → 构建 → 重启。期间约几秒不可用；失败会自动回滚。确认更新？`,
      confirmText: "开始更新",
      danger: false,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await api<{ started: boolean }>("/api/admin/update", { method: "POST" });
      toast.success("更新已开始");
      await mutate(); // 立即拉取 starting 状态，进入轮询
    } catch (e) {
      toast.error((e as ApiError).message || "启动更新失败");
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="max-w-2xl space-y-5">
        <PageHeader title="系统更新" subtitle="一键升级面板到最新版本" />
        <div className="card p-5">
          <Skeleton className="h-5 w-56" />
        </div>
      </div>
    );
  }

  if (data && data.enabled === false) {
    return (
      <div className="max-w-2xl space-y-5">
        <PageHeader title="系统更新" subtitle="一键升级面板到最新版本" />
        <div className="card p-5 text-sm text-slate-500">
          本环境未开启自助更新。需在服务器 <code className="rounded bg-slate-100 px-1">.env</code> 中设置{" "}
          <code className="rounded bg-slate-100 px-1">SELF_UPDATE_ENABLED=1</code> 并配置{" "}
          <code className="rounded bg-slate-100 px-1">SELF_UPDATE_RESTART_CMD</code> 后重启生效。
        </div>
      </div>
    );
  }

  const v = data?.version;
  const st = data?.status;
  const running = !!data?.running;
  const behind = v?.behind ?? 0;
  const terminalRecent =
    !running && st && (st.phase === "done" || st.phase === "error");

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="系统更新"
        subtitle="一键升级面板到最新版本：拉取代码、迁移数据库、构建并重启，失败自动回滚"
      />

      {/* 当前版本 */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <IconRefresh className="h-4 w-4 text-slate-400" />
            当前版本
          </div>
          <button className="btn-default" disabled={checking || running} onClick={check}>
            {checking && <IconSpinner className="h-4 w-4" />}
            {checking ? "检查中…" : "检查更新"}
          </button>
        </div>
        {v ? (
          <div className="space-y-1 text-sm text-slate-600">
            <div>
              <span className="font-mono text-slate-800">{v.commit}</span>
              <span className="ml-2">{v.subject}</span>
            </div>
            <div className="text-slate-400">
              提交于 {new Date(v.committedAt).toLocaleString()} · 分支 {data?.branch}
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-400">无法读取版本信息</div>
        )}
      </div>

      {/* 更新可用 / 已是最新 */}
      {!running && (
        <div className="card p-5">
          {behind > 0 ? (
            <>
              <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                <IconAlert className="h-4 w-4" />
                发现新版本 · 落后 {behind} 个提交
              </div>
              <ul className="mt-3 space-y-1 text-sm text-slate-600">
                {v!.pending.map((c) => (
                  <li key={c.commit} className="flex gap-2">
                    <span className="font-mono text-slate-400">{c.commit}</span>
                    <span>{c.subject}</span>
                  </li>
                ))}
              </ul>
              <button className="btn-primary mt-4" disabled={busy} onClick={doUpdate}>
                {busy && <IconSpinner className="h-4 w-4" />}
                {busy ? "启动中…" : "立即更新"}
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-emerald-700">
              <IconCheck className="h-4 w-4" />
              已是最新版本
            </div>
          )}
        </div>
      )}

      {/* 进度 / 结果 */}
      {(running || terminalRecent) && st && (
        <div className="card p-5">
          <div className="mb-3 text-sm font-semibold text-slate-800">
            {running ? "更新进行中…" : st.phase === "done" ? "更新完成" : "更新失败"}
          </div>

          {st.phase === "rollback" ? (
            <div className="mb-3 flex items-center gap-1.5 text-sm text-amber-700">
              <IconSpinner className="h-4 w-4" />
              更新失败，正在回滚…
            </div>
          ) : (
            <ol className="mb-3 space-y-1.5">
              {STEPS.map((s, i) => {
                const cur = stepIndex(st.phase);
                const isDone = st.phase === "done";
                const done = isDone || i < cur;
                const active = !isDone && i === cur && st.phase !== "error";
                return (
                  <li key={s.key} className="flex items-center gap-2 text-sm">
                    {done ? (
                      <IconCheck className="h-4 w-4 text-emerald-600" />
                    ) : active ? (
                      <IconSpinner className="h-4 w-4 text-brand-600" />
                    ) : (
                      <span className="inline-block h-4 w-4 rounded-full border border-slate-200" />
                    )}
                    <span className={done ? "text-slate-500" : active ? "font-medium text-slate-800" : "text-slate-400"}>
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {st.phase === "done" && (
            <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              <IconCheck className="h-4 w-4" />
              已更新到 <span className="font-mono">{st.newCommit}</span>
            </div>
          )}
          {st.phase === "error" && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {st.error || "更新失败"}
            </div>
          )}

          {st.logTail && (
            <pre className="mt-3 max-h-48 overflow-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
              {st.logTail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
