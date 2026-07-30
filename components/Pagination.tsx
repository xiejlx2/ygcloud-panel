export function Pagination({
  page,
  totalItems,
  pageSize,
  onPageChange,
}: {
  page: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  if (totalPages <= 1) return null;

  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
      <span className="text-xs text-slate-500">
        显示 {start}–{end}，共 {totalItems} 台
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn-default btn-sm"
          disabled={currentPage <= 1}
          onClick={() => onPageChange(currentPage - 1)}
        >
          上一页
        </button>
        <label className="sr-only" htmlFor="server-page">
          当前页
        </label>
        <select
          id="server-page"
          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-600 outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
          value={currentPage}
          onChange={(e) => onPageChange(Number(e.target.value))}
        >
          {Array.from({ length: totalPages }, (_, index) => index + 1).map(
            (value) => (
              <option key={value} value={value}>
                第 {value} / {totalPages} 页
              </option>
            ),
          )}
        </select>
        <button
          type="button"
          className="btn-default btn-sm"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(currentPage + 1)}
        >
          下一页
        </button>
      </div>
    </div>
  );
}
