"use client";

/** 右上角用户菜单：显示名首字母头像 + 下拉（角色 / 修改密码 / 退出）。 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { api, ApiError } from "@/components/Api";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { IconChevronDown, IconLogout, IconKey, IconSpinner } from "@/components/Icons";

interface Me {
  id: string;
  role: string;
  name: string;
}

export function UserMenu() {
  const router = useRouter();
  const toast = useToast();
  const { data } = useSWR<Me>("/api/auth/me", api);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const [pwdOpen, setPwdOpen] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [newPwd2, setNewPwd2] = useState("");
  const [pwdErr, setPwdErr] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" }).catch(() => void 0);
    router.replace("/login");
  }

  function openPwd() {
    setOpen(false);
    setOldPwd("");
    setNewPwd("");
    setNewPwd2("");
    setPwdErr(null);
    setPwdOpen(true);
  }

  async function submitPwd() {
    setPwdErr(null);
    if (newPwd !== newPwd2) {
      setPwdErr("两次输入的新密码不一致");
      return;
    }
    setChanging(true);
    try {
      await api("/api/auth/password", {
        method: "POST",
        body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd }),
      });
      setPwdOpen(false);
      toast.success("密码已修改，其他设备的登录已全部失效");
    } catch (e) {
      setPwdErr((e as ApiError).message || "修改失败");
    } finally {
      setChanging(false);
    }
  }

  const name = data?.name || "…";
  const roleLabel =
    data?.role === "reseller_admin" ? "管理员" : data?.role === "customer" ? "客户" : "";
  const initial = name.trim().charAt(0).toUpperCase() || "U";

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 text-sm transition-colors hover:bg-slate-100"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-xs font-semibold text-white">
          {initial}
        </span>
        <span className="hidden max-w-[120px] truncate text-slate-700 sm:block">
          {name}
        </span>
        <IconChevronDown className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1.5 w-48 animate-fade-in overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop">
          <div className="border-b border-slate-100 px-3.5 py-3">
            <div className="truncate text-sm font-medium text-slate-800">{name}</div>
            {roleLabel && (
              <div className="mt-0.5 text-xs text-slate-400">{roleLabel}</div>
            )}
          </div>
          <button
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
            onClick={openPwd}
          >
            <IconKey className="h-4 w-4" />
            修改密码
          </button>
          <button
            className="flex w-full items-center gap-2 px-3.5 py-2.5 text-sm text-slate-600 transition-colors hover:bg-slate-50 hover:text-red-600"
            onClick={logout}
          >
            <IconLogout className="h-4 w-4" />
            退出登录
          </button>
        </div>
      )}

      {/* 修改登录密码 */}
      <Modal
        open={pwdOpen}
        onClose={() => setPwdOpen(false)}
        title="修改登录密码"
        footer={
          <>
            <button className="btn-default" onClick={() => setPwdOpen(false)}>取消</button>
            <button
              className="btn-primary"
              disabled={changing || !oldPwd || !newPwd || !newPwd2}
              onClick={submitPwd}
            >
              {changing && <IconSpinner className="h-4 w-4" />}
              确认修改
            </button>
          </>
        }
      >
        <label className="label">旧密码</label>
        <input
          type="password"
          className="input"
          value={oldPwd}
          onChange={(e) => setOldPwd(e.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        <label className="label mt-3">新密码</label>
        <input
          type="password"
          className="input"
          placeholder="8-64 位，须含大小写字母和数字"
          value={newPwd}
          onChange={(e) => setNewPwd(e.target.value)}
          autoComplete="new-password"
        />
        <label className="label mt-3">确认新密码</label>
        <input
          type="password"
          className="input"
          value={newPwd2}
          onChange={(e) => setNewPwd2(e.target.value)}
          autoComplete="new-password"
        />
        <p className="mt-2 text-xs text-slate-400">
          修改成功后，其他设备/浏览器上的登录会全部失效，本设备无需重新登录。
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
