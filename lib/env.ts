/**
 * 服务端环境变量读取 + 启动期校验。
 * 客户端严禁导入此文件。
 */
import "server-only";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) {
    throw new Error(`缺少必要环境变量：${name}`);
  }
  return v;
}

export const env = {
  // 上游云平台 OpenAPI 基础地址。不设默认值：必须由部署方在 .env 中提供，
  // 使代码库本身不含任何具体服务商标识。
  PROVIDER_API_BASE: required("PROVIDER_API_BASE").replace(/\/$/, ""),
  TOKEN_ENCRYPTION_KEY: required("TOKEN_ENCRYPTION_KEY"),
  JWT_SECRET: required("JWT_SECRET"),
  JWT_EXPIRES_HOURS: Number(process.env.JWT_EXPIRES_HOURS || "12"),
  // 定时通知任务的调用密钥。由系统 crontab 通过 x-cron-secret 头传入，
  // 校验通过才允许触发 /api/cron/notify。未设置则该端点直接拒绝（503）。
  CRON_SECRET: process.env.CRON_SECRET || "",
};

/**
 * 启动时（首次 import）做一次弱校验，给出明确错误。
 * Token 密钥必须是 64 位 hex（32 字节）。
 */
function validateKey(): void {
  const k = env.TOKEN_ENCRYPTION_KEY;
  if (!/^[0-9a-fA-F]{64}$/.test(k)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY 必须是 64 位 hex（32 字节随机串，openssl rand -hex 32）。",
    );
  }
  if (env.JWT_SECRET.length < 16) {
    throw new Error("JWT_SECRET 至少 16 个字符。");
  }
}

// 仅在服务端运行时执行一次
validateKey();
