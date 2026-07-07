/** 空状态：图标 + 标题 + 说明 + 可选操作按钮。 */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand">
          {icon}
        </div>
      )}
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {description && (
        <div className="mt-1 max-w-sm text-xs text-slate-400">{description}</div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
