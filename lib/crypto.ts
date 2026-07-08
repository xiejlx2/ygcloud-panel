/**
 * Token 加解密：AES-256-GCM。
 * - 同一明文每次加密结果不同（IV 随机）。
 * - 密文自含 IV 与 auth tag，落库字符串格式：base64(iv) + "." + base64(ciphertext+tag)。
 */
import "server-only";
import crypto from "node:crypto";
import { env } from "@/lib/env";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM 推荐 12 字节
const TAG_LEN = 16;

function keyBuf(): Buffer {
  return Buffer.from(env.TOKEN_ENCRYPTION_KEY, "hex");
}

/**
 * 密钥指纹（hint）：SHA-256(密钥) 的前 8 位 hex。
 * 用于诊断“密钥变更导致解密失败”，可安全展示给前端 ——
 * 由单向哈希派生，不泄露密钥本身的任何字节。
 */
export function keyHint(): string {
  return crypto
    .createHash("sha256")
    .update(env.TOKEN_ENCRYPTION_KEY, "utf8")
    .digest("hex")
    .slice(0, 8);
}

/**
 * 判断库中存储的 hint 是否对应当前密钥。
 * 兼容旧格式：早期版本直接存密钥前 8 位明文，密钥未变时也应视为匹配；
 * 该行的 hint 会在下次保存凭据时自动升级为新格式。
 */
export function keyHintMatchesCurrent(stored: string | null | undefined): boolean {
  if (!stored) return true; // 无记录时不告警
  if (stored === keyHint()) return true;
  // 旧格式：密钥前 8 位 hex 明文
  return stored === env.TOKEN_ENCRYPTION_KEY.slice(0, 8);
}

export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, keyBuf(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // 把 tag 直接附在密文末尾
  const payload = Buffer.concat([enc, tag]);
  return `${iv.toString("base64")}.${payload.toString("base64")}`;
}

export function decryptToken(stored: string): string {
  const [ivB64, payloadB64] = stored.split(".");
  if (!ivB64 || !payloadB64) {
    throw new Error("TOKEN_DECRYPT_FORMAT_INVALID");
  }
  const iv = Buffer.from(ivB64, "base64");
  const payload = Buffer.from(payloadB64, "base64");
  if (payload.length < TAG_LEN) {
    throw new Error("TOKEN_DECRYPT_PAYLOAD_TOO_SHORT");
  }
  const enc = payload.subarray(0, payload.length - TAG_LEN);
  const tag = payload.subarray(payload.length - TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, keyBuf(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString("utf8");
}

/** 仅展示用：返回 token 后 4 位。 */
export function tokenSuffix(plain: string): string {
  if (!plain) return "";
  return plain.slice(-4);
}
