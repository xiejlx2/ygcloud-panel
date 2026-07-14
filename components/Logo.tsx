/**
 * 品牌标识。默认为菱形渐变标 +「服务器控制台」；
 * 传入 logoDataUrl / name 时显示自定义品牌（白标，配置见 /admin/branding）。
 * 纯展示组件，品牌数据由服务端组件读库后作为 props 传入。
 */

export function LogoMark({
  className = "h-8 w-8",
  logoDataUrl,
}: {
  className?: string;
  logoDataUrl?: string | null;
}) {
  if (logoDataUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={logoDataUrl}
        alt=""
        className={`${className} rounded-lg object-contain`}
        aria-hidden="true"
      />
    );
  }
  // 渐变色走品牌 CSS 变量：配置主题色后默认图标也跟随品牌色。
  // 图形 = 层叠菱形（layers）：上层实心 + 两道渐隐层线，寓意云基础设施/服务器栈。
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgb(var(--brand-500))" />
          <stop offset="1" stopColor="rgb(var(--brand-700))" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lg)" />
      <path d="M16 7.5 23.5 12 16 16.5 8.5 12Z" fill="white" />
      <path
        d="M8.5 16.5 16 21l7.5-4.5"
        stroke="white"
        strokeOpacity="0.65"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M8.5 21 16 25.5 23.5 21"
        stroke="white"
        strokeOpacity="0.32"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function Logo({
  className = "",
  name = "服务器控制台",
  logoDataUrl,
  subtitle,
}: {
  className?: string;
  name?: string;
  logoDataUrl?: string | null;
  subtitle?: string | null;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-8 w-8 shrink-0" logoDataUrl={logoDataUrl} />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-slate-900">
          {name}
        </div>
        {subtitle && (
          <div className="text-[11px] font-medium text-slate-400">{subtitle}</div>
        )}
      </div>
    </div>
  );
}
