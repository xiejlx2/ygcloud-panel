"use client";

import { useState } from "react";
import { api, ApiError } from "@/components/Api";
import { StatusBadge } from "@/components/StatusBadge";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { IconSpinner } from "@/components/Icons";

interface Props {
  uuid: string;
  // 客户端不需要展示"分配"按钮等管理动作，由父组件传入
  role: "reseller_admin" | "customer";
  onDone?: () => void;
  // 是否允许修改密码：客户默认 false，代理商默认 true
  canModifyPassword?: boolean;
}

type PendingAction = "start" | "stop" | "restart" | "password" | null;

export function ServerActionButtons({
  uuid,
  role,
  onDone,
  canModifyPassword = role === "reseller_admin",
}: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, setPending] = useState<PendingAction>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  async function act(action: "start" | "stop" | "restart") {
    const ok = await confirm({
      title: `${label(action)}服务器`,
      message: `确认对该服务器执行【${label(action)}】操作吗？`,
      confirmText: label(action),
      danger: action !== "start",
    });
    if (!ok) return;
    setPending(action);
    setTaskStatus("PENDING");
    try {
      const r = await api<{ asyncTaskUUID: string | null; status: string }>(
        `/api/servers/${uuid}/${action}`,
        { method: "POST" },
      );
      pollTask(r.asyncTaskUUID);
    } catch (e) {
      toast.error((e as ApiError).message || "操作失败");
      setPending(null);
      setTaskStatus(null);
    }
  }

  async function pollTask(t?: string | null) {
    if (!t) {
      setPending(null);
      setTaskStatus(null);
      return;
    }
    const start = Date.now();
    const tick = async () => {
      try {
        const r = await api<{ taskStatus: string | null; processResult: string | null }>(
          `/api/tasks/${t}`,
        );
        setTaskStatus(r.taskStatus ?? null);
        if (
          r.taskStatus === "FINISHED" ||
          r.taskStatus === "FAILED" ||
          r.processResult === "SUCCESS" ||
          r.processResult === "FAILED"
        ) {
          setPending(null);
          setTaskStatus(null);
          if (r.processResult === "FAILED" || r.taskStatus === "FAILED") {
            toast.error("任务执行失败");
          } else {
            toast.success("操作已完成");
          }
          onDone?.();
          return;
        }
        if (Date.now() - start > 60_000) {
          setPending(null);
          setTaskStatus(null);
          toast.info("任务仍在执行，请稍后刷新查看");
          return;
        }
        setTimeout(tick, 3000);
      } catch (e) {
        setPending(null);
        setTaskStatus(null);
        toast.error((e as ApiError).message || "查询任务失败");
      }
    };
    setTimeout(tick, 1500);
  }

  async function submitPassword() {
    setPwdErr(null);
    setPending("password");
    try {
      const r = await api<{ asyncTaskUUID: string | null }>(
        `/api/servers/${uuid}/password`,
        { method: "POST", body: JSON.stringify({ password: pwd }) },
      );
      setPwd("");
      setPwdOpen(false);
      setTaskStatus("PENDING");
      toast.success("已提交修改，正在执行");
      pollTask(r.asyncTaskUUID);
    } catch (e) {
      setPwdErr((e as ApiError).message || "修改密码失败");
      setPending(null);
    }
  }

  const busy = pending === "start" || pending === "stop" || pending === "restart";

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <PowerBtn label="开机" active={pending === "start"} disabled={busy} onClick={() => act("start")} />
        <PowerBtn label="关机" active={pending === "stop"} disabled={busy} onClick={() => act("stop")} />
        <PowerBtn label="重启" active={pending === "restart"} disabled={busy} onClick={() => act("restart")} />
        {canModifyPassword && (
          <button
            className="btn-ghost btn-sm"
            disabled={pending === "password"}
            onClick={() => setPwdOpen(true)}
          >
            改密码
          </button>
        )}
        {taskStatus && <StatusBadge value={taskStatus} />}
      </div>

      <Modal
        open={pwdOpen}
        onClose={() => {
          setPwdOpen(false);
          setPwdErr(null);
        }}
        title="修改服务器系统密码"
        footer={
          <>
            <button className="btn-default" onClick={() => setPwdOpen(false)}>
              取消
            </button>
            <button
              className="btn-primary"
              disabled={pending === "password" || pwd.length === 0}
              onClick={submitPassword}
            >
              {pending === "password" && <IconSpinner className="h-4 w-4" />}
              确认修改
            </button>
          </>
        }
      >
        <label className="label">新密码</label>
        <input
          type="password"
          className="input"
          placeholder="8-16 位，含大小写 / 数字 / 特殊字符"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          autoFocus
        />
        <p className="mt-2 text-xs text-slate-400">
          禁止连续或重复字符与常见弱口令。修改为异步操作，提交后稍候生效。
        </p>
        {pwdErr && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {pwdErr}
          </div>
        )}
      </Modal>
    </div>
  );
}

function PowerBtn({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button className="btn-default btn-sm" disabled={disabled} onClick={onClick}>
      {active && <IconSpinner className="h-3.5 w-3.5" />}
      {label}
    </button>
  );
}

function label(action: "start" | "stop" | "restart") {
  return action === "start" ? "开机" : action === "stop" ? "关机" : "重启";
}
