import { useBoardDecisions } from '../hooks/useBoardDecisions'

// Resident-facing Board page — the full history of board decisions, newest
// first, read from the same board_decisions the home feed uses.
const STATUS = {
  approved:   { cls: 'approved',   label: 'Approved' },
  pending:    { cls: 'pending',    label: 'Pending' },
  paid:       { cls: 'paid',       label: 'Paid' },
  discussion: { cls: 'discussion', label: 'Discussion' },
}

const fmtAmt = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtDate = (d) => (d
  ? new Date(d + 'T00:00:00').toLocaleDateString('en-US',
      { month: 'short', day: 'numeric', year: 'numeric' })
  : '')

export default function Board() {
  const { decisions, loading } = useBoardDecisions(100)
  const list = decisions || []

  const approvedSpend = list
    .filter(d => d.status === 'approved' || d.status === 'paid')
    .reduce((s, d) => s + (Number(d.amount) || 0), 0)
  const pendingCount = list.filter(d => d.status === 'pending').length

  return (
    <div className="board-wrap">
      <div className="board-kicker">The Board</div>
      <h1 className="board-h1">Decisions &amp; motions</h1>
      <p className="board-dek">
        Every vendor approval, motion, and vote your board has logged — newest first.
      </p>

      {loading && <div className="board-empty">Loading board activity…</div>}

      {!loading && list.length === 0 && (
        <div className="board-empty">
          <div className="board-empty-title">No decisions logged yet</div>
          <div className="board-empty-sub">
            When your board approves a vendor, logs a motion, or records a vote,
            it appears here for the whole community to see.
          </div>
        </div>
      )}

      {!loading && list.length > 0 && (
        <>
          <div className="board-stats">
            <div className="board-stat">
              <div className="board-stat-v">{list.length}</div>
              <div className="board-stat-k">Decisions logged</div>
            </div>
            <div className="board-stat">
              <div className="board-stat-v">{fmtAmt(approvedSpend)}</div>
              <div className="board-stat-k">Approved spend</div>
            </div>
            <div className="board-stat">
              <div className="board-stat-v">{pendingCount}</div>
              <div className="board-stat-k">Awaiting a vote</div>
            </div>
          </div>

          <div className="board-list">
            {list.map(d => {
              const s = STATUS[d.status] || STATUS.discussion
              return (
                <div className="board-item" key={d.id}>
                  <div className="board-item-main">
                    <div className="board-item-title">{d.title}</div>
                    <div className="board-item-meta">
                      {d.vendor && <span>{d.vendor}</span>}
                      {d.vendor && <span className="board-dot">·</span>}
                      <span>{fmtDate(d.decided_on)}</span>
                    </div>
                  </div>
                  {d.amount != null && (
                    <div className="board-item-amt">{fmtAmt(d.amount)}</div>
                  )}
                  <span className={`board-pill board-pill-${s.cls}`}>{s.label}</span>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
