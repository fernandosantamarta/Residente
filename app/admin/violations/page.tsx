'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/providers'
import {
  appeal,
  computeStats,
  dismiss,
  markManualPaid,
  markStripePaid,
  removeStoredViolation,
  reopen,
  sendFineToCollections,
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
import { useT } from '@/lib/i18n'

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

// What state-string to show in the row meta line, given the row's
// current status + resolution + kind. Reads like an at-a-glance label.
function stateLabel(v: Violation, t: (key: string) => string): string {
  if (v.status === 'appealed') return t('admin.violations.stateUnderAppeal')
  if (v.status === 'closed') {
    if (v.resolution === 'stripe-paid')  return t('admin.violations.resolutionStripePaid')
    if (v.resolution === 'manual-paid')  return t('admin.violations.resolutionManualPaid')
    if (v.resolution === 'waived')       return t('admin.violations.resolutionWaived')
    if (v.resolution === 'dismissed')    return t('admin.violations.resolutionDismissed')
    return t('admin.violations.stateClosed')
  }
  // open
  return v.kind === 'fine'
    ? t('admin.violations.stateAwaitingStripe')
    : t('admin.violations.stateOpenWarning')
}

// Admin → Violations. Board issues a violation; Stripe handles the
// money. The board's only routine clicks are: appeal, dismiss
// (warnings), and the override menu for cash/check/waive.
export default function AdminViolations() {
  const t = useT()
  const router = useRouter()
  const { profile } = useAuth() || {}
  const { violations: list, addViolation, deleteAll } = useViolationsAdmin()
  const rules = useRulesData()
  const residents = useCommunityResidents()

  // Bridge an unpaid fine into Collections: opens (or reuses) a fine-only
  // collection case for the owner, then jumps to the collection ladder.
  const [sendingId, setSendingId] = useState<string | null>(null)
  const sendToCollections = async (v: Violation) => {
    if (!profile?.community_id) return
    setError(''); setSendingId(v.id)
    try {
      const res = await sendFineToCollections({
        violation: v, communityId: profile.community_id, createdBy: profile.id ?? null, residents,
      })
      router.push(`/admin/collections/${res.caseId}${res.created ? '' : '?existing=1'}`)
    } catch (err: any) {
      setError(err?.message || t('admin.violations.sendToCollectionsError')); setSendingId(null)
    }
  }

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
    if (!form.resident.trim()) { setError(t('admin.violations.errorPickResident')); return }
    if (form.kind === 'fine' && (form.amount === '' || Number(form.amount) <= 0)) {
      setError(t('admin.violations.errorFineAmount'))
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
          ? t('admin.violations.successFineLogged', { amount: fmtMoney(Number(form.amount)), resident: form.resident.trim() })
          : t('admin.violations.successWarningLogged', { resident: form.resident.trim() })
      )
    } catch (err: any) {
      setError(err?.message || t('admin.violations.errorCouldNotLog'))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id: string) => {
    try { await removeStoredViolation(id) }
    catch (err: any) { setError(err?.message || t('admin.violations.errorCouldNotRemove')) }
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
      <div className="admin-kicker">{t('admin.violations.kicker')}</div>
      <h1 className="admin-h1">{t('admin.violations.pageTitle')} <span className="amp">&amp;</span> {t('admin.violations.pageTitleSuffix')}</h1>
      <p className="admin-dek" style={{ maxWidth: 580 }}>
        {t('admin.violations.pageDek')}
      </p>

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {/* Headline stats — same four numbers the residents see. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, margin: '4px 0 18px' }}>
        {[
          { v: fmtNum(stats.warnings), l: t('admin.violations.statWarningsIssued') },
          { v: fmtMoney(stats.fines),  l: t('admin.violations.statFinesCollected') },
          { v: fmtNum(stats.resolved), l: t('admin.violations.statResolved') },
          { v: fmtNum(stats.appeals),  l: t('admin.violations.statAppeals') },
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
              <div className="wsrow-title">{t('admin.violations.enforcementLinkTitle')}</div>
              <div className="wsrow-desc">{t('admin.violations.enforcementLinkDesc')}</div>
            </div>
            <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
          </Link>
          <Link href="/admin/collections" className="wsrow">
            <span className="wsrow-glyph" style={{ color: '#B54708', background: '#B5470818' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" /><path d="M7 14l3-3 3 3 4-5" />
              </svg>
            </span>
            <div className="wsrow-main">
              <div className="wsrow-title">{t('admin.violations.collectionsLinkTitle')}</div>
              <div className="wsrow-desc">{t('admin.violations.collectionsLinkDesc')}</div>
            </div>
            <span className="wsrow-arrow" aria-hidden="true">&rarr;</span>
          </Link>
        </div>
      </div>

      {/* Violation log card. */}
      <div className="card">
        <div className="card-head">
          <div>
            <h2>{t('admin.violations.violationLogTitle')}</h2>
            <div className="sub">{list.length} {list.length === 1 ? t('admin.violations.entryOne') : t('admin.violations.entryMany')}</div>
          </div>
          <div className="cset-arch-head-r" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="cset-rule-filter" style={{ minWidth: 150 }}>
              <Dropdown<'all' | ViolationKind>
                value={filterKind}
                onChange={(v) => { setFilterKind(v); setPage(1) }}
                ariaLabel={t('admin.violations.filterByKind')}
                options={[
                  { value: 'all',     label: t('admin.violations.filterAllKinds', { count: list.length }) },
                  { value: 'warning', label: t('admin.violations.filterWarnings', { count: list.filter(v => v.kind === 'warning').length }) },
                  { value: 'fine',    label: t('admin.violations.filterFines', { count: list.filter(v => v.kind === 'fine').length }) },
                ]}
              />
            </div>
            <div className="cset-rule-filter" style={{ minWidth: 150 }}>
              <Dropdown<'all' | ViolationStatus>
                value={filterStatus}
                onChange={(v) => { setFilterStatus(v); setPage(1) }}
                ariaLabel={t('admin.violations.filterByStatus')}
                options={[
                  { value: 'all',      label: t('admin.violations.filterAllStatuses', { count: list.length }) },
                  { value: 'open',     label: t('admin.violations.filterOpen', { count: list.filter(v => v.status === 'open').length }) },
                  { value: 'appealed', label: t('admin.violations.filterAppealed', { count: list.filter(v => v.status === 'appealed').length }) },
                  { value: 'closed',   label: t('admin.violations.filterClosed', { count: list.filter(v => v.status === 'closed').length }) },
                ]}
              />
            </div>
            <button type="button" className="admin-primary-btn cset-head-cta" onClick={() => setShowAdd(true)}>{t('admin.violations.btnLogViolation')}</button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="bc-empty" style={{ margin: 0 }}>
            {list.length === 0 ? t('admin.violations.emptyNoViolations') : t('admin.violations.emptyNoMatch')}
          </div>
        ) : (
          <>
            <div className="bd-list">
              {visible.map((v: Violation) => (
                <ViolationRow key={v.id} v={v} onRemove={() => remove(v.id)} onSendToCollections={() => sendToCollections(v)} sending={sendingId === v.id} />
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
        {list.length > 0 && (
          <div className="rulebook-footer">
            <button
              type="button"
              className="admin-rules-danger"
              onClick={async () => {
                if (window.confirm(t('admin.violations.confirmDeleteAll'))) {
                  try { await deleteAll() } catch (err: any) { setError(err?.message || t('admin.violations.errorCouldNotClear')) }
                }
              }}
            >
              {t('admin.violations.btnDeleteAll')}
            </button>
          </div>
        )}
      </div>

      {/* Log-violation popup. */}
      {showAdd && (
        <AdminModal title={t('admin.violations.modalTitle')}
          sub={t('admin.violations.modalSub')}
          onClose={() => setShowAdd(false)}>
          <form className="admin-form" onSubmit={add}>
            <div className="admin-field">
              <span className="admin-field-label">{t('admin.violations.fieldKind')}</span>
              <Dropdown<ViolationKind>
                value={form.kind}
                onChange={v => setField('kind', v)}
                ariaLabel={t('admin.violations.fieldKindAria')}
                options={[
                  { value: 'warning', label: t('admin.violations.kindWarning') },
                  { value: 'fine',    label: t('admin.violations.kindFine') },
                ]}
              />
            </div>

            <div className="admin-field">
              <span className="admin-field-label">{t('admin.violations.fieldRule')}</span>
              <Dropdown<string>
                value={form.rule_id}
                onChange={v => setField('rule_id', v)}
                ariaLabel={t('admin.violations.fieldRuleAria')}
                placeholder={t('admin.violations.rulePlaceholder')}
                searchable
                options={[
                  { value: '', label: t('admin.violations.noSpecificRule') },
                  ...rules.map(r => ({
                    value: r.id,
                    label: r.section ? `${r.section} — ${r.title}` : r.title,
                  })),
                ]}
              />
              <span className="admin-field-hint">
                {t('admin.violations.ruleHint')}
              </span>
            </div>

            <div className="admin-field">
              <span className="admin-field-label">{t('admin.violations.fieldResident')}</span>
              <Dropdown<string>
                value={residents.find(r => r.label === form.resident)?.id || ''}
                onChange={id => {
                  const r = residents.find(x => x.id === id)
                  setForm(f => ({ ...f, resident: r?.label || '', profile_id: r?.profile_id ?? null }))
                }}
                ariaLabel={t('admin.violations.fieldResidentAria')}
                placeholder={residents.length ? t('admin.violations.residentPlaceholder') : t('admin.violations.residentNoRoster')}
                searchable
                options={residents.map(r => ({ value: r.id, label: r.label }))}
              />
            </div>

            {form.kind === 'fine' && (
              <label className="admin-field" style={{ maxWidth: 200 }}>
                <span className="admin-field-label">{t('admin.violations.fieldFineAmount')}</span>
                <input name="amount" className="admin-input" type="number" placeholder="50"
                  value={form.amount} onChange={e => setField('amount', e.target.value)} />
                <span className="admin-field-hint">
                  {t('admin.violations.fineAmountHint')}
                </span>
              </label>
            )}

            {form.kind === 'fine' && (
              <label className="admin-field" style={{ maxWidth: 220 }}>
                <span className="admin-field-label">{t('admin.violations.fieldDueDate')}</span>
                <input name="due_at" className="admin-input" type="date"
                  value={form.due_at} onChange={e => setField('due_at', e.target.value)} />
                <span className="admin-field-hint">
                  {t('admin.violations.dueDateHint')}
                </span>
              </label>
            )}

            <label className="admin-field" style={{ maxWidth: 220 }}>
              <span className="admin-field-label">{t('admin.violations.fieldDate')}</span>
              <input name="opened_at" className="admin-input" type="date"
                value={form.opened_at} onChange={e => setField('opened_at', e.target.value)} />
            </label>

            <label className="admin-field">
              <span className="admin-field-label">{t('admin.violations.fieldNotes')}</span>
              <textarea name="notes" className="admin-input admin-textarea" rows={3}
                placeholder={t('admin.violations.notesPlaceholder')}
                value={form.notes} onChange={e => setField('notes', e.target.value)} />
            </label>

            <div className="admin-form-actions">
              {error && <span className="admin-err-inline">{error}</span>}
              <button type="button" className="admin-btn-ghost" onClick={() => setShowAdd(false)}>{t('admin.documents.cancelBtn')}</button>
              <button type="submit" className="admin-primary-btn" disabled={saving}>
                {saving ? t('admin.violations.btnLogging') : t('admin.violations.btnLogViolationSubmit')}
              </button>
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

function ViolationRow({ v, onRemove, onSendToCollections, sending }: { v: Violation; onRemove: () => void; onSendToCollections: () => void; sending: boolean }) {
  const t = useT()
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
            <span className={`admin-vi-pill ${pillClass(v)}`}>{stateLabel(v, t)}</span>
          </div>
          <div className="bd-meta">
            <span>{v.kind === 'fine' ? t('admin.violations.kindLabelFine') : t('admin.violations.kindLabelWarning')}</span>
            <span className="bd-dot">·</span>
            <span>{v.rule_title || t('admin.violations.noSpecificRule')}</span>
            <span className="bd-dot">·</span>
            <span>{t('admin.violations.openedOn', { date: fmtDate(v.opened_at) || '—' })}</span>
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
          {v.notes ? <p>{v.notes}</p> : <p className="bd-body-empty">{t('admin.violations.noNotes')}</p>}
          <div className="bd-body-meta">
            <span><strong>{t('admin.violations.metaResident')}</strong> {v.resident}</span>
            <span><strong>{t('admin.violations.metaKind')}</strong> {v.kind === 'fine' ? t('admin.violations.kindLabelFine') : t('admin.violations.kindLabelWarning')}</span>
            {v.amount != null && Number(v.amount) > 0 && (
              <span><strong>{t('admin.violations.metaAmount')}</strong> {fmtMoney(v.amount)}</span>
            )}
            <span><strong>{t('admin.violations.metaRule')}</strong> {v.rule_title || t('admin.violations.noSpecificRule')}</span>
            <span><strong>{t('admin.violations.metaOpened')}</strong> {fmtDate(v.opened_at)}</span>
            {v.closed_at && <span><strong>{t('admin.violations.metaClosed')}</strong> {fmtDate(v.closed_at)}</span>}
            {v.stripe_invoice_id && (
              <span><strong>{t('admin.violations.metaStripeInvoice')}</strong> <code>{v.stripe_invoice_id}</code></span>
            )}
          </div>

          {/* Actions — only what's relevant for this row's state.
              The Stripe-driven happy path needs zero clicks; this
              section is appeals, warnings, and exceptions. */}
          <RowActions v={v} overrideOpen={overrideOpen} setOverrideOpen={setOverrideOpen} onSendToCollections={onSendToCollections} sending={sending} />
        </div>
      )}
      <button type="button" className="bc-del" onClick={(e) => { e.stopPropagation(); onRemove() }}
        aria-label={t('admin.violations.ariaRemoveViolation')}>&times;</button>
    </div>
  )
}

function RowActions({
  v,
  overrideOpen,
  setOverrideOpen,
  onSendToCollections,
  sending,
}: {
  v: Violation
  overrideOpen: boolean
  setOverrideOpen: (b: boolean) => void
  onSendToCollections: () => void
  sending: boolean
}) {
  const t = useT()
  const isFine = v.kind === 'fine'

  if (v.status === 'closed') {
    return (
      <div className="admin-vi-actions">
        <span className="admin-vi-closed-note">
          {v.resolution === 'stripe-paid' && t('admin.violations.closedStripePaid')}
          {v.resolution === 'manual-paid' && t('admin.violations.closedManualPaid')}
          {v.resolution === 'waived'      && t('admin.violations.closedWaived')}
          {v.resolution === 'dismissed'   && t('admin.violations.closedDismissed')}
        </span>
        <button type="button" className="admin-btn-ghost" onClick={() => reopen(v.id)}>
          {t('admin.violations.btnReopen')}
        </button>
      </div>
    )
  }

  if (v.status === 'appealed') {
    return (
      <div className="admin-vi-actions">
        <span className="admin-vi-closed-note">
          {isFine
            ? t('admin.violations.appealedFinNote')
            : t('admin.violations.appealedWarningNote')}
        </span>
        <button type="button" className="admin-btn" onClick={() => reopen(v.id)}>
          {t('admin.violations.btnResumeCollection')}
        </button>
        {isFine && (
          <button type="button" className="admin-btn-ghost" onClick={() => waive(v.id)}>
            {t('admin.violations.btnSideWithResident')}
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
          {t('admin.violations.openFineNote')}
        </span>
      ) : (
        <button type="button" className="admin-btn" onClick={() => dismiss(v.id)}>
          {t('admin.violations.btnDismissWarning')}
        </button>
      )}
      <button type="button" className="admin-btn-ghost" onClick={() => appeal(v.id)}>
        {t('admin.violations.btnOpenAppeal')}
      </button>
      {isFine && (
        <button type="button" className="admin-btn" disabled={sending} onClick={onSendToCollections}
          title={t('admin.violations.sendToCollectionsTitle')}>
          {sending ? t('admin.violations.sendingToCollections') : t('admin.violations.btnSendToCollections')}
        </button>
      )}
      {isFine && (
        <div className="admin-vi-override">
          <button
            type="button"
            className="admin-btn-ghost admin-vi-override-toggle"
            onClick={() => setOverrideOpen(!overrideOpen)}
            aria-expanded={overrideOpen}
          >
            {t('admin.violations.btnOverride')} <span aria-hidden="true">▾</span>
          </button>
          {overrideOpen && (
            <div className="admin-vi-override-menu" role="menu">
              <button type="button" role="menuitem" className="admin-vi-override-item"
                onClick={() => { markManualPaid(v.id); setOverrideOpen(false) }}>
                <strong>{t('admin.violations.overrideMarkPaid')}</strong>
                <span>{t('admin.violations.overrideMarkPaidDesc')}</span>
              </button>
              <button type="button" role="menuitem" className="admin-vi-override-item"
                onClick={() => { waive(v.id); setOverrideOpen(false) }}>
                <strong>{t('admin.violations.overrideWaive')}</strong>
                <span>{t('admin.violations.overrideWaiveDesc')}</span>
              </button>
              <button type="button" role="menuitem" className="admin-vi-override-item"
                onClick={() => { markStripePaid(v.id); setOverrideOpen(false) }}>
                <strong>{t('admin.violations.overrideSimulateStripe')}</strong>
                <span>{t('admin.violations.overrideSimulateStripeDesc')}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
