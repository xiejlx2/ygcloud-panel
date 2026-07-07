/** @type {import('next').NextConfig} */

// 全局安全响应头。CSP 以 frame-ancestors 'none' 防点击劫持；
// script/style 放开 'unsafe-inline'（Next 的注水脚本/内联样式需要），
// dev 额外需要 'unsafe-eval'。如需更严可后续改用 nonce 中间件。
const isProd = process.env.NODE_ENV === "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // 浏览器仅在 HTTPS 响应上生效，HTTP(直连 IP)访问会被忽略，故可安全下发
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
];

const nextConfig = {
  reactStrictMode: true,
  // 不允许在客户端构建产物中出现敏感环境变量
  // 服务端用到的密钥不应以 NEXT_PUBLIC_ 开头
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
