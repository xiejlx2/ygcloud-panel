"use client";

/**
 * 通知渠道配置 UI（代理商端与客户端共用，仅 API 路径不同）。
 * 左侧渠道表单 + 右侧 sticky「配置攻略」+ 测试推送。
 */
import { useEffect, useState } from "react";
import useSWR from "swr";
import { api, ApiError } from "@/components/Api";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { IconBell, IconShield, IconSpinner } from "@/components/Icons";

interface NotifyInfo {
  configured: boolean;
  enabled: boolean;
  telegram: { configured: boolean; suffix?: string; chatId?: string | null; keyMatches?: boolean };
  webhook: { configured: boolean; type?: string | null; keyMatches?: boolean };
  lastRunAt?: string;
  lastError?: string;
}

interface TestResult {
  channel: string;
  ok: boolean;
  error?: string;
}

const WEBHOOK_TYPES = [
  { value: "wecom", label: "企业微信" },
  { value: "dingtalk", label: "钉钉" },
  { value: "feishu", label: "飞书" },
];

type GuideTab = "telegram" | "wecom" | "dingtalk" | "feishu";

const GUIDE_TABS: { id: GuideTab; label: string }[] = [
  { id: "telegram", label: "Telegram" },
  { id: "wecom", label: "企业微信" },
  { id: "dingtalk", label: "钉钉" },
  { id: "feishu", label: "飞书" },
];

const GUIDES: Record<
  GuideTab,
  { title: string; steps: string[]; example?: string; note?: string }
> = {
  telegram: {
    title: "获取 Bot Token 与 Chat ID",
    steps: [
      "在 Telegram 搜索 @BotFather，发送 /newbot，按提示给机器人起名，创建成功后会返回一串 Bot Token。",
      "搜索并打开你刚建的机器人，点「Start」或随便发一条消息——机器人只能给「先跟它说过话」的人发消息。",
      "给 @userinfobot 发一条消息，它会回复你的数字 ID，即 Chat ID。",
      "若要发到群：把机器人拉进群，群 Chat ID 以 -100 开头（可用 @getidsbot 获取）。",
    ],
    example: "Token 形如　123456789:AAE-xxxxxxxxxxxxxxxxxx",
    note: "国内服务器通常无法直连 Telegram。配好后务必点「测试推送」确认；收不到就改用企业微信 / 钉钉 / 飞书。",
  },
  wecom: {
    title: "企业微信群机器人",
    steps: [
      "用企业微信打开目标群 → 右上角「…」→「群机器人」→「添加机器人」→ 新建。",
      "创建后复制它的 Webhook 地址。",
      "左侧类型选「企业微信」，粘贴地址并保存，再点「测试推送」验证。",
    ],
    example: "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxx",
  },
  dingtalk: {
    title: "钉钉群机器人",
    steps: [
      "钉钉打开目标群 →「群设置」→「机器人」→「添加机器人」→「自定义」。",
      "安全设置勾选「自定义关键词」，关键词填「服务器」（本面板消息都以【面板名称】开头，含「服务器」时可通过；如面板名不含该词，请改用面板名做关键词）。",
      "复制 Webhook 地址。",
      "左侧类型选「钉钉」，粘贴地址并保存，再点「测试推送」验证。",
    ],
    example: "https://oapi.dingtalk.com/robot/send?access_token=xxxx",
    note: "安全设置请用「自定义关键词」；本面板暂不支持「加签」和「IP 白名单」。",
  },
  feishu: {
    title: "飞书群机器人",
    steps: [
      "飞书打开目标群 →「设置」→「群机器人」→「添加机器人」→「自定义机器人」。",
      "安全设置可留空，或勾「自定义关键词」（本面板暂不支持签名校验）。",
      "复制 Webhook 地址。",
      "左侧类型选「飞书」，粘贴地址并保存，再点「测试推送」验证。",
    ],
    example: "https://open.feishu.cn/open-apis/bot/v2/hook/xxxx",
  },
};

function GuidePanel({ tab, onTab }: { tab: GuideTab; onTab: (t: GuideTab) => void }) {
  const g = GUIDES[tab];
  return (
    <div className="card overflow-hidden p-0 lg:sticky lg:top-20">
      <div className="border-b border-slate-100 bg-gradient-to-br from-brand-50/70 to-transparent px-5 py-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
          <IconBell className="h-4 w-4 text-brand" />
          配置攻略
        </div>
        <p className="mt-1 text-xs text-slate-500">选一个渠道，照着步骤配就行。</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {GUIDE_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onTab(t.id)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                tab === t.id
                  ? "bg-brand text-white shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="text-sm font-semibold text-slate-800">{g.title}</div>
        <ol className="mt-3 space-y-3">
          {g.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[11px] font-semibold text-brand-700">
                {i + 1}
              </span>
              <span className="text-xs leading-relaxed text-slate-600">{s}</span>
            </li>
          ))}
        </ol>

        {g.example && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
              地址 / 格式示例
            </div>
            <code className="block overflow-x-auto whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600">
              {g.example}
            </code>
          </div>
        )}

        {g.note && (
          <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span className="shrink-0">⚠</span>
            <span>{g.note}</span>
          </p>
        )}
      </div>
    </div>
  );
}

export function NotifySettings({
  basePath,
  subtitle,
  scanText,
}: {
  basePath: string;
  subtitle: string;
  scanText: string;
}) {
  const toast = useToast();
  const confirm = useConfirm();
  const { data, mutate, isLoading } = useSWR<NotifyInfo>(basePath, api);

  const [tgToken, setTgToken] = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [webhookType, setWebhookType] = useState("wecom");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<TestResult[] | null>(null);
  const [guideTab, setGuideTab] = useState<GuideTab>("wecom");

  useEffect(() => {
    if (!data) return;
    setTgChatId(data.telegram.chatId ?? "");
    if (data.webhook.type) setWebhookType(data.webhook.type);
  }, [data]);

  function pickGuide(t: GuideTab) {
    setGuideTab(t);
    if (t === "wecom" || t === "dingtalk" || t === "feishu") setWebhookType(t);
  }

  async function post(body: Record<string, unknown>, okMsg: string, tag: string) {
    setBusy(tag);
    try {
      await api(basePath, { method: "POST", body: JSON.stringify(body) });
      toast.success(okMsg);
      mutate();
    } catch (e) {
      toast.error((e as ApiError).message || "保存失败");
    } finally {
      setBusy(null);
    }
  }

  async function clearChannel(target: "telegram" | "webhook") {
    const ok = await confirm({
      title: "清除渠道",
      message: `确认清除${target === "telegram" ? " Telegram " : "企业 webhook "}配置？`,
      confirmText: "清除",
      danger: true,
    });
    if (!ok) return;
    setBusy(`clear-${target}`);
    try {
      await api(`${basePath}?target=${target}`, { method: "DELETE" });
      toast.success("已清除");
      if (target === "telegram") { setTgToken(""); setTgChatId(""); }
      else setWebhookUrl("");
      mutate();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setBusy(null);
    }
  }

  async function testPush() {
    setBusy("test");
    setTestResults(null);
    try {
      const r = await api<{ sent: boolean; results: TestResult[] }>(`${basePath}/test`, {
        method: "POST",
      });
      setTestResults(r.results);
      if (r.sent) toast.success("测试消息已发送，请到对应渠道查收");
      else toast.error("所有渠道发送失败，见下方明细");
    } catch (e) {
      toast.error((e as ApiError).message || "测试失败");
    } finally {
      setBusy(null);
    }
  }

  const anyConfigured = data?.telegram.configured || data?.webhook.configured;

  return (
    <div className="max-w-6xl space-y-5">
      <PageHeader title="通知设置" subtitle={subtitle} />

      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          {/* ===== 左：配置表单 ===== */}
          <div className="space-y-5">
            {/* 总开关 + 运行状态 */}
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <IconBell className="h-4 w-4 text-slate-400" />
                  通知总开关
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand"
                    checked={data?.enabled ?? true}
                    disabled={busy === "enabled"}
                    onChange={(e) => post({ enabled: e.target.checked }, e.target.checked ? "已开启" : "已关闭", "enabled")}
                  />
                  {data?.enabled ? "已开启" : "已关闭"}
                </label>
              </div>
              <p className="mt-2 text-xs text-slate-500">{scanText}</p>
              {(data?.lastRunAt || data?.lastError) && (
                <div className="mt-2 text-xs text-slate-400">
                  {data?.lastRunAt && <>最近运行 {new Date(data.lastRunAt).toLocaleString()}</>}
                  {data?.lastError && (
                    <span className="ml-2 text-red-500">上次发送异常：{data.lastError}</span>
                  )}
                </div>
              )}
            </div>

            {/* Telegram */}
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800">Telegram</div>
                {data?.telegram.configured && (
                  <span className="text-xs text-emerald-600">已配置 ****{data.telegram.suffix}</span>
                )}
              </div>
              <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
                <IconShield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                bot token 仅服务端加密存储。配置步骤见右侧「配置攻略」。
              </p>
              {data?.telegram.configured && data.telegram.keyMatches === false && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⚠ 服务端加密密钥已变更，原 bot token 无法解密，请重新填入。
                </div>
              )}
              <label className="label mt-3">Bot Token</label>
              <input
                className="input font-mono"
                type="password"
                placeholder={data?.telegram.configured ? "已配置，如需更换请重新输入" : "123456:ABC-DEF..."}
                value={tgToken}
                onFocus={() => setGuideTab("telegram")}
                onChange={(e) => setTgToken(e.target.value)}
              />
              <label className="label mt-3">Chat ID</label>
              <input
                className="input font-mono"
                placeholder="例如 123456789 或 -1001234567890（群）"
                value={tgChatId}
                onFocus={() => setGuideTab("telegram")}
                onChange={(e) => setTgChatId(e.target.value)}
              />
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-primary"
                  disabled={busy === "tg" || !tgChatId || (!data?.telegram.configured && !tgToken)}
                  onClick={() =>
                    post(
                      { telegramChatId: tgChatId, ...(tgToken ? { telegramBotToken: tgToken } : {}) },
                      "Telegram 已保存",
                      "tg",
                    ).then(() => setTgToken(""))
                  }
                >
                  {busy === "tg" && <IconSpinner className="h-4 w-4" />}
                  保存
                </button>
                {data?.telegram.configured && (
                  <button className="btn-default" disabled={busy === "clear-telegram"} onClick={() => clearChannel("telegram")}>
                    清除
                  </button>
                )}
              </div>
            </div>

            {/* 企业 webhook */}
            <div className="card p-5">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800">企业微信 / 钉钉 / 飞书 群机器人</div>
                {data?.webhook.configured && (
                  <span className="text-xs text-emerald-600">
                    已配置（{WEBHOOK_TYPES.find((t) => t.value === data.webhook.type)?.label ?? data.webhook.type}）
                  </span>
                )}
              </div>
              <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
                <IconShield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                国内可直连，比 Telegram 稳。webhook 地址仅服务端加密存储。配置步骤见右侧「配置攻略」。
              </p>
              {data?.webhook.configured && data.webhook.keyMatches === false && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⚠ 服务端加密密钥已变更，原 webhook 地址无法解密，请重新填入。
                </div>
              )}
              <label className="label mt-3">类型</label>
              <select
                className="select"
                value={webhookType}
                onChange={(e) => { setWebhookType(e.target.value); setGuideTab(e.target.value as GuideTab); }}
              >
                {WEBHOOK_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <label className="label mt-3">Webhook 地址</label>
              <input
                className="input font-mono"
                type="password"
                placeholder={data?.webhook.configured ? "已配置，如需更换请重新输入" : "https://..."}
                value={webhookUrl}
                onFocus={() => setGuideTab(webhookType as GuideTab)}
                onChange={(e) => setWebhookUrl(e.target.value)}
              />
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-primary"
                  disabled={busy === "wh" || (!data?.webhook.configured && !webhookUrl)}
                  onClick={() =>
                    post(
                      { webhookType, ...(webhookUrl ? { webhookUrl } : {}) },
                      "Webhook 已保存",
                      "wh",
                    ).then(() => setWebhookUrl(""))
                  }
                >
                  {busy === "wh" && <IconSpinner className="h-4 w-4" />}
                  保存
                </button>
                {data?.webhook.configured && (
                  <button className="btn-default" disabled={busy === "clear-webhook"} onClick={() => clearChannel("webhook")}>
                    清除
                  </button>
                )}
              </div>
            </div>

            {/* 测试推送 */}
            <div className="card p-5">
              <div className="text-sm font-semibold text-slate-800">测试推送</div>
              <p className="mt-1 text-xs text-slate-500">
                向已保存的渠道立即发一条测试消息，验证是否能收到（尤其确认 Telegram 从服务器能否直连）。
              </p>
              <button className="btn-default mt-3" disabled={busy === "test" || !anyConfigured} onClick={testPush}>
                {busy === "test" && <IconSpinner className="h-4 w-4" />}
                {anyConfigured ? "发送测试消息" : "请先配置至少一个渠道"}
              </button>
              {testResults && (
                <ul className="mt-3 space-y-1 text-xs">
                  {testResults.map((r) => (
                    <li key={r.channel} className={r.ok ? "text-emerald-600" : "text-red-600"}>
                      {r.ok ? "✅" : "❌"} {r.channel}
                      {r.error ? ` —— ${r.error}` : " 发送成功"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* ===== 右：配置攻略（sticky） ===== */}
          <GuidePanel tab={guideTab} onTab={pickGuide} />
        </div>
      )}
    </div>
  );
}
