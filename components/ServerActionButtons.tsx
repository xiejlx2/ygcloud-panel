"use client";

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/components/Api";
import { StatusBadge } from "@/components/StatusBadge";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { IconSpinner, IconAlert, IconDots } from "@/components/Icons";

interface Props {
  uuid: string;
  role?: "reseller_admin" | "customer";
  onDone?: () => void;
  // 改密码 / 重装系统：默认对代理商与客户都开放
  canModifyPassword?: boolean;
  canReinstall?: boolean;
  // menu：紧凑下拉（表格行用）；inline：平铺按钮（详情页用）
  variant?: "menu" | "inline";
}

interface ImageItem {
  imageResourceUUID: string;
  imageName: string | null;
  osVersion: string | null;
  osVersionDetail: string | null;
  imageType: string | null;
  imageAccount: string | null;
}

function imageLabel(i: ImageItem): string {
  if (i.imageType === "Application") {
    // 应用镜像：应用名更直观，附带底层系统
    return i.imageName
      ? `${i.imageName}${i.osVersionDetail ? `（${i.osVersionDetail}）` : ""}`
      : i.osVersionDetail || i.imageResourceUUID;
  }
  return i.osVersionDetail || i.imageName || i.imageResourceUUID;
}

type PendingAction = "start" | "stop" | "restart" | "password" | "reinstall" | null;

export function ServerActionButtons({
  uuid,
  onDone,
  canModifyPassword = true,
  canReinstall = true,
  variant = "inline",
}: Props) {
  const toast = useToast();
  const confirm = useConfirm();
  const [pending, setPending] = useState<PendingAction>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwdErr, setPwdErr] = useState<string | null>(null);

  const [reOpen, setReOpen] = useState(false);
  const [images, setImages] = useState<ImageItem[] | null>(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [image, setImage] = useState("");
  const [rePwd, setRePwd] = useState("");
  const [reAck, setReAck] = useState(false);
  const [reErr, setReErr] = useState<string | null>(null);

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
        if (Date.now() - start > 120_000) {
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

  async function openReinstall() {
    setReOpen(true);
    setReErr(null);
    setImage("");
    setRePwd("");
    setReAck(false);
    if (images) return;
    setImgLoading(true);
    try {
      const r = await api<{ items: ImageItem[] }>(`/api/servers/${uuid}/images`);
      setImages(r.items);
    } catch (e) {
      setReErr((e as ApiError).message || "获取镜像列表失败");
    } finally {
      setImgLoading(false);
    }
  }

  async function submitReinstall() {
    setReErr(null);
    setPending("reinstall");
    try {
      const r = await api<{ asyncTaskUUID: string | null }>(
        `/api/servers/${uuid}/reinstall`,
        {
          method: "POST",
          body: JSON.stringify({ imageResourceUUID: image, password: rePwd }),
        },
      );
      setReOpen(false);
      setTaskStatus("PENDING");
      toast.success("已提交重装，正在执行");
      pollTask(r.asyncTaskUUID);
    } catch (e) {
      setReErr((e as ApiError).message || "重装失败");
      setPending(null);
    }
  }

  const busy = pending === "start" || pending === "stop" || pending === "restart";

  const modals = (
    <>
      {/* 改密码 */}
      <Modal
        open={pwdOpen}
        onClose={() => {
          setPwdOpen(false);
          setPwdErr(null);
        }}
        title="修改服务器系统密码"
        footer={
          <>
            <button className="btn-default" onClick={() => setPwdOpen(false)}>取消</button>
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

      {/* 重装系统 */}
      <Modal
        open={reOpen}
        onClose={() => {
          setReOpen(false);
          setReErr(null);
        }}
        title="重装系统"
        maxWidth="max-w-lg"
        footer={
          <>
            <button className="btn-default" onClick={() => setReOpen(false)}>取消</button>
            <button
              className="btn-danger"
              disabled={pending === "reinstall" || !image || rePwd.length === 0 || !reAck}
              onClick={submitReinstall}
            >
              {pending === "reinstall" && <IconSpinner className="h-4 w-4" />}
              确认重装
            </button>
          </>
        }
      >
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
          <IconAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            重装将<b>清空该服务器上的全部数据且不可恢复</b>。上游要求
            <b>先关机</b>后才能重装；若未关机会提示失败，请先执行「关机」。
          </div>
        </div>

        <label className="label">目标系统镜像</label>
        {imgLoading ? (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <IconSpinner className="h-4 w-4" /> 加载镜像列表…
          </div>
        ) : (
          <select className="select" value={image} onChange={(e) => setImage(e.target.value)}>
            <option value="">请选择系统</option>
            {(() => {
              const list = images ?? [];
              const system = list.filter((i) => i.imageType !== "Application");
              const application = list.filter((i) => i.imageType === "Application");
              return (
                <>
                  {system.length > 0 && (
                    <optgroup label="标准镜像">
                      {system.map((i) => (
                        <option key={i.imageResourceUUID} value={i.imageResourceUUID}>
                          {imageLabel(i)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {application.length > 0 && (
                    <optgroup label="应用镜像">
                      {application.map((i) => (
                        <option key={i.imageResourceUUID} value={i.imageResourceUUID}>
                          {imageLabel(i)}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </>
              );
            })()}
          </select>
        )}

        <label className="label mt-3">新系统密码</label>
        <input
          type="password"
          className="input"
          placeholder="8-16 位，含大小写 / 数字 / 特殊字符"
          value={rePwd}
          onChange={(e) => setRePwd(e.target.value)}
        />
        <p className="mt-1 text-xs text-slate-400">
          重装后 Linux 用户名为 root，Windows 为 Administrator。
        </p>

        <label className="mt-3 flex items-start gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            className="mt-0.5 accent-red-600"
            checked={reAck}
            onChange={(e) => setReAck(e.target.checked)}
          />
          我已知晓：重装会清空该服务器数据、需先关机，且操作不可撤销。
        </label>

        {reErr && (
          <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {reErr}
          </div>
        )}
      </Modal>
    </>
  );

  // ===== 紧凑下拉（表格行）=====
  if (variant === "menu") {
    return (
      <ActionMenu
        busy={busy}
        pending={pending}
        taskStatus={taskStatus}
        canModifyPassword={canModifyPassword}
        canReinstall={canReinstall}
        onAct={act}
        onPassword={() => setPwdOpen(true)}
        onReinstall={openReinstall}
      >
        {modals}
      </ActionMenu>
    );
  }

  // ===== 平铺按钮（详情页）=====
  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <PowerBtn label="开机" active={pending === "start"} disabled={busy} onClick={() => act("start")} />
        <PowerBtn label="关机" active={pending === "stop"} disabled={busy} onClick={() => act("stop")} />
        <PowerBtn label="重启" active={pending === "restart"} disabled={busy} onClick={() => act("restart")} />
        {canModifyPassword && (
          <button className="btn-ghost btn-sm" disabled={pending === "password"} onClick={() => setPwdOpen(true)}>
            改密码
          </button>
        )}
        {canReinstall && (
          <button
            className="btn-sm rounded-md px-2.5 py-1 font-medium text-red-600 transition-colors hover:bg-red-50"
            disabled={pending === "reinstall"}
            onClick={openReinstall}
          >
            重装系统
          </button>
        )}
        {taskStatus && <StatusBadge value={taskStatus} />}
      </div>
      {modals}
    </div>
  );
}

/** 行内操作下拉：kebab 触发，fixed 定位避免被表格滚动容器裁剪。 */
function ActionMenu({
  busy,
  pending,
  taskStatus,
  canModifyPassword,
  canReinstall,
  onAct,
  onPassword,
  onReinstall,
  children,
}: {
  busy: boolean;
  pending: PendingAction;
  taskStatus: string | null;
  canModifyPassword: boolean;
  canReinstall: boolean;
  onAct: (a: "start" | "stop" | "restart") => void;
  onPassword: () => void;
  onReinstall: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    // 页面滚动/尺寸变化时关闭（fixed 定位会失准）
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    // 点击菜单“之外”才关闭。必须同时排除触发按钮与菜单本身，
    // 否则 mousedown 命中菜单项时会先卸载菜单，导致点击不触发（功能“无反应”）。
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
    const W = 176;
    const H = 220;
    let left = r.right - W;
    let top = r.bottom + 6;
    if (top + H > window.innerHeight) top = r.top - H - 6;
    if (left < 8) left = 8;
    setPos({ top, left });
    setOpen(true);
  }

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="flex items-center justify-end gap-2">
      {taskStatus && <StatusBadge value={taskStatus} />}
      <button
        ref={btnRef}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        onClick={toggle}
        aria-label="操作"
      >
        {busy || pending ? <IconSpinner className="h-4 w-4" /> : <IconDots className="h-4 w-4" />}
      </button>

      {open && pos && (
        <div
          ref={menuRef}
          className="fixed z-50 w-44 animate-fade-in overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-pop"
          style={{ top: pos.top, left: pos.left }}
        >
          <MenuItem disabled={busy} onClick={() => run(() => onAct("start"))}>开机</MenuItem>
          <MenuItem disabled={busy} onClick={() => run(() => onAct("stop"))}>关机</MenuItem>
          <MenuItem disabled={busy} onClick={() => run(() => onAct("restart"))}>重启</MenuItem>
          {(canModifyPassword || canReinstall) && <div className="my-1 h-px bg-slate-100" />}
          {canModifyPassword && (
            <MenuItem onClick={() => run(onPassword)}>修改密码</MenuItem>
          )}
          {canReinstall && (
            <MenuItem danger onClick={() => run(onReinstall)}>重装系统</MenuItem>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center px-3.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        danger
          ? "text-red-600 hover:bg-red-50"
          : "text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
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
