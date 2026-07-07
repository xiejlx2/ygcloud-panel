"use client";

/**
 * 命令式确认弹窗，替代原生 confirm()。
 * 用法：
 *   const confirm = useConfirm();
 *   if (!(await confirm({ title: "取消分配", message: "确认？", danger: true }))) return;
 */
import { createContext, useCallback, useContext, useState } from "react";
import { Modal } from "@/components/Modal";
import { IconAlert } from "@/components/Icons";

interface ConfirmOptions {
  title?: string;
  message: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm 必须在 ConfirmProvider 内使用");
  return ctx;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    opts: ConfirmOptions;
    resolve: (v: boolean) => void;
  } | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>((resolve) => setState({ opts, resolve }));
  }, []);

  function close(result: boolean) {
    state?.resolve(result);
    setState(null);
  }

  const o = state?.opts;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={o?.title ?? "请确认"}
        footer={
          <>
            <button className="btn-default" onClick={() => close(false)}>
              {o?.cancelText ?? "取消"}
            </button>
            <button
              className={o?.danger ? "btn-danger" : "btn-primary"}
              onClick={() => close(true)}
            >
              {o?.confirmText ?? "确认"}
            </button>
          </>
        }
      >
        <div className="flex gap-3">
          {o?.danger && (
            <span className="mt-0.5 shrink-0 text-amber-500">
              <IconAlert />
            </span>
          )}
          <div className="text-sm leading-relaxed text-slate-600">
            {o?.message}
          </div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
