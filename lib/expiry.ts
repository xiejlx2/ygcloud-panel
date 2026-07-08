/**
 * 到期 / 回收站状态推导（前后端共用的纯函数，不依赖任何运行环境）。
 *
 * 上游平台的生命周期规则：
 *   到期 → 进入回收站保存 3 个整天 → 第 4 天 0 点销毁。
 * 上游接口没有回收站/销毁相关字段，全部状态由 expireTime 推导：
 *   例：7 月 8 日 15:00 到期 → 回收站保留 7-09 / 7-10 / 7-11 三个整天
 *       → 预计 7 月 12 日 00:00 销毁。
 * “0 点”按本服务运行时区计算，部署时区必须与上游平台一致（Asia/Shanghai）。
 */

export const EXPIRING_SOON_DAYS = 7;
export const RECYCLE_RETENTION_DAYS = 3;

export type ExpiryState = "active" | "expiring" | "recycled" | "destroyed";

export interface ExpiryInfo {
  state: ExpiryState;
  /** expiring 时的剩余整天数（0 表示今天到期），其余状态为 null */
  daysLeft: number | null;
  /** 预计销毁时间（到期日 0 点 + 4 天）；无 expireTime 时为 null */
  destroyAt: Date | null;
}

export function getExpiryInfo(
  expireTime: string | Date | null | undefined,
  now: Date = new Date(),
): ExpiryInfo {
  if (!expireTime) return { state: "active", daysLeft: null, destroyAt: null };
  const exp = expireTime instanceof Date ? expireTime : new Date(expireTime);
  if (Number.isNaN(exp.getTime())) {
    return { state: "active", daysLeft: null, destroyAt: null };
  }

  const destroyAt = new Date(exp);
  destroyAt.setHours(0, 0, 0, 0);
  destroyAt.setDate(destroyAt.getDate() + RECYCLE_RETENTION_DAYS + 1);

  if (now.getTime() >= destroyAt.getTime()) {
    return { state: "destroyed", daysLeft: null, destroyAt };
  }
  if (now.getTime() >= exp.getTime()) {
    return { state: "recycled", daysLeft: null, destroyAt };
  }

  const msLeft = exp.getTime() - now.getTime();
  if (msLeft <= EXPIRING_SOON_DAYS * 86_400_000) {
    return {
      state: "expiring",
      daysLeft: Math.floor(msLeft / 86_400_000),
      destroyAt,
    };
  }
  return { state: "active", daysLeft: null, destroyAt };
}
