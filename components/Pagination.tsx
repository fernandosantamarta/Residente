'use client'

// Compact paginator — used on:
//   - /admin/rules (Rule book list)
//   - /admin/schedule (Events you've added list)
//   - /app/documents (Document archive)
// Hides itself entirely if everything fits on one page.
export function Pagination({
  page, pageSize, total, onPageChange,
}: {
  page: number              // 1-indexed
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  if (pageCount <= 1) return null
  const start = (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)
  return (
    <nav className="pgn" aria-label="Pagination">
      <button
        type="button"
        className="pgn-btn"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
        aria-label="Previous page"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Previous
      </button>
      <span className="pgn-info">
        {start}–{end} of {total}
      </span>
      <button
        type="button"
        className="pgn-btn"
        onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        disabled={page === pageCount}
        aria-label="Next page"
      >
        Next
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6" />
        </svg>
      </button>
    </nav>
  )
}

// Slice helper. 1-indexed page.
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  const start = (page - 1) * pageSize
  return items.slice(start, start + pageSize)
}
