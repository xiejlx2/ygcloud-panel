/**
 * 面板品牌配置读取（服务端）。
 * 单行配置（id="default"），字段为空时回退内置默认品牌。
 * React cache() 保证同一次渲染内只查一次库。
 */
import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/prisma";

export const DEFAULT_PANEL_NAME = "服务器控制台";

export interface Branding {
  panelName: string;
  /** null = 使用内置菱形 LogoMark */
  logoDataUrl: string | null;
  loginSubtitle: string | null;
  /** 主题色 #RRGGBB；null = 默认靛蓝 */
  themeColor: string | null;
  /** 是否有任何自定义项（用于设置页展示） */
  customized: boolean;
  /** 配置最后更新时间戳（favicon 缓存版本号用；无配置行时为 0） */
  updatedAtEpoch: number;
}

export const getBranding = cache(async (): Promise<Branding> => {
  const row = await prisma.panelSetting
    .findUnique({ where: { id: "default" } })
    .catch(() => null);
  return {
    panelName: row?.panelName?.trim() || DEFAULT_PANEL_NAME,
    logoDataUrl: row?.logoDataUrl || null,
    loginSubtitle: row?.loginSubtitle?.trim() || null,
    themeColor: row?.themeColor || null,
    customized: !!(
      row?.panelName ||
      row?.logoDataUrl ||
      row?.loginSubtitle ||
      row?.themeColor
    ),
    updatedAtEpoch: row?.updatedAt ? Math.floor(row.updatedAt.getTime() / 1000) : 0,
  };
});
