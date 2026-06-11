'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  appeal,
  computeStats,
  dismiss,
  markManualPaid,
  markStripePaid,
  removeStoredViolation,
  reopen,
  useViolationsAdmin,
  useCommunityResidents,
  Violation,
  ViolationKind,
  ViolationResolution,
  ViolationStatus,
  waive,
} from '@/lib/violations'
import { useRulesData } from '@/lib/rules'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'
import { EasyDocsTabs } from '../EasyDocsTabs'
import { AdminModal } from '../AdminModal'

const VIOLATIONS_PAGE_SIZE = 8

type FormState = {
  kind: ViolationKind
  rule_id: string
  resident: string          // denormalized label of the picked resident
  profile_id: string | null // the picked resident's account
  amount: string
  due_at: string            // fine payment deadline (only used when kind=fine)
  notes: string
  opened_at: string
}
// Default fine payment window: today + 30 days. The board can change it per fine.
const addDays = (iso: string, n: number) => {
  const d = new Date(iso)
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const todayISO = () => new Date().toISOString().slice(0, 10)
const EMPTY: FormState = {
  kind: 'warning',
  rule_id: '',
  resident: '',
  profile_id: null,
  amount: '',
  due_at: addDays(todayISO(), 30),
  notes: '',
  opened_at: todayISO(),
}

const fmtMoney = (n: number | null | undefined) =>
  '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtNum = (n: number) => n.toLocaleString('en-US')
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  } catch { return '' }
}

const RESOLUTION_LABEL: Record<ViolationResolution, string> = {
  'stripe-paid': 'Paid via Stripe',
  'manual-paid': 'Paid manually',
  'waived':      'Waived',
  'dismissed':   'Dismissed',
}

// What state-string to show in the row meta line, given the row's
// current status + resolution + kind. Reads like an at-a-glance label.
function stateLabel(v: Violation): string {
  if (v.status === 'appealed') return 'Under appeal'
  if (v.status === 'closed') {
    return v.resolution ? RESOLUTION_LABEL[v.resolution] : 'Closed'
  }
  // open
  return v.kind === 'fine' ? 'Awaiting Stripe payment' : 'Open warning'
}

// Admin → Violations. Board issues a violation; Stripe handles the
// money. The board's only routine clicks are: appeal, dismiss
// (warnings), and the override menu for cash/check/waive.
export default function AdminViolations() {
  const { violations: list, addViolation, deleteAll } = useViolationsAdmin()
  const rules = useRulesData()
  const residents = useCommunityResidents()

  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const [filterKind, setFilterKind] = useState<'all' | ViolationKind>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | ViolationStatus>('all')
  const [page, setPage] = useState(1)
  const [showAdd, setShowAdd] = useState(false)

  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const stats = useMemo(() => computeStats(list), [list])

  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }))

  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.resident.trim()) { setError('Pick the resident this is against.'); return }
    if (form.kind === 'fine' && (form.amount === '' || Number(form.amount) <= 0)) {
      setError('A fine needs a dollar amount.')
      return
    }
    setSaving(true); setError('')
    try {
      const rule = rules.find(r => r.id === form.rule_id) || null
      await addViolation({
        profile_id: form.profile_id,
        resident_label: form.resident.trim(),
        kind: form.kind,
        rule_id: rule?.id || null,
        rule_title: rule?.title || null,
        amount: form.kind === 'fine' ? Number(form.amount) : null,
        due_at: form.kind === 'fine' ? form.due_at : null,
        notes: form.notes.trim() || null,
      })
      setForm({ ...EMPTY, opened_at: todayISO(), due_at: addDays(todayISO(), 30) })
      setShowAdd(false)
      setSuccessMsg(
        form.kind === 'fine'
          ? `Logged ${fmtMoney(Number(form.amount))} fine against ${form.resident.trim()} — they've been notified.`
          : `Logged warning against ${form.resident.trim()} — they've been notified.`
      )
    } catch (err: any) {
      setError(err?.message || 'Could not log the violation')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try { await removeStoredViolation(id) }
    catch (err: any) { setError(err?.message || 'Could not remove the violation') }
  }

  const filtered = useMemo(() => {
    return list.filter(v => {
      if (filterKind !== 'all' && v.kind !== filterKind) return false
      if (filterStatus !== 'all' && v.status !== filterStatus) return false
      return true
    }).sort((a, b) => b.opened_at.localeCompare(a.opened_at))
  }, [list, filterKind, filterStatus])

  const visible = paginate(filtered, page, VIOLATIONS_PAGE_SIZE)

  return (
    <div className="admin-page cset cviol">
      <EasyDocsTabs active="violations" />
      <div className="admin-kicker">Violations</div>
      <h1 className="admin-h1">Violations <span className="amp">&amp;</span> enforcement</h1>
      <p className="admin-dek" style={{ maxWidth: 580 }}>
        Log warnings and fines against the rule book. Fines auto-bill
        through Stripe and close themselves when paid &mdash; you only
        click for appeals, dismissals, or cash overrides.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', margin: '6px 0 8px' }}>
        {list.length > 0 && (
          <button
            type="button"
            className="admin-rules-danger"
            onClick={async () => {
              if (window.confirm('Clear every violation in the community? This cannot be undone.')) {
                try { await deleteAll() } catch (err: any) { setError(err?.message || 'Could not clear violations') }
              }
            }}
          >
            Delete all
          </button>
        )}
        <button type="button" className="admin-primary-btn" onClick={() => setShowAdd(true)}>+ Log violation</button>
      </div>

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {/* Headline stats — same four numbers the residents see. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, margin: '4px 0 18px' }}>
        {[
          { v: fmtNum(stats.warnings), l: 'Warnings issued' },
          { v: fmtMoney(stats.fines),  l: 'Fines collected' },
          { v: fmtNum(stats.resolved), l: 'Resolved' },
          { v: fmtNum(stats.appeals),  l: 'Appeals' },
        ].map(s => (
          <div className="stat" key={s.l}>
            <div className="v">{s.v}</div>
            <div className="l">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Cross-link to the statutory enforcement workspace (Compliance) — same
          wsrow card format the Compliance hub uses. */}
      <div className="card">
        <div className="wslist">
          <Link href="/admin/enforcement" className="wsrow">
            <span className="wsrow-glyph" style={{ color: '#DC6803', background: '#DC680318' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3l8 4v6c0 5-3.5 7-8 8-4.5-1-8-3-8-8V7z" /><path d="M9 12l2 2 4-4" />
              </svg>
            </span>
            <div className="wsrow-main">
              <div className="wsrow-title">Statutory fines, hearings &amp; suspensions</div>
              <div className="wsrow-desc">Run a fine through the independent fining committee and the 14-day hearing notice, and track voting / use-rights suspensions.</div>
            </div>
            <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>

      {/* Violation log card. */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>Violation log</h2>
            <div className="sub">{list.length} {list.length === 1 ? 'entry' : 'entries'} on file</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 150 }}>
              <Dropdown<'all' | ViolationKind>
                value={filterKind}
                onChange={(v) => { setFilterKind(v); setPage(1) }}
                ariaLabel="Filter by kind"
                options={[
                  { value: 'all',     label: `All kinds (${list.length})` },
                  { value: 'warning', label: `Warnings (${list.filter(v => v.kind === 'warning').length})` },
                  { value: 'fine',    label: `Fines (${list.filter(v => v.kind === 'fine').length})` },
                ]}
              />
            </div>
            <div style={{ minWidth: 150 }}>
              <Dropdown<'all' | ViolationStatus>
                value={filterStatus}
                onChange={(v) => { setFilterStatus(v); setPage(1) }}
                ariaLabel="Filter by status"
                options={[
                  { value: 'all',      label: `All statuses (${list.length})` },
                  { value: 'open',     label: `Open (${list.filter(v => v.status === 'open').length})` },
                  { value: 'appealed', label: `Appealed (${list.filter(v => v.status === 'appealed').length})` },
                  { value: 'closed',   label: `Closed (${list.filter(v => v.status === 'closed').length})` },
                ]}
              />
            </div>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bc-empty" style={{ margin: 0 }}>
            {list.length === 0 ? 'No violations yet — click "+ Log violation" to add one.' : 'No violations match these filters.'}
          </div>
        ) : (
          <>
            <div className="bd-list">
              {visible.map((v: Violation) => (
                <ViolationRow key={v.id} v={v} onRemove={() => remove(v.id)} />
              ))}
            </div>
            <Pagination
              page={page}
              pageSize={VIOLATIONS_PAGE_SIZE}
              total={filtered.length}
              onPageChange={setPage}
            />
          </>
        )}
      </div>

      {/* Log-violation popup. */}
      {showAdd && (
        <AdminModal title="Log a violation"
          sub="Against the rule book. Fines auto-bill through Stripe."
          onClose={() => setShowAdd(false)}>
          <form className="admin-form" onSubmit={add}>
            <div className="admin-field">
              <span className="admin-field-label">Kind</span>
              <Dropdown<ViolationKind>
                value={form.kind}
                onChange={v => setField('kind', v)}
                ariaLabel="Violation kind"
                options={[
                  { value: 'warning', label: 'Warning (no fine)' },
                  { value: 'fine',    label: 'Fine ($) — auto-billed via Stripe' },
                ]}
              />
            </div>

            <div className="admin-field">
              <span className="admin-field-label">Rule (optional)</span>
              <Dropdown<string>
                value={form.rule_id}
                onChange={v => setField('rule_id', v)}
                ariaLabel="Rule"
                placeholder="Pick a rule…"
                searchable
                options={[
                  { value: '', label: '— No specific rule —' },
                  ...rules.map(r => ({
                    value: r.id,
                    label: r.section ? `${r.section} — ${r.title}` : r.title,
                  })),
                ]}
              />
              <span className="admin-field-hint">
                Linking a rule shows residents which standard the violation refers to.
              </span>
            </div>

            <div className="admin-field">
              <span className="admin-field-label">Resident</span>
              <Dropdown<string>
                value={residents.find(r => r.label === form.resident)?.id || ''}
                onChange={id => {
                  const r = residents.find(x => x.id === id)
                  setForm(f => ({ ...f, resident: r?.label || '', profile_id: r?.profile_id ?? null }))
                }}
                ariaLabel="Resident"
                placeholder={residents.length ? 'Pick a resident…' : 'No residents on the roster yet'}
                searchable
                options={residents.map(r => ({ value: r.id, label: r.label }))}
              />
            </div>

            {form.kind === 'fine' && (
              <label className="admin-field" style={{ maxWidth: 200 }}>
                <span className="admin-field-label">Fine $</span>
                <input name="amount" className="admin-input" type="number" placeholder="50"
                  value={form.amount} onChange={e => setField('amount', e.target.value)} />
                <span className="admin-field-hint">
                  Stripe invoice is generated and emailed to the resident automatically.
                </span>
              </label>
            )}

            {form.kind === 'fine' && (
              <label className="admin-field" style={{ maxWidth: 220 }}>
                <span className="admin-field-label">Due date</span>
                <input name="due_at" className="admin-input" type="date"
                  value={form.due_at} onChange={e => setField('due_at', e.target.value)} />
                <span className="admin-field-hint">
                  The deadline the resident sees on their Pay screen. Defaults to 30 days out.
                </span>
              </label>
            )}

            <label className="admin-field" style={{ maxWidth: 220 }}>
              <span className="admin-field-label">Date</span>
              <input name="opened_at" className="admin-input" type="date"
                value={form.opened_at} onChange={e => setField('opened_at', e.target.value)} />
            </label>

            <label className="admin-field">
              <span className="admin-field-label">Notes (optional)</span>
              <textarea name="notes" className="admin-input admin-textarea" rows={3}
                placeholder="What happened, what the resident said, any follow-up."
                value={form.notes} onChange={e => setField('notes', e.target.value)} />
            </label>

            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-btn" disabled={saving}>
                {saving ? 'Logging…' : 'Log violation'}
              </button>
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
          </form>
        </AdminModal>
      )}
    </div>
  )
}

function pillClass(v: Violation): string {
  if (v.status === 'appealed') return 'admin-vi-pill-appealed'
  if (v.status === 'open') return 'admin-vi-pill-open'
  // closed
  if (v.resolution === 'stripe-paid' || v.resolution === 'manual-paid') return 'admin-vi-pill-paid'
  if (v.resolution === 'waived') return 'admin-vi-pill-waived'
  return 'admin-vi-pill-dismissed'
}

function ViolationRow({ v, onRemove }: { v: Violation; onRemove: () => void }) {
  const [open, setOpen] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  return (
    <div className={`bd-row${open ? ' open' : ''}`}>
      <button
        type="button"
        className="bd-row-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <div className="bd-main">
          <div className="bd-title">
            {v.resident}
            <span className={`admin-vi-pill ${pillClass(v)}`}>{stateLabel(v)}</span>
          </div>
          <div className="bd-meta">
            <span>{v.kind === 'fine' ? 'Fine' : 'Warning'}</span>
            <span className="bd-dot">·</span>
            <span>{v.rule_title || 'No specific rule'}</span>
            <span className="bd-dot">·</span>
            <span>Opened {fmtDate(v.opened_at) || '—'}</span>
          </div>
        </div>
        {v.amount != null && Number(v.amount) > 0 && (
          <div className="bd-amount">{fmtMoney(v.amount)}</div>
        )}
        <svg className="bd-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="bd-body">
          {v.notes ? <p>{v.notes}</p> : <p className="bd-body-empty">No notes for this entry.</p>}
          <div className="bd-body-meta">
            <span><strong>Resident:</strong> {v.resident}</span>
            <span><strong>Kind:</strong> {v.kind === 'fine' ? 'Fine' : 'Warning'}</span>
            {v.amount != null && Number(v.amount) > 0 && (
              <span><strong>Amount:</strong> {fmtMoney(v.amount)}</span>
            )}
            <span><strong>Rule:</strong> {v.rule_title || 'No specific rule'}</span>
            <span><strong>Opened:</strong> {fmtDate(v.opened_at)}</span>
            {v.closed_at && <span><strong>Closed:</strong> {fmtDate(v.closed_at)}</span>}
            {v.stripe_invoice_id && (
              <span><strong>Stripe invoice:</strong> <code>{v.stripe_invoice_id}</code></span>
            )}
          </div>

          {/* Actions — only what's relevant for this row's state.
              The Stripe-driven happy path needs zero clicks; this
              section is appeals, warnings, and exceptions. */}
          <RowActions v={v} overrideOpen={overrideOpen} setOverrideOpen={setOverrideOpen} />
        </div>
      )}
      <button type="button" className="bc-del" onClick={(e) => { e.stopPropagation(); onRemove() }}
        aria-label="Remove violation">&times;</button>
    </div>
  )
}

function RowActions({
  v,
  overrideOpen,
  setOverrideOpen,
}: {
  v: Violation
  overrideOpen: boolean
  setOverrideOpen: (b: boolean) => void
}) {
  const isFine = v.kind === 'fine'

  if (v.status === 'closed') {
    return (
      <div className="admin-vi-actions">
        <span className="admin-vi-closed-note">
          {v.resolution === 'stripe-paid' && 'Closed automatically when the Stripe invoice was paid.'}
          {v.resolution === 'manual-paid' && 'Closed manually after a cash / check payment was recorded.'}
          {v.resolution === 'waived'      && 'Closed because the board waived collection.'}
          {v.resolution === 'dismissed'   && 'Warning closed without further action.'}
        </span>
        <button type="button" className="admin-btn-ghost" onClick={() => reopen(v.id)}>
          Reopen
        </button>
      </div>
    )
  }

  if (v.status === 'appealed') {
    return (
      <div className="admin-vi-actions">
        <span className="admin-vi-closed-note">
          {isFine
            ? 'Stripe collection is paused while the board reviews the appeal.'
            : 'Warning is under review.'}
        </span>
        <button type="button" className="admin-btn" onClick={() => reopen(v.id)}>
          Resume collection
        </button>
        {isFine && (
          <button type="button" className="admin-btn-ghost" onClick={() => waive(v.id)}>
            Side with resident &mdash; waive
          </button>
        )}
      </div>
    )
  }

  // status === 'open'
  return (
    <div className="admin-vi-actions">
      {isFine ? (
        <span className="admin-vi-closed-note">
          Stripe will collect automatically. You only need to click if there&rsquo;s an appeal or override.
        </span>
      ) : (
        <button type="button" className="admin-btn" onClick={() => dismiss(v.id)}>
          Dismiss warning
        </button>
      )}
      <button type="button" className="admin-btn-ghost" onClick={() => appeal(v.id)}>
        Open appeal
      </button>
      {isFine && (
        <div className="admin-vi-override">
          <button
            type="button"
            className="admin-btn-ghost admin-vi-override-toggle"
            onClick={() => setOverrideOpen(!overrideOpen)}
            aria-expanded={overrideOpen}
          >
            Override <span aria-hidden="true">▾</span>
          </button>
          {overrideOpen && (
            <div className="admin-vi-override-menu" role="menu">
              <button type="button" role="menuitem" className="admin-vi-override-item"
                onClick={() => { markManualPaid(v.id); setOverrideOpen(false) }}>
                <strong>Mark paid manually</strong>
                <span>Cash or check &mdash; logged outside Stripe.</span>
              </button>
              <button type="button" role="menuitem" className="admin-vi-override-item"
                onClick={() => { waive(v.id); setOverrideOpen(false) }}>
                <strong>Waive this fine</strong>
                <span>Board declines to collect. Voids the Stripe invoice.</span>
              </button>
              <button type="button" role="menuitem" className="admin-vi-override-item"
                onClick={() => { markStripePaid(v.id); setOverrideOpen(false) }}>
                <strong>Simulate Stripe payment</strong>
                <span>Demo-only &mdash; mimics the webhook firing.</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
