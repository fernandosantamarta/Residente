'use client'

import { useRules } from '@/hooks/useRules'

const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

// Resident-facing rule book — covenants and house rules grouped by section,
// published by the board.
export default function Rules() {
  const { rules, loading } = useRules()
  const list = rules || []

  // Group by section, keeping the board's sort order.
  const sections = []
  const bySection = {}
  list.forEach(r => {
    const name = r.section || 'General'
    if (!bySection[name]) { bySection[name] = []; sections.push(name) }
    bySection[name].push(r)
  })

  return (
    <div className="rules-wrap">
      <div className="rules-kicker">Community Rules</div>
      <h1 className="rules-h1">What we agreed to live by</h1>
      <p className="rules-dek">
        The covenants and house rules for the community, in plain language — set by your board.
      </p>

      {loading && <div className="rules-empty">Loading the rule book…</div>}

      {!loading && list.length === 0 && (
        <div className="rules-empty">
          <div className="rules-empty-title">No rules published yet</div>
          <div className="rules-empty-sub">
            When your board adds covenants and house rules, they appear here for everyone.
          </div>
        </div>
      )}

      {!loading && sections.map(name => (
        <div className="rules-section" key={name}>
          <div className="rules-section-title">{name}</div>
          <div className="rules-list">
            {bySection[name].map(r => (
              <div className="rule-item" key={r.id}>
                <div className="rule-item-head">
                  <div className="rule-item-title">{r.title}</div>
                  {r.fine != null && Number(r.fine) > 0 && (
                    <span className="rule-fine">{fmtMoney(r.fine)} fine</span>
                  )}
                </div>
                {r.body && <div className="rule-item-body">{r.body}</div>}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
