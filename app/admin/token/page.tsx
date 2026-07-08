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

interface TokenInfo {
  configured: boolean;
  status?: string;
  tokenSuffix?: string;
  lastVerifiedAt?: string;
  // 服务端比对结果：库内凭据的加密密钥与当前密钥是否一致
  keyMatches?: boolean;
  currentKeyHint?: string;
}

export default function AdminTokenPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, mutate, isLoading } = useSWR<TokenInfo>("/api/admin/token", api);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ tokenSuffix: string }>("/api/admin/token", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      toast.success(`已保存，末 4 位 ****${r.tokenSuffix}`);
      setToken("");
      mutate();
    } catch (e) {
      toast.error((e as ApiError).message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function verify() {
    setVerifying(true);
    try {
      const r = await api<{ verified: boolean; instanceCount: number }>(
        "/api/admin/token",
        { method: "PATCH" },
      );
      toast.success(`校验通过，可访问 ${r.instanceCount} 台服务器`);
      mutate();
    } catch (e) {
      toast.error((e as ApiError).message || "校验失败");
    } finally {
      setVerifying(false);
    }
  }

  async function revoke() {
    const ok = await confirm({
      title: "撤销接入凭据",
      message: "确认撤销当前凭据？撤销后将无法同步服务器或执行任何操作。",
      confirmText: "撤销",
      danger: true,
    });
    if (!ok) return;
    try {
      await api("/api/admin/token", { method: "DELETE" });
      toast.success("凭据已撤销");
      mutate();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  const keyMismatch = data?.configured && data.keyMatches === false;

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader title="接入配置" subtitle="配置上游平台 API 接入凭据（仅服务端加密存储）" />

      <div className="card p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
          <IconKey className="h-4 w-4 text-slate-400" />
          当前凭据
        </div>
        {isLoading ? (
          <Skeleton className="h-5 w-48" />
        ) : data?.configured ? (
          <div className="space-y-1.5 text-sm text-slate-600">
            <div className="flex items-center gap-1.5">
              状态 <StatusBadge value={data.status} />
            </div>
            <div className="text-slate-400">末 4 位 ****{data.tokenSuffix}</div>
            {data.lastVerifiedAt && (
              <div className="text-slate-400">
                最近校验 {new Date(data.lastVerifiedAt).toLocaleString()}
              </div>
            )}
            {keyMismatch && (
              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                ⚠ 服务端加密密钥已变更（当前密钥指纹 {data.currentKeyHint}），
                原凭据无法解密，请重新填入。
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-400">尚未配置</div>
        )}
        <div className="mt-4 flex gap-2">
          <button className="btn-default" disabled={!data?.configured || verifying} onClick={verify}>
            {verifying && <IconSpinner className="h-4 w-4" />}
            {verifying ? "校验中…" : "立即校验"}
          </button>
          <button className="btn-danger" disabled={!data?.configured} onClick={revoke}>
            撤销凭据
          </button>
        </div>
      </div>

      <div className="card p-5">
        <div className="text-sm font-semibold text-slate-800">
          {data?.configured ? "更新凭据" : "填入凭据"}
        </div>
        <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
          <IconShield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          凭据来自上游云平台控制台的 API 凭据页面。仅在服务端加密存储，绝不展示给前端或客户。
        </p>
        <textarea
          className="textarea mt-3 font-mono"
          rows={3}
          placeholder="粘贴接入凭据"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
        <button className="btn-primary mt-3" disabled={saving || !token} onClick={save}>
          {saving && <IconSpinner className="h-4 w-4" />}
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}
