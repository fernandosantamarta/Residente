'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { planForHomes } from '@/lib/plan'
import { docSectionsFor, type DocSection } from '@/lib/documents/checklist'
import { uploadSignupDocuments, saveSignupNotes, type PropertyType } from '@/lib/signup'

// Admin home — replaces the old redirect-to-/community. A real dashboard:
// quick stats + a "Get your community live" checklist whose items tick off
// from actual data presence, so a freshly-signed-up board sees exactly what's
// left to do. No new tables — everything is computed from counts.

const withTimeout = (p, ms = 10000) =>
  Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error("Can't reach the server")), ms))])

type Counts = { residents: number; board: number; documents: number; budgets: number }

export default function AdminHome() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [community, setCommunity] = useState<any>(null)
  const [counts, setCounts] = useState<Counts | null>(null)
  const [status, setStatus] = useState('loading') // loading | ready | none | error
  const [copied, setCopied] = useState(false)
  // The "Upload documents" popup — a replica of the signup document to-do list,
  // re-surfaced here so a board can finish gathering files from the dashboard.
  const [showDocs, setShowDocs] = useState(false)
  // The "Paste your roster" popup — paste owners straight from Excel/Sheets and
  // import them without leaving the overview.
  const [showPaste, setShowPaste] = useState(false)

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading')
    try {
      const countOf = (table: string, build?: (q: any) => any) => {
        let q = supabase!.from(table).select('id', { count: 'exact', head: true }).eq('community_id', communityId)
        return build ? build(q) : q
      }
      const [c, res, board, docs, bud] = await withTimeout(Promise.all([
        supabase!.from('communities').select('*').eq('id', communityId).single(),
        countOf('residents'),
        countOf('residents', q => q.not('board_position', 'is', null)),
        countOf('documents'),
        countOf('budget_categories'),
      ])) as any[]
      setCommunity(c.data)
      setCounts({
        residents: res.count || 0, board: board.count || 0,
        documents: docs.count || 0, budgets: bud.count || 0,
      })
      setStatus('ready')
    } catch {
      setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const copyCode = async () => {
    if (!community?.join_code) return
    try { await navigator.clipboard.writeText(community.join_code); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {}
  }

  // "Download poster" — build a print-ready lobby flyer (US Letter) in a new
  // window and open the browser print dialog, where the board can Save as PDF
  // to email around or print to post. The QR encodes the community's join URL
  // (this deploy's origin → /signup); the big join code is the typed fallback.
  // The QR image is a baked-in raster once printed, so the saved PDF is
  // self-contained. Falls back gracefully to just the code if the image fails.
  const openPoster = () => {
    const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
    const origin = window.location.origin
    const host = origin.replace(/^https?:\/\//, '')
    const joinUrl = `${origin}/signup`
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&data=${encodeURIComponent(joinUrl)}`
    const name = esc(community?.name || 'our community')
    const code = community?.join_code ? esc(community.join_code) : ''
    const logo = `${origin}/residente-logo.png`
    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Join ${name} — Residente</title>
<style>
  @page { size: letter portrait; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #2A1206; }
  .sheet { width: 8.5in; min-height: 11in; margin: 0 auto; padding: 0.85in 0.8in 0.7in; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 32px; height: 32px; object-fit: contain; }
  .brand b { font-size: 19px; letter-spacing: -0.3px; }
  .kicker { margin-top: 0.45in; font-size: 14px; font-weight: 800; letter-spacing: 0.2em; text-transform: uppercase; color: #E14909; }
  h1 { font-size: 50px; line-height: 1.03; margin: 8px 0 0; letter-spacing: -1.6px; }
  h1 span { color: #E14909; }
  .dek { font-size: 18px; line-height: 1.5; color: #6b5544; margin: 14px 0 0; max-width: 6in; }
  .mid { margin-top: 0.5in; display: flex; gap: 0.5in; align-items: center; }
  .qrwrap { flex-shrink: 0; width: 2.6in; height: 2.6in; border: 3px solid #2A1206; border-radius: 18px; padding: 12px; background: #fff; }
  .qrwrap img { width: 100%; height: 100%; display: block; }
  .codelabel { font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b5544; }
  .code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 44px; font-weight: 800; letter-spacing: 4px; color: #2A1206; margin-top: 8px; background: #FFF5EC; border: 2px dashed rgba(225,73,9,0.55); border-radius: 14px; padding: 12px 20px; display: inline-block; }
  .perks { margin-top: 18px; font-size: 15.5px; line-height: 1.9; color: #2A1206; }
  .perks span { margin-right: 18px; white-space: nowrap; }
  .steps { margin-top: 0.5in; display: flex; gap: 0.35in; }
  .step { flex: 1; }
  .step .n { width: 32px; height: 32px; border-radius: 999px; background: #E14909; color: #fff; font-weight: 800; font-size: 17px; display: flex; align-items: center; justify-content: center; }
  .step h3 { font-size: 17px; margin: 11px 0 4px; }
  .step p { font-size: 14px; color: #6b5544; line-height: 1.45; margin: 0; }
  .foot { margin-top: auto; padding-top: 0.35in; border-top: 1px solid #efe1d2; display: flex; justify-content: space-between; font-size: 12.5px; color: #8a7a6a; }
</style></head>
<body>
  <div class="sheet">
    <div class="brand"><img src="${logo}" alt=""><b>Residente</b></div>
    <div class="kicker">You're invited</div>
    <h1>Join <span>${name}</span><br>online.</h1>
    <p class="dek">See where your dues go, pay online, get board updates, reserve amenities, and vote — all in one place, free for residents.</p>
    <div class="mid">
      <div class="qrwrap"><img id="qr" src="${qr}" alt="Scan to join"></div>
      <div>
        <div class="codelabel">Scan the code — or join with</div>
        <div class="code">${code || '— ask your board —'}</div>
        <div class="perks">
          <span>✓ Pay your dues</span><span>✓ See the budget</span><br>
          <span>✓ Board updates</span><span>✓ Reserve amenities</span>
        </div>
      </div>
    </div>
    <div class="steps">
      <div class="step"><div class="n">1</div><h3>Scan or visit</h3><p>Point your phone camera at the code, or open <b>${esc(host)}</b> in any browser.</p></div>
      <div class="step"><div class="n">2</div><h3>${code ? 'Enter the code' : 'Get the code'}</h3><p>${code ? `Type <b>${code}</b> to find ${name}.` : `Ask your board for ${name}'s join code.`}</p></div>
      <div class="step"><div class="n">3</div><h3>You're in</h3><p>Create your login and your home is connected instantly.</p></div>
    </div>
    <div class="foot"><span>Questions? Ask your community board.</span><span>Powered by Residente</span></div>
  </div>
  <script>
    var img = document.getElementById('qr'), printed = false;
    function go(){ if (printed) return; printed = true; window.focus(); window.print(); }
    if (img && img.complete) setTimeout(go, 300);
    else if (img) { img.addEventListener('load', function(){ setTimeout(go, 300); }); img.addEventListener('error', go); }
    setTimeout(go, 2500);
  </script>
</body></html>`
    const w = window.open('', '_blank')
    if (!w) return
    w.document.open()
    w.document.write(html)
    w.document.close()
  }

  if (status === 'loading') return <div className="admin-page"><div className="admin-note">Loading…</div></div>
  if (status === 'none') return (
    <div className="admin-page">
      <div className="admin-kicker">Overview</div>
      <h1 className="admin-h1">Welcome</h1>
      <div className="admin-note admin-note-warn">No community is linked to your account yet.</div>
    </div>
  )
  if (status === 'error') return (
    <div className="admin-page">
      <div className="admin-note admin-note-err">Couldn&apos;t load your dashboard.
        <button className="admin-btn-ghost" onClick={load}>Retry</button>
      </div>
    </div>
  )

  const dues = Number(community?.monthly_dues) || 0
  // Setup guide, in the order a manager should actually do it. Each hint names
  // the exact tab to open (matching the admin nav) plus the action to take, so
  // it reads as step-by-step instructions, not just a label.
  const items = [
    { label: 'Add your board members', done: (counts?.board || 0) >= 1, href: '/admin/voice',
      hint: 'Open Easy Voice → Board and add your President, Treasurer, and Secretary. They get admin access too.' },
    { label: 'Review your budget', done: (counts?.budgets || 0) > 0, href: '/admin/community',
      hint: 'Open the Community tab, edit the starter categories, and set this year’s amounts.' },
    { label: 'Set your monthly dues', done: dues > 0, href: '/admin/community',
      hint: 'In the Community tab, enter what each home pays per month — residents then see their balance.' },
    { label: 'Add your residents', done: (counts?.residents || 0) > 1, href: '/admin/residents',
      hint: 'Open Easy Track → Residents, then import your owner roster by CSV or add them one at a time.' },
    { label: 'Upload key documents', done: (counts?.documents || 0) >= 1, href: '/admin/documents',
      hint: 'Open Easy Documents and upload your bylaws, declaration, budget, insurance, and latest minutes.' },
  ]
  const doneCount = items.filter(i => i.done).length
  const pct = Math.round((doneCount / items.length) * 100)

  // Subscription state (see lib/plan.ts + supabase/community-billing.sql).
  const homes = community?.home_count ?? community?.unit_count ?? 0
  const sub = community?.subscription_status
  const plan = community?.plan
  const isPaidPlan = plan && plan !== 'free'
  const pastDue = sub === 'past_due'
  // Paid band that isn't active yet → show the Activate banner (covers pending,
  // legacy 'trial', and past_due). Free communities never see it.
  const needsActivation = Boolean(isPaidPlan && sub !== 'active')

  // Hint under the progress ring — the next step still to do.
  const nextStep = items.find(i => !i.done)?.label

  return (
    <div className="admin-page">
      <div className="admin-kicker">Get started</div>
      <h1 className="admin-h1">Let&rsquo;s get <span style={{ color: '#E14909' }}>{community?.name || 'your community'}</span> live.</h1>
      <p className="admin-dek">Three quick moves and your neighbors are in. Each step ticks off on its own as you go.</p>

      {needsActivation && (
        <Link href="/admin/billing" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
          flexWrap: 'wrap', margin: '4px 0 20px', padding: '14px 18px', textDecoration: 'none',
          border: '1px solid #f3b27a', background: '#fff6ee', borderRadius: 12, color: 'inherit',
        }}>
          <span style={{ fontSize: 13.5, color: '#6b5544' }}>
            <strong style={{ color: '#2a1206' }}>
              {pastDue ? 'Your subscription payment failed.' : `Activate your ${planForHomes(homes).label} plan.`}
            </strong>{' '}
            {pastDue ? 'Update it in Billing to keep your community running.' : 'Subscribe in Billing to keep it active.'}
          </span>
          <span className="admin-primary-btn" style={{ whiteSpace: 'nowrap' }}>
            {pastDue ? 'Go to Billing →' : 'Subscribe →'}
          </span>
        </Link>
      )}

      {/* Progress + guided setup — the mock hero row. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '6px 0 26px', flexWrap: 'wrap' }}>
        <div className="admin-dash-ring" style={{ ['--pct' as any]: `${pct}%` }}>{pct}%</div>
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{doneCount} of {items.length} steps done</div>
          <div style={{ fontSize: 13.5, color: '#6b5544', marginTop: 2 }}>
            {doneCount === items.length ? 'All set — your community is live. 🎉' : `Next: ${nextStep || 'finish setup'}.`}
          </div>
        </div>
        {doneCount < items.length && (
          <Link href="/admin/setup" className="admin-primary-btn" style={{ textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Start guided setup &rarr;
          </Link>
        )}
      </div>

      {/* The 3 "ease" cards — mock layout: pill, title, blurb, full-width button. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, margin: '0 0 22px' }}>
        {[
          { tag: 'No CSV needed', title: 'Paste your roster', blurb: 'Copy owners straight from Excel — we match the columns.', cta: 'Paste & import', primary: true, action: () => setShowPaste(true) },
          { tag: 'Sets itself up', title: 'Upload your docs', blurb: 'Drop your CC&Rs — we pre-fill rules, fines & reserves.', cta: 'Choose file', primary: true, action: () => setShowDocs(true) },
          { tag: 'No emails? No problem', title: 'Print join poster', blurb: 'A lobby flyer with a QR code. Residents scan to join.', cta: 'Download poster', primary: true, action: openPoster },
        ].map(c => (
          <div key={c.title} style={{ display: 'flex', flexDirection: 'column', gap: 9, border: '1px solid #efe1d2', background: '#fff', borderRadius: 18, padding: '20px 18px 18px', boxShadow: '0 1px 2px rgba(42,18,6,0.05)' }}>
            <span style={{ alignSelf: 'flex-start', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#b5481f', background: 'rgba(229,96,31,0.12)', padding: '3px 9px', borderRadius: 999 }}>{c.tag}</span>
            <span style={{ fontSize: 16, fontWeight: 700 }}>{c.title}</span>
            <span style={{ fontSize: 13, color: '#6b5544', lineHeight: 1.45, flex: 1 }}>{c.blurb}</span>
            {/* Each card fires an action — paste popup, docs popup, or poster. */}
            <button type="button" className="admin-primary-btn" onClick={c.action}
              style={{ textAlign: 'center', cursor: 'pointer', border: 'none', font: 'inherit' }}>
              {c.cta}
            </button>
          </div>
        ))}
      </div>

      <div className="admin-dash-card">
        <div className="admin-dash-card-head">
          <div>
            <h2 className="admin-dash-card-title">Set up your community</h2>
            <span className="admin-dash-card-sub">
              {doneCount === items.length
                ? 'All set — your community is live. 🎉'
                : `Follow these ${items.length} steps top to bottom. ${doneCount} of ${items.length} done.`}
            </span>
          </div>
          <div className="admin-dash-ring" style={{ ['--pct' as any]: `${pct}%` }}>{pct}%</div>
        </div>
        <ul className="admin-check-list">
          {items.map((i, idx) => (
            <li key={i.label} className={`admin-check-item${i.done ? ' done' : ''}`}>
              <span className="admin-check-dot">{i.done ? '✓' : idx + 1}</span>
              <div className="admin-check-body">
                <span className="admin-check-label">{i.label}</span>
                <span className="admin-check-hint">{i.hint}</span>
              </div>
              {/* The documents step opens the to-do popup; the rest navigate. */}
              {i.href === '/admin/documents' ? (
                <button type="button" className="admin-check-go" onClick={() => setShowDocs(true)}
                  style={{ cursor: 'pointer', border: 'none', background: 'none', font: 'inherit' }}>
                  {i.done ? 'Edit →' : 'Start →'}
                </button>
              ) : (
                <Link href={i.href} className="admin-check-go">{i.done ? 'Edit →' : 'Start →'}</Link>
              )}
            </li>
          ))}
        </ul>
        <p className="admin-dash-card-foot">
          Last step: share your join code below so owners can sign in to their homes.
        </p>
      </div>

      {community?.join_code && (
        <div className="admin-dash-card admin-dash-code">
          <div>
            <div className="admin-dash-card-sub">Resident join code</div>
            <div className="admin-dash-code-val">{community.join_code}</div>
            <div className="admin-dash-card-sub">Residents enter this at the Get started page to join.</div>
          </div>
          <button className="admin-secondary-btn" onClick={copyCode}>{copied ? 'Copied ✓' : 'Copy'}</button>
        </div>
      )}

      {/* Persistent entry to the subscription tab (the bar no longer carries it). */}
      <p className="admin-dek" style={{ marginTop: 18 }}>
        Manage your plan, payment, and invoices on the{' '}
        <Link href="/admin/billing" style={{ color: '#E14909', fontWeight: 700 }}>Plan &amp; billing</Link> page.
      </p>

      {showDocs && (
        <DocsChecklistModal
          communityId={communityId}
          propertyType={community?.association_type === 'condo' ? 'condo' : 'hoa'}
          onClose={() => setShowDocs(false)}
          onSaved={load}
        />
      )}

      {showPaste && (
        <PasteRosterModal
          communityId={communityId}
          onClose={() => setShowPaste(false)}
          onSaved={load}
        />
      )}
    </div>
  )
}

/* ------------------------- Paste-roster popup ------------------------- */

// The editable import grid — the exact spreadsheet from Easy Track → Residents,
// re-used here so the two imports behave identically. One row per household
// across four columns; a trailing blank row is always kept so there's room to
// type or paste next. Module-scope helpers mirror app/admin/residents/page.tsx.
const GRID_COLS = ['name', 'unit', 'email', 'phone'] as const
const blankGridRow = () => ({ name: '', unit: '', email: '', phone: '' })
const gridRowHasData = (r: any) => !!(r.name || r.unit || r.email || r.phone)
const withTrailingGridRow = (rows: any[]) => {
  const last = rows[rows.length - 1]
  if (!last || gridRowHasData(last)) rows.push(blankGridRow())
  return rows
}

// Parse an uploaded CSV/TSV into grid rows. Header-aware: if the first row
// names columns we map by header (so a 5-column export with subdivision +
// address still lands in the right cells); otherwise we read them positionally
// as Owner · Unit/Address · Email · Phone. Tab- or comma-delimited.
function parseCsvToGridRows(text: string) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const cells = (line: string) => (line.includes('\t') ? line.split('\t') : line.split(',')).map((c) => c.trim())
  const head = cells(lines[0]).map((c) => c.toLowerCase())
  const HEADERS = ['name', 'full name', 'owner', 'subdivision', 'address', 'email', 'phone', 'unit', 'unit / address']
  const hasHeader = head.some((c) => HEADERS.includes(c))
  // Column indexes — header-driven when present, else positional 0..3.
  const findIdx = (...keys: string[]) => head.findIndex((h) => keys.some((k) => h.includes(k)))
  const idx = hasHeader
    ? {
        name: Math.max(0, findIdx('name', 'owner')),
        unit: (() => { const i = findIdx('unit', 'address', 'subdivision'); return i >= 0 ? i : 1 })(),
        email: (() => { const i = findIdx('email'); return i >= 0 ? i : 2 })(),
        phone: (() => { const i = findIdx('phone'); return i >= 0 ? i : 3 })(),
      }
    : { name: 0, unit: 1, email: 2, phone: 3 }
  const out: { name: string; unit: string; email: string; phone: string }[] = []
  for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
    const c = cells(lines[i])
    if (!c[idx.name]) continue
    out.push({
      name: c[idx.name] || '', unit: c[idx.unit] || '',
      email: c[idx.email] || '', phone: c[idx.phone] || '',
    })
  }
  return out
}

// A quick paste-and-import popup, surfaced from the overview's "Paste your
// roster" card. Same editable column grid as the Residents page (type a cell,
// or paste a whole block straight from Excel / Google Sheets and it spreads
// across the columns), and the same `residents` insert path so the two stay
// consistent — the Unit value doubles as the household address.
function PasteRosterModal({
  communityId, onClose, onSaved,
}: {
  communityId?: string
  onClose: () => void
  onSaved: () => void
}) {
  const [grid, setGrid] = useState(() => [blankGridRow(), blankGridRow(), blankGridRow()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const ink = '#2A1206', orange = '#E14909'

  // "Upload CSV" — read the chosen file, parse it, and drop the rows into the
  // grid for a quick review before importing (rather than committing blindly).
  const onPickFile = (e: any) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseCsvToGridRows(String(reader.result))
      if (parsed.length) { setGrid([...parsed.map((r) => ({ ...r })), blankGridRow()]); setError('') }
      else setError('No rows found in that file — check it has an Owner column.')
    }
    reader.onerror = () => setError('Could not read that file')
    reader.readAsText(file)
  }

  const setCell = (ri: number, key: string, val: string) => setGrid((g) => {
    const next = g.map((r) => ({ ...r }))
    ;(next[ri] as any)[key] = val
    return withTrailingGridRow(next)
  })

  // Paste a block (from Excel / Sheets) straight into the grid, spreading the
  // tab/newline-delimited cells from the focused cell down and to the right.
  const onPasteCell = (e: any, ri: number, ci: number) => {
    const text = e.clipboardData.getData('text')
    if (!text || !/[\t\n]/.test(text)) return   // single value — let it paste normally
    e.preventDefault()
    const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n')
    setGrid((g) => {
      const next = g.map((r) => ({ ...r }))
      lines.forEach((line: string, li: number) => {
        const cells = line.split('\t')
        const tr = ri + li
        while (next.length <= tr) next.push(blankGridRow())
        cells.forEach((cell: string, cj: number) => {
          const col = GRID_COLS[ci + cj]
          if (col) (next[tr] as any)[col] = cell.trim()
        })
      })
      return withTrailingGridRow(next)
    })
    if (error) setError('')
  }

  const addRow = () => setGrid((g) => [...g, blankGridRow()])
  const removeRow = (ri: number) => setGrid((g) => {
    const next = g.filter((_, i) => i !== ri)
    return withTrailingGridRow(next.length ? next : [blankGridRow()])
  })

  const filled = grid.filter((r) => r.name.trim())

  const save = async () => {
    if (!filled.length) { setError('Type or paste at least one row — Owner is required.'); return }
    if (!communityId || !hasSupabase || !supabase) { onClose(); return }
    setSaving(true); setError('')
    try {
      const toInsert = filled.map((r) => ({
        community_id: communityId,
        full_name: r.name.trim(),
        address: r.unit.trim() || null,
        unit_number: r.unit.trim() || null,
        email: r.email.trim() || null,
        phone: r.phone.trim() || null,
      }))
      const { error } = await supabase.from('residents').insert(toInsert)
      if (error) throw error
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err?.message || 'Import failed'); setSaving(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(23,19,14,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      {/* `etrack` scopes the shared import-sheet / import-cell styles onto the popup. */}
      <div className="etrack" onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 600, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(23,19,14,0.4)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 20px 14px', borderBottom: '1px solid #f0e6da' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: orange }}>Paste your roster</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: ink, marginTop: 2 }}>Import owners in seconds</div>
            <div style={{ fontSize: 12.5, color: '#6b5544', marginTop: 2 }}>
              Type a row, or paste a block straight from Excel or Google Sheets — we map the columns for you.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 999, border: '1px solid #e7d9c9', background: '#fff', color: ink, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>

        {/* Body — the editable grid (same one as Easy Track → Residents). */}
        <div style={{ padding: '16px 20px 4px', overflow: 'auto' }}>
          <div className="import-sheet">
            <div className="import-sheet-row import-sheet-head">
              <span>Owner</span><span>Unit / Address</span><span>Email</span><span>Phone</span>
            </div>
            <div>
              {grid.map((row, ri) => (
                <div className="import-sheet-row" key={ri}>
                  {GRID_COLS.map((key, ci) => (
                    <input key={key} className="import-cell" value={(row as any)[key]}
                      placeholder={ri === 0 ? ['Jane Doe', '4B or 1247 Oak St', 'jane@email.com', '305-555-0142'][ci] : ''}
                      aria-label={`${['Owner', 'Unit / Address', 'Email', 'Phone'][ci]} row ${ri + 1}`}
                      onChange={(e) => setCell(ri, key, e.target.value)}
                      onPaste={(e) => onPasteCell(e, ri, ci)} />
                  ))}
                  <button type="button" className="import-del" onClick={() => removeRow(ri)}
                    tabIndex={-1} aria-label={`Delete row ${ri + 1}`}>&times;</button>
                </div>
              ))}
            </div>
          </div>
          <button type="button" className="import-addrow" onClick={addRow}>+ Add row</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv,text/plain"
            onChange={onPickFile} style={{ display: 'none' }} />
        </div>

        {/* Footer — Upload CSV sits next to Import. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px 16px', borderTop: '1px solid #f0e6da' }}>
          <div style={{ fontSize: 12.5, color: error ? '#b5481f' : '#6b5544', marginRight: 'auto' }}>
            {error || (filled.length ? `${filled.length} household${filled.length === 1 ? '' : 's'} ready to import` : 'Type or paste rows to begin')}
          </div>
          <button type="button" className="admin-secondary-btn"
            title="CSV columns: name, unit/address, email, phone (a header row is auto-detected)"
            onClick={() => fileRef.current?.click()}>
            Upload CSV
          </button>
          <button type="button" className="admin-primary-btn" onClick={save} disabled={saving || !filled.length}
            style={{ cursor: saving || !filled.length ? 'default' : 'pointer', border: 'none', font: 'inherit', opacity: saving || !filled.length ? 0.6 : 1 }}>
            {saving ? 'Importing…' : filled.length ? `Import ${filled.length}` : 'Import'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ----------------------- Upload-documents popup ----------------------- */

// A faithful replica of the /signup document to-do list, surfaced from the admin
// overview so a board can keep gathering files after onboarding. Same checklist
// data (lib/documents/checklist.ts), same one-category-at-a-time flow with a
// review summary. Confirmed checks are informational; attached files upload to
// the community vault on save via the same helper the signup wizard uses.
// `onFile` ⇒ a matching document is already in the community vault, so the row
// loads pre-checked (crossed out) and shows "On file" instead of an upload prompt.
type DocRowState = { checked: boolean; file: File | null; onFile: boolean }
type DocSecState = { items: DocRowState[]; note: string }

function DocsChecklistModal({
  communityId, propertyType, onClose, onSaved,
}: {
  communityId?: string
  propertyType: PropertyType
  onClose: () => void
  onSaved: () => void
}) {
  const [docs] = useState<DocSection[]>(() => docSectionsFor(propertyType))
  const [state, setState] = useState<DocSecState[]>(
    () => docs.map((s) => ({ items: s.items.map(() => ({ checked: false, file: null, onFile: false })), note: '' })),
  )
  const [section, setSection] = useState(0)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Pre-check anything already in the vault. Both this popup and the signup
  // wizard store a document's title as the exact checklist item name, so a
  // normalized title match is a reliable "already submitted" signal — those rows
  // load crossed out and marked "On file" rather than prompting another upload.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!hasSupabase || !supabase || !communityId) return
      try {
        const { data } = await supabase.from('documents').select('title').eq('community_id', communityId)
        if (cancelled || !data) return
        const norm = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/i, '').replace(/\s+/g, ' ').trim()
        const have = new Set(data.map((d: any) => norm(d.title || '')).filter(Boolean))
        if (!have.size) return
        setState((prev) => prev.map((sec, si) => ({
          ...sec,
          items: sec.items.map((it, ii) =>
            have.has(norm(docs[si].items[ii].name)) ? { ...it, checked: true, onFile: true } : it),
        })))
      } catch { /* non-fatal — checklist just starts blank */ }
    })()
    return () => { cancelled = true }
  }, [communityId, docs])

  const total = docs.length
  const onSummary = section >= total
  const doneCount = (i: number) => state[i].items.filter((it) => it.checked).length
  const allDone = (i: number) => doneCount(i) === docs[i].items.length
  const attachedCount = state.reduce((n, s) => n + s.items.filter((it) => it.file).length, 0)

  const patch = (si: number, fn: (s: DocSecState) => DocSecState) =>
    setState((prev) => prev.map((s, i) => (i === si ? fn(s) : s)))
  const toggle = (si: number, ii: number) =>
    patch(si, (s) => ({ ...s, items: s.items.map((it, j) => (j === ii ? { ...it, checked: !it.checked } : it)) }))
  const attach = (si: number, ii: number, file: File | null) => {
    if (!file) return
    patch(si, (s) => ({ ...s, items: s.items.map((it, j) => (j === ii ? { ...it, checked: true, file } : it)) }))
  }
  const setNote = (si: number, note: string) => patch(si, (s) => ({ ...s, note }))

  // Upload every attached file to the vault and persist any per-category notes —
  // the same best-effort path the signup wizard uses after provisioning.
  const save = async () => {
    if (!communityId) { onClose(); return }
    setSaving(true)
    const collected = state.flatMap((s, si) =>
      s.items.flatMap((it, ii) => (it.file ? [{ title: docs[si].items[ii].name, category: docs[si].category, file: it.file }] : [])),
    )
    const notes = state
      .map((s, si) => ({ section: docs[si].label, note: s.note }))
      .filter((n) => n.note.trim().length > 0)
    try {
      await uploadSignupDocuments(communityId, collected)
      await saveSignupNotes(communityId, notes)
      onSaved()
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const ink = '#2A1206', cream = '#FFF5EC', orange = '#E14909'

  const dots = (
    <div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 6, margin: '0 0 16px' }}>
      {docs.map((sec, i) => (
        <button key={sec.label} type="button" aria-label={`Go to ${sec.label}`}
          onClick={() => setSection(i)}
          style={{
            width: i === section ? 22 : 8, height: 8, borderRadius: 999, padding: 0, border: 'none', cursor: 'pointer',
            transition: 'width 0.2s, background 0.2s',
            background: i === section ? orange : allDone(i) ? 'rgba(225,73,9,0.55)' : 'rgba(42,18,6,0.18)',
          }} />
      ))}
    </div>
  )

  return (
    <div role="dialog" aria-modal="true" onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(23,19,14,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 560, maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(23,19,14,0.4)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '18px 20px 14px', borderBottom: '1px solid #f0e6da' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: orange }}>Upload documents</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: ink, marginTop: 2 }}>Your document checklist</div>
            <div style={{ fontSize: 12.5, color: '#6b5544', marginTop: 2 }}>
              The same list from setup — anything already in your vault is checked off. Attach the rest now or later.
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 999, border: '1px solid #e7d9c9', background: '#fff', color: ink, cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ padding: '16px 20px 4px', overflow: 'auto' }}>
          {dots}

          {onSummary ? (
            <>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: ink, marginBottom: 4 }}>Review your documents</div>
              <p style={{ fontSize: 12.5, color: '#6b5544', margin: '0 0 12px' }}>
                Here&apos;s what you&apos;ve gathered. Attached files save to your vault; you can add the rest anytime.
              </p>
              {docs.map((sec, i) => {
                const d = doneCount(i), t = sec.items.length
                const cls = d === t ? 'all' : d > 0 ? 'partial' : 'none'
                const pill = cls === 'all'
                  ? { background: orange, color: '#fff' }
                  : cls === 'partial'
                    ? { background: 'rgba(225,73,9,0.16)', color: orange }
                    : { background: 'rgba(42,18,6,0.08)', color: 'rgba(42,18,6,0.45)' }
                return (
                  <button key={sec.label} type="button" onClick={() => setSection(i)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', background: cream, color: ink, border: 'none', borderRadius: 14, padding: '12px 15px', marginBottom: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                      <span style={{ fontSize: 20, flexShrink: 0 }} aria-hidden="true">{sec.emoji}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{sec.label}</span>
                    </span>
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999, ...pill }}>
                      {d === t ? 'All done' : `${d}/${t}`}
                    </span>
                  </button>
                )
              })}
            </>
          ) : (() => {
            const sec = docs[section]
            const s = state[section]
            const d = doneCount(section), t = sec.items.length
            return (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(42,18,6,0.45)' }}>
                  Step {section + 1} of {total} · Your documents
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 2px' }}>
                  <span style={{ fontSize: 22 }} aria-hidden="true">{sec.emoji}</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: ink }}>{sec.label}</span>
                </div>
                <p style={{ fontSize: 12.5, color: '#6b5544', margin: '0 0 12px' }}>
                  {d === t ? 'All set for this category ✓' : 'Confirm or upload each — listed most important first. Skip and add the rest later.'}
                </p>

                <div style={{ background: cream, borderRadius: 16, overflow: 'hidden', border: '1px solid #f0e2d2' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'rgba(42,18,6,0.45)', padding: '9px 16px 1px' }}>
                    Most important first ↓
                  </div>
                  <div style={{ padding: '2px 0' }}>
                    {sec.items.map((item, i) => {
                      const it = s.items[i]
                      const dkey = `${section}-${i}`
                      const open = openKey === dkey
                      const showDesc = open || hoverKey === dkey
                      return (
                        <div key={item.name}
                          onMouseEnter={() => setHoverKey(dkey)} onMouseLeave={() => setHoverKey(null)}
                          style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(42,18,6,0.07)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '7px 16px' }}>
                            <button type="button" onClick={() => toggle(section, i)}
                              aria-label={`${it.checked ? 'Uncheck' : 'Check'} ${item.name}`}
                              style={{
                                width: 22, height: 22, flexShrink: 0, padding: 0, display: 'grid', placeItems: 'center', cursor: 'pointer',
                                borderRadius: 7, transition: 'all 0.14s',
                                border: it.checked ? `2px solid ${orange}` : '2px solid rgba(42,18,6,0.28)',
                                background: it.checked ? orange : 'transparent',
                                color: it.checked ? '#fff' : 'transparent',
                              }}>
                              <IconCheck />
                            </button>
                            <button type="button" onClick={() => setOpenKey(open ? null : dkey)} aria-expanded={showDesc}
                              style={{ flex: 1, minWidth: 0, textAlign: 'left', display: 'flex', alignItems: 'center', gap: 7, padding: 0, border: 'none', background: 'none', cursor: 'pointer', font: 'inherit', fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, color: it.checked ? 'rgba(42,18,6,0.4)' : ink }}>
                              <span style={{ minWidth: 0, textDecoration: it.checked ? 'line-through' : 'none' }}>{item.name}</span>
                              <span aria-hidden="true" style={{ flexShrink: 0, display: 'grid', placeItems: 'center', width: 13, height: 13, color: showDesc ? orange : 'rgba(42,18,6,0.38)', transform: showDesc ? 'rotate(90deg)' : 'none', transition: 'transform 0.16s, color 0.16s' }}>
                                <ChevronRight />
                              </span>
                            </button>
                            {it.onFile ? (
                              <span style={{
                                flexShrink: 0, whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700, padding: '6px 12px',
                                borderRadius: 999, border: `1.5px solid ${orange}`, background: 'rgba(225,73,9,0.12)', color: orange,
                              }}>
                                ✓ On file
                              </span>
                            ) : (
                              <label style={{
                                flexShrink: 0, cursor: 'pointer', whiteSpace: 'nowrap', fontSize: 12, fontWeight: 700,
                                padding: '6px 12px', borderRadius: 999, transition: 'all 0.14s',
                                border: it.file ? `1.5px solid ${orange}` : '1.5px solid rgba(42,18,6,0.22)',
                                background: it.file ? 'rgba(225,73,9,0.12)' : 'transparent',
                                color: it.file ? orange : 'rgba(42,18,6,0.7)',
                              }}>
                                {it.file ? '✓ Saved' : 'Upload'}
                                <input type="file" style={{ display: 'none' }}
                                  onChange={(e) => attach(section, i, e.target.files?.[0] ?? null)} />
                              </label>
                            )}
                          </div>
                          <div style={{ display: 'grid', gridTemplateRows: showDesc ? '1fr' : '0fr', opacity: showDesc ? 1 : 0, transition: 'grid-template-rows 0.24s ease, opacity 0.2s ease' }}>
                            <div style={{ overflow: 'hidden' }}>
                              <div style={{ padding: '0 16px 10px 49px', fontSize: 12, lineHeight: 1.45, color: 'rgba(42,18,6,0.62)' }}>{item.desc}</div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div style={{ padding: '10px 16px 12px', borderTop: '1px solid rgba(42,18,6,0.1)' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'rgba(42,18,6,0.5)', marginBottom: 6 }}>Notes</div>
                    <textarea value={s.note} onChange={(e) => setNote(section, e.target.value)}
                      placeholder="Missing items, context, or questions…"
                      style={{ width: '100%', resize: 'none', minHeight: 52, border: '1.5px solid rgba(42,18,6,0.18)', borderRadius: 12, padding: '9px 11px', fontSize: 13, font: 'inherit', color: ink, background: '#fff', outline: 'none' }} />
                  </div>
                </div>
              </>
            )
          })()}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px 16px', borderTop: '1px solid #f0e6da' }}>
          <div style={{ fontSize: 12, color: '#6b5544', marginRight: 'auto' }}>
            {attachedCount > 0 ? `${attachedCount} file${attachedCount === 1 ? '' : 's'} ready to upload` : 'Attach files anytime'}
          </div>
          {!onSummary && section > 0 && (
            <button type="button" onClick={() => setSection(section - 1)}
              style={{ padding: '9px 14px', borderRadius: 999, border: '1px solid #d8c3ad', background: '#fff', color: ink, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              ← Back
            </button>
          )}
          {onSummary ? (
            <button type="button" className="admin-primary-btn" onClick={save} disabled={saving}
              style={{ cursor: saving ? 'default' : 'pointer', border: 'none', font: 'inherit', opacity: saving ? 0.7 : 1 }}>
              {saving ? 'Saving…' : attachedCount > 0 ? 'Save to vault' : 'Done'}
            </button>
          ) : (
            <button type="button" className="admin-primary-btn" onClick={() => setSection(section + 1)}
              style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}>
              {section === total - 1 ? 'Review →' : 'Next →'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" style={{ width: 12, height: 12 }}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ width: 13, height: 13 }}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}
