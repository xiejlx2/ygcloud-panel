"use client";

/**
 * 表头交互控件（管理端 / 客户端服务器列表共用）：
 *  - FilterHead：点击弹出选项下拉做列筛选（fixed 定位，避免被表格滚动容器裁剪）
 *  - SortHead：点击在 升序 → 降序 → 不排序 之间循环
 */
import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { IconChevronDown, IconCheck, IconSort } from "@/components/Icons";

export interface FilterOption {
  value: string;
  label: string;
}

export function FilterHead({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | null;
  options: FilterOption[];
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  function toggle() {
    if (open) return setOpen(false);
    const r = btnRef.current!.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left });
    setOpen(true);
  }

  const active = value !== null ? options.find((o) => o.value === value) : null;

  const pick = (v: string | null) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        className={clsx(
          "inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-slate-700",
          active ? "text-brand" : "",
        )}
        onClick={toggle}
        title="点击筛选"
      >
        {label}
        {active && (
          <span className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal text-brand-700">
            {active.label}
          </span>
        )}
        <IconChevronDown className="h-3 w-3" />
      </button>
      {open && pos && (
        <div
          ref={menuRef}
          className="fixed z-50 w-36 animate-fade-in overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-pop"
          style={{ top: pos.top, left: pos.left }}
        >
          <FilterRow selected={value === null} onClick={() => pick(null)}>
            全部
          </FilterRow>
          {options.map((o) => (
            <FilterRow
              key={o.value}
              selected={o.value === value}
              onClick={() => pick(o.value)}
            >
              {o.label}
            </FilterRow>
          ))}
        </div>
      )}
    </>
  );
}

function FilterRow({
  children,
  selected,
  onClick,
}: {
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={clsx(
        "flex w-full items-center justify-between px-3 py-1.5 text-left text-sm normal-case tracking-normal transition-colors hover:bg-slate-50",
        selected ? "font-medium text-brand" : "text-slate-700",
      )}
      onClick={onClick}
    >
      {children}
      {selected && <IconCheck className="h-3.5 w-3.5" />}
    </button>
  );
}

export type SortDir = "asc" | "desc" | null;

/** 点击循环：不排序 → 升序 → 降序 → 不排序 */
export function nextSortDir(dir: SortDir): SortDir {
  return dir === null ? "asc" : dir === "asc" ? "desc" : null;
}

export function SortHead({
  label,
  dir,
  onToggle,
}: {
  label: string;
  dir: SortDir;
  onToggle: () => void;
}) {
  return (
    <button
      className={clsx(
        "inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-slate-700",
        dir ? "text-brand" : "",
      )}
      onClick={onToggle}
      title="点击排序"
    >
      {label}
      {dir === "asc" ? (
        <IconChevronDown className="h-3 w-3 rotate-180" />
      ) : dir === "desc" ? (
        <IconChevronDown className="h-3 w-3" />
      ) : (
        <IconSort className="h-3 w-3 text-slate-300" />
      )}
    </button>
  );
}
