'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '@/app/providers'
import { useMyResident } from '@/hooks/useMyResident'
import {
  listHomeDocs, uploadHomeDoc, setConveys, deleteHomeDoc, homeDocUrl, logPayment,
  HOME_DOC_CATEGORIES, type HomeDoc,
} from '@/lib/homeVault'
import './home.css'

const fmtMoney = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const todayISO = () => new Date().toISOString().slice(0, 10)

export default function HomePage() {
  const { profile } = useAuth() || {}
  const { resident, balance, status, payments, monthlyDues, loading: resLoading } = useMyResident()
  const profileId = profile?.id

  const [docs, setDocs] = useState<HomeDoc[]>([])
  const [docsLoading, setDocsLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!profileId) { setDocsLoading(false); return }
    setDocsLoading(true)
    try { setDocs(await listHomeDocs(profileId)) }
    catch (e) { setErr((e as Error).message) }
    finally { setDocsLoading(false) }
  }, [profileId])
  useEffect(() => { reload() }, [reload])

  const doneCategories = new Set(docs.map(d => d.category))

  return (
    <div className="hv">
      <div className="hv-kicker">Your home</div>
      <h1 className="hv-h1">{resident?.unit_number ? `Unit ${resident.unit_number}` : 'My home'}</h1>
      <p className="hv-dek">Keep your home&apos;s records in one place, and track what you&apos;ve paid. Files you mark as conveying pass to the next owner.</p>

      {err && <div className="hv-err">{err} <button className="hv-link" onClick={() => { setErr(null); reload() }}>Retry</button></div>}

      <DuesCard
        resident={resident} balance={balance} status={status}
        payments={payments} monthlyDues={monthlyDues} loading={resLoading}
        profileId={profileId} onLogged={reload}
      />

      <DocsCard
        docs={docs} loading={docsLoading} doneCategories={doneCategories}
        resident={resident} profileId={profileId} onChange={reload} setErr={setErr}
      />
    </div>
  )
}

/* ----------------------------- dues ----------------------------- */

function DuesCard({ resident, balance, status, payments, monthlyDues, loading, profileId, onLogged }: any) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [paidOn, setPaidOn] = useState(todayISO())
  const [method, setMethod] = useState('Check')
  const [note, setNote] = useState('')
  const [proof, setProof] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const owes = typeof balance === 'number' && balance > 0
  const logged = (payments || []).filter((p: any) => !p.stripe_session_id)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resident || !profileId) return
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter an amount.'); return }
    setBusy(true); setError(null)
    try {
      await logPayment({
        residentId: resident.id, communityId: resident.community_id, profileId,
        amount: amt, paidOn, method, note, proofFile: proof,
      })
      setAmount(''); setNote(''); setProof(null); if (fileRef.current) fileRef.current.value = ''
      setOpen(false)
      onLogged()
    } catch (e2) { setError((e2 as Error).message || 'Could not log payment.') }
    finally { setBusy(false) }
  }

  return (
    <section className="hv-card">
      <div className="hv-card-head">
        <h2 className="hv-card-title">Dues</h2>
        {monthlyDues > 0 && <span className="hv-card-sub">{fmtMoney(monthlyDues)}/mo</span>}
      </div>

      {loading ? (
        <div className="hv-muted">Loading…</div>
      ) : !resident ? (
        <div className="hv-muted">No home record found for your account yet.</div>
      ) : (
        <>
          <div className={`hv-balance ${owes ? 'owes' : 'ok'}`}>
            <div className="hv-balance-num">{typeof balance === 'number' ? fmtMoney(Math.abs(balance)) : '—'}</div>
            <div className="hv-balance-label">{owes ? 'Balance due' : 'Paid up'}</div>
          </div>

          {!open && <button className="hv-btn" onClick={() => setOpen(true)}>Log a payment</button>}

          {open && (
            <form className="hv-form" onSubmit={submit}>
              <div className="hv-form-row">
                <label className="hv-field">
                  <span className="hv-label">Amount</span>
                  <input className="hv-input" inputMode="decimal" value={amount}
                    onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" autoFocus />
                </label>
                <label className="hv-field">
                  <span className="hv-label">Date paid</span>
                  <input className="hv-input" type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} />
                </label>
              </div>
              <div className="hv-form-row">
                <label className="hv-field">
                  <span className="hv-label">Method</span>
                  <select className="hv-input" value={method} onChange={e => setMethod(e.target.value)}>
                    {['Check', 'Bank transfer', 'Zelle', 'Cash', 'Card', 'Other'].map(m => <option key={m}>{m}</option>)}
                  </select>
                </label>
                <label className="hv-field">
                  <span className="hv-label">Note (optional)</span>
                  <input className="hv-input" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. May dues" />
                </label>
              </div>
              <label className="hv-field">
                <span className="hv-label">Proof / receipt (optional)</span>
                <input className="hv-input" ref={fileRef} type="file" onChange={e => setProof(e.target.files?.[0] ?? null)} />
              </label>
              {error && <div className="hv-err">{error}</div>}
              <div className="hv-actions">
                <button type="button" className="hv-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
                <button type="submit" className="hv-btn" disabled={busy}>{busy ? 'Saving…' : 'Save payment'}</button>
              </div>
            </form>
          )}

          {logged.length > 0 && (
            <div className="hv-paylist">
              {logged.map((p: any) => (
                <div key={p.id} className="hv-payrow">
                  <span className="hv-pay-amt">{fmtMoney(p.amount)}</span>
                  <span className="hv-pay-meta">{p.method || 'Payment'} · {fmtDate(p.paid_on)}{p.note ? ` · ${p.note}` : ''}</span>
                  {p.proof_path && <span className="hv-pay-proof" title="Has receipt">📎</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

/* ----------------------------- documents ----------------------------- */

function DocsCard({ docs, loading, doneCategories, resident, profileId, onChange, setErr }: any) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>(HOME_DOC_CATEGORIES[0])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file || !profileId) return
    setBusy(true)
    try {
      await uploadHomeDoc({
        file, title, category,
        profileId, communityId: resident?.community_id ?? null, residentId: resident?.id ?? null,
      })
      setFile(null); setTitle(''); if (fileRef.current) fileRef.current.value = ''
      setOpen(false); onChange()
    } catch (e2) { setErr((e2 as Error).message || 'Upload failed.') }
    finally { setBusy(false) }
  }

  const openDoc = async (d: HomeDoc) => {
    const url = await homeDocUrl(d.storage_path)
    if (url) window.open(url, '_blank', 'noopener')
  }
  const remove = async (d: HomeDoc) => { try { await deleteHomeDoc(d); onChange() } catch (e) { setErr((e as Error).message) } }
  const toggle = async (d: HomeDoc) => { try { await setConveys(d.id, !d.conveys); onChange() } catch (e) { setErr((e as Error).message) } }

  return (
    <section className="hv-card">
      <div className="hv-card-head">
        <h2 className="hv-card-title">Home documents</h2>
        {!open && <button className="hv-btn" onClick={() => setOpen(true)}>Add a document</button>}
      </div>

      {open && (
        <form className="hv-form" onSubmit={submit}>
          <label className="hv-field">
            <span className="hv-label">File</span>
            <input className="hv-input" ref={fileRef} type="file" onChange={e => setFile(e.target.files?.[0] ?? null)} required />
          </label>
          <div className="hv-form-row">
            <label className="hv-field">
              <span className="hv-label">Title</span>
              <input className="hv-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Roof warranty" />
            </label>
            <label className="hv-field">
              <span className="hv-label">Category</span>
              <select className="hv-input" value={category} onChange={e => setCategory(e.target.value)}>
                {HOME_DOC_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="hv-actions">
            <button type="button" className="hv-btn-ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button type="submit" className="hv-btn" disabled={busy || !file}>{busy ? 'Uploading…' : 'Upload'}</button>
          </div>
        </form>
      )}

      {/* Starter checklist */}
      <div className="hv-checklist">
        {HOME_DOC_CATEGORIES.filter(c => c !== 'Other').map(c => (
          <span key={c} className={`hv-chip${doneCategories.has(c) ? ' done' : ''}`}>
            {doneCategories.has(c) ? '✓ ' : ''}{c}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="hv-muted">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="hv-muted">No documents yet. Add your deed, insurance, warranties, and permits — they&apos;ll be here whenever you need them.</div>
      ) : (
        <div className="hv-doclist">
          {docs.map((d: HomeDoc) => (
            <div key={d.id} className="hv-docrow">
              <button className="hv-doc-main" onClick={() => openDoc(d)}>
                <span className="hv-doc-title">{d.title}</span>
                <span className="hv-doc-meta">{d.category || 'Document'} · {fmtDate(d.uploaded_at)}</span>
              </button>
              <label className="hv-conveys" title="Transfers to the next owner when you sell">
                <input type="checkbox" checked={d.conveys} onChange={() => toggle(d)} />
                <span>Conveys</span>
              </label>
              <button className="hv-doc-del" onClick={() => remove(d)} aria-label="Delete">×</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
