'use client'

import { useEffect, useMemo, useState } from 'react'
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

const VIOLATIONS_PAGE_SIZE = 8

type FormState = {
  kind: ViolationKind
  rule_id: string
  resident: string          // denormalized label of the picked resident
  profile_id: string | null // the picked resident's account
  amount: string
  notes: string
  opened_at: string
}
const EMPTY: FormState = {
  kind: 'warning',
  rule_id: '',
  resident: '',
  profile_id: null,
  amount: '',
  notes: '',
  opened_at: new Date().toISOString().slice(0, 10),
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
        notes: form.notes.trim() || null,
      })
      setForm({ ...EMPTY, opened_at: new Date().toISOString().slice(0, 10) })
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
    <div className="admin-page">
      <EasyDocsTabs active="violations" />
      <div className="admin-kicker">Violations</div>
      <h1 className="admin-h1">Violations <span className="rb-amp">&amp;</span> enforcement</h1>
      <p className="admin-dek">
        Log warnings and fines against the rule book. Fines auto-bill
        through Stripe and close themselves when paid &mdash; you only
        click for appeals, dismissals, or cash overrides.
      </p>

      {/* Headline stats — same four numbers the residents see. */}
      <div className="admin-vi-stats">
        <div className="admin-vi-stat">
          <div className="admin-vi-stat-n">{fmtNum(stats.warnings)}</div>
          <div className="admin-vi-stat-l">Warnings issued</div>
        </div>
        <div className="admin-vi-stat">
          <div className="admin-vi-stat-n">{fmtMoney(stats.fines)}</div>
          <div className="admin-vi-stat-l">Fines collected</div>
        </div>
        <div className="admin-vi-stat">
          <div className="admin-vi-stat-n">{fmtNum(stats.resolved)}</div>
          <div className="admin-vi-stat-l">Resolved</div>
        </div>
        <div className="admin-vi-stat">
          <div className="admin-vi-stat-n">{fmtNum(stats.appeals)}</div>
          <div className="admin-vi-stat-l">Appeals</div>
        </div>
      </div>

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

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
          <button type="submit" className="admin-btn" disabled={saving}>
            {saving ? 'Logging…' : 'Log violation'}
          </button>
          {error && <span className="admin-err-inline">{error}</span>}
        </div>
      </form>

      <div className="bc-head" style={{ marginTop: 40, marginBottom: 14, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="bc-title">Violation log</h2>
          <span className="bc-sub">
            {list.length} {list.length === 1 ? 'entry' : 'entries'} on file.
          </span>
        </div>
        <div style={{ display: 'inline-flex', gap: 8 }}>
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
        </div>
      </div>

      <div className="admin-sched-filters" style={{ marginTop: 4, marginBottom: 12 }}>
        <div className="admin-sched-filter">
          <label>Kind</label>
          <Dropdown<'all' | ViolationKind>
            value={filterKind}
            onChange={setFilterKind}
            ariaLabel="Filter by kind"
            options={[
              { value: 'all',     label: `All (${list.length})` },
              { value: 'warning', label: `Warnings (${list.filter(v => v.kind === 'warning').length})` },
              { value: 'fine',    label: `Fines (${list.filter(v => v.kind === 'fine').length})` },
            ]}
          />
        </div>
        <div className="admin-sched-filter">
          <label>Status</label>
          <Dropdown<'all' | ViolationStatus>
            value={filterStatus}
            onChange={setFilterStatus}
            ariaLabel="Filter by status"
            options={[
              { value: 'all',      label: `All (${list.length})` },
              { value: 'open',     label: `Open (${list.filter(v => v.status === 'open').length})` },
              { value: 'appealed', label: `Appealed (${list.filter(v => v.status === 'appealed').length})` },
              { value: 'closed',   label: `Closed (${list.filter(v => v.status === 'closed').length})` },
            ]}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bc-empty">No violations match these filters.</div>
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
