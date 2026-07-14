/**
 * 主题色派生（白标）：由一个品牌基色（对应色板 600 位）自动生成全套深浅色阶。
 * 浅色阶 = 基色向白色混合，深色阶 = 向黑色混合 —— 对绝大多数品牌色都能得到
 * 协调的 hover/背景/徽章用色。
 *
 * 变量存 "R G B" 三元组（如 "79 70 229"），配合 tailwind 的
 * rgb(var(--brand-x) / <alpha-value>) 写法，透明度修饰符（bg-brand-100/60 等）可用。
 *
 * 注意：本文件不含 server-only —— 品牌设置页需要在浏览器端做实时预览。
 */

export const THEME_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** 内置默认主题（靛蓝 Indigo），与 globals.css 的 :root 默认值一致。 */
export const DEFAULT_THEME_COLOR = "#4f46e5";

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** t∈[0,1]：向 target 混合的比例。 */
function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

const WHITE: Rgb = [255, 255, 255];
const BLACK: Rgb = [0, 0, 0];

/** 由基色生成各色阶的 "R G B" 三元组，键与 tailwind.config 的 brand 色阶一一对应。 */
export function derivePalette(baseHex: string): Record<string, string> {
  const base = hexToRgb(baseHex);
  const shade = (c: Rgb) => c.join(" ");
  return {
    "50": shade(mix(base, WHITE, 0.93)),
    "100": shade(mix(base, WHITE, 0.86)),
    "200": shade(mix(base, WHITE, 0.72)),
    "300": shade(mix(base, WHITE, 0.55)),
    "400": shade(mix(base, WHITE, 0.3)),
    "500": shade(mix(base, WHITE, 0.12)),
    "600": shade(base),
    "700": shade(mix(base, BLACK, 0.18)),
    DEFAULT: shade(base),
    dark: shade(mix(base, BLACK, 0.22)),
  };
}

/** 生成注入 <style> 的 :root CSS 文本。 */
export function themeCssText(baseHex: string): string {
  const p = derivePalette(baseHex);
  const lines = Object.entries(p)
    .map(([k, v]) => `--brand-${k === "DEFAULT" ? "def" : k}:${v};`)
    .join("");
  return `:root{${lines}}`;
}
