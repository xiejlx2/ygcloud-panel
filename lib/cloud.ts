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
  "/instance/reinstallSystem": "POST",
  "/image/list": "GET",
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

export interface InstanceListResult {
  instances: InstanceListItem[];
  /**
   * 本轮是否完整覆盖了所有 (region, zone)。
   * false 表示至少有一个可用区拉取失败——此时“某台机器不在返回结果里”
   * 不能作为它已被销毁的依据（调用方据此决定是否执行清理类操作）。
   */
  complete: boolean;
}

// /instance/list 上游分页：pageSize 取值范围 1~50、默认仅 10。
// 不传就只能拿到每个可用区的前 10 台，机器多的可用区会被静默截断（曾导致漏同步）。
// 用上限 50 逐页翻，直到取满上游报告的 rowCount 或某页返回不足一页。
const ZONE_PAGE_SIZE = 50;
const ZONE_MAX_PAGES = 40; // 安全上限：单可用区最多 2000 台，防异常时无限翻页

/**
 * 解析 EXTRA_SYNC_ZONES：手动补充的额外同步地域（已从上游 region/list 下架、
 * 但仍有存量机器的地域，如售罄后的 sau-jeddah-1）。
 *
 * 格式：逗号分隔多个地域，每个为 "regionCode:zoneCode"；zoneCode 省略时默认
 * 取 regionCode + "-a"。例：
 *   EXTRA_SYNC_ZONES="sau-jeddah-1:sau-jeddah-1-a,om-muscat-1"
 */
function parseExtraZones(): { region: string; zone: string }[] {
  const raw = process.env.EXTRA_SYNC_ZONES || "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [region, zone] = pair.split(":").map((x) => x.trim());
      return { region, zone: zone || (region ? `${region}-a` : "") };
    })
    .filter((t) => t.region && t.zone);
}

/**
 * 拉取单个 (region, zone) 下的全部实例（翻页取全）。
 * 任一页失败直接抛出，由调用方标记本轮不完整。
 */
async function fetchZoneInstances(
  resellerId: string,
  region: string,
  zone: string,
): Promise<InstanceListItem[]> {
  const all: InstanceListItem[] = [];
  for (let page = 1; page <= ZONE_MAX_PAGES; page++) {
    const d = await cloudRequest<{ instances?: InstanceListItem[]; rowCount?: number }>(
      resellerId,
      "/instance/list",
      {
        method: "GET",
        query: {
          regionCode: region,
          zoneCode: zone,
          page,
          pageSize: ZONE_PAGE_SIZE,
        },
        timeoutMs: 20000,
      },
    );
    const arr = d.instances ?? [];
    all.push(...arr);
    // 本页不足一页 → 已是最后一页
    if (arr.length < ZONE_PAGE_SIZE) break;
    // 已取满上游报告的总数 → 提前结束
    if (typeof d.rowCount === "number" && all.length >= d.rowCount) break;
  }
  return all;
}

/**
 * 拉取代理商名下所有服务器（含完整性标记）。
 * 上游 /instance/list 要求必传 regionCode + zoneCode，所以必须先拉 region 列表，
 * 再按 (region, zone) 维度逐个翻页拉取，合并去重。
 *
 * 单 zone 失败不阻断整体同步（某区域临时故障不应影响其他区域），
 * 但会把 complete 置为 false。
 */
export async function listInstancesDetailed(
  resellerId: string,
  opts?: {
    // 额外并入的“已知地域”（来自 reseller_known_zones 表）。用于覆盖已从
    // region/list 下架、但仍有存量机器的地域（如售罄的 sau-jeddah-1）。
    knownZones?: { region: string; zone: string }[];
  },
): Promise<InstanceListResult> {
  const regions = await listRegions(resellerId);
  // 注意：不能因 region/list 为空就直接返回。已售罄下架的地域会从 region/list
  // 消失，但其存量机器仍在运行、instance/list 仍可查到。这类地域靠“已知地域表”
  // 和 EXTRA_SYNC_ZONES 兜底，因此即便 region/list 为空也要继续处理额外地域。

  // 展开成 (region, zone) 任务列表，并去重合并三个来源：
  //   ① region/list 当前在售地域
  //   ② 调用方传入的已知地域（reseller_known_zones）
  //   ③ EXTRA_SYNC_ZONES 环境变量兜底
  const tasks: { region: string; zone: string }[] = [];
  const known = new Set<string>();
  const addZone = (region: string, zone: string) => {
    if (!region || !zone) return;
    const key = `${region}|${zone}`;
    if (known.has(key)) return;
    known.add(key);
    tasks.push({ region, zone });
  };
  for (const r of regions) {
    for (const z of r.zones) addZone(r.regionCode, z.zoneCode);
  }
  for (const kz of opts?.knownZones ?? []) addZone(kz.region, kz.zone);
  for (const ez of parseExtraZones()) addZone(ez.region, ez.zone);

  if (tasks.length === 0) return { instances: [], complete: true };

  // 并发拉取：地域多（几十个）时并发过低会明显拖慢，过高会触发上游限流。
  // 折中取 12——多数地域无机器、单次往返即返回，实测足够快且稳。
  const CONCURRENCY = 12;
  let complete = true;
  const results: InstanceListItem[][] = [];
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const batch = tasks.slice(i, i + CONCURRENCY);
    const out = await Promise.all(
      batch.map((t) =>
        fetchZoneInstances(resellerId, t.region, t.zone).catch(() => {
          complete = false;
          return [] as InstanceListItem[];
        }),
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
  return { instances: merged, complete };
}

/** 兼容旧调用方：仅返回实例列表。 */
export async function listInstances(resellerId: string): Promise<InstanceListItem[]> {
  const r = await listInstancesDetailed(resellerId);
  return r.instances;
}

export interface ZoneWithMachines {
  regionCode: string;
  regionName?: string;
  zoneCode: string;
  zoneName?: string;
  machineCount: number;
}

/**
 * 从实例列表按 (regionCode, zoneCode) 聚合出“有机器的地域”及其机器数。
 * 供「更新地域库」把有机器的地域写入 reseller_known_zones。
 */
export function zonesFromInstances(instances: InstanceListItem[]): ZoneWithMachines[] {
  const map = new Map<string, ZoneWithMachines>();
  for (const it of instances) {
    const regionCode = it.regionCode;
    const zoneCode = it.zoneCode;
    if (!regionCode || !zoneCode) continue;
    const key = `${regionCode}|${zoneCode}`;
    const cur = map.get(key);
    if (cur) {
      cur.machineCount++;
    } else {
      map.set(key, {
        regionCode,
        regionName: it.regionName,
        zoneCode,
        zoneName: it.zoneName,
        machineCount: 1,
      });
    }
  }
  return Array.from(map.values());
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
  opts?: { regionCode?: string; zoneCode?: string; force?: boolean },
): Promise<{ asyncTaskUUID?: string; status?: string }> {
  const body = buildInstanceActionBody(ecsResourceUUID, undefined, opts);
  // 强制关机：上游 /instance/stop 的可选参数 forceStop。
  // 仅在显式要求时才携带，普通关机不发送该字段。
  if (opts?.force === true) body.forceStop = true;
  return cloudRequest(resellerId, "/instance/stop", {
    method: "POST",
    body,
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

// ===== 镜像查询 + 重装系统 =====

export interface ImageItem {
  imageResourceUUID: string;
  imageName?: string;
  osVersion?: string;
  osVersionDetail?: string;
  osDistroVersion?: string;
  imageAccount?: string;
  imageType?: string;
  regionCode?: string;
  [k: string]: unknown;
}

// 需要从镜像列表中屏蔽的关键词（逗号分隔，命中即隐藏），由部署方在 .env 的
// IMAGE_HIDE_KEYWORDS 配置。放到环境变量而非硬编码，使代码库本身不含任何服务商标识。
const HIDE_KEYWORDS = (process.env.IMAGE_HIDE_KEYWORDS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function isBrandImage(i: ImageItem): boolean {
  if (HIDE_KEYWORDS.length === 0) return false;
  const hay = [i.imageName, i.osVersion, i.osVersionDetail, i.osDistroVersion]
    .filter((v): v is string => typeof v === "string")
    .join(" ")
    .toLowerCase();
  return HIDE_KEYWORDS.some((k) => hay.includes(k));
}

/**
 * 查询可用镜像（用于重装系统时选择目标系统）。
 * imageType：System（标准镜像）/ Application（应用镜像）/ Self（私有镜像）。
 * 强制过滤掉带品牌字样的镜像（屏蔽上游标识）。
 */
export async function listImages(
  resellerId: string,
  opts?: { regionCode?: string; imageType?: string; page?: number; pageSize?: number },
): Promise<ImageItem[]> {
  const data = await cloudRequest<{ images?: ImageItem[] }>(
    resellerId,
    "/image/list",
    {
      method: "GET",
      query: {
        regionCode: opts?.regionCode,
        imageType: opts?.imageType,
        page: opts?.page ?? 1,
        pageSize: opts?.pageSize ?? 50,
      },
    },
  );
  return (data?.images ?? []).filter(
    (i) => i && i.imageResourceUUID && !isBrandImage(i),
  );
}

/**
 * 分页拉取某类镜像的全部条目（上限 5 页 / 250 条，避免异常时无限翻页）。
 * 翻页依据“上游本页原始返回量”，品牌过滤在此之上叠加，不影响翻页判断。
 */
export async function listAllImages(
  resellerId: string,
  opts: { regionCode?: string; imageType: string },
): Promise<ImageItem[]> {
  const all: ImageItem[] = [];
  const PAGE_SIZE = 50;
  for (let page = 1; page <= 5; page++) {
    const data = await cloudRequest<{ images?: ImageItem[] }>(
      resellerId,
      "/image/list",
      {
        method: "GET",
        query: {
          regionCode: opts.regionCode,
          imageType: opts.imageType,
          page,
          pageSize: PAGE_SIZE,
        },
      },
    );
    const raw = (data?.images ?? []).filter((i) => i && i.imageResourceUUID);
    all.push(...raw.filter((i) => !isBrandImage(i)));
    if (raw.length < PAGE_SIZE) break; // 原始返回不足一页 → 已是最后一页
  }
  return all;
}

/**
 * 重装系统（异步、破坏性）。
 * 上游要求：目标服务器需先关机；重装会清空该服务器数据。
 * regionCode 必填，zoneCode 可选。
 */
export async function reinstallSystem(
  resellerId: string,
  ecsResourceUUID: string,
  params: {
    imageResourceUUID: string;
    password: string;
    regionCode: string;
    zoneCode?: string;
  },
): Promise<{ asyncTaskUUID?: string; status?: string }> {
  return cloudRequest(resellerId, "/instance/reinstallSystem", {
    method: "POST",
    body: {
      ecsResourceUUID,
      imageResourceUUID: params.imageResourceUUID,
      password: params.password,
      regionCode: params.regionCode,
      ...(params.zoneCode ? { zoneCode: params.zoneCode } : {}),
    },
  });
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
