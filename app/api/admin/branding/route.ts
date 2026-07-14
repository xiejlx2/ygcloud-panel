/**
 * 面板品牌设置（白标）。仅 reseller_admin 可调用。
 *
 * GET    /api/admin/branding → 当前配置（含默认值回退与 customized 标记）
 * POST   /api/admin/branding → 保存（名称/副标题传 null 表示清空回默认；logo 仅在传了新值时更新）
 * DELETE /api/admin/branding → 全部恢复默认
 */
import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { assertIsResellerAdmin } from "@/lib/permissions";
import { getBranding, DEFAULT_PANEL_NAME } from "@/lib/branding";
import { ok, err, handleError } from "@/lib/api";
import { writeAudit } from "@/lib/audit";

export async function GET() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);
    const b = await getBranding();
    return ok({ ...b, defaultPanelName: DEFAULT_PANEL_NAME });
  } catch (e) {
    return handleError(e);
  }
}

// logo 限制：png/jpeg/webp/svg 的 data URL，base64 部分 ≤ 400_000 字符（约 300KB 原图）
const LOGO_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/;

const PostBody = z.object({
  panelName: z.string().max(30).nullable().optional(),
  loginSubtitle: z.string().max(60).nullable().optional(),
  // 主题色 #RRGGBB；null 表示恢复默认靛蓝
  themeColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "主题色必须是 #RRGGBB 格式")
    .nullable()
    .optional(),
  logoDataUrl: z
    .string()
    .max(400_000, "Logo 图片过大（请压缩到 300KB 以内）")
    .regex(LOGO_RE, "Logo 必须是 png/jpg/webp/svg 图片")
    .optional(),
  clearLogo: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    const json = await req.json().catch(() => null);
    const parsed = PostBody.safeParse(json);
    if (!parsed.success) {
      const msg = parsed.error.errors[0]?.message || "参数错误";
      return err("INVALID_INPUT", msg, 400);
    }
    const b = parsed.data;

    const data: Record<string, unknown> = {};
    if (b.panelName !== undefined) data.panelName = b.panelName?.trim() || null;
    if (b.loginSubtitle !== undefined) data.loginSubtitle = b.loginSubtitle?.trim() || null;
    if (b.themeColor !== undefined) data.themeColor = b.themeColor;
    if (b.logoDataUrl) data.logoDataUrl = b.logoDataUrl;
    if (b.clearLogo) data.logoDataUrl = null;

    await prisma.panelSetting.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });

    await writeAudit({
      user,
      ecsResourceUuid: "-",
      action: "branding_update",
      requestPayload: {
        panelName: b.panelName,
        loginSubtitle: b.loginSubtitle,
        themeColor: b.themeColor,
        logoSet: !!b.logoDataUrl,
        clearLogo: !!b.clearLogo,
      },
    });

    return ok({ saved: true });
  } catch (e) {
    return handleError(e);
  }
}

export async function DELETE() {
  try {
    const user = await getSession();
    assertIsResellerAdmin(user);

    await prisma.panelSetting.deleteMany({ where: { id: "default" } });
    await writeAudit({ user, ecsResourceUuid: "-", action: "branding_reset" });
    return ok({ reset: true });
  } catch (e) {
    return handleError(e);
  }
}
