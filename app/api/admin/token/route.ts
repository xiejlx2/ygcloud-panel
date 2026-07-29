/**
 * 代理商多云账户凭据管理。
 *
 * GET    /api/admin/token        列出全部云账户（绝不返回明文 Key）
 * POST   /api/admin/token        新增账户 { accountName, token }
 * PUT    /api/admin/token        更新账户 { id, accountName, token? }
 * PATCH  /api/admin/token        校验账户 { id }
 * DELETE /api/admin/token?id=... 移除账户及其缓存资源
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import {
  encryptToken,
  keyHint,
  keyHintMatchesCurrent,
  tokenSuffix,
} from "@/lib/crypto";
import { listInstancesDetailed } from "@/lib/cloud";
import { getKnownZones } from "@/lib/sync";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

const AccountName = z.string().trim().min(1).max(50);
const Token = z.string().trim().min(8).max(512);

export async function GET() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const rows = await prisma.resellerApiToken.findMany({
      where: { resellerId: user.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { serverCache: true } } },
    });
    return ok({
      items: rows.map((row) => ({
        id: row.id,
        accountName: row.accountName,
        status: row.status,
        tokenSuffix: row.tokenSuffix,
        lastVerifiedAt: row.lastVerifiedAt,
        keyMatches: keyHintMatchesCurrent(row.tokenKeyHint),
        serverCount: row._count.serverCache,
        createdAt: row.createdAt,
      })),
      currentKeyHint: keyHint(),
    });
  } catch (e) {
    return handleError(e);
  }
}

const CreateBody = z.object({
  accountName: AccountName,
  token: Token,
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);
    const parsed = CreateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return err("INVALID_INPUT", "账户名称或 OpenAPI Key 格式错误", 400);

    const exists = await prisma.resellerApiToken.findFirst({
      where: { resellerId: user.id, accountName: parsed.data.accountName },
      select: { id: true },
    });
    if (exists) return err("ACCOUNT_NAME_TAKEN", "云账户名称已存在", 409);

    const row = await prisma.resellerApiToken.create({
      data: {
        resellerId: user.id,
        accountName: parsed.data.accountName,
        tokenEncrypted: encryptToken(parsed.data.token),
        tokenSuffix: tokenSuffix(parsed.data.token),
        tokenKeyHint: keyHint(),
        status: "active",
      },
    });
    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "cloud_account_create",
      requestPayload: {
        accountId: row.id,
        accountName: row.accountName,
        suffix: row.tokenSuffix,
      },
    });
    return ok(
      {
        id: row.id,
        accountName: row.accountName,
        tokenSuffix: row.tokenSuffix,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}

const UpdateBody = z.object({
  id: z.string().min(1),
  accountName: AccountName,
  token: Token.optional(),
});

export async function PUT(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);
    const parsed = UpdateBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return err("INVALID_INPUT", "参数错误", 400);

    const current = await prisma.resellerApiToken.findFirst({
      where: { id: parsed.data.id, resellerId: user.id },
      select: { id: true },
    });
    if (!current) return err("NOT_FOUND", "云账户不存在", 404);
    const duplicate = await prisma.resellerApiToken.findFirst({
      where: {
        resellerId: user.id,
        accountName: parsed.data.accountName,
        id: { not: parsed.data.id },
      },
      select: { id: true },
    });
    if (duplicate) return err("ACCOUNT_NAME_TAKEN", "云账户名称已存在", 409);

    const data: {
      accountName: string;
      tokenEncrypted?: string;
      tokenSuffix?: string;
      tokenKeyHint?: string;
      status?: string;
      lastVerifiedAt?: null;
    } = { accountName: parsed.data.accountName };
    if (parsed.data.token) {
      data.tokenEncrypted = encryptToken(parsed.data.token);
      data.tokenSuffix = tokenSuffix(parsed.data.token);
      data.tokenKeyHint = keyHint();
      data.status = "active";
      data.lastVerifiedAt = null;
    }
    const row = await prisma.resellerApiToken.update({
      where: { id: parsed.data.id },
      data,
    });
    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "cloud_account_update",
      requestPayload: {
        accountId: row.id,
        accountName: row.accountName,
        tokenChanged: !!parsed.data.token,
        suffix: parsed.data.token ? row.tokenSuffix : undefined,
      },
    });
    return ok({ saved: true });
  } catch (e) {
    return handleError(e);
  }
}

const VerifyBody = z.object({ id: z.string().min(1) });

export async function PATCH(req: NextRequest) {
  let accountId: string | null = null;
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);
    const parsed = VerifyBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return err("INVALID_INPUT", "缺少云账户 ID", 400);
    accountId = parsed.data.id;

    const account = await prisma.resellerApiToken.findFirst({
      where: { id: accountId, resellerId: user.id },
      select: { id: true, accountName: true },
    });
    if (!account) return err("NOT_FOUND", "云账户不存在", 404);

    const knownZones = await getKnownZones(user.id, account.id);
    const result = await listInstancesDetailed(user.id, {
      apiTokenId: account.id,
      allowInvalidToken: true,
      knownZones,
    });
    if (!result.complete) {
      await prisma.resellerApiToken.update({
        where: { id: account.id },
        data: { status: "invalid" },
      });
      return err(
        "TOKEN_PARTIAL_ACCESS",
        "部分地域无法访问，请确认该 Key 已开放全部地域权限",
        400,
      );
    }

    const verifiedAt = new Date();
    await prisma.resellerApiToken.update({
      where: { id: account.id },
      data: { lastVerifiedAt: verifiedAt, status: "active" },
    });
    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "cloud_account_verify",
      requestPayload: {
        accountId: account.id,
        accountName: account.accountName,
        instanceCount: result.instances.length,
      },
    });
    return ok({
      verified: true,
      instanceCount: result.instances.length,
      lastVerifiedAt: verifiedAt,
    });
  } catch (e) {
    if (accountId) {
      await prisma.resellerApiToken
        .updateMany({ where: { id: accountId }, data: { status: "invalid" } })
        .catch(() => void 0);
    }
    return handleError(e);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return err("INVALID_INPUT", "缺少云账户 ID", 400);

    const account = await prisma.resellerApiToken.findFirst({
      where: { id, resellerId: user.id },
      select: { id: true, accountName: true },
    });
    if (!account) return err("NOT_FOUND", "云账户不存在", 404);

    const removed = await prisma.$transaction(async (tx) => {
      const servers = await tx.serverCache.findMany({
        where: { resellerId: user.id, apiTokenId: id },
        select: { ecsResourceUuid: true },
      });
      const uuids = servers.map((s) => s.ecsResourceUuid);
      const assignments =
        uuids.length > 0
          ? await tx.serverAssignment.deleteMany({
              where: { resellerId: user.id, ecsResourceUuid: { in: uuids } },
            })
          : { count: 0 };
      await tx.serverCache.deleteMany({
        where: { resellerId: user.id, apiTokenId: id },
      });
      await tx.resellerKnownZone.deleteMany({
        where: { resellerId: user.id, apiTokenId: id },
      });
      await tx.notificationLog.deleteMany({
        where: { resellerId: user.id, dedupKey: `token:${id}` },
      });
      await tx.resellerApiToken.delete({ where: { id } });
      return { servers: servers.length, assignments: assignments.count };
    });

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "cloud_account_remove",
      requestPayload: {
        accountId: account.id,
        accountName: account.accountName,
        removedServers: removed.servers,
        removedAssignments: removed.assignments,
      },
    });
    return ok({ removed: true, ...removed });
  } catch (e) {
    return handleError(e);
  }
}
