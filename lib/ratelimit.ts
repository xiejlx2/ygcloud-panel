/**
 * 简单的内存令牌桶限流（按 key 维度）。
 * 进程重启后状态丢失——MVP 阶段足够；后续如需多实例可换 Redis。
 */
import "server-only";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

// 定期清理长时间未活动的桶，防止 key 无限增长导致内存缓慢泄漏。
// 超过该时长未再命中、且理应已回满的桶视为可回收。
const IDLE_TTL_MS = 60 * 60 * 1000; // 1 小时
let lastSweep = 0;

function sweep(now: number): void {
  if (now - lastSweep < IDLE_TTL_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (now - b.lastRefill > IDLE_TTL_MS) buckets.delete(key);
  }
}

export interface RateLimitConfig {
  // 桶容量，同时也是单位窗口内最大次数
  capacity: number;
  // 单位窗口（毫秒）
  windowMs: number;
}

/**
 * 返回 true 表示放行（已扣 1），false 表示限流。
 */
export function rateLimit(key: string, cfg: RateLimitConfig): boolean {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b) {
    buckets.set(key, { tokens: cfg.capacity - 1, lastRefill: now });
    return true;
  }
  // 按时间比例补齐
  const elapsed = now - b.lastRefill;
  const refill = (elapsed / cfg.windowMs) * cfg.capacity;
  b.tokens = Math.min(cfg.capacity, b.tokens + refill);
  b.lastRefill = now;
  if (b.tokens < 1) {
    return false;
  }
  b.tokens -= 1;
  return true;
}

// 预设的常用规则（对应方案 10.4）
export const RL = {
  login: { capacity: 5, windowMs: 10 * 60 * 1000 }, // 5 次 / 10 分钟
  powerOp: { capacity: 1, windowMs: 30 * 1000 }, // 开/关/重启 1 次 / 30 秒
  modifyPwd: { capacity: 3, windowMs: 10 * 60 * 1000 }, // 改密码 3 次 / 10 分钟
  reinstall: { capacity: 1, windowMs: 5 * 60 * 1000 }, // 重装系统 1 次 / 5 分钟（破坏性，严格限流）
  syncServer: { capacity: 1, windowMs: 60 * 1000 }, // 同步 1 次 / 60 秒
  // 客户列表页触发的后台刷新：按代理商维度全局兜底，防止客户狂刷
  // 把 listInstances 的多区域扇出调用放大、打挂代理商 Token。
  clientRefresh: { capacity: 1, windowMs: 60 * 1000 }, // 每代理商 1 次 / 60 秒
} as const;
