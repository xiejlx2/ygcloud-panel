/**
 * 密码相关：
 * 1. 服务端登录密码哈希（bcrypt）。
 * 2. 上游服务器系统密码强度校验（与上游一致的限制，避免来回请求）。
 */
import "server-only";
import bcrypt from "bcryptjs";

export async function hashLoginPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyLoginPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * 面板登录密码校验（自助改密码用）：
 * 长度 8-64、须含大小写字母与数字（特殊字符可选，比服务器系统密码宽松），禁止常见弱口令。
 */
export function validateLoginPassword(pwd: string): PasswordPolicyResult {
  const reasons: string[] = [];
  if (typeof pwd !== "string" || pwd.length < 8 || pwd.length > 64) {
    reasons.push("长度必须为 8-64 位");
  }
  if (!/[A-Z]/.test(pwd)) reasons.push("必须包含大写字母");
  if (!/[a-z]/.test(pwd)) reasons.push("必须包含小写字母");
  if (!/[0-9]/.test(pwd)) reasons.push("必须包含数字");
  if (WEAK_PASSWORDS.has(pwd)) reasons.push("禁止使用常见弱密码");
  return { ok: reasons.length === 0, reasons };
}

/** 服务器系统密码校验：长度 8-16、大写、小写、数字、特殊字符、禁止连续字符与弱口令。 */
export interface PasswordPolicyResult {
  ok: boolean;
  reasons: string[];
}

const WEAK_PASSWORDS = new Set([
  "Password123!",
  "Admin@12345",
  "Aa123456!",
  "Qwerty123!",
  "123456Aa!",
]);

const SPECIAL_CHARS = /[`~!@#$%^&*()\-_=+\[\]{}|;:'",.<>/?\\]/;

export function validateInstancePassword(pwd: string): PasswordPolicyResult {
  const reasons: string[] = [];
  if (typeof pwd !== "string" || pwd.length < 8 || pwd.length > 16) {
    reasons.push("长度必须为 8-16 位");
  }
  if (!/[A-Z]/.test(pwd)) reasons.push("必须包含大写字母");
  if (!/[a-z]/.test(pwd)) reasons.push("必须包含小写字母");
  if (!/[0-9]/.test(pwd)) reasons.push("必须包含数字");
  if (!SPECIAL_CHARS.test(pwd)) reasons.push("必须包含特殊字符");
  // 禁止连续 3 个相同或连续递增/递减字符
  if (/(.)\1\1/.test(pwd)) reasons.push("禁止连续 3 个相同字符");
  if (hasSequential(pwd, 3)) reasons.push("禁止连续递增/递减字符（如 abc、321）");
  if (WEAK_PASSWORDS.has(pwd)) reasons.push("禁止使用常见弱密码");

  return { ok: reasons.length === 0, reasons };
}

function hasSequential(s: string, len: number): boolean {
  if (s.length < len) return false;
  for (let i = 0; i <= s.length - len; i++) {
    let asc = true;
    let desc = true;
    for (let j = 1; j < len; j++) {
      const a = s.charCodeAt(i + j - 1);
      const b = s.charCodeAt(i + j);
      if (b - a !== 1) asc = false;
      if (a - b !== 1) desc = false;
    }
    if (asc || desc) return true;
  }
  return false;
}
