/**
 * 代理商API 接入凭据 管理。
 *
 * GET  /api/admin/token  → 读取当前 Token 状态（不返回明文，仅返回后 4 位/状态/最近校验时间）
 * POST /api/admin/token  → 新增或更新 Token（请求体 { token }）
 * DELETE /api/admin/token → 撤销 Token
 *
 * 仅 reseller_admin 可调用。
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import {
  encryptToken,
  keyHint,
  tokenSuffix,
} from "@/lib/crypto";
import { listInstances } from "@/lib/cloud";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const row = await prisma.resellerApiToken.findUnique({
      where: { resellerId: user.id },
    });
    if (!row) {
      return ok({ configured: false });
    }
    return ok({
      configured: true,
      status: row.status,
      tokenSuffix: row.tokenSuffix,
      lastVerifiedAt: row.lastVerifiedAt,
      // 用于提示密钥变更导致无法解密
      keyHint: row.tokenKeyHint,
      currentKeyHint: keyHint(),
    });
  } catch (e) {
    return handleError(e);
  }
}

const PostBody = z.object({ token: z.string().min(8).max(512) });

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const json = await req.json().catch(() => null);
    const parsed = PostBody.safeParse(json);
    if (!parsed.success) return err("INVALID_INPUT", "Token 格式错误", 400);

    const plain = parsed.data.token;
    const enc = encryptToken(plain);
    const suffix = tokenSuffix(plain);

    // 写库（upsert）
    await prisma.resellerApiToken.upsert({
      where: { resellerId: user.id },
      create: {
        resellerId: user.id,
        tokenEncrypted: enc,
        tokenSuffix: suffix,
        tokenKeyHint: keyHint(),
        status: "active",
      },
      update: {
        tokenEncrypted: enc,
        tokenSuffix: suffix,
        tokenKeyHint: keyHint(),
        status: "active",
      },
    });

    // 写日志（不计 ecs 资源）
    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "token_update",
      requestPayload: { suffix },
    });

    return ok({ saved: true, tokenSuffix: suffix });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    await prisma.resellerApiToken.deleteMany({
      where: { resellerId: user.id },
    });
    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "token_revoke",
    });
    return ok({ revoked: true });
  } catch (e) {
    return handleError(e);
  }
}

// 顺便提供一个轻量校验接口：调用一次 /instance/list 看是否能拉到
export async function PATCH() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const list = await listInstances(user.id).catch((e) => {
      throw e;
    });
    const row = await prisma.resellerApiToken.update({
      where: { resellerId: user.id },
      data: { lastVerifiedAt: new Date(), status: "active" },
    });
    return ok({
      verified: true,
      instanceCount: Array.isArray(list) ? list.length : 0,
      lastVerifiedAt: row.lastVerifiedAt,
    });
  } catch (e) {
    // 校验失败时把 token 状态标记为 invalid（保留密文便于诊断）
    const user = await getSession();
    if (user) {
      await prisma.resellerApiToken
        .update({
          where: { resellerId: user.id },
          data: { status: "invalid" },
        })
        .catch(() => void 0);
    }
    return handleError(e);
  }
}
