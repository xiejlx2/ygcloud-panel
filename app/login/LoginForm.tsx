"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/components/Api";
import { Logo } from "@/components/Logo";
import { IconShield, IconSpinner } from "@/components/Icons";

export function LoginForm({
  panelName = "服务器控制台",
  logoDataUrl = null,
  subtitle = null,
}: {
  panelName?: string;
  logoDataUrl?: string | null;
  subtitle?: string | null;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const r = await api<{ user: { role: string } }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (r.user.role === "reseller_admin") router.replace("/admin/dashboard");
      else router.replace("/client/servers");
    } catch (e) {
      setError((e as ApiError).message || "登录失败");
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden px-4">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-100/60 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-indigo-100/50 blur-3xl" />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Logo name={panelName} logoDataUrl={logoDataUrl} subtitle={subtitle} />
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6">
          <div>
            <h1 className="text-base font-semibold text-slate-900">登录到控制台</h1>
          </div>
          <div>
            <label className="label">登录账号</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="请输入账号"
              required
            />
          </div>
          <div>
            <label className="label">密码</label>
            <input
              type="password"
              className="input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              placeholder="请输入密码"
              required
            />
          </div>
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          <button type="submit" className="btn-primary w-full" disabled={loading}>
            {loading && <IconSpinner className="h-4 w-4" />}
            {loading ? "登录中…" : "登录"}
          </button>
        </form>

        <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
          <IconShield className="h-3.5 w-3.5" />
          会话经加密保护，凭据仅服务端存储
        </div>
      </div>
    </div>
  );
}
