import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { getBranding } from "@/lib/branding";

// 浏览器标题随品牌配置（白标）；未配置时为默认名
export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  return { title: b.panelName, description: b.panelName };
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
