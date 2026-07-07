"use client";

/** 基础模态框：居中卡片 + 遮罩 + ESC/点击遮罩关闭。 */
import { useEffect } from "react";
import { IconX } from "@/components/Icons";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = "max-w-md",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className={`relative z-10 w-full ${maxWidth} animate-fade-in rounded-2xl border border-slate-200 bg-white shadow-pop`}
      >
        {title && (
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
            <div className="text-[15px] font-semibold text-slate-900">{title}</div>
            <button
              className="text-slate-400 hover:text-slate-600"
              onClick={onClose}
              aria-label="关闭"
            >
              <IconX className="h-5 w-5" />
            </button>
          </div>
        )}
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
