/**
 * 上游云平台 OpenAPI 封装（后端专用）。
 *
 * 安全要求：
 *  1) 仅允许调用白名单内的路径（基础查询 / 基础运维）。
 *  2) 接入凭据（x-open-token）只在这里被读取并注入，绝不返回到上层。
 *  3) 调用失败时抛出标准 Error，由调用方记录日志、回写结果。
 */
import "server-only";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { decryptToken } from "@/lib/crypto";

/** 上游接口白名单。任何未在此列表的路径都禁止调用。 */
const ALLOWED_PATHS: Record<string, "GET" | "POST"> = {
  "/region/list": "GET",
  "/instance/list": "GET",
  "/instance/detail": "GET",
  "/instance/start": "POST",
  "/instance/stop": "POST",
  "/instance/restart": "POST",
  "/instance/modifyInstancePassword": "POST",
  "/asynctask/getResult": "GET",
};

export class CloudApiError extends Error {
  code: string;
  httpStatus: number;
  bizCode?: string;
  constructor(message: string, opts: { code: string; httpStatus: number; bizCode?: string }) {
    super(message);
    this.code = opts.code;
    this.httpStatus = opts.httpStatus;
    this.bizCode = opts.bizCode;
  }
}

export function isAllowedApiPath(path: string, method: "GET" | "POST"): boolean {
  const allowed = ALLOWED_PATHS[path];
  return allowed === method;
}

/**
 * 取出代理商当前生效接入凭据（明文）。仅供本模块内部使用。
 * 若凭据不存在或解密失败，抛出明确错误。
 */
async function getResellerPlainToken(resellerId: string): Promise<string> {
  const row = await prisma.resellerApiToken.findUnique({
    where: { resellerId },
  });
  if (!row || row.status !== "active") {
    throw new CloudApiError("尚未配置 API 接入凭据或凭据已停用", {
      code: "TOKEN_NOT_CONFIGURED",
      httpStatus: 400,
    });
  }
  try {
    return decryptToken(row.tokenEncrypted);
  } catch {
    throw new CloudApiError("接入凭据解密失败（密钥可能已变更）", {
      code: "TOKEN_DECRYPT_FAILED",
      httpStatus: 500,
    });
  }
}

export interface CloudResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

/**
 * 调用上游云平台 OpenAPI。仅接受白名单路径。
 */
export async function cloudRequest<T = unknown>(
  resellerId: string,
  path: string,
  opts: {
    method?: "GET" | "POST";
    query?: Record<string, string | number | boolean | undefined>;
    body?: Record<string, unknown>;
    // 调用方可覆盖超时
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const method = opts.method ?? "GET";
  if (!isAllowedApiPath(path, method)) {
    throw new CloudApiError(`禁止调用上游接口：${method} ${path}`, {
      code: "UPSTREAM_API_NOT_ALLOWED",
      httpStatus: 400,
    });
  }
  const token = await getResellerPlainToken(resellerId);

  const url = new URL(env.PROVIDER_API_BASE + path);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined) continue;
      url.searchParams.set(k, String(v));
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 15000);

  let resp: Response;
  try {
    resp = await fetch(url.toString(), {
      method,
      headers: {
        "x-open-token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
      cache: "no-store",
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") {
      throw new CloudApiError("上游接口调用超时", {
        code: "UPSTREAM_TIMEOUT",
        httpStatus: 504,
      });
    }
    throw new CloudApiError(`上游接口网络错误：${(e as Error).message}`, {
      code: "UPSTREAM_NETWORK_ERROR",
      httpStatus: 502,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await resp.text();
  let json: unknown = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = { _rawText: text };
    }
  }

  if (!resp.ok) {
    const bizCode = (json as { code?: string } | null)?.code;
    throw new CloudApiError(
      `上游接口返回 HTTP ${resp.status}`,
      { code: "UPSTREAM_HTTP_ERROR", httpStatus: resp.status, bizCode },
    );
  }

  // 上游业务层错误识别：
  // - 失败响应包含 code/message（code 可能是数字 0/200 或字符串错误名，如 "InvalidRegionCode.NotNull"）
  // - 成功响应不一定有 code 字段（如 /region/list 直接返回 { regions: [...] }）
  // - success:false 也视为失败
  const obj = json as {
    code?: number | string;
    message?: string;
    msg?: string;
    success?: boolean;
    data?: T;
  } | null;

  if (obj && typeof obj === "object" && obj.success === false) {
    throw new CloudApiError(obj.message || obj.msg || "上游业务错误", {
      code: "UPSTREAM_BIZ_ERROR",
      httpStatus: 200,
      bizCode: obj.code !== undefined ? String(obj.code) : "UNKNOWN",
    });
  }

  if (obj && typeof obj === "object" && "code" in obj && obj.code !== undefined && obj.code !== null) {
    const code = obj.code;
    const isOk =
      (typeof code === "number" && (code === 0 || code === 200)) ||
      (typeof code === "string" && (code === "0" || code === "200"));
    if (!isOk) {
      throw new CloudApiError(obj.message || obj.msg || `上游业务错误：${code}`, {
        code: "UPSTREAM_BIZ_ERROR",
        httpStatus: 200,
        bizCode: String(code),
      });
    }
  }

  return (obj?.data ?? (json as T)) as T;
}

// ===== 高层封装：区域 / 实例 / 详情 / 开关机 / 重启 / 改密码 / 异步任务 =====

export interface ZoneItem {
  zoneCode: string;
  zoneName?: string;
}

export interface RegionItem {
  regionCode: string;
  regionName?: string;
  zones: ZoneItem[];
}

export interface InstanceListItem {
  ecsResourceUUID: string;
  instanceName?: string;
  publicIpAddress?: string;
  internalIpAddress?: string;
  regionCode?: string;
  regionName?: string;
  zoneCode?: string;
  zoneName?: string;
  cpu?: number;
  memory?: number;
  bandwidth?: number;
  osName?: string;
  osVersionDetail?: string;
  ecsStatus?: string;
  ecsPendingStatus?: string;
  expireTime?: string;
  [k: string]: unknown;
}

/** 拉取所有区域 + 可用区。/region/list 返回 { regions: [...] }。 */
export async function listRegions(resellerId: string): Promise<RegionItem[]> {
  const data = await cloudRequest<{ regions?: RegionItem[] }>(
    resellerId,
    "/region/list",
    { method: "GET" },
  );
  const arr = data?.regions ?? [];
  return arr.filter((r) => r && r.regionCode && Array.isArray(r.zones));
}

/**
 * 拉取代理商名下所有服务器。
 * 上游 /instance/list 要求必传 regionCode + zoneCode，所以必须先拉 region 列表，
 * 再按 (region, zone) 维度逐个拉取，合并去重。
 *
 * 单 zone 失败不阻断整体同步（某区域临时故障不应影响其他区域）。
 */
export async function listInstances(resellerId: string): Promise<InstanceListItem[]> {
  const regions = await listRegions(resellerId);
  if (regions.length === 0) return [];

  // 展开成 (region, zone) 任务列表
  const tasks: { region: string; zone: string }[] = [];
  for (const r of regions) {
    for (const z of r.zones) {
      tasks.push({ region: r.regionCode, zone: z.zoneCode });
    }
  }

  // 限制并发到 5，避免触发上游速率限制
  const CONCURRENCY = 5;
  const results: InstanceListItem[][] = [];
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const out = await Promise.all(
      batch.map((t) =>
        cloudRequest<{ instances?: InstanceListItem[] }>(
          resellerId,
          "/instance/list",
          {
            method: "GET",
            query: { regionCode: t.region, zoneCode: t.zone },
            timeoutMs: 20000,
          },
        )
          .then((d) => d.instances ?? [])
          .catch(() => [] as InstanceListItem[]),
      ),
    );
    for (const arr of out) results.push(arr);
  }

  // 按 ecsResourceUUID 去重（保险）
  const seen = new Set<string>();
  const merged: InstanceListItem[] = [];
  for (const it of results.flat()) {
    if (!it || !it.ecsResourceUUID) continue;
    if (seen.has(it.ecsResourceUUID)) continue;
    seen.add(it.ecsResourceUUID);
    merged.push(it);
  }
  return merged;
}

export async function getInstanceDetail(
  resellerId: string,
  ecsResourceUUID: string,
  opts?: { regionCode?: string; zoneCode?: string },
): Promise<InstanceListItem | null> {
  const data = await cloudRequest<InstanceListItem | { instance?: InstanceListItem } | null>(
    resellerId,
    "/instance/detail",
    {
      method: "GET",
      query: {
        ecsResourceUUID,
        ...(opts?.regionCode ? { regionCode: opts.regionCode } : {}),
        ...(opts?.zoneCode ? { zoneCode: opts.zoneCode } : {}),
      },
    },
  );
  if (!data) return null;
  if ((data as { instance?: InstanceListItem }).instance) {
    return (data as { instance?: InstanceListItem }).instance ?? null;
  }
  return data as InstanceListItem;
}

export async function startInstance(
  resellerId: string,
  ecsResourceUUID: string,
  opts?: { regionCode?: string; zoneCode?: string },
): Promise<{ asyncTaskUUID?: string; status?: string }> {
  return cloudRequest(resellerId, "/instance/start", {
    method: "POST",
    body: buildInstanceActionBody(ecsResourceUUID, undefined, opts),
  });
}

export async function stopInstance(
  resellerId: string,
  ecsResourceUUID: string,
  opts?: { regionCode?: string; zoneCode?: string },
): Promise<{ asyncTaskUUID?: string; status?: string }> {
  return cloudRequest(resellerId, "/instance/stop", {
    method: "POST",
    body: buildInstanceActionBody(ecsResourceUUID, undefined, opts),
  });
}

export async function restartInstance(
  resellerId: string,
  ecsResourceUUID: string,
  opts?: { regionCode?: string; zoneCode?: string },
): Promise<{ asyncTaskUUID?: string; status?: string }> {
  return cloudRequest(resellerId, "/instance/restart", {
    method: "POST",
    body: buildInstanceActionBody(ecsResourceUUID, undefined, opts),
  });
}

export async function modifyInstancePassword(
  resellerId: string,
  ecsResourceUUID: string,
  password: string,
  opts?: { regionCode?: string; zoneCode?: string },
): Promise<{ asyncTaskUUID?: string; status?: string }> {
  return cloudRequest(resellerId, "/instance/modifyInstancePassword", {
    method: "POST",
    body: buildInstanceActionBody(ecsResourceUUID, password, opts),
  });
}

function buildInstanceActionBody(
  ecsResourceUUID: string,
  password: string | undefined,
  opts?: { regionCode?: string; zoneCode?: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = { ecsResourceUUID };
  if (password) body.password = password;
  if (opts?.regionCode) body.regionCode = opts.regionCode;
  if (opts?.zoneCode) body.zoneCode = opts.zoneCode;
  return body;
}

export interface AsyncTaskResult {
  taskStatus?: string; // FINISHED / RUNNING / FAILED ...
  processResult?: string; // SUCCESS / FAILED ...
  errMsg?: string | null;
}

export async function getAsyncTaskResult(
  resellerId: string,
  asyncTaskUUID: string,
): Promise<AsyncTaskResult> {
  return cloudRequest<AsyncTaskResult>(resellerId, "/asynctask/getResult", {
    method: "GET",
    query: { asyncTaskUUID },
  });
}
