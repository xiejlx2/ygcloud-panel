"use client";

import clsx from "clsx";
import { getExpiryInfo } from "@/lib/expiry";

function fmtDestroy(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * 到期状态徽章：
 *   - 7 天内到期：琥珀色“X 天后到期 / 今天到期”
 *   - 已到期进回收站：红色“回收站 · X月X日销毁”
 *   - 已过销毁时间（等待同步清理）：灰色“已销毁”
 *   - 正常 / 无到期时间：不渲染
 */
export function ExpiryBadge({ expireTime }: { expireTime?: string | null }) {
  const info = getExpiryInfo(expireTime ?? null);
  if (info.state === "active") return null;

  if (info.state === "expiring") {
    return (
      <span className={clsx("badge", "bg-amber-50 text-amber-700")}>
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        {info.daysLeft === 0 ? "今天到期" : `${info.daysLeft} 天后到期`}
      </span>
    );
  }
  if (info.state === "recycled") {
    return (
      <span className={clsx("badge", "bg-red-50 text-red-700")}>
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
        回收站 · {info.destroyAt ? `${fmtDestroy(info.destroyAt)}销毁` : "即将销毁"}
      </span>
    );
  }
  return (
    <span className={clsx("badge", "bg-slate-100 text-slate-500")}>
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      已销毁
    </span>
  );
}
