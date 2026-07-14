import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { getBranding } from "@/lib/branding";
import { themeCssText, THEME_COLOR_RE } from "@/lib/theme";

// 浏览器标题随品牌配置（白标）；未配置时为默认名
export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return { title: b.panelName, description: b.panelName };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const b = await getBranding();
  // 配置了主题色时覆盖 :root 品牌色变量（默认值在 globals.css）
  const themeStyle =
    b.themeColor && THEME_COLOR_RE.test(b.themeColor)
      ? themeCssText(b.themeColor)
      : null;
  return (
    <html lang="zh-CN">
      <head>{themeStyle && <style id="brand-theme">{themeStyle}</style>}</head>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
