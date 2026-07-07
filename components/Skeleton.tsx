/** 骨架屏占位。用于数据加载态，替代「加载中…」文本。 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** 表格骨架：给定列数与行数，渲染灰条占位行。 */
export function TableSkeleton({
  cols,
  rows = 5,
}: {
  cols: number;
  rows?: number;
}) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c}>
              <Skeleton className="h-4 w-full max-w-[140px]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** 统计卡片骨架 */
export function StatSkeleton() {
  return (
    <div className="card p-4">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-3 h-7 w-12" />
    </div>
  );
}
