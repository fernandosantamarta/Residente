'use client'

import { useState, useEffect, useCallback, useRef, ChangeEvent } from 'react'
import { AdminModal } from '../AdminModal'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { useT } from '@/lib/i18n'
import {
  addStoredCategory,
  hideBuiltInCategory,
  removeStoredCategory,
  RULE_CATEGORIES,
  useCategoriesData,
  useRulesAdmin,
} from '@/lib/rules'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'
import { EasyDocsTabs } from '../EasyDocsTabs'
import { DEFAULT_CHANNELS } from '@/lib/voice'
import {
  DOC_CATEGORIES, FL_REQUIRED_CATEGORIES, postingApplies, recordsInspectionDueAt,
  amendmentDistributionDue, AMENDMENT_DISTRIBUTION_DAYS,
  type DocCategory,
} from '@/lib/compliance/official-records'
import { ymd } from '@/lib/compliance/rules-core'
import { logAudit } from '@/lib/audit'

const RULE_BOOK_PAGE_SIZE = 6
const DOCS_PAGE_SIZE = 8

const withTimeoutRules = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const withTimeoutDocs = (p, ms = 30000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtPubDate = (iso: string | null | undefined) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return '' }
}
const fmtSize = (b) => {
  const n = Number(b) || 0
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
const fmtDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  : '')

// Map a document category to a tasteful color family for its pill — grouped by
// theme rather than one hue per category (there are a dozen), so the archive
// stays scannable without clashing. Unmapped categories keep the neutral pill.
const docCatClass = (category?: string | null) => {
  switch (category) {
    case 'Governing Documents':
    case 'Rules & Policies':
      return 'doc-cat doc-cat--gov'
    case 'Financial Documents':
    case 'Bank Records & Ledgers':
      return 'doc-cat doc-cat--fin'
    case 'Insurance':
      return 'doc-cat doc-cat--ins'
    case 'Inspection Reports':
    case 'Building Permits':
      return 'doc-cat doc-cat--insp'
    default:
      return 'doc-cat'
  }
}

// File glyph drawn at the head of each archive row (scannability, matches mock v2).
const DocGlyph = () => (
  <span className="doc-ic"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></svg></span>
)

// Cloud-upload glyph for the "Drop a PDF here" setup cards.
const UploadGlyph = () => (
  <span className="docsetup-ic"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M12 13v8" /><path d="m8 17 4-4 4 4" /><path d="M20.4 14.5A4 4 0 0 0 18 7h-1.3A7 7 0 1 0 4 15.2" /></svg></span>
)

const RULE_EMPTY = { section: '', title: '', body: '', fine: '' }
// DOC_CATEGORIES + FL_REQUIRED_CATEGORIES now live in lib/compliance/official-records.ts
// (imported above) so the statutory category set has one home shared with the
// compliance signal producer.
const DOC_EMPTY: { title: string; category: DocCategory } = { title: '', category: 'Governing Documents' }

export default function AdminEasyDocs() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const t = useT()

  // Which section shows: 'rules' or 'documents'. Switched in-page (instant) by
  // the Easy Documents sub-nav; only the active section renders. Read the hash
  // once on mount so arriving from the Violations tab (#documents) lands on the
  // right section.
  const [tab, setTab] = useState<'rules' | 'documents'>('documents')
  useEffect(() => {
    const h = window.location.hash.replace(/^#/, '')
    if (h === 'rules' || h === 'documents') setTab(h)
  }, [])

  // ── Rules state ──────────────────────────────────────────────────────────
  const [ruleError, setRuleError] = useState('')
  const [ruleForm, setRuleForm] = useState(RULE_EMPTY)
  const [ruleSaving, setRuleSaving] = useState(false)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [pdfStatus, setPdfStatus] = useState<string>('')
  const pdfInputRef = useRef<HTMLInputElement | null>(null)
  const categories = useCategoriesData()
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterPeriod, setFilterPeriod] = useState<
    'all' | 'week' | 'month' | 'past-week' | 'past-month' | 'past-year'
  >('all')
  const [rulePage, setRulePage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAddRule, setShowAddRule] = useState(false)
  const [ruleSuccessMsg, setRuleSuccessMsg] = useState('')
  const { rules: rows, addRule: insertRule, removeRule: deleteRule, deleteAll, restoreDemo } = useRulesAdmin()
  const ruleStatus = 'ready' as const

  useEffect(() => {
    if (!ruleSuccessMsg) return
    const id = setTimeout(() => setRuleSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [ruleSuccessMsg])

  const setRuleField = (k, v) => setRuleForm(f => ({ ...f, [k]: v }))

  const addRule = async (e) => {
    e.preventDefault()
    if (!ruleForm.title.trim()) { setRuleError('Give the rule a title'); return }
    setRuleSaving(true); setRuleError('')
    try {
      // Default to "General" so a rule with no section still slots into a
      // visible category on the resident rule book (never orphaned).
      const section = ruleForm.section.trim() || 'General'
      const title = ruleForm.title.trim()
      const newCategoryCreated = section && !categories.includes(section)
      if (newCategoryCreated) addStoredCategory(section!)
      await insertRule({
        section, title,
        body: ruleForm.body.trim() || null,
        fine: ruleForm.fine === '' ? null : Number(ruleForm.fine),
        sort_order: rows.length,
      })

      // Tell residents a new rule was added. Same broadcast path as a library
      // upload: one ev_notices insert + the ev_notice_fanout DB trigger delivers
      // a recipient row per resident (honouring channel prefs). Fires only on
      // this explicit single-rule add — never the bulk "restore samples" seed —
      // so onboarding doesn't blast the whole community. Best-effort: the rule
      // is already saved, so a notice failure must not read as an add error.
      try {
        await withTimeoutDocs(
          supabase.from('ev_notices').insert({
            community_id: communityId,
            kind: 'rule_published',
            channels: DEFAULT_CHANNELS,
            subject: `New rule: ${title}`,
            body: `A new rule was added to your community rule book${section ? ` under ${section}` : ''}.`,
          })
        )
      } catch { /* notice is best-effort; the rule add already succeeded */ }

      setRuleForm(RULE_EMPTY)
      setShowAddRule(false)
      setRuleSuccessMsg(
        newCategoryCreated
          ? `Added "${title}" — "${section}" is now a category too.`
          : `Added "${title}" to the rule book.`
      )
    } catch (err) {
      setRuleError((err as any)?.message || 'Could not add the rule')
    } finally {
      setRuleSaving(false)
    }
  }

  const onPickPdf = (e: ChangeEvent<HTMLInputElement>) => {
    setPdfFile(e.target.files?.[0] || null)
    setPdfStatus('')
  }
  const importPdf = () => {
    if (!pdfFile) return
    setPdfStatus(`Received ${pdfFile.name} — PDF parsing isn't wired yet, but the file is ready.`)
  }

  const removeRule = async (id) => {
    try {
      await deleteRule(id)
    } catch (err) {
      setRuleError((err as any)?.message || 'Could not remove the rule')
    }
  }

  // ── Documents state ──────────────────────────────────────────────────────
  const [docRows, setDocRows] = useState([])
  const [docStatus, setDocStatus] = useState('loading')
  const [docError, setDocError] = useState('')
  const [docForm, setDocForm] = useState(DOC_EMPTY)
  const [docFile, setDocFile] = useState(null)
  const [docSaving, setDocSaving] = useState(false)
  const [docSuccessMsg, setDocSuccessMsg] = useState('')
  const [docPage, setDocPage] = useState(1)
  const [docCatFilter, setDocCatFilter] = useState<string>('all')
  const [showUpload, setShowUpload] = useState(false)
  const docFileRef = useRef(null)
  const govFileRef = useRef<HTMLInputElement | null>(null)
  const bulkFileRef = useRef<HTMLInputElement | null>(null)
  // Official-records compliance: community (for posting scope) + records-inspection requests.
  const [community, setCommunity] = useState<any>(null)
  const [recRequests, setRecRequests] = useState<any[]>([])

  useEffect(() => {
    if (!docSuccessMsg) return
    const id = setTimeout(() => setDocSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [docSuccessMsg])

  const loadDocs = useCallback(async () => {
    if (!hasSupabase || !communityId) { setDocStatus('none'); return }
    setDocStatus('loading'); setDocError('')
    try {
      const { data, error } = await withTimeoutDocs(
        supabase.from('documents').select('*')
          .eq('community_id', communityId)
          .order('uploaded_at', { ascending: false })
      )
      if (error) throw error
      setDocRows(data || [])
      // Best-effort: community (posting scope) + records-inspection requests.
      // A missing migration just leaves these empty — the archive still renders.
      try {
        const { data: c } = await withTimeoutDocs(
          supabase.from('communities').select('*').eq('id', communityId).single()
        )
        setCommunity(c || null)
      } catch { /* keep community null */ }
      try {
        const { data: rr } = await withTimeoutDocs(
          supabase.from('resident_requests').select('*')
            .eq('community_id', communityId).eq('category', 'records')
            .order('created_at', { ascending: false })
        )
        setRecRequests(rr || [])
      } catch { /* records-requests are optional */ }
      setDocStatus('ready')
    } catch (err) {
      const msg = err?.message || ''
      if (/schema cache|does not exist|find the table/i.test(msg)) {
        setDocStatus('none')
      } else {
        setDocError(msg || 'Could not load documents')
        setDocStatus('error')
      }
    }
  }, [communityId])

  useEffect(() => { loadDocs() }, [loadDocs])

  const setDocField = (k, v) => setDocForm(f => ({ ...f, [k]: v }))

  const uploadDoc = async (e) => {
    e.preventDefault()
    if (!docFile) { setDocError('Choose a file to upload'); return }
    if (!docForm.title.trim()) { setDocError('Give the document a title'); return }
    setDocSaving(true); setDocError('')
    try {
      const ext = docFile.name.includes('.') ? docFile.name.split('.').pop().toLowerCase() : 'bin'
      const path = `${communityId}/${crypto.randomUUID()}.${ext}`
      const up = await withTimeoutDocs(supabase.storage.from('documents').upload(path, docFile))
      if (up.error) throw up.error
      const row = {
        community_id: communityId,
        title: docForm.title.trim(),
        category: docForm.category,
        storage_path: path,
        file_size: docFile.size,
      }
      const { data, error } = await withTimeoutDocs(
        supabase.from('documents').insert(row).select().single()
      )
      if (error) {
        supabase.storage.from('documents').remove([path])
        throw error
      }
      setDocRows(rs => [data, ...rs])
      setDocForm(DOC_EMPTY)
      setDocFile(null)
      if (docFileRef.current) docFileRef.current.value = ''
      setShowUpload(false)
      setDocSuccessMsg(`Uploaded "${row.title}".`)

      // Tell residents a new library document is available. Uploads through the
      // Voice tab already fire a 'document_uploaded' notice; the main Documents
      // library was the one upload path that stayed silent. The ev_notice_fanout
      // DB trigger materialises one recipient row per resident (honouring their
      // channel prefs), so the bell + email work with just this insert.
      // Best-effort: the document is already saved, so a notice failure must
      // not surface to the board as an upload error.
      try {
        await withTimeoutDocs(
          supabase.from('ev_notices').insert({
            community_id: communityId,
            kind: 'document_uploaded',
            channels: DEFAULT_CHANNELS,
            subject: `New document: ${row.title}`,
            body: `A new document was added to your community library${row.category ? ` under ${row.category}` : ''}.`,
          })
        )
      } catch { /* notice is best-effort; the document upload already succeeded */ }
    } catch (err) {
      setDocError(err?.message || 'Upload failed')
    } finally {
      setDocSaving(false)
    }
  }

  const removeDoc = async (doc) => {
    const prev = docRows
    setDocRows(rs => rs.filter(r => r.id !== doc.id))
    try {
      await withTimeoutDocs(supabase.storage.from('documents').remove([doc.storage_path]))
      const { error } = await withTimeoutDocs(supabase.from('documents').delete().eq('id', doc.id))
      if (error) throw error
      setDocSuccessMsg(`Removed "${doc.title}".`)
    } catch (err) {
      setDocRows(prev)
      setDocError(err?.message || 'Could not remove that document')
    }
  }

  // Open a stored document in a new tab via a short-lived signed URL (the mock's
  // "Open →"). Read-only; the bucket is private so we never expose a raw path.
  const openDoc = async (doc: any) => {
    try {
      const { data, error } = await withTimeoutDocs(
        supabase.storage.from('documents').createSignedUrl(doc.storage_path, 60)
      )
      if (error) throw error
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
    } catch (err: any) {
      setDocError(err?.message || 'Could not open that document')
    }
  }

  // "Set up from your governing docs" — pick a PDF and file it under Governing
  // Documents immediately. Same upload path as the form; auto-extraction into
  // rules/fines is a later slice (the extract-setup edge fn), noted in the card.
  const onPickGoverningDoc = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (e.target) e.target.value = ''
    if (!file) return
    setDocSaving(true); setDocError('')
    try {
      const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'pdf'
      const path = `${communityId}/${crypto.randomUUID()}.${ext}`
      const up = await withTimeoutDocs(supabase.storage.from('documents').upload(path, file))
      if ((up as any).error) throw (up as any).error
      const title = file.name.replace(/\.[^.]+$/, '')
      const { data, error } = await withTimeoutDocs(
        supabase.from('documents').insert({
          community_id: communityId, title,
          category: 'Governing Documents', storage_path: path, file_size: file.size,
        }).select().single()
      )
      if (error) { supabase.storage.from('documents').remove([path]); throw error }
      setDocRows((rs: any[]) => [data, ...rs])
      setDocSuccessMsg(`Filed "${title}" under Governing Documents.`)
    } catch (err: any) {
      setDocError(err?.message || 'Could not upload that file')
    } finally { setDocSaving(false) }
  }

  // Bulk upload — pick many files at once and file each one. Category defaults to
  // the active filter (if a specific one is picked) so "filter to Minutes → bulk
  // upload" tags them all; otherwise Governing Documents. Failures skip, not abort.
  const onBulkUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (e.target) e.target.value = ''
    if (!files.length) return
    const category = (docCatFilter !== 'all' ? docCatFilter : 'Governing Documents') as DocCategory
    setDocSaving(true); setDocError('')
    let ok = 0
    try {
      for (const file of files) {
        try {
          const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
          const path = `${communityId}/${crypto.randomUUID()}.${ext}`
          const up = await withTimeoutDocs(supabase.storage.from('documents').upload(path, file))
          if ((up as any).error) throw (up as any).error
          const { data, error } = await withTimeoutDocs(
            supabase.from('documents').insert({
              community_id: communityId, title: file.name.replace(/\.[^.]+$/, ''),
              category, storage_path: path, file_size: file.size,
            }).select().single()
          )
          if (error) { supabase.storage.from('documents').remove([path]); throw error }
          setDocRows((rs: any[]) => [data, ...rs])
          ok++
        } catch { /* skip this file, keep going */ }
      }
      if (ok) setDocSuccessMsg(`Uploaded ${ok} document${ok === 1 ? '' : 's'} to ${category}.`)
      if (ok < files.length) setDocError(`${files.length - ok} file${files.length - ok === 1 ? '' : 's'} failed to upload.`)
    } finally { setDocSaving(false) }
  }

  // Mark a document posted / unposted to the portal (drives the 30-day signal).
  const togglePosted = async (doc: any) => {
    const next = !doc.posted_to_portal
    setDocRows((rs: any[]) => rs.map(r => r.id === doc.id ? { ...r, posted_to_portal: next, posted_at: next ? new Date().toISOString() : null } : r))
    try {
      const { error } = await withTimeoutDocs(
        supabase.from('documents').update({ posted_to_portal: next, posted_at: next ? new Date().toISOString() : null }).eq('id', doc.id)
      )
      if (error) throw error
      if (next && communityId) logAudit({ community_id: communityId, event_type: 'records.document_posted', target_type: 'document', target_id: doc.id })
    } catch (err: any) {
      setDocError(err?.message || 'Could not update posting status (run supabase/official-records.sql?)')
      loadDocs()
    }
  }

  // Patch a document row (used by the HOA recorded-amendment distribution
  // control — drives the 30-day FS 720.306(1)(b) signal). Optimistic.
  const patchDoc = async (id: string, patch: Record<string, any>) => {
    setDocRows((rs: any[]) => rs.map(r => r.id === id ? { ...r, ...patch } : r))
    try {
      const { error } = await withTimeoutDocs(supabase.from('documents').update(patch).eq('id', id))
      if (error) throw error
    } catch (err: any) {
      setDocError(err?.message || 'Could not update the amendment (run supabase/compliance-slice2.sql?)')
      loadDocs()
    }
  }

  // Mark a records-inspection request answered — stamps responded_at (the DB
  // trigger then notifies the resident) and resolves it.
  const respondToRequest = async (req: any) => {
    try {
      const { error } = await withTimeoutDocs(
        supabase.from('resident_requests').update({ responded_at: new Date().toISOString(), status: 'resolved' }).eq('id', req.id)
      )
      if (error) throw error
      if (communityId) logAudit({ community_id: communityId, event_type: 'records.request_responded', target_type: 'records_request', target_id: req.id })
      setRecRequests((rs: any[]) => rs.map(r => r.id === req.id ? { ...r, responded_at: new Date().toISOString(), status: 'resolved' } : r))
      setDocSuccessMsg('Records request marked answered.')
    } catch (err: any) {
      setDocError(err?.message || 'Could not update the request')
    }
  }

  const recordsApplies = postingApplies(community)
  const isHoa = community?.association_type === 'hoa'
  const openRecRequests = recRequests.filter(r => r.status !== 'resolved' && r.status !== 'cancelled')

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="easydocs-combined">
      <EasyDocsTabs active={tab} onSelect={setTab} />

      {/* ════════════════════════════════════════════════════════════════
          RULES SECTION
      ════════════════════════════════════════════════════════════════ */}
      {tab === 'rules' && (
      <section id="easydocs-rules" style={{ scrollMarginTop: 56 }}>
        <div className="admin-page cset">
          <div className="admin-kicker">{t('admin.documents.rulesKicker')}</div>
          <h1 className="admin-h1">{t('admin.documents.ruleBookTitle')}</h1>
          <p className="admin-dek" style={{ maxWidth: 560 }}>
            {t('admin.documents.ruleBookDek')}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', margin: '6px 0 8px' }}>
            <button type="button" className="admin-btn-ghost"
              onClick={async () => {
                try { await restoreDemo(); setRuleSuccessMsg('Starter rules added.') }
                catch (err) { setRuleError((err as any)?.message || 'Could not restore samples') }
              }}>
              {t('admin.documents.restoreSamples')}
            </button>
            <button type="button" className="admin-rules-danger"
              onClick={async () => {
                if (window.confirm('Delete every rule? You can restore the samples afterward.')) {
                  try { await deleteAll(); setRuleSuccessMsg('All rules deleted.') }
                  catch (err) { setRuleError((err as any)?.message || 'Could not delete rules') }
                }
              }}>
              {t('admin.documents.deleteAll')}
            </button>
            <button type="button" className="admin-primary-btn" onClick={() => setShowAddRule(true)}>{t('admin.documents.addRuleBtn')}</button>
          </div>

          {ruleSuccessMsg && (
            <div className="admin-success" role="status">
              <span className="admin-success-check" aria-hidden="true">✓</span>
              {ruleSuccessMsg}
            </div>
          )}

          {/* Set up from a rule book PDF — same governing-docs intake pattern. */}
          <div className="card lever">
            <div className="card-head">
              <div>
                <h2>{t('admin.documents.ruleBookPdfTitle')}</h2>
                <div className="sub">{t('admin.documents.ruleBookPdfSub')}</div>
              </div>
              <span className="doc-badge">{t('admin.documents.setsItselfUp')}</span>
            </div>
            <div className="docsetup" onClick={() => pdfInputRef.current?.click()}>
              <UploadGlyph />
              <div className="docsetup-title">{t('admin.documents.dropPdfHere')}</div>
              <div className="docsetup-sub">{t('admin.documents.ruleBookPdfTypes')}</div>
            </div>
            {pdfFile && <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-dim)' }}>{pdfFile.name}</div>}
            {pdfStatus && <div className="admin-note" style={{ marginTop: 10 }}>{pdfStatus}</div>}
            <div className="docsetup-actions">
              <input name="rule-book-pdf" ref={pdfInputRef} type="file" accept="application/pdf"
                onChange={onPickPdf} style={{ display: 'none' }} />
              <span className="docsetup-hint">{t('admin.documents.pdfFoundHint')}</span>
              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="admin-secondary-btn" onClick={() => pdfInputRef.current?.click()}>
                  {pdfFile ? t('admin.documents.pickAnother') : t('admin.documents.chooseFile')}
                </button>
                <button type="button" className="admin-primary-btn" onClick={importPdf} disabled={!pdfFile}>{t('admin.documents.importBtn')}</button>
              </div>
            </div>
          </div>

          {/* Rule book — numbered clean rows (matches mock). */}
          <div className="card">
            <div className="card-head">
              <div>
                <h2>{t('admin.documents.ruleBookCardTitle')}</h2>
                <div className="sub">{t('admin.documents.publishedToResidents')} · {rows.length} {rows.length === 1 ? t('admin.documents.ruleOne') : t('admin.documents.ruleMany')}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 160 }}>
                  <Dropdown<string>
                    value={filterCategory}
                    onChange={setFilterCategory}
                    ariaLabel={t('admin.documents.filterByCategoryAriaLabel')}
                    options={[
                      { value: 'all', label: `${t('admin.documents.allSections')} (${rows.length})` },
                      ...categories.map(c => ({
                        value: c,
                        label: `${c} (${rows.filter((r: any) => (r.section || '') === c).length})`,
                      })),
                    ]}
                  />
                </div>
                <div style={{ minWidth: 140 }}>
                  <Dropdown<typeof filterPeriod>
                    value={filterPeriod}
                    onChange={setFilterPeriod}
                    ariaLabel={t('admin.documents.filterByPeriodAriaLabel')}
                    options={[
                      { value: 'all',        label: t('admin.documents.periodAll') },
                      { value: 'week',       label: t('admin.documents.periodWeek') },
                      { value: 'month',      label: t('admin.documents.periodMonth') },
                      { value: 'past-week',  label: t('admin.documents.periodPastWeek') },
                      { value: 'past-month', label: t('admin.documents.periodPastMonth') },
                      { value: 'past-year',  label: t('admin.documents.periodPastYear') },
                    ]}
                  />
                </div>
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="bc-empty" style={{ margin: 0 }}>{t('admin.documents.noRulesYet')}</div>
            ) : (() => {
              const filtered = rows.filter((r: any) => {
                if (filterCategory !== 'all' && (r.section || '') !== filterCategory) return false
                if (filterPeriod === 'all') return true
                const added = r.created_at ? new Date(r.created_at) : null
                if (!added) return false
                const today = new Date()
                const dayMs = 24 * 60 * 60 * 1000
                const weekStart = new Date(today); weekStart.setDate(today.getDate() - today.getDay())
                const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
                const past7   = new Date(today.getTime() -   7 * dayMs)
                const past30  = new Date(today.getTime() -  30 * dayMs)
                const past365 = new Date(today.getTime() - 365 * dayMs)
                switch (filterPeriod) {
                  case 'week':       return added >= weekStart
                  case 'month':      return added >= monthStart
                  case 'past-week':  return added >= past7
                  case 'past-month': return added >= past30
                  case 'past-year':  return added >= past365
                }
              })
              if (filtered.length === 0) return <div className="bc-empty" style={{ margin: 0 }}>{t('admin.documents.noRulesFilter')}</div>
              const visible = paginate(filtered, rulePage, RULE_BOOK_PAGE_SIZE)
              const startIdx = (rulePage - 1) * RULE_BOOK_PAGE_SIZE
              return (
                <>
                  <div className="rulelist">
                    {visible.map((r: any, i: number) => {
                      const open = expandedId === r.id
                      return (
                        <div className="rulerow" key={r.id}>
                          <span className="rulenum">{startIdx + i + 1}</span>
                          <div className="rulemain">
                            <div className="ruletitle">{r.title}</div>
                            <div className="rulemeta">
                              {r.section ? `${r.section} · ` : ''}{r.body ? r.body.slice(0, 80) + (r.body.length > 80 ? '…' : '') : `${t('admin.documents.publishedLabel')} ${fmtPubDate(r.created_at) || '—'}`}
                            </div>
                            {open && (
                              <div className="rule-detail">
                                {r.body ? <p style={{ margin: '0 0 8px' }}>{r.body}</p> : <p style={{ margin: '0 0 8px', opacity: 0.7 }}>{t('admin.documents.noRuleDetail')}</p>}
                                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
                                  <span><strong>{t('admin.documents.sectionLabel')}:</strong> {r.section || t('admin.documents.unsectioned')}</span>
                                  <span><strong>{t('admin.documents.publishedLabel')}:</strong> {fmtPubDate(r.created_at) || t('admin.documents.unknownDate')}</span>
                                  {r.fine != null && Number(r.fine) > 0 && <span><strong>{t('admin.documents.fineLabel')}:</strong> {fmtMoney(r.fine)}</span>}
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="ruleactions">
                            {r.fine != null && Number(r.fine) > 0 && <div className="bd-amount">{fmtMoney(r.fine)}</div>}
                            <button type="button" className="rule-edit" onClick={() => setExpandedId(open ? null : r.id)} aria-expanded={open}>
                              {open ? t('admin.documents.closeBtn') : t('admin.documents.editBtn')} →
                            </button>
                            <button type="button" className="vdel" onClick={() => removeRule(r.id)} aria-label={t('admin.documents.removeRuleAriaLabel')}>&times;</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <Pagination page={rulePage} pageSize={RULE_BOOK_PAGE_SIZE}
                    total={filtered.length} onPageChange={setRulePage} />
                </>
              )
            })()}
          </div>

          {/* Add-rule popup — opens over the page from "+ Add rule". */}
          {showAddRule && (
            <AdminModal title={t('admin.documents.addRuleModalTitle')}
              sub={t('admin.documents.addRuleModalSub')}
              onClose={() => setShowAddRule(false)}>
              <form className="admin-form" onSubmit={addRule}>
                <div className="admin-field">
                  <span className="admin-field-label">{t('admin.documents.sectionFieldLabel')}</span>
                  <Dropdown<string>
                    value={ruleForm.section}
                    onChange={v => setRuleField('section', v)}
                    ariaLabel={t('admin.documents.ruleSectionAriaLabel')}
                    placeholder={t('admin.documents.chooseSectionPlaceholder')}
                    searchable
                    onCreate={name => {
                      addStoredCategory(name)
                      setRuleField('section', name)
                      setRuleSuccessMsg(`Added "${name}" as a category.`)
                    }}
                    onDelete={name => {
                      const isBuiltIn = (RULE_CATEGORIES as readonly string[]).includes(name)
                      if (isBuiltIn) hideBuiltInCategory(name)
                      else removeStoredCategory(name)
                      if (ruleForm.section === name) setRuleField('section', '')
                      setRuleSuccessMsg(`Removed "${name}" category.`)
                    }}
                    options={categories.map(c => ({ value: c, label: c }))}
                  />
                  <span className="admin-field-hint">{t('admin.documents.sectionFieldHint')}</span>
                </div>
                <label className="admin-field">
                  <span className="admin-field-label">{t('admin.documents.ruleFieldLabel')}</span>
                  <input name="title" className="admin-input" placeholder={t('admin.documents.ruleFieldPlaceholder')}
                    value={ruleForm.title} onChange={e => setRuleField('title', e.target.value)} />
                </label>
                <label className="admin-field">
                  <span className="admin-field-label">{t('admin.documents.detailFieldLabel')}</span>
                  <textarea name="body" className="admin-input admin-textarea" rows={3}
                    placeholder={t('admin.documents.detailFieldPlaceholder')}
                    value={ruleForm.body} onChange={e => setRuleField('body', e.target.value)} />
                </label>
                <label className="admin-field" style={{ maxWidth: 200 }}>
                  <span className="admin-field-label">{t('admin.documents.fineFieldLabel')}</span>
                  <input name="fine" className="admin-input" type="number" placeholder="50"
                    value={ruleForm.fine} onChange={e => setRuleField('fine', e.target.value)} />
                </label>
                <div className="admin-form-actions">
                  <button type="submit" className="admin-primary-btn" disabled={ruleSaving}>
                    {ruleSaving ? t('admin.documents.addingBtn') : t('admin.documents.addRuleSubmitBtn')}
                  </button>
                  {ruleError && <span className="admin-err-inline">{ruleError}</span>}
                </div>
              </form>
            </AdminModal>
          )}
        </div>
      </section>
      )}

      {/* ════════════════════════════════════════════════════════════════
          DOCUMENTS SECTION
      ════════════════════════════════════════════════════════════════ */}
      {tab === 'documents' && (
      <section id="easydocs-documents" style={{ scrollMarginTop: 56 }}>
        <div className="admin-page cset">
          <div className="admin-kicker">{t('admin.documents.documentsKicker')}</div>
          <h1 className="admin-h1">{t('admin.documents.documentArchiveTitle')}</h1>
          <p className="admin-dek" style={{ maxWidth: 560 }}>
            {t('admin.documents.documentArchiveDek')}
          </p>
          {docStatus === 'ready' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', margin: '6px 0 8px' }}>
              <input ref={bulkFileRef} type="file" multiple onChange={onBulkUpload} style={{ display: 'none' }} />
              <button type="button" className="admin-secondary-btn" disabled={docSaving}
                onClick={() => bulkFileRef.current?.click()}>
                {docSaving ? t('admin.documents.uploadingBtn') : t('admin.documents.bulkUploadBtn')}
              </button>
              <button type="button" className="admin-primary-btn" onClick={() => setShowUpload(s => !s)}>
                {showUpload ? t('admin.documents.closeBtn') : t('admin.documents.addDocumentBtn')}
              </button>
            </div>
          )}

          {docStatus === 'none' && (
            <div className="admin-note admin-note-warn">
              {t('admin.documents.noCommunityNote')}
            </div>
          )}
          {docStatus === 'error' && (
            <div className="admin-note admin-note-err">
              {docError}
              <button type="button" className="admin-btn-ghost" onClick={loadDocs}>{t('admin.documents.retryBtn')}</button>
            </div>
          )}

          {docSuccessMsg && (
            <div className="admin-success" role="status">
              <span className="admin-success-check" aria-hidden="true">✓</span>
              {docSuccessMsg}
            </div>
          )}

          <SetupNotesPanel communityId={communityId} />

          {docStatus === 'loading' && <div className="admin-note">{t('admin.documents.loadingMsg')}</div>}
          {docStatus === 'ready' && (
            <>
              {/* Set up from your governing docs — drop a PDF, file it, pre-fill rules. */}
              <div className="card lever">
                <div className="card-head">
                  <div>
                    <h2>{t('admin.documents.govDocsTitle')}</h2>
                    <div className="sub">{t('admin.documents.govDocsSub')}</div>
                  </div>
                  <span className="doc-badge">{t('admin.documents.setsItselfUp')}</span>
                </div>
                <div className="docsetup" onClick={() => { if (!docSaving) govFileRef.current?.click() }}>
                  <UploadGlyph />
                  <div className="docsetup-title">{t('admin.documents.dropPdfHere')}</div>
                  <div className="docsetup-sub">{t('admin.documents.govDocsPdfTypes')}</div>
                </div>
                <div className="docsetup-actions">
                  <input ref={govFileRef} type="file" accept="application/pdf"
                    onChange={onPickGoverningDoc} style={{ display: 'none' }} />
                  <span className="docsetup-hint">{t('admin.documents.pdfFoundHint')}</span>
                  <button type="button" className="admin-primary-btn" disabled={docSaving}
                    onClick={() => govFileRef.current?.click()}>
                    {docSaving ? t('admin.documents.uploadingBtn') : t('admin.documents.chooseFile')}
                  </button>
                </div>
              </div>

              {/* Add-a-document popup — opens over the page from the header button. */}
              {showUpload && (
                <AdminModal title={t('admin.documents.addDocModalTitle')}
                  sub={t('admin.documents.addDocModalSub')}
                  onClose={() => setShowUpload(false)}>
                  <form className="admin-form" onSubmit={uploadDoc}>
                    <label className="admin-field">
                      <span className="admin-field-label">{t('admin.documents.titleFieldLabel')}</span>
                      <input name="title" className="admin-input" placeholder={t('admin.documents.titleFieldPlaceholder')}
                        value={docForm.title} onChange={e => setDocField('title', e.target.value)} />
                    </label>
                    <div className="admin-field" style={{ maxWidth: 240 }}>
                      <span className="admin-field-label">{t('admin.documents.categoryFieldLabel')}</span>
                      <Dropdown
                        value={docForm.category}
                        onChange={v => setDocField('category', v)}
                        ariaLabel={t('admin.documents.docCategoryAriaLabel')}
                        options={[...DOC_CATEGORIES].map(c => ({ value: c, label: c }))}
                      />
                    </div>
                    <label className="admin-field">
                      <span className="admin-field-label">{t('admin.documents.fileFieldLabel')}</span>
                      <input name="document" ref={docFileRef} type="file" className="admin-file"
                        onChange={e => setDocFile(e.target.files?.[0] || null)} />
                    </label>
                    <div className="admin-form-actions">
                      <button type="submit" className="admin-primary-btn" disabled={docSaving}>
                        {docSaving ? t('admin.documents.uploadingBtn') : t('admin.documents.uploadDocumentBtn')}
                      </button>
                      {docError && <span className="admin-err-inline">{docError}</span>}
                    </div>
                  </form>
                </AdminModal>
              )}

              {/* Florida compliance — required document types (kept from the live page). */}
              <div className="card">
                <div className="card-head"><div><h2>{t('admin.documents.floridaComplianceTitle')}</h2>
                  <div className="sub">{t('admin.documents.floridaComplianceSub')}</div></div></div>
                <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-dim)' }}>
                  {t('admin.documents.floridaComplianceDesc')}
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 }}>
                  {FL_REQUIRED_CATEGORIES.map(({ label, statute }) => {
                    const present = docRows.some(
                      (d: any) => (d.category || '').toLowerCase() === label.toLowerCase()
                    )
                    return (
                      <span
                        key={label}
                        title={`FL §${statute}`}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '7px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600,
                          background: present ? 'rgba(125,140,92,0.14)' : 'rgba(210,80,80,0.10)',
                          color: present ? '#5d6b3f' : '#c0392b',
                          border: `1px solid ${present ? 'rgba(125,140,92,0.3)' : 'rgba(210,80,80,0.25)'}`,
                        }}
                      >
                        <span style={{
                          flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
                          display: 'grid', placeItems: 'center', fontSize: 11, lineHeight: 1,
                          color: '#fff', background: present ? '#7d8c5c' : '#c0392b',
                        }}>{present ? '✓' : '!'}</span>
                        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
                      </span>
                    )
                  })}
                </div>
                <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--text-faint)' }}>
                  <strong>{t('admin.documents.publicNoticesLabel')}</strong> {t('admin.documents.publicNoticesDesc')}
                </p>
              </div>

              {/* Archive — clean table (mock columns + preserved posting/amendment). */}
              <div className="card">
                <div className="card-head">
                  <div><h2>{t('admin.documents.archiveTitle')}</h2>
                    <div className="sub">{docRows.length} {docRows.length === 1 ? t('admin.documents.documentOne') : t('admin.documents.documentMany')}</div></div>
                  <div style={{ minWidth: 180 }}>
                    <Dropdown<string>
                      value={docCatFilter}
                      onChange={(v) => { setDocCatFilter(v); setDocPage(1) }}
                      ariaLabel={t('admin.documents.filterByDocCategoryAriaLabel')}
                      options={[
                        { value: 'all', label: `${t('admin.documents.allCategories')} (${docRows.length})` },
                        ...[...DOC_CATEGORIES].map(c => ({
                          value: c,
                          label: `${c} (${docRows.filter((d: any) => (d.category || '') === c).length})`,
                        })),
                      ]}
                    />
                  </div>
                </div>
                {(() => {
                  const filteredDocs = docRows.filter((d: any) => docCatFilter === 'all' || (d.category || '') === docCatFilter)
                  if (filteredDocs.length === 0) {
                    return <div className="bc-empty" style={{ margin: 0 }}>
                      {docRows.length === 0 ? t('admin.documents.noDocsYet') : t('admin.documents.noDocsInCategory')}
                    </div>
                  }
                  const pageRows = paginate(filteredDocs, docPage, DOCS_PAGE_SIZE)
                  return (
                    <>
                      <table className="doctbl">
                        <thead>
                          <tr>
                            <th>{t('admin.documents.colDocument')}</th><th>{t('admin.documents.colCategory')}</th><th>{t('admin.documents.colUploaded')}</th><th className="act" aria-label={t('admin.documents.colActionsAriaLabel')} />
                          </tr>
                        </thead>
                        {pageRows.map((d: any) => {
                          const hasSub = recordsApplies || isHoa
                          return (
                            <tbody key={d.id}>
                              <tr>
                                <td>
                                  <div className="doc-cell">
                                    <DocGlyph />
                                    <div>
                                      <div className="doc-name">{d.title}</div>
                                      {(fmtSize(d.file_size) || recordsApplies) && (
                                        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 2 }}>
                                          {fmtSize(d.file_size)}
                                          {fmtSize(d.file_size) && recordsApplies && ' · '}
                                          {recordsApplies && (
                                            <span style={{ color: d.posted_to_portal ? '#067647' : '#B54708', fontWeight: 600 }}>
                                              {d.posted_to_portal ? t('admin.documents.postedToPortal') : t('admin.documents.notPosted')}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td>{d.category ? <span className={docCatClass(d.category)}>{d.category}</span> : <span className="muted">—</span>}</td>
                                <td className="muted">{fmtDate(d.uploaded_at)}</td>
                                <td className="act">
                                  <button type="button" className="doc-open" onClick={() => openDoc(d)}>{t('admin.documents.openDocBtn')}</button>
                                  <button type="button" className="vdel" onClick={() => removeDoc(d)} aria-label={t('admin.documents.removeDocAriaLabel')}>&times;</button>
                                </td>
                              </tr>
                              {hasSub && (
                                <tr className="doc-subrow">
                                  <td colSpan={4}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                                      {recordsApplies && (
                                        <button type="button" className="admin-btn-ghost" style={{ fontSize: 12 }}
                                          onClick={() => togglePosted(d)}>
                                          {d.posted_to_portal ? t('admin.documents.markUnpostedBtn') : t('admin.documents.markPostedBtn')}
                                        </button>
                                      )}
                                      {isHoa && <AmendmentControl doc={d} onPatch={patchDoc} />}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          )
                        })}
                      </table>
                      <Pagination page={docPage} pageSize={DOCS_PAGE_SIZE}
                        total={filteredDocs.length} onPageChange={setDocPage} />
                    </>
                  )
                })()}
              </div>

              {/* Records-inspection requests (FS 718.111(12)(c) / 720.303(5)). */}
              <div id="records-requests" className="card" style={{ scrollMarginTop: 56 }}>
                <div className="card-head">
                  <div>
                    <h2>{t('admin.documents.recordsRequestsTitle')}</h2>
                    <div className="sub">
                      {openRecRequests.length} {t('admin.documents.openRequests')} · {t('admin.documents.statutoryDeadline', { dayType: community?.association_type === 'hoa' ? t('admin.documents.businessDay') : t('admin.documents.workingDay') })}
                    </div>
                  </div>
                  <a href="/admin/documents/records-print?type=manifest" target="_blank" rel="noreferrer" className="admin-btn-ghost" style={{ textDecoration: 'none' }}>📄 {t('admin.documents.recordsIndexLink')}</a>
                </div>
                {recRequests.length === 0 ? (
                  <div className="bc-empty" style={{ margin: 0 }}>{t('admin.documents.noRecordsRequests')}</div>
                ) : (
                  <div className="bd-list">
                    {recRequests.map(r => {
                      const due = r.due_at ? new Date(r.due_at) : recordsInspectionDueAt(r.created_at)
                      const answered = !!r.responded_at
                      const overdue = !answered && due && due.getTime() < Date.now()
                      return (
                        <div className="bd-row" key={r.id} style={overdue ? { borderLeft: '4px solid #B42318' } : undefined}>
                          <div className="bd-main">
                            <div className="bd-title">{r.subject || t('admin.documents.recordsRequestFallback')}</div>
                            <div className="bd-meta">
                              {r.submitter_name && <><span>{r.submitter_name}</span><span className="bd-dot">·</span></>}
                              <span>{t('admin.documents.requestedOn')} {fmtDate(r.created_at)}</span>
                              {due && <><span className="bd-dot">·</span>
                                <span style={{ color: answered ? '#067647' : overdue ? '#B42318' : '#475467', fontWeight: 600 }}>
                                  {answered ? `${t('admin.documents.answeredOn')} ${fmtDate(r.responded_at)}` : `${t('admin.documents.dueOn')} ${ymd(due)}`}
                                </span></>}
                            </div>
                            {r.body && <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>{r.body}</div>}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                            {!answered && (
                              <button type="button" className="admin-primary-btn" onClick={() => respondToRequest(r)}>
                                {t('admin.documents.markAnsweredBtn')}
                              </button>
                            )}
                            <a href={`/admin/documents/records-print?type=acknowledgement&request=${r.id}`} target="_blank" rel="noreferrer" className="doc-card-link" style={{ fontSize: 12 }}>{t('admin.documents.acknowledgementLink')}</a>
                            <a href={`/admin/documents/records-print?type=checklist&request=${r.id}`} target="_blank" rel="noreferrer" className="doc-card-link" style={{ fontSize: 12 }}>{t('admin.documents.checklistLink')}</a>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </section>
      )}
    </div>
  )
}

// HOA recorded-amendment distribution control (FS 720.306(1)(b)). Lets the board
// flag a document as a recorded governing-document amendment and record the
// recording + member-distribution dates that drive the 30-day advisory signal.
// Rendered below each archive row for HOA communities only.
function AmendmentControl({ doc, onPatch }: { doc: any; onPatch: (id: string, patch: Record<string, any>) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const isAmend = !!doc.is_amendment
  const recorded = doc.amendment_recorded_at || null
  const distributed = doc.members_distributed_at || null
  const due = recorded ? amendmentDistributionDue(recorded) : null
  const overdue = !!due && !distributed && due.getTime() < Date.now()

  if (!open) {
    if (!isAmend) {
      return (
        <button type="button" className="admin-btn-ghost" style={{ fontSize: 12, marginTop: 2 }} onClick={() => setOpen(true)}
          title={t('admin.documents.recordedAmendmentTitle')}>
          ⚖ {t('admin.documents.recordedAmendmentBtn')}
        </button>
      )
    }
    const label = distributed ? `⚖ ${t('admin.documents.amendmentDistributed')}` : overdue ? `⚖ ${t('admin.documents.amendmentDistributeNow')}` : `⚖ ${t('admin.documents.amendmentPending')}`
    const col = distributed ? '#067647' : overdue ? '#B42318' : '#B54708'
    return (
      <button type="button" className="admin-btn-ghost" style={{ fontSize: 12, marginTop: 2, color: col, fontWeight: 600 }} onClick={() => setOpen(true)}>
        {label}
      </button>
    )
  }

  return (
    <div style={{ border: '1px dashed #cbd5e1', borderRadius: 10, padding: '10px 12px', marginTop: 4, background: '#fafafa' }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={isAmend} onChange={e => onPatch(doc.id, { is_amendment: e.target.checked })} />
        {t('admin.documents.recordedAmendmentCheckbox')}
      </label>
      {isAmend && (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11.5 }}>
              <span style={{ opacity: 0.7 }}>{t('admin.documents.recordedOnLabel')}{due ? ` (${t('admin.documents.distributeByLabel')} ${ymd(due)})` : ''}</span>
              <input className="admin-input" style={{ maxWidth: 170 }} type="date" defaultValue={recorded ?? ''}
                onChange={e => onPatch(doc.id, { amendment_recorded_at: e.target.value || null })} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 11.5 }}>
              <span style={{ opacity: 0.7 }}>{t('admin.documents.membersServedOnLabel')}</span>
              <input className="admin-input" style={{ maxWidth: 170 }} type="date" defaultValue={distributed ?? ''}
                onChange={e => onPatch(doc.id, { members_distributed_at: e.target.value || null })} />
            </label>
          </div>
          <p style={{ fontSize: 11.5, opacity: 0.7, margin: '6px 0 0' }}>
            {t('admin.documents.amendmentDistributionNote', { days: AMENDMENT_DISTRIBUTION_DAYS.value })}
          </p>
        </>
      )}
      <button type="button" className="admin-btn-ghost" style={{ fontSize: 12, marginTop: 8 }} onClick={() => setOpen(false)}>{t('admin.documents.closeBtn')}</button>
    </div>
  )
}

// Read-only panel for the notes the board typed in the /signup document wizard.
// Renders nothing unless there are notes, so it's invisible for communities that
// skipped them. Board-only by RLS (community_setup_notes); a later AI slice will
// consume the same rows to pre-fill settings — here they're just shown back.
type SetupNote = { id: string; section: string; note: string; created_at?: string | null }

function SetupNotesPanel({ communityId }: { communityId?: string | null }) {
  const t = useT()
  const [notes, setNotes] = useState<SetupNote[]>([])

  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    let active = true
    ;(async () => {
      try {
        const { data, error } = await supabase
          .from('community_setup_notes')
          .select('id, section, note, created_at')
          .eq('community_id', communityId)
          .order('created_at', { ascending: true })
        if (!active || error || !data) return
        setNotes(data as SetupNote[])
      } catch { /* table may not exist yet — stay hidden */ }
    })()
    return () => { active = false }
  }, [communityId])

  if (!notes.length) return null

  return (
    <div className="admin-note admin-note-info" style={{ marginBottom: 24 }}>
      <strong>{t('admin.documents.onboardingNotesTitle')}</strong>
      <p style={{ margin: '8px 0 12px', fontSize: 13, opacity: 0.85 }}>
        {t('admin.documents.onboardingNotesDesc')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {notes.map((n) => (
          <div key={n.id} style={{
            padding: '10px 12px', borderRadius: 10,
            background: 'rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.08)',
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, opacity: 0.8 }}>{n.section}</div>
            <div style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{n.note}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
