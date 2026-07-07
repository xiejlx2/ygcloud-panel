"use client";

/**
 * 轻量 Toast 通知系统。替代原生 alert()。
 * 用法：const toast = useToast(); toast.success("已保存"); toast.error("失败原因");
 */
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { IconCheck, IconAlert, IconX } from "@/components/Icons";

type ToastKind = "success" | "error" | "info";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 ToastProvider 内使用");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(1);

  const remove = useCallback((id: number) => {
    setItems((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = seq.current++;
      setItems((cur) => [...cur, { id, kind, message }]);
      setTimeout(() => remove(id), 4000);
    },
    [remove],
  );

  const api: ToastApi = {
    success: (m) => push("success", m),
    error: (m) => push("error", m),
    info: (m) => push("info", m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[100] flex flex-col items-center gap-2 px-4">
        {items.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm animate-slide-in items-start gap-2.5 rounded-xl border bg-white px-3.5 py-3 shadow-pop"
            style={{
              borderColor:
                t.kind === "success"
                  ? "#bbf7d0"
                  : t.kind === "error"
                    ? "#fecaca"
                    : "#e2e8f0",
            }}
          >
            <span
              className={`mt-0.5 shrink-0 ${
                t.kind === "success"
                  ? "text-emerald-600"
                  : t.kind === "error"
                    ? "text-red-600"
                    : "text-brand"
              }`}
            >
              {t.kind === "success" ? (
                <IconCheck />
              ) : (
                <IconAlert />
              )}
            </span>
            <div className="flex-1 text-sm text-slate-700">{t.message}</div>
            <button
              className="shrink-0 text-slate-400 hover:text-slate-600"
              onClick={() => remove(t.id)}
              aria-label="关闭"
            >
              <IconX className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
