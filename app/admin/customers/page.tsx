"use client";

import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/components/Api";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { TableSkeleton } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { Modal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { IconUsers, IconPlus, IconSpinner } from "@/components/Icons";

interface Customer {
  id: string;
  username: string;
  displayName: string;
  status: string;
  remark: string | null;
  phone: string | null;
  email: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  serverCount: number;
}

const COLS = 7;

export default function AdminCustomersPage() {
  const { data, error, mutate, isLoading } = useSWR<{ items: Customer[] }>(
    "/api/admin/customers",
    api,
  );
  const [open, setOpen] = useState(false);
  const items = data?.items ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="客户"
        subtitle="创建客户账号、重置密码、禁用"
        actions={
          <button className="btn-primary" onClick={() => setOpen(true)}>
            <IconPlus className="h-4 w-4" />
            新建客户
          </button>
        }
      />
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>名称</th>
                <th>登录账号</th>
                <th>状态</th>
                <th>服务器</th>
                <th>联系方式</th>
                <th>最近登录</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <TableSkeleton cols={COLS} rows={5} />}
              {!isLoading && items.length === 0 && (
                <tr>
                  <td colSpan={COLS}>
                    <EmptyState
                      icon={<IconUsers />}
                      title="暂无客户"
                      description="新建客户账号，再把服务器分配给他们。"
                      action={
                        <button className="btn-primary btn-sm" onClick={() => setOpen(true)}>
                          <IconPlus className="h-4 w-4" />
                          新建客户
                        </button>
                      }
                    />
                  </td>
                </tr>
              )}
              {items.map((c) => (
                <CustomerRow key={c.id} c={c} onMutate={() => mutate()} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <CreateDialog
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {
          setOpen(false);
          mutate();
        }}
      />
    </div>
  );
}

function CustomerRow({ c, onMutate }: { c: Customer; onMutate: () => void }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [resetOpen, setResetOpen] = useState(false);

  async function disable() {
    const ok = await confirm({
      title: "禁用客户",
      message: `确认禁用客户「${c.displayName}」？该客户将立即无法登录，名下所有分配也会被撤销。`,
      confirmText: "禁用账号",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/admin/customers/${c.id}`, { method: "DELETE" });
      toast.success("客户已禁用");
      onMutate();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  return (
    <tr>
      <td>
        <div className="font-medium text-slate-800">{c.displayName}</div>
        {c.remark && <div className="text-xs text-slate-400">{c.remark}</div>}
      </td>
      <td className="font-mono text-xs">{c.username}</td>
      <td>
        <StatusBadge value={c.status} />
      </td>
      <td>
        <span className="chip">{c.serverCount} 台</span>
      </td>
      <td className="text-xs">
        {c.phone && <div className="text-slate-600">{c.phone}</div>}
        {c.email && <div className="text-slate-500">{c.email}</div>}
        {!c.phone && !c.email && <span className="text-slate-400">—</span>}
      </td>
      <td className="whitespace-nowrap text-xs text-slate-500">
        {c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleString() : "—"}
      </td>
      <td>
        <div className="flex items-center gap-3 text-xs">
          <button className="text-brand hover:underline" onClick={() => setResetOpen(true)}>
            重置密码
          </button>
          {c.status === "active" && (
            <button className="text-red-600 hover:underline" onClick={disable}>
              禁用
            </button>
          )}
        </div>
        <ResetDialog
          open={resetOpen}
          customer={c}
          onClose={() => setResetOpen(false)}
        />
      </td>
    </tr>
  );
}

function ResetDialog({
  open,
  customer,
  onClose,
}: {
  open: boolean;
  customer: Customer;
  onClose: () => void;
}) {
  const toast = useToast();
  const [pwd, setPwd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await api(`/api/admin/customers/${customer.id}/reset`, {
        method: "POST",
        body: JSON.stringify({ password: pwd }),
      });
      toast.success(`已重置「${customer.displayName}」的密码`);
      setPwd("");
      onClose();
    } catch (e) {
      setError((e as ApiError).message || "重置失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`重置密码 · ${customer.displayName}`}
      footer={
        <>
          <button className="btn-default" onClick={onClose}>
            取消
          </button>
          <button className="btn-primary" disabled={loading || pwd.length < 8} onClick={submit}>
            {loading && <IconSpinner className="h-4 w-4" />}
            确认重置
          </button>
        </>
      }
    >
      <label className="label">新登录密码</label>
      <input
        type="text"
        className="input"
        placeholder="至少 8 位"
        value={pwd}
        onChange={(e) => setPwd(e.target.value)}
        autoFocus
      />
      {error && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}
    </Modal>
  );
}

function CreateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const empty = { name: "", username: "", password: "", remark: "", phone: "", email: "" };
  const [form, setForm] = useState(empty);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await api("/api/admin/customers", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          username: form.username,
          password: form.password,
          remark: form.remark || null,
          phone: form.phone || null,
          email: form.email || null,
        }),
      });
      toast.success("客户已创建");
      setForm(empty);
      onCreated();
    } catch (e) {
      setError((e as ApiError).message || "创建失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="新建客户"
      footer={
        <>
          <button className="btn-default" onClick={onClose}>
            取消
          </button>
          <button
            className="btn-primary"
            disabled={loading || !form.name || !form.username || !form.password}
            onClick={submit}
          >
            {loading && <IconSpinner className="h-4 w-4" />}
            创建
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">显示名称</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div>
          <label className="label">登录账号</label>
          <input
            className="input"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="字母 / 数字 / _-.，3-50 位"
          />
        </div>
        <div>
          <label className="label">初始密码</label>
          <input
            type="text"
            className="input"
            placeholder="至少 8 位"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">手机（可选）</label>
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div>
            <label className="label">邮箱（可选）</label>
            <input
              className="input"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
        </div>
        <div>
          <label className="label">备注（可选）</label>
          <input
            className="input"
            value={form.remark}
            onChange={(e) => setForm({ ...form, remark: e.target.value })}
          />
        </div>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}
