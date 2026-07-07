"use client";

import clsx from "clsx";

// 每种状态：徽章底色/文字色 + 圆点色 + 中文展示名
interface StatusStyle {
  cls: string;
  dot: string;
  label?: string;
}

const MAP: Record<string, StatusStyle> = {
  STARTED: { cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "运行中" },
  RUNNING: { cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "运行中" },
  STOPPED: { cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "已停止" },
  PENDING: { cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500 animate-pulse", label: "处理中" },
  STARTING: { cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500 animate-pulse", label: "开机中" },
  STOPPING: { cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500 animate-pulse", label: "关机中" },
  RESTARTING: { cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500 animate-pulse", label: "重启中" },
  FAILED: { cls: "bg-red-50 text-red-700", dot: "bg-red-500", label: "失败" },
  FINISHED: { cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "已完成" },
  SUCCESS: { cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "成功" },
  active: { cls: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500", label: "正常" },
  disabled: { cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "已禁用" },
  invalid: { cls: "bg-red-50 text-red-700", dot: "bg-red-500", label: "无效" },
  revoked: { cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400", label: "已撤销" },
};

export function StatusBadge({ value }: { value?: string | null }) {
  if (!value) return <span className="text-slate-400">—</span>;
  const s = MAP[value] ?? { cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400" };
  return (
    <span className={clsx("badge", s.cls)}>
      <span className={clsx("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label ?? value}
    </span>
  );
}
