"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/components/Api";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Logo } from "@/components/Logo";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { IconBrush, IconSpinner } from "@/components/Icons";

interface BrandingInfo {
  panelName: string;
  logoDataUrl: string | null;
  loginSubtitle: string | null;
  customized: boolean;
  defaultPanelName: string;
}

// 与后端校验一致：300KB 以内的 png/jpg/webp/svg
const MAX_LOGO_BYTES = 300 * 1024;
const ACCEPT_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export default function AdminBrandingPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const { data, mutate, isLoading } = useSWR<BrandingInfo>("/api/admin/branding", api);

  const [name, setName] = useState("");
  const [subtitle, setSubtitle] = useState("");
  // undefined=未改动；null=清除；string=新上传的 data URL
  const [logoDraft, setLogoDraft] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setName(data.customized && data.panelName !== data.defaultPanelName ? data.panelName : "");
    setSubtitle(data.loginSubtitle ?? "");
  }, [data]);

  function pickLogo(file: File | undefined) {
    if (!file) return;
    if (!ACCEPT_TYPES.includes(file.type)) {
      toast.error("仅支持 png / jpg / webp / svg 图片");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("图片超过 300KB，请压缩后再上传");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDraft(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function save() {
    setSaving(true);
    try {
      await api("/api/admin/branding", {
        method: "POST",
        body: JSON.stringify({
          panelName: name.trim() || null,
          loginSubtitle: subtitle.trim() || null,
          ...(typeof logoDraft === "string" ? { logoDataUrl: logoDraft } : {}),
          ...(logoDraft === null ? { clearLogo: true } : {}),
        }),
      });
      toast.success("品牌设置已保存");
      setLogoDraft(undefined);
      mutate();
      // 顶栏/标题由服务端渲染，刷新服务端组件让新品牌立即生效
      router.refresh();
    } catch (e) {
      toast.error((e as ApiError).message || "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    const ok = await confirm({
      title: "恢复默认品牌",
      message: "确认清除全部自定义品牌（名称 / Logo / 副标题），恢复为默认样式？",
      confirmText: "恢复默认",
      danger: true,
    });
    if (!ok) return;
    try {
      await api("/api/admin/branding", { method: "DELETE" });
      toast.success("已恢复默认品牌");
      setName("");
      setSubtitle("");
      setLogoDraft(undefined);
      mutate();
      router.refresh();
    } catch (e) {
      toast.error((e as ApiError).message);
    }
  }

  // 预览用的即时值
  const previewName = name.trim() || data?.defaultPanelName || "服务器控制台";
  const previewLogo =
    logoDraft !== undefined ? logoDraft : (data?.logoDataUrl ?? null);
  const previewSubtitle = subtitle.trim() || null;

  return (
    <div className="max-w-2xl space-y-5">
      <PageHeader
        title="品牌设置"
        subtitle="自定义面板名称与 Logo，客户看到的将是你的品牌（白标）"
      />

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {/* 实时预览 */}
          <div className="card p-5">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <IconBrush className="h-4 w-4 text-slate-400" />
              效果预览
            </div>
            <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 py-8">
              <Logo name={previewName} logoDataUrl={previewLogo} subtitle={previewSubtitle} />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              此样式将出现在：登录页、顶部导航栏、浏览器标题、通知消息前缀。
            </p>
          </div>

          {/* 配置表单 */}
          <div className="card p-5">
            <label className="label">面板名称</label>
            <input
              className="input"
              placeholder={`留空使用默认「${data?.defaultPanelName}」`}
              maxLength={30}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <label className="label mt-4">登录页副标题（可选）</label>
            <input
              className="input"
              placeholder="例如：某某科技 · 云服务器管理"
              maxLength={60}
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
            />

            <label className="label mt-4">Logo 图片（可选）</label>
            <div className="flex items-center gap-3">
              <label className="btn-default cursor-pointer">
                选择图片
                <input
                  type="file"
                  accept={ACCEPT_TYPES.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    pickLogo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
              {(previewLogo || logoDraft === null) && (
                <button
                  className="text-xs text-red-600 hover:underline"
                  onClick={() => setLogoDraft(null)}
                >
                  清除 Logo（用默认图标）
                </button>
              )}
            </div>
            <p className="mt-1.5 text-xs text-slate-400">
              建议正方形、透明底 png/svg，300KB 以内；会显示为圆角小图标。
            </p>

            <div className="mt-5 flex gap-2">
              <button className="btn-primary" disabled={saving} onClick={save}>
                {saving && <IconSpinner className="h-4 w-4" />}
                保存
              </button>
              {data?.customized && (
                <button className="btn-default" onClick={reset}>
                  恢复默认
                </button>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500">
            提示：如果你在钉钉机器人里设置了「自定义关键词」做安全校验，修改面板名称后
            记得同步更新关键词（通知消息以【面板名称】开头）。
          </div>
        </>
      )}
    </div>
  );
}
