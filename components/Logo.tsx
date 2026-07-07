/** 品牌标识：菱形渐变标 + 文字「服务器控制台」。纯内联 SVG，无依赖。 */

export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#4338ca" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lg)" />
      <path
        d="M10 12.5h12M10 16h12M10 19.5h7"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="22.5" cy="19.5" r="1.4" fill="#c7d2fe" />
    </svg>
  );
}

export function Logo({
  className = "",
  subtitle,
}: {
  className?: string;
  subtitle?: string;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <LogoMark className="h-8 w-8 shrink-0" />
      <div className="leading-tight">
        <div className="text-[15px] font-semibold tracking-tight text-slate-900">
          服务器控制台
        </div>
        {subtitle && (
          <div className="text-[11px] font-medium text-slate-400">{subtitle}</div>
        )}
      </div>
    </div>
  );
}
