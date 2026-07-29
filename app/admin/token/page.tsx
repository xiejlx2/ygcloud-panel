"use client";

import { useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/components/Api";
import { StatusBadge } from "@/components/StatusBadge";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { IconKey, IconShield, IconSpinner } from "@/components/Icons";

interface CloudAccount {
  id: string;
  accountName: string;
  status: string;
  tokenSuffix: string | null;
  lastVerifiedAt: string | null;
  keyMatches: boolean;
  serverCount: number;
}

interface TokenInfo {
  items: CloudAccount[];
  currentKeyHint: string;
}

export default function AdminTokenPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, mutate, isLoading } = useSWR<TokenInfo>("/api/admin/token", api);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [token, setToken] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  function openCreate() {
    setEditingId(null);
    setAccountName("");
    setToken("");
    setFormOpen(true);
  }

  function openEdit(item: CloudAccount) {
    setEditingId(item.id);
    setAccountName(item.accountName);
    setToken("");
    setFormOpen(true);
  }

  async function save() {
    if (!accountName.trim()) return;
    if (!editingId && !token.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await api("/api/admin/token", {
          method: "PUT",
          body: JSON.stringify({
            id: editingId,
            accountName: accountName.trim(),
            ...(token.trim() ? { token: token.trim() } : {}),
          }),
        });
        toast.success(token.trim() ? "云账户名称和 Key 已更新" : "云账户名称已更新");
      } else {
        await api("/api/admin/token", {
          method: "POST",
          body: JSON.stringify({
            accountName: accountName.trim(),
            token: token.trim(),
          }),
        });
        toast.success("云账户已添加");
      }
      setFormOpen(false);
      setToken("");
      await mutate();
    } catch (e) {
      toast.error((e as ApiError).message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function verify(item: CloudAccount) {
    setVerifyingId(item.id);
    try {
      const r = await api<{ verified: boolean; instanceCount: number }>(
        "/api/admin/token",
        {
          method: "PATCH",
          body: JSON.stringify({ id: item.id }),
        },
      );
      toast.success(`${item.accountName} 校验通过，可访问 ${r.instanceCount} 台服务器`);
      await mutate();
    } catch (e) {
      toast.error((e as ApiError).message || "校验失败");
      await mutate();
    } finally {
      setVerifyingId(null);
    }
  }

  async function remove(item: CloudAccount) {
    const ok = await confirm({
      title: "移除云账户",
      message:
        `确认移除「${item.accountName}」？该账户的 ${item.serverCount} 台缓存服务器将从面板移除，` +
        "已有分配会一并解除；上游云服务器本身不会被删除。",
      confirmText: "确认移除",
      danger: true,
    });
    if (!ok) return;
    setRemovingId(item.id);
    try {
      await api(`/api/admin/token?id=${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      toast.success("云账户已移除");
      await mutate();
    } catch (e) {
      toast.error((e as ApiError).message || "移除失败");
    } finally {
      setRemovingId(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader
        title="接入配置"
        subtitle="接入多个上游云账户，统一同步和管理各账户中的服务器"
        actions={
          <button className="btn-primary" onClick={openCreate}>
            <IconKey className="h-4 w-4" />
            添加云账户
          </button>
        }
      />

      <div className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
        <IconShield className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <span>
          每个 OpenAPI Key 仅在服务端使用 AES-256-GCM 加密存储。服务器同步后会记录来源账户，
          后续开关机、改密和重装会自动使用对应账户的 Key。
        </span>
      </div>

      {formOpen && (
        <div className="card p-5">
          <div className="text-sm font-semibold text-slate-800">
            {editingId ? "编辑云账户" : "添加云账户"}
          </div>
          <label className="label mt-4">账户名称</label>
          <input
            className="input"
            maxLength={50}
            placeholder="例如：主账户、海外账户、客户资源池"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            autoFocus
          />
          <label className="label mt-4">
            OpenAPI Key
            {editingId && <span className="ml-1 font-normal text-slate-400">留空表示不更换</span>}
          </label>
          <textarea
            className="textarea font-mono"
            rows={3}
            placeholder={editingId ? "如需更换 Key，请粘贴新值" : "粘贴该账户的 OpenAPI Key"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <div className="mt-4 flex gap-2">
            <button
              className="btn-primary"
              disabled={saving || !accountName.trim() || (!editingId && !token.trim())}
              onClick={save}
            >
              {saving && <IconSpinner className="h-4 w-4" />}
              保存
            </button>
            <button className="btn-default" disabled={saving} onClick={() => setFormOpen(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : items.length === 0 ? (
        <div className="card p-8 text-center">
          <IconKey className="mx-auto h-8 w-8 text-slate-300" />
          <div className="mt-2 text-sm font-medium text-slate-700">尚未接入云账户</div>
          <p className="mt-1 text-xs text-slate-400">添加第一个 OpenAPI Key 后即可同步服务器。</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-slate-900">{item.accountName}</span>
                    <StatusBadge value={item.status} />
                    <span className="badge bg-slate-100 text-slate-600">
                      {item.serverCount} 台服务器
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 text-xs text-slate-400">
                    <div>Key 末 4 位 ****{item.tokenSuffix || "—"}</div>
                    <div>
                      {item.lastVerifiedAt
                        ? `最近校验 ${new Date(item.lastVerifiedAt).toLocaleString()}`
                        : "尚未校验"}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    className="btn-default btn-sm"
                    disabled={verifyingId === item.id}
                    onClick={() => verify(item)}
                  >
                    {verifyingId === item.id && <IconSpinner className="h-3.5 w-3.5" />}
                    校验
                  </button>
                  <button className="btn-default btn-sm" onClick={() => openEdit(item)}>
                    编辑
                  </button>
                  <button
                    className="btn-sm rounded-md px-2.5 py-1 font-medium text-red-600 hover:bg-red-50"
                    disabled={removingId === item.id}
                    onClick={() => remove(item)}
                  >
                    {removingId === item.id ? "移除中…" : "移除"}
                  </button>
                </div>
              </div>
              {!item.keyMatches && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  服务端加密密钥已变更（当前指纹 {data?.currentKeyHint}），请编辑并重新填入该账户 Key。
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
