'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@/lib/i18n'
import { usePlatformPending, PlatformPendingItem } from '@/hooks/usePlatformPending'

// Self-contained palette — this page lives outside the themed app layout, so it
// carries its own tokens (mirrors app/platform/page.tsx's `C`, kept local on
// purpose so this component doesn't import from the page).
const C = {
  bg: '#FFF5EC', card: '#FFFFFF', border: 'rgba(42,18,6,0.14)',
  text: '#2A1206', muted: 'rgba(42,18,6,0.64)', accent: '#E14909', accentSoft: 'rgba(225,73,9,0.12)',
  good: '#1B9E6B', goodSoft: 'rgba(27,158,107,0.13)',
  warn: '#C2740C', warnSoft: 'rgba(194,116,12,0.14)',
  bad: '#D64141', badSoft: 'rgba(214,65,65,0.13)',
  info: '#3B72C4', infoSoft: 'rgba(59,114,196,0.13)',
}
const card: React.CSSProperties = { background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: '20px 22px' }
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: C.muted, padding: '0 12px 10px', fontWeight: 700 }
const td: React.CSSProperties = { padding: '13px 12px', borderTop: `1px solid ${C.border}`, fontSize: 13.5, color: C.text, verticalAlign: 'middle' }

const fmtDate = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// Severity → dot color. overdue=red, soon=amber, info=blue.
const sevColor = (s: PlatformPendingItem['severity']) =>
  s === 'overdue' ? C.bad : s === 'soon' ? C.warn : C.info
const sevBg = (s: PlatformPendingItem['severity']) =>
  s === 'overdue' ? C.badSoft : s === 'soon' ? C.warnSoft : C.infoSoft

// Stable order for the per-community item-type groups: tickets + approvals
// (ministerial, actionable here) first, then the statutory items.
const TYPE_ORDER: PlatformPendingItem['item_type'][] = [
  'support_ticket', 'resident_approval', 'collections', 'arc_request',
  'meeting_minutes_due', 'election_milestone', 'violation_fine',
]

export default function PendingQueue() {
  const t = useT()
  const router = useRouter()
  const { items, loading, error, approveResident, enterAndGo } = usePlatformPending()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [goingId, setGoingId] = useState<string | null>(null)

  // i18n label for an item type (the group sub-header + the row's kind chip).
  const typeLabel = (k: PlatformPendingItem['item_type']) => t(`admin.opsQueue.type.${k}`)
  const sevLabel = (s: PlatformPendingItem['severity']) => t(`admin.opsQueue.sev.${s}`)

  // Group: community_name → item_type → rows. Communities sorted alphabetically,
  // groups within a community in TYPE_ORDER.
  const groups = useMemo(() => {
    const byCommunity = new Map<string, { communityId: string | null; name: string; byType: Map<string, PlatformPendingItem[]> }>()
    for (const it of items) {
      const key = it.community_id || '∅'
      let g = byCommunity.get(key)
      if (!g) { g = { communityId: it.community_id, name: it.community_name || t('admin.opsQueue.unknownCommunity'), byType: new Map() }; byCommunity.set(key, g) }
      const arr = g.byType.get(it.item_type) || []
      arr.push(it)
      g.byType.set(it.item_type, arr)
    }
    return [...byCommunity.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [items, t])

  const selectedApprovals = useMemo(
    () => items.filter(it => it.item_type === 'resident_approval' && selected.has(it.id)),
    [items, selected])

  const toggle = (id: string) => setSelected(s => {
    const next = new Set(s)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  const approveSelected = async () => {
    if (!selectedApprovals.length) return
    setBusy(true)
    // Sequential so the DB function + audit log fire one per resident, then the
    // realtime reload reconciles. Clear each id as it lands.
    for (const it of selectedApprovals) {
      await approveResident(it.id)
      setSelected(s => { const n = new Set(s); n.delete(it.id); return n })
    }
    setBusy(false)
  }

  const onGo = async (it: PlatformPendingItem) => {
    setGoingId(it.id)
    // Support tickets stay in the console (the deep-link is /platform?...), so no
    // community-enter needed; the other items drop into the community first.
    if (it.item_type !== 'support_ticket' && it.community_id) {
      await enterAndGo(it.community_id, it.deep_link_href)
    }
    router.push(it.deep_link_href)
  }

  if (loading) return (
    <div style={{ color: C.muted, padding: 24 }}>{t('admin.opsQueue.loading')}</div>
  )
  if (error) return (
    <div style={{ ...card }}>
      <div style={{ color: C.muted, fontSize: 13.5 }}>{t('admin.opsQueue.notAllowed')}</div>
    </div>
  )

  const total = items.length
  const overdue = items.filter(i => i.severity === 'overdue').length
  const approvalsCount = items.filter(i => i.item_type === 'resident_approval').length

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>{t('admin.opsQueue.title')}</h2>
          <p style={{ color: C.muted, fontSize: 13, margin: '6px 0 0', maxWidth: 620 }}>{t('admin.opsQueue.intro')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, background: C.accentSoft, color: C.accent }}>
            {t('admin.opsQueue.totalPending')}: {total}
          </span>
          {overdue > 0 && (
            <span style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 999, background: C.badSoft, color: C.bad }}>
              {t('admin.opsQueue.overdue')}: {overdue}
            </span>
          )}
        </div>
      </div>

      {/* Batch action bar — the one ministerial bulk control. */}
      {approvalsCount > 0 && (
        <div style={{ ...card, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: C.muted, flex: 1, minWidth: 200 }}>{t('admin.opsQueue.approveHint')}</span>
          <button type="button" onClick={approveSelected} disabled={busy || selectedApprovals.length === 0}
            style={{ cursor: busy || selectedApprovals.length === 0 ? 'default' : 'pointer', fontSize: 13, fontWeight: 700, padding: '9px 16px',
              borderRadius: 9, border: `1px solid ${C.good}`, background: selectedApprovals.length ? C.good : 'transparent',
              color: selectedApprovals.length ? '#fff' : C.muted, opacity: busy ? 0.6 : 1, whiteSpace: 'nowrap' }}>
            {busy ? t('admin.opsQueue.approving') : `${t('admin.opsQueue.approveSelected')} (${selectedApprovals.length})`}
          </button>
        </div>
      )}

      {total === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '44px 22px' }}>
          <div style={{ fontSize: 30, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{t('admin.opsQueue.emptyTitle')}</div>
          <div style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>{t('admin.opsQueue.emptyBody')}</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {groups.map(g => {
            const types = TYPE_ORDER.filter(ty => g.byType.has(ty))
            const count = [...g.byType.values()].reduce((s, a) => s + a.length, 0)
            return (
              <section key={g.communityId || g.name} style={{ ...card }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{g.name}</h3>
                  <span style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, background: C.bg, borderRadius: 999, padding: '2px 9px' }}>{count}</span>
                </div>
                {types.map(ty => {
                  const rows = g.byType.get(ty) || []
                  const isApproval = ty === 'resident_approval'
                  return (
                    <div key={ty} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11.5, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, margin: '6px 4px 2px' }}>
                        {typeLabel(ty)} · {rows.length}
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                          <thead><tr>
                            {isApproval && <th style={{ ...th, width: 32 }}> </th>}
                            <th style={th}>{t('admin.opsQueue.col.item')}</th>
                            <th style={th}>{t('admin.opsQueue.col.status')}</th>
                            <th style={th}>{t('admin.opsQueue.col.due')}</th>
                            <th style={{ ...th, textAlign: 'right' }}>{t('admin.opsQueue.col.action')}</th>
                          </tr></thead>
                          <tbody>
                            {rows.map(it => (
                              <tr key={it.id}>
                                {isApproval && (
                                  <td style={{ ...td, textAlign: 'center' }}>
                                    <input type="checkbox" checked={selected.has(it.id)} onChange={() => toggle(it.id)}
                                      aria-label={t('admin.opsQueue.selectRow')} style={{ cursor: 'pointer', width: 16, height: 16, accentColor: C.good }} />
                                  </td>
                                )}
                                <td style={td}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                    <span aria-hidden="true" title={sevLabel(it.severity)} style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: sevColor(it.severity) }} />
                                    <div style={{ minWidth: 0 }}>
                                      <div style={{ fontWeight: 600 }}>{it.title}</div>
                                      {(it.subtitle || it.actor_name) && (
                                        <div style={{ fontSize: 12, color: C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
                                          {it.actor_name || it.subtitle}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td style={td}>
                                  {it.status ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 999, textTransform: 'capitalize',
                                      background: sevBg(it.severity), color: sevColor(it.severity) }}>
                                      {String(it.status).replace(/_/g, ' ')}
                                    </span>
                                  ) : '—'}
                                </td>
                                <td style={{ ...td, color: C.muted, whiteSpace: 'nowrap' }}>{fmtDate(it.due_at)}</td>
                                <td style={{ ...td, textAlign: 'right' }}>
                                  <button type="button" onClick={() => onGo(it)} disabled={goingId === it.id}
                                    title={t('admin.opsQueue.goHint')}
                                    style={{ cursor: goingId === it.id ? 'default' : 'pointer', fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 8,
                                      border: `1px solid ${C.accent}`, background: C.accentSoft, color: C.accent, whiteSpace: 'nowrap' }}>
                                    {goingId === it.id ? t('admin.opsQueue.opening') : `${t('admin.opsQueue.go')} →`}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
