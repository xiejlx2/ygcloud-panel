/**
 * GET /api/branding/icon
 *   浏览器标签图标（favicon）。公开访问（favicon 请求不带鉴权语义，仅输出图片）：
 *   - 已上传 Logo → 输出该图片
 *   - 未上传 → 输出跟随主题色的默认菱形标 SVG
 *   根布局的 metadata.icons 引用本路由并带 ?v=<更新时间戳> 做缓存版本号，
 *   换 Logo/主题色后浏览器自动拉新图。
 */
import { getBranding } from "@/lib/branding";
import { derivePalette, DEFAULT_THEME_COLOR, THEME_COLOR_RE } from "@/lib/theme";

// 必须动态渲染：路由本身不读 cookie/参数，Next 会把它静态化成构建时快照，
// 导致换 Logo 后图标永远不变。
export const dynamic = "force-dynamic";

export async function GET() {
  const b = await getBranding();

  if (b.logoDataUrl) {
    const m = b.logoDataUrl.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (m) {
      return new Response(Buffer.from(m[2], "base64"), {
        headers: {
          "Content-Type": m[1],
          // v= 版本参数保证换图后 URL 变化，可放心长缓存
          "Cache-Control": "public, max-age=86400, immutable",
        },
      });
    }
  }

  // 默认菱形标：颜色随主题色（favicon 是独立文档，不能用页面的 CSS 变量，需烘焙实色）
  const base =
    b.themeColor && THEME_COLOR_RE.test(b.themeColor) ? b.themeColor : DEFAULT_THEME_COLOR;
  const p = derivePalette(base);
  const rgb = (k: string) => `rgb(${p[k].split(" ").join(",")})`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="${rgb("500")}"/><stop offset="1" stop-color="${rgb("700")}"/>
</linearGradient></defs>
<rect x="2" y="2" width="28" height="28" rx="8" fill="url(#g)"/>
<path d="M10 12.5h12M10 16h12M10 19.5h7" stroke="white" stroke-width="2" stroke-linecap="round"/>
<circle cx="22.5" cy="19.5" r="1.4" fill="${rgb("200")}"/>
</svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
