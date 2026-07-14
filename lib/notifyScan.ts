/**
 * 通知扫描核心（后端专用）。
 *
 * 每个代理商跑一轮 runNotifyForReseller：
 *   1) 真实同步（listInstancesDetailed + syncServerCache），顺带判定 Token/同步是否健康。
 *      —— 这也让 server_cache 保持新鲜、Token 每天自动校验（此前 sync 全靠手动触发）。
 *   2) 读 server_cache，用 getExpiryInfo 算出新增的到期 / 回收站告警（按 NotificationLog 去重）。
 *   3) 把本轮新增告警批量成一条中文消息，发到该代理商配置的渠道，记 NotificationLog + 审计。
 *
 * 去重（dedupKey）：
 *   到期：expire:<uuid>:<expireDate>:<threshold>（threshold ∈ 7/3/1/0；带到期日期纪元，续费后自然重置）
 *   回收站：recycle:<uuid>:<expireDate>
 *   Token/同步：token:<resellerId>（状态翻转语义：不健康且无此记录→发送并建记录；恢复健康→删记录）
 */
import "server-only";
import { prisma } from "@/lib/prisma";
import { getExpiryInfo } from "@/lib/expiry";
import { listInstancesDetailed, CloudApiError } from "@/lib/cloud";
import { syncServerCache, getKnownZones } from "@/lib/sync";
import { sendToConfig, hasAnyChannel } from "@/lib/notify";
import { getBranding } from "@/lib/branding";

const EXPIRE_THRESHOLDS = [7, 3, 1, 0] as const;

export interface NotifyRunResult {
  resellerId: string;
  skipped?: string; // 跳过原因（未配置渠道 / 未启用）
  tokenHealthy: boolean;
  alertsSent: number;
  channels: string[];
  error?: string;
}

/** 到期日期纪元：用于 dedupKey，续费后到期时间变化即换一批 key，自然重新进入告警窗口。 */
function expireEpoch(expireTime: Date): string {
  return expireTime.toISOString().slice(0, 10); // YYYY-MM-DD
}

function fmtDate(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 一台机器的简短标识：别名 || 名称 (公网IP)。 */
function serverLabel(s: {
  instanceName: string | null;
  publicIpAddress: string | null;
  customerAlias?: string | null;
}): string {
  const name = s.customerAlias || s.instanceName || "(未命名)";
  return s.publicIpAddress ? `${name} (${s.publicIpAddress})` : name;
}

interface ScanServer {
  ecsResourceUuid: string;
  instanceName: string | null;
  publicIpAddress: string | null;
  expireTime: Date | null;
  customerAlias?: string | null;
}

/**
 * 扫描一批机器的到期/回收站状态，产出本轮新增（未去重命中）告警。
 * 纯函数，reseller 与 customer 两条路径共用。
 */
function scanExpiryRecycle(
  servers: ScanServer[],
  sentKeys: Set<string>,
  now: Date,
): { newKeys: { key: string; kind: string }[]; expiringLines: string[]; recycleLines: string[] } {
  const newKeys: { key: string; kind: string }[] = [];
  const expiringLines: string[] = [];
  const recycleLines: string[] = [];
  for (const s of servers) {
    if (!s.expireTime) continue;
    const info = getExpiryInfo(s.expireTime, now);
    const epoch = expireEpoch(s.expireTime);
    if (info.state === "expiring" && info.daysLeft !== null) {
      let isNew = false;
      for (const t of EXPIRE_THRESHOLDS) {
        if (info.daysLeft <= t) {
          const key = `expire:${s.ecsResourceUuid}:${epoch}:${t}`;
          if (!sentKeys.has(key)) {
            newKeys.push({ key, kind: "expiry" });
            isNew = true;
          }
        }
      }
      if (isNew) {
        const when = info.daysLeft === 0 ? "今天到期" : `${info.daysLeft} 天后到期`;
        expiringLines.push(` • ${serverLabel(s)} ${when}`);
      }
    } else if (info.state === "recycled") {
      const key = `recycle:${s.ecsResourceUuid}:${epoch}`;
      if (!sentKeys.has(key)) {
        newKeys.push({ key, kind: "recycle" });
        const destroy = info.destroyAt ? `预计 ${fmtDate(info.destroyAt)} 销毁` : "即将销毁";
        recycleLines.push(` • ${serverLabel(s)} 已进回收站，${destroy}，数据将永久删除`);
      }
    }
  }
  return { newKeys, expiringLines, recycleLines };
}

export async function runNotifyForReseller(
  resellerId: string,
  now: Date = new Date(),
): Promise<NotifyRunResult> {
  const cfg = await prisma.resellerNotifyConfig.findUnique({ where: { resellerId } });

  // ===== 1) 真实同步 + Token/同步健康判定 =====
  // 同步与通知解耦：无论是否配置了通知渠道，每日同步都必须执行，
  // 否则未配通知的代理商缓存会悄悄过期（到期时间/状态失真）。
  // 同步结果三分类（任务每小时跑，必须区分暂时性抖动与真失效，否则假告警会很吵）：
  //   syncOk       —— 成功：标记 token active，清除历史 token 告警（允许下次失效再告）
  //   tokenBroken  —— 凭据/鉴权/业务类错误：标记 invalid + 触发告警（去重）
  //   暂时性错误    —— 网络/超时：不告警、不改 token 状态、不清除告警记录，仅记入 lastError
  let syncOk = true;
  let tokenBroken = false;
  let syncErrorMsg: string | null = null;
  try {
    const knownZones = await getKnownZones(resellerId);
    const { instances, complete } = await listInstancesDetailed(resellerId, { knownZones });
    await syncServerCache(resellerId, instances, complete, now);
    // 成功：与 token/route.ts PATCH 成功分支一致，标记 active + lastVerifiedAt
    await prisma.resellerApiToken
      .updateMany({ where: { resellerId }, data: { status: "active", lastVerifiedAt: now } })
      .catch(() => void 0);
  } catch (e) {
    syncOk = false;
    syncErrorMsg = e instanceof Error ? e.message : String(e);
    if (
      e instanceof CloudApiError &&
      [
        "TOKEN_NOT_CONFIGURED",
        "TOKEN_DECRYPT_FAILED",
        "UPSTREAM_HTTP_ERROR",
        "UPSTREAM_BIZ_ERROR",
      ].includes(e.code)
    ) {
      tokenBroken = true;
      await prisma.resellerApiToken
        .updateMany({ where: { resellerId }, data: { status: "invalid" } })
        .catch(() => void 0);
    }
  }

  // 未启用通知或没配渠道：同步已完成，告警部分跳过（不组装、不发送、不记 dedup）
  if (!cfg || !cfg.enabled || !hasAnyChannel(cfg)) {
    return {
      resellerId,
      skipped: !cfg || !cfg.enabled ? "通知未启用（已完成同步）" : "未配置渠道（已完成同步）",
      tokenHealthy: !tokenBroken,
      alertsSent: 0,
      channels: [],
    };
  }

  // ===== 2) 组装本轮新增告警 =====
  // 已发过的 dedupKey 集合（一次查全，避免逐条查库）
  const existing = await prisma.notificationLog.findMany({
    where: { resellerId },
    select: { dedupKey: true },
  });
  const sentKeys = new Set(existing.map((r) => r.dedupKey));

  const newKeys: { key: string; kind: string }[] = [];
  const expiringLines: string[] = [];
  const recycleLines: string[] = [];
  const tokenLines: string[] = [];

  // -- Token/同步告警（状态翻转去重）--
  // 仅凭据/鉴权类失败告警；网络/超时等暂时性错误既不告警也不清除告警记录（状态未知）。
  const tokenKey = `token:${resellerId}`;
  if (tokenBroken) {
    if (!sentKeys.has(tokenKey)) {
      tokenLines.push(
        `⚠ 接入凭据校验失败，服务器同步已停摆${syncErrorMsg ? `（${syncErrorMsg}）` : ""}。请尽快到「接入配置」重新填写并校验凭据，否则面板数据将持续过期。`,
      );
      newKeys.push({ key: tokenKey, kind: "token" });
    }
  } else if (syncOk) {
    // 恢复健康：清除旧的 token 告警记录，使下次失效可再次告警
    if (sentKeys.has(tokenKey)) {
      await prisma.notificationLog
        .deleteMany({ where: { resellerId, dedupKey: tokenKey } })
        .catch(() => void 0);
    }
  }

  // -- 到期 / 回收站告警（读同步后的 server_cache）--
  const servers = await prisma.serverCache.findMany({
    where: { resellerId, expireTime: { not: null } },
    select: {
      ecsResourceUuid: true,
      instanceName: true,
      publicIpAddress: true,
      expireTime: true,
      customerAlias: true,
    },
  });
  const scan = scanExpiryRecycle(servers, sentKeys, now);
  newKeys.push(...scan.newKeys);
  expiringLines.push(...scan.expiringLines);
  recycleLines.push(...scan.recycleLines);

  if (newKeys.length === 0) {
    // 无新增告警：更新 lastRunAt；暂时性同步错误记入 lastError 供「通知设置」页诊断
    await prisma.resellerNotifyConfig
      .update({
        where: { resellerId },
        data: { lastRunAt: now, lastError: syncOk ? null : `同步失败（暂时性）：${syncErrorMsg ?? ""}`.slice(0, 480) },
      })
      .catch(() => void 0);
    return { resellerId, tokenHealthy: !tokenBroken, alertsSent: 0, channels: [] };
  }

  // ===== 3) 组装消息并发送 =====
  const branding = await getBranding();
  const parts: string[] = [`【${branding.panelName} · 提醒】`];
  if (tokenLines.length) parts.push(tokenLines.join("\n"));
  if (expiringLines.length) parts.push(`即将到期（${expiringLines.length}）：\n${expiringLines.join("\n")}`);
  if (recycleLines.length)
    parts.push(`已进回收站 · 即将销毁（${recycleLines.length}）：\n${recycleLines.join("\n")}`);
  const message = parts.join("\n\n");

  const { ok, results } = await sendToConfig(cfg, message);
  const channels = results.filter((r) => r.ok).map((r) => r.channel);
  const errText = results
    .filter((r) => !r.ok)
    .map((r) => `${r.channel}:${r.error}`)
    .join("; ");

  if (ok) {
    // 送达成功：把本轮所有新增 dedupKey 落库（去重），避免重复轰炸
    await prisma.notificationLog.createMany({
      data: newKeys.map((k) => ({
        resellerId,
        dedupKey: k.key,
        kind: k.kind,
        channels: channels.join(","),
        success: true,
        detail: message.slice(0, 480),
      })),
    });
    await prisma.operationLog.create({
      data: {
        resellerId,
        userId: resellerId,
        userRole: "reseller_admin",
        ecsResourceUuid: "-",
        action: "notify_sent",
        requestPayload: JSON.stringify({ alerts: newKeys.length, channels, kinds: summarizeKinds(newKeys) }),
      },
    });
  }

  await prisma.resellerNotifyConfig
    .update({
      where: { resellerId },
      data: { lastRunAt: now, lastError: ok ? null : errText.slice(0, 480) || "全部渠道发送失败" },
    })
    .catch(() => void 0);

  return {
    resellerId,
    tokenHealthy: !tokenBroken,
    alertsSent: ok ? newKeys.length : 0,
    channels,
    error: ok ? undefined : errText || "发送失败",
  };
}

function summarizeKinds(keys: { kind: string }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const k of keys) m[k.kind] = (m[k.kind] ?? 0) + 1;
  return m;
}

/**
 * 客户维度的到期/回收站通知：只扫该客户当前被分配的机器，只发给客户自己配置的渠道。
 * 不做同步（客户无凭据）、不含 Token 告警。通知配置复用 reseller_notify_configs 表
 * （resellerId 列实际存 owner 用户 id，客户 id 同样合法）；去重也用该表 resellerId=customerId 命名空间。
 */
export async function runNotifyForCustomer(
  customerId: string,
  now: Date = new Date(),
): Promise<NotifyRunResult> {
  const cfg = await prisma.resellerNotifyConfig.findUnique({ where: { resellerId: customerId } });
  if (!cfg || !cfg.enabled || !hasAnyChannel(cfg)) {
    return { resellerId: customerId, skipped: "客户未配渠道", tokenHealthy: true, alertsSent: 0, channels: [] };
  }

  const customer = await prisma.user.findUnique({
    where: { id: customerId },
    select: { parentId: true },
  });
  const parentId = customer?.parentId;
  if (!parentId) {
    return { resellerId: customerId, skipped: "客户缺少上级", tokenHealthy: true, alertsSent: 0, channels: [] };
  }

  // 客户当前被分配的机器
  const assignments = await prisma.serverAssignment.findMany({
    where: { customerId, status: "active" },
    select: { ecsResourceUuid: true },
  });
  const uuids = assignments.map((a) => a.ecsResourceUuid);
  if (uuids.length === 0) {
    await prisma.resellerNotifyConfig
      .update({ where: { resellerId: customerId }, data: { lastRunAt: now } })
      .catch(() => void 0);
    return { resellerId: customerId, tokenHealthy: true, alertsSent: 0, channels: [] };
  }

  const servers = await prisma.serverCache.findMany({
    where: { resellerId: parentId, ecsResourceUuid: { in: uuids }, expireTime: { not: null } },
    select: {
      ecsResourceUuid: true,
      instanceName: true,
      publicIpAddress: true,
      expireTime: true,
      customerAlias: true,
    },
  });

  const existing = await prisma.notificationLog.findMany({
    where: { resellerId: customerId },
    select: { dedupKey: true },
  });
  const sentKeys = new Set(existing.map((r) => r.dedupKey));

  const { newKeys, expiringLines, recycleLines } = scanExpiryRecycle(servers, sentKeys, now);

  if (newKeys.length === 0) {
    await prisma.resellerNotifyConfig
      .update({ where: { resellerId: customerId }, data: { lastRunAt: now, lastError: null } })
      .catch(() => void 0);
    return { resellerId: customerId, tokenHealthy: true, alertsSent: 0, channels: [] };
  }

  const branding = await getBranding();
  const parts: string[] = [`【${branding.panelName} · 到期提醒】`];
  if (expiringLines.length) parts.push(`即将到期（${expiringLines.length}）：\n${expiringLines.join("\n")}`);
  if (recycleLines.length)
    parts.push(`已进回收站 · 即将销毁（${recycleLines.length}）：\n${recycleLines.join("\n")}`);
  parts.push("如需续费，请联系为你开通账号的服务商。");
  const message = parts.join("\n\n");

  const { ok, results } = await sendToConfig(cfg, message);
  const channels = results.filter((r) => r.ok).map((r) => r.channel);
  const errText = results.filter((r) => !r.ok).map((r) => `${r.channel}:${r.error}`).join("; ");

  if (ok) {
    await prisma.notificationLog.createMany({
      data: newKeys.map((k) => ({
        resellerId: customerId,
        dedupKey: k.key,
        kind: k.kind,
        channels: channels.join(","),
        success: true,
        detail: message.slice(0, 480),
      })),
    });
    await prisma.operationLog.create({
      data: {
        resellerId: parentId,
        userId: customerId,
        userRole: "customer",
        ecsResourceUuid: "-",
        action: "notify_sent",
        requestPayload: JSON.stringify({ alerts: newKeys.length, channels, kinds: summarizeKinds(newKeys) }),
      },
    });
  }

  await prisma.resellerNotifyConfig
    .update({
      where: { resellerId: customerId },
      data: { lastRunAt: now, lastError: ok ? null : errText.slice(0, 480) || "全部渠道发送失败" },
    })
    .catch(() => void 0);

  return {
    resellerId: customerId,
    tokenHealthy: true,
    alertsSent: ok ? newKeys.length : 0,
    channels,
    error: ok ? undefined : errText || "发送失败",
  };
}

/**
 * 遍历所有在用代理商，逐个跑一轮。cron 端点调用。
 * 注意不按通知配置过滤：每日同步对所有代理商执行（保持缓存新鲜），
 * 通知只对配好渠道的代理商发送（runNotifyForReseller 内部分流）。
 */
export async function runNotifyForAll(now: Date = new Date()): Promise<NotifyRunResult[]> {
  const admins = await prisma.user.findMany({
    where: { role: "reseller_admin", status: "active" },
    select: { id: true },
  });
  const out: NotifyRunResult[] = [];
  for (const a of admins) {
    try {
      out.push(await runNotifyForReseller(a.id, now));
    } catch (e) {
      out.push({
        resellerId: a.id,
        tokenHealthy: false,
        alertsSent: 0,
        channels: [],
        error: (e as Error).message,
      });
    }
  }

  // 再处理配好通知渠道的客户（只发到期/回收站，不做同步）
  const customers = await prisma.user.findMany({
    where: { role: "customer", status: "active", notifyConfig: { enabled: true } },
    select: { id: true },
  });
  for (const c of customers) {
    try {
      out.push(await runNotifyForCustomer(c.id, now));
    } catch (e) {
      out.push({
        resellerId: c.id,
        tokenHealthy: true,
        alertsSent: 0,
        channels: [],
        error: (e as Error).message,
      });
    }
  }
  return out;
}
