'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { downloadCsv, exportFilename } from '@/lib/exportCsv'
import { parseRosterCsv, extractRosterFromFile } from '@/lib/signupImport'
import { logAudit } from '@/lib/audit'
import { transferHome } from '@/lib/homeVault'
import { Pager } from '@/components/Pager'
import { Dropdown } from '@/components/Dropdown'
import { EasyTrackTabs } from '../EasyTrackTabs'
import { useT } from '@/lib/i18n'

// Resident account / voting-invite state from the magic-link columns, with a
// fallback to a linked profile (older rows activated before invited_at existed).
// Roster activation lifecycle pill. Distinct from the "pending approvals" card
// (self-serve signups awaiting board verification) — these are roster rows we
// added, tracking whether the owner has been invited + has activated the app.
const inviteState = (r) =>
  (r.activated_at || r.profile_id) ? { cls: 'ok', key: 'admin.residents.pillActivated' }
  : r.invited_at ? { cls: 'warn', key: 'admin.residents.pillInvited' }
  : { cls: 'dim', key: 'admin.residents.pillNotInvited' }

// Initials for a household avatar — first letters of the first two words.
const initials = (name) =>
  String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

// Roster CSV parsing lives in lib/signupImport.ts (parseRosterCsv) so the signup
// onboarding import and this admin re-import stay consistent — same header mapping
// (any column order), quote-aware splitting, opening_balance + unit_number support.

// Money formatter for the import preview (tie-out against the prior manager's
// trial balance). USD; communities bill in dollars.
const fmtUSD = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Sort alphabetically by household name; unit/address (numeric-aware) breaks ties.
const sortRows = (rs) => [...rs].sort((a, b) => {
  const n = String(a.full_name || '~').localeCompare(String(b.full_name || '~'))
  if (n !== 0) return n
  return String(a.address || '').localeCompare(
    String(b.address || ''), undefined, { numeric: true })
})

// Editable import spreadsheet — one row per household, four columns matching the
// header. Always keeps a trailing blank row so there's somewhere to type next.
const GRID_COLS = ['name', 'unit', 'email', 'phone']
const blankGridRow = () => ({ name: '', unit: '', email: '', phone: '' })
const gridRowHasData = (r) => !!(r.name || r.unit || r.email || r.phone)

// Stage parsed/extracted rows for the "Review before importing" table. Every row
// gets a stable _k so editing/removing one never reorders or clobbers another
// (React keys by _k, not index), plus a _balText buffer so a half-typed balance
// like "12." or "-" isn't mangled by per-keystroke number parsing. Both are
// stripped at write time (confirmImport maps named fields only).
let _pendingKey = 0
const stagePending = (rows) => rows.map(r => ({
  ...r,
  _k: ++_pendingKey,
  _balText: typeof r.opening_balance === 'number' && Number.isFinite(r.opening_balance) ? String(r.opening_balance) : '',
}))

// Residents page — the community roster (people only): who's on the roster,
// whether they've registered/activated their account, their contact info and
// tenants, plus invite/transfer/remove. All dues & payment tracking lives in
// Reports (/admin/reports); this page carries no money.
export default function Residents() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState([])
  const [community, setCommunity] = useState(null)
  const [transfers, setTransfers] = useState([]) // home_transfers for this community (admin visibility)
  const [rosterPage, setRosterPage] = useState(0)
  const ROSTER_SIZE = 12
  const [reviewPage, setReviewPage] = useState(0) // paginates the import-review table
  const REVIEW_SIZE = 25
  const [status, setStatus] = useState('loading') // loading | ready | none | error
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null) // parsed CSV / pasted rows awaiting confirm
  const [importing, setImporting] = useState(false)
  const [successMsg, setSuccessMsg] = useState('')
  const [query, setQuery] = useState('')
  const [subFilter, setSubFilter] = useState('all')
  const [grid, setGrid] = useState(() => [blankGridRow(), blankGridRow(), blankGridRow()])
  const fileRef = useRef(null)
  // One upload picker: a CSV is parsed directly; a PDF/photo is read by AI.
  const [aiBusy, setAiBusy] = useState(false)
  // "More →" hint fades out as the import sheet is scrolled right.
  const [hintOpacity, setHintOpacity] = useState(1)
  // Magic-link invites (ported from the old Voice Roster).
  const [inviteBusyId, setInviteBusyId] = useState(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  // When the invite can't be emailed (Resend in test mode / no verified domain)
  // the function still returns a usable action_link — surface it to copy by hand
  // instead of a misleading "Invitation sent".
  const [inviteLink, setInviteLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)

  // Auto-dismiss the green confirmation banner after 4 seconds.
  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [resR, comR, xferR] = await Promise.all([
        withTimeout(supabase.from('residents').select('*').eq('community_id', communityId)),
        withTimeout(supabase.from('communities').select('*')
          .eq('id', communityId).single()),
        // Ownership-transfer history — admin oversight ("see everything").
        withTimeout(supabase.from('home_transfers').select('resident_id, to_email, created_at')
          .eq('community_id', communityId).order('created_at', { ascending: false })),
      ])
      if (resR.error) throw resR.error
      setRows(sortRows(resR.data || []))
      setCommunity(comR.data || null)
      setTransfers(xferR?.data || [])
      setStatus('ready')
    } catch (err) {
      setError(err?.message || t('admin.residents.errLoadResidents')); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  // Download the roster as CSV (reuses the shared lib/exportCsv helper that
  // also powers /admin/reports).
  const exportRoster = () => {
    const cols = [
      { label: 'Name', value: r => r.full_name || '' },
      { label: 'Unit', value: r => r.unit_number || '' },
      { label: 'Opening balance', value: r => r.opening_balance != null ? Number(r.opening_balance).toFixed(2) : '' },
      { label: 'Subdivision', value: r => r.subdivision || '' },
      { label: 'Address', value: r => r.address || '' },
      { label: 'Email', value: r => r.email || '' },
      { label: 'Phone', value: r => r.phone || '' },
    ]
    downloadCsv(exportFilename('residente-roster', new Date().toISOString().slice(0, 10)), rows, cols)
  }

  const communityName = community?.name || ''

  // (dues/payments moved to /admin/reports — Residents is people-only.)
  // Stat tiles (mock parity). "Activated" = a resident with a linked account
  // (profile_id set); "Pending" = on the roster but no account yet. "Tenants" =
  // units flagged as rented or carrying tenant contact info.
  const stats = useMemo(() => {
    const activated = rows.filter(r => r.activated_at || r.profile_id).length
    const tenants = rows.filter(r => r.is_rented || r.tenant_name).length
    return { owners: rows.length, tenants, activated, pending: rows.length - activated }
  }, [rows])

  // Subdivision filter options for the toolbar dropdown.
  const subOptions = useMemo(() => {
    const subs = [...new Set(rows.map(r => (r.subdivision || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b))
    return [{ value: 'all', label: t('admin.residents.allSubdivisions') }, ...subs.map(s => ({ value: s, label: s }))]
  }, [rows])

  // Search + subdivision filter over the already-sorted roster (flat table).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter(r => {
      if (r.approval_state === 'pending') return false  // surfaced in the approvals card, not the roster
      if (subFilter !== 'all' && (r.subdivision || '').trim() !== subFilter) return false
      if (!q) return true
      return [r.full_name, r.unit_number, r.address, r.email].some(v => String(v || '').toLowerCase().includes(q))
    })
  }, [rows, query, subFilter])

  // Self-serve signups that didn't auto-match the roster (email/address). The
  // board verifies them here: Approve anyway / Reject / Contact.
  const pendingApprovals = useMemo(
    () => rows.filter(r => r.approval_state === 'pending'),
    [rows],
  )

  // Owners who requested a tenant account from their app Settings — the board
  // approves (sends the non-voting tenant invite) or rejects.
  const tenantRequests = useMemo(
    () => rows.filter(r => r.tenant_request_state === 'pending'),
    [rows],
  )

  // Show the outcome of an invite: a success note if the email went out, or the
  // copyable action_link if it couldn't (no verified sending domain yet).
  const noteInvite = (data, sentMsg) => {
    if (data?.email_sent === false && data?.action_link) {
      setInviteLink(data.action_link); setLinkCopied(false); setInviteMsg('')
    } else {
      setInviteLink(''); setInviteMsg(sentMsg)
    }
  }

  const approveTenantRequest = async (r) => {
    setInviteBusyId(r.id); setError(''); setInviteMsg(''); setInviteLink('')
    try {
      // Mark approved first, then fire the existing tenant invite.
      await withTimeout(supabase.from('residents').update({ tenant_request_state: 'approved' }).eq('id', r.id))
      const { data, error } = await supabase.functions.invoke('voice-invite-owner', { body: { resident_id: r.id, tenant: true } })
      if (error) throw error
      if (data && data.ok === false) throw new Error(data.error || 'Invite failed')
      await logAudit({ community_id: communityId, event_type: 'tenant.approved', target_type: 'resident', target_id: r.id, metadata: { email_sent: !!data?.email_sent } })
      noteInvite(data, t('admin.residents.tenantInviteSent')); load()
    } catch (err) {
      setError(err?.message || t('admin.residents.errSendInvitation'))
    } finally { setInviteBusyId(null) }
  }

  const rejectTenantRequest = async (id) => {
    try {
      await withTimeout(supabase.from('residents').update({ tenant_request_state: 'rejected' }).eq('id', id))
      await logAudit({ community_id: communityId, event_type: 'tenant.rejected', target_type: 'resident', target_id: id })
      load()
    } catch (err) { setError(err?.message || t('admin.residents.errRemoveResident')) }
  }

  // Most-recent ownership transfer per unit, so the roster can flag a household
  // whose account was handed to a new owner (admin oversight).
  const transferByResident = useMemo(() => {
    const m = new Map()
    for (const x of transfers) if (x.resident_id && !m.has(x.resident_id)) m.set(x.resident_id, x)
    return m
  }, [transfers])

  // Admin-initiated ownership transfer — the board path (no name-confirm; that
  // guard is for the owner's own self-serve flow). Emails the buyer an invite to
  // claim the unit, reassigns the account, and logs to home_transfers. Reuses the
  // same home-transfer edge function as the resident settings flow.
  const transferOwnership = async (resident, buyerEmail, buyerName) => {
    try {
      const res = await transferHome({ residentId: resident.id, buyerEmail, buyerName: buyerName || undefined })
      await logAudit({ community_id: communityId, event_type: 'home.transferred', target_type: 'resident', target_id: resident.id, metadata: { to_email: buyerEmail, by: 'board' } })
      await load()
      return { ok: true, emailed: !!res?.email_sent }
    } catch (err) {
      return { error: err?.message || t('admin.residents.xferFailed') }
    }
  }

  const remove = async (id) => {
    const prev = rows
    setRows(rs => rs.filter(r => r.id !== id)) // optimistic
    try {
      const { error } = await withTimeout(supabase.from('residents').delete().eq('id', id))
      if (error) throw error
    } catch (err) {
      setRows(prev) // roll back
      setError(err?.message || t('admin.residents.errRemoveResident'))
    }
  }

  // Send (or resend) a resident their magic-link invite to activate the app and
  // vote. Reuses the voice-invite-owner edge function + audit log.
  const sendInvite = async (id) => {
    if (!hasSupabase || !communityId) return
    setInviteBusyId(id); setError(''); setInviteMsg(''); setInviteLink('')
    try {
      const { data, error } = await supabase.functions.invoke('voice-invite-owner', { body: { resident_id: id } })
      if (error) throw error
      if (data && data.ok === false) throw new Error(data.error || 'Invite failed')
      await logAudit({ community_id: communityId, event_type: 'invite.sent', target_type: 'resident', target_id: id, metadata: { email_sent: !!data?.email_sent } })
      noteInvite(data, t('admin.residents.invitationSent'))
      load()
    } catch (err) {
      setError(err?.message || t('admin.residents.errSendInvitation'))
    } finally { setInviteBusyId(null) }
  }

  // Invite the unit's TENANT (leased home) to their own non-voting account.
  // Same edge function, tenant flag — links tenant_profile_id, no unit/no vote.
  const sendTenantInvite = async (id) => {
    if (!hasSupabase || !communityId) return
    setInviteBusyId(id); setError(''); setInviteMsg(''); setInviteLink('')
    try {
      const { data, error } = await supabase.functions.invoke('voice-invite-owner', { body: { resident_id: id, tenant: true } })
      if (error) throw error
      if (data && data.ok === false) throw new Error(data.error || 'Invite failed')
      await logAudit({ community_id: communityId, event_type: 'invite.sent', target_type: 'resident', target_id: id, metadata: { tenant: true, email_sent: !!data?.email_sent } })
      noteInvite(data, t('admin.residents.tenantInviteSent'))
      load()
    } catch (err) {
      setError(err?.message || t('admin.residents.errSendInvitation'))
    } finally { setInviteBusyId(null) }
  }

  // Fully remove a unit's tenant (revoke account link + membership + community).
  // Switching = remove, then Invite tenant with the new email.
  const removeTenant = async (id) => {
    setInviteBusyId(id); setError(''); setInviteMsg('')
    try {
      const { data, error } = await supabase.functions.invoke('tenant-remove', { body: { resident_id: id } })
      if (error) throw error
      if (data && data.ok === false) throw new Error(data.error || 'Remove failed')
      await logAudit({ community_id: communityId, event_type: 'tenant.removed', target_type: 'resident', target_id: id })
      setInviteMsg(t('admin.residents.tenantRemoved'))
      load()
    } catch (err) {
      setError(err?.message || t('admin.residents.errSendInvitation'))
    } finally { setInviteBusyId(null) }
  }

  // Owners who have an email but were never invited — the bulk-invite targets.
  const uninvited = useMemo(() => rows.filter(r => r.email && !r.invited_at && !r.activated_at && !r.profile_id), [rows])

  const inviteAllUninvited = async () => {
    if (!hasSupabase || !communityId || !uninvited.length) return
    setBulkBusy(true); setError(''); setInviteMsg('')
    let sent = 0, failed = 0
    for (const o of uninvited) {
      try {
        const { data, error } = await supabase.functions.invoke('voice-invite-owner', { body: { resident_id: o.id } })
        if (error) throw error
        if (data && data.ok === false) throw new Error(data.error || 'Invite failed')
        await logAudit({ community_id: communityId, event_type: 'invite.sent', target_type: 'resident', target_id: o.id, metadata: { email_sent: !!data?.email_sent, bulk: true } })
        sent++
      } catch { failed++ }
    }
    setBulkBusy(false)
    const failedSuffix = failed ? t('admin.residents.bulkInviteFailed', { failed: String(failed) }) : ''
    setInviteMsg(t('admin.residents.bulkInviteResult', { sent: String(sent), failedSuffix }))
    load()
  }

  // Instant local edit while typing — no DB write yet.
  const editLocal = (id, key, val) =>
    setRows(rs => rs.map(r => (r.id === id ? { ...r, [key]: val } : r)))

  // Commit the opening balance to the DB (on blur).
  const commit = async (id, patch) => {
    try {
      const { error } = await withTimeout(
        supabase.from('residents').update(patch).eq('id', id)
      )
      if (error) throw error
      setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)))
    } catch (err) {
      setError(err?.message || t('admin.residents.errSaveChange'))
      load() // re-sync from the DB
    }
  }

  // Approve a pending self-serve signup → active resident who can vote.
  const approveResident = async (id) => {
    try {
      const { error } = await withTimeout(supabase.from('residents').update({
        approval_state: 'active', verified_via: 'board', voting_eligible: true,
        activated_at: new Date().toISOString(),
      }).eq('id', id))
      if (error) throw error
      if (communityId) await logAudit({ community_id: communityId, event_type: 'resident.approved', target_type: 'resident', target_id: id })
      setSuccessMsg(t('admin.residents.approvedMsg'))
      load()
    } catch (err) {
      setError(err?.message || t('admin.residents.errApprove'))
    }
  }

  // Reject a pending signup — keeps the row (marked rejected) so it stops showing
  // and can't re-match. They can retry with the correct email.
  const rejectResident = async (id) => {
    try {
      const { error } = await withTimeout(supabase.from('residents').update({ approval_state: 'rejected' }).eq('id', id))
      if (error) throw error
      if (communityId) await logAudit({ community_id: communityId, event_type: 'resident.rejected', target_type: 'resident', target_id: id })
      load()
    } catch (err) {
      setError(err?.message || t('admin.residents.errReject'))
    }
  }

  // Email a pending resident to sort out a mismatch (e.g. "use the email we have
  // on file"). Opens the board member's mail client, prefilled.
  const contactResident = (r) => {
    const subject = t('admin.residents.contactSubject')
    const body = t('admin.residents.contactBody', { name: r.full_name || '', community: communityName || '' })
    window.location.href = `mailto:${r.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  }

  // Keep a trailing blank row so the spreadsheet always has room to type/paste.
  const withTrailingRow = (rows) => {
    const last = rows[rows.length - 1]
    if (!last || gridRowHasData(last)) rows.push(blankGridRow())
    return rows
  }

  const setCell = (ri, key, val) => setGrid(g => {
    const next = g.map(r => ({ ...r }))
    next[ri][key] = val
    return withTrailingRow(next)
  })

  // Paste a block (from Excel / Sheets) straight into the grid, spreading the
  // tab/newline-delimited cells from the focused cell down and to the right.
  const onPasteCell = (e, ri, ci) => {
    const text = e.clipboardData.getData('text')
    if (!text || !/[\t\n]/.test(text)) return   // single value — let it paste normally
    e.preventDefault()
    const lines = text.replace(/\r/g, '').replace(/\n+$/, '').split('\n')
    setGrid(g => {
      const next = g.map(r => ({ ...r }))
      lines.forEach((line, li) => {
        const cells = line.split('\t')
        const tr = ri + li
        while (next.length <= tr) next.push(blankGridRow())
        cells.forEach((cell, cj) => {
          const col = GRID_COLS[ci + cj]
          if (col) next[tr][col] = cell.trim()
        })
      })
      return withTrailingRow(next)
    })
  }

  const addRow = () => setGrid(g => [...g, blankGridRow()])
  const removeRow = (ri) => setGrid(g => {
    const next = g.filter((_, i) => i !== ri)
    return withTrailingRow(next.length ? next : [blankGridRow()])
  })

  // "Paste & import" — turn the filled grid rows into the same confirm flow the
  // CSV upload uses (the green "Import all N" bar). Owner (name) is required.
  // The Unit value doubles as the household address so notices/exports have one.
  const importGrid = () => {
    const parsed = grid.filter(r => r.name.trim()).map(r => ({
      full_name: r.name.trim(), unit_number: r.unit.trim(),
      email: r.email.trim(), phone: r.phone.trim(),
      address: r.unit.trim(), subdivision: '',
    }))
    if (parsed.length) { setPending(stagePending(parsed)); setError('') }
    else setError(t('admin.residents.errGridEmpty'))
  }
  const gridHasData = grid.some(gridRowHasData)

  // One upload for everything. A CSV is parsed directly; a PDF or photo (any
  // layout) is read by AI (extract-roster). Either way the result lands in the
  // same confirm preview so the board reviews before importing. If AI can't read
  // a PDF/image (not deployed/configured, or a bad scan), we point them to CSV.
  const onPickAny = (e) => {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv' || file.type === 'application/vnd.ms-excel'
    if (isCsv) {
      const reader = new FileReader()
      reader.onload = () => {
        const parsed = parseRosterCsv(String(reader.result || ''))
        if (parsed.length) { setPending(stagePending(parsed)); setError('') }
        else setError(t('admin.residents.errNoRowsInFile'))
      }
      reader.onerror = () => setError(t('admin.residents.errReadFile'))
      reader.readAsText(file)
      return
    }
    setAiBusy(true); setError('')
    extractRosterFromFile(file)
      .then(rows => {
        if (rows && rows.length) setPending(stagePending(rows))
        else setError(t('admin.residents.aiUnavailable'))
      })
      .catch(() => setError(t('admin.residents.aiUnavailable')))
      .finally(() => setAiBusy(false))
  }

  // Edit one cell of a staged row in the review table (text fields). Matched by
  // the stable _k so a prior remove can't shift which row we touch.
  const editPending = (k, key, val) =>
    setPending(ps => ps.map(p => (p._k === k ? { ...p, [key]: val } : p)))

  // Opening balance is edited as free text (_balText keeps "12." / "-" intact)
  // while we keep opening_balance numeric in lockstep for the tie-out total.
  const editPendingBal = (k, val) =>
    setPending(ps => ps.map(p => {
      if (p._k !== k) return p
      const s = String(val).trim()
      const n = s ? Number(s.replace(/[^0-9.\-]/g, '')) : NaN
      return { ...p, _balText: val, opening_balance: Number.isFinite(n) ? n : undefined }
    }))

  const removePending = (k) =>
    setPending(ps => { const next = ps.filter(p => p._k !== k); return next.length ? next : null })

  const confirmImport = async () => {
    if (!pending) return
    setImporting(true); setError('')
    try {
      const toInsert = pending
        // A name can be blanked in the review table — never insert a nameless row.
        .filter(p => (p.full_name || '').trim())
        .map(p => ({
          community_id: communityId,
          full_name: p.full_name.trim(),
          subdivision: p.subdivision || null,
          address: p.address || null,
          email: p.email || null,
          phone: p.phone || null,
          unit_number: p.unit_number || null,
          // opening_balance has no other UI writer — set it only when the file carried
          // a real number so a blank cell never zeroes an existing balance. Feeds
          // residentBalance()/casePayoff()/the GL and shows up in /admin/reports.
          ...(typeof p.opening_balance === 'number' && Number.isFinite(p.opening_balance)
            ? { opening_balance: p.opening_balance } : {}),
        }))
      if (!toInsert.length) { setError(t('admin.residents.errGridEmpty')); setImporting(false); return }
      const { error } = await withTimeout(supabase.from('residents').insert(toInsert))
      if (error) throw error
      const n = toInsert.length
      setPending(null)
      setGrid([blankGridRow(), blankGridRow(), blankGridRow()])
      await load()
      setSuccessMsg(t('admin.residents.importedResidents', { count: String(n), suffix: n === 1 ? '' : 's' }))
    } catch (err) {
      setError(err?.message || t('admin.residents.errImportFailed'))
    } finally { setImporting(false) }
  }

  const gridColLabels = [
    t('admin.residents.colOwner'),
    t('admin.residents.colUnit'),
    t('admin.residents.colEmail'),
    t('admin.residents.colPhone'),
  ]
  const gridColPlaceholders = [
    t('admin.residents.phOwner'),
    t('admin.residents.phUnit'),
    t('admin.residents.phEmail'),
    t('admin.residents.phPhone'),
  ]

  // Opening-balance summary for the confirm bar — lets a board tie the import out
  // to the prior manager's trial balance before committing the migration.
  const pendingMoney = useMemo(() => {
    if (!pending) return null
    const withBal = pending.filter(p => typeof p.opening_balance === 'number' && p.opening_balance !== 0)
    if (!withBal.length) return null
    return { count: withBal.length, total: withBal.reduce((s, p) => s + (p.opening_balance || 0), 0) }
  }, [pending])

  // A blank CSV with the exact headers the parser recognizes (and one example row) —
  // the fastest way for a board to hand us the roster + opening balances at setup.
  const downloadTemplate = () => {
    const example = [{ full_name: 'Jane Smith', unit_number: '101', opening_balance: 1250, email: 'jane@example.com', phone: '555-0100', address: '101 Oak St' }]
    downloadCsv('residente-roster-template.csv', example, [
      { label: 'Name', value: r => r.full_name },
      { label: 'Unit', value: r => r.unit_number },
      { label: 'Opening balance', value: r => r.opening_balance },
      { label: 'Email', value: r => r.email },
      { label: 'Phone', value: r => r.phone },
      { label: 'Address', value: r => r.address },
    ])
  }

  return (
    <div className="admin-page etrack">
      <EasyTrackTabs active="residents" />
      <div className="admin-kicker">{t('admin.residents.kicker')}</div>
      <h1 className="admin-h1">{communityName ? t('admin.residents.rosterTitle', { community: communityName }) : t('admin.residents.rosterTitleDefault')}</h1>
      <p className="admin-dek">
        {t('admin.residents.dekBase')}
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          {t('admin.residents.noCommunity')}
        </div>
      )}

      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.residents.retry')}</button>
        </div>
      )}

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {inviteMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {inviteMsg}
        </div>
      )}

      {inviteLink && (
        <div className="admin-note admin-note-err" role="status"
          style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
          <span>{t('admin.residents.inviteNoEmail')}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="admin-input" readOnly value={inviteLink} style={{ flex: 1 }}
              onFocus={e => e.currentTarget.select()} />
            <button type="button" className="admin-secondary-btn"
              onClick={async () => { try { await navigator.clipboard.writeText(inviteLink); setLinkCopied(true) } catch {} }}>
              {linkCopied ? t('admin.residents.linkCopied') : t('admin.residents.copyLink')}
            </button>
          </div>
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <>
          {/* Stat tiles. */}
          <div className="stats">
            {[
              { v: String(stats.owners), l: t('admin.residents.statOwners') },
              { v: String(stats.tenants), l: t('admin.residents.statTenants') },
              { v: String(stats.activated), l: t('admin.residents.statActivated'), c: 'var(--ok)' },
              { v: String(stats.pending), l: t('admin.residents.statPending'), c: 'var(--warn)' },
            ].map(s => (
              <div key={s.l} className="stat">
                <div className="v" style={s.c ? { color: s.c } : undefined}>{s.v}</div>
                <div className="l">{s.l}</div>
              </div>
            ))}
          </div>

          {/* Pending approvals — self-serve signups that didn't auto-match the
              roster. Board confirms (Approve anyway), rejects, or contacts them. */}
          {pendingApprovals.length > 0 && (
            <div className="card pending-card" style={{ borderColor: 'var(--warn)' }}>
              <div className="card-head">
                <div>
                  <h2>{t('admin.residents.pendingCardTitle')}</h2>
                  <div className="sub">{t('admin.residents.pendingCardSub')}</div>
                </div>
                <span className="pill" style={{ background: 'var(--warn)', color: '#fff' }}>{pendingApprovals.length}</span>
              </div>
              <table className="tbl">
                <tbody>
                  {pendingApprovals.map(r => (
                    <tr className="tr" key={r.id}>
                      <td className="pend-who">
                        <span className="strong">{r.full_name || t('admin.residents.pendingNoName')}</span>
                        <span className="pill warn pend-badge">{t('admin.residents.pendingNeedsReview')}</span>
                      </td>
                      <td className="muted pend-detail">
                        <span className="pend-detail-label">{t('admin.residents.pendingSignedUpWith')}</span>{' '}
                        {r.email || '—'} · {r.address || r.unit_number || t('admin.residents.pendingNoUnit')}
                      </td>
                      <td className="pend-act">
                        <button type="button" className="admin-btn-ghost" onClick={() => contactResident(r)}>{t('admin.residents.contactBtn')}</button>
                        <button type="button" className="admin-btn-ghost" onClick={() => rejectResident(r.id)}>{t('admin.residents.rejectBtn')}</button>
                        <button type="button" className="admin-primary-btn" onClick={() => approveResident(r.id)}>{t('admin.residents.approveBtn')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tenant requests — owners who asked (from their Settings) to give
              their renter a non-voting account. Approve = send the tenant invite. */}
          {tenantRequests.length > 0 && (
            <div className="card pending-card" style={{ borderColor: 'var(--warn)' }}>
              <div className="card-head">
                <div>
                  <h2>{t('admin.residents.tenantReqCardTitle')}</h2>
                  <div className="sub">{t('admin.residents.tenantReqCardSub')}</div>
                </div>
                <span className="pill" style={{ background: 'var(--warn)', color: '#fff' }}>{tenantRequests.length}</span>
              </div>
              <table className="tbl">
                <tbody>
                  {tenantRequests.map(r => (
                    <tr className="tr" key={r.id}>
                      <td className="pend-who">
                        <span className="strong">{r.full_name || t('admin.residents.pendingNoName')}</span>
                        <span className="muted"> · {r.unit_number || r.address || t('admin.residents.pendingNoUnit')}</span>
                      </td>
                      <td className="muted pend-detail">
                        <span className="pend-detail-label">{t('admin.residents.tenantReqProposed')}</span>{' '}
                        {r.tenant_name || '—'} · {r.tenant_email || '—'}
                      </td>
                      <td className="pend-act">
                        <button type="button" className="admin-btn-ghost" disabled={inviteBusyId === r.id} onClick={() => rejectTenantRequest(r.id)}>{t('admin.residents.rejectBtn')}</button>
                        <button type="button" className="admin-primary-btn" disabled={inviteBusyId === r.id} onClick={() => approveTenantRequest(r)}>{inviteBusyId === r.id ? t('admin.residents.sendingSingle') : t('admin.residents.tenantReqApprove')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Import your roster — one editable spreadsheet. Type into the cells,
              paste a block straight from Excel / Google Sheets, or upload a CSV. */}
          <div className="card import-card">
            <div className="card-head">
              <div>
                <h2>{t('admin.residents.importCardTitle')}</h2>
                <div className="sub">{t('admin.residents.importCardSub')}</div>
              </div>
              <span className="pill dim">{t('admin.residents.pillNoCSV')}</span>
            </div>
            <div className="import-sheet"
              onScroll={e => {
                const el = e.currentTarget
                const max = el.scrollWidth - el.clientWidth
                setHintOpacity(max > 4 ? Math.max(0, 1 - el.scrollLeft / max) : 1)
              }}>
              <div className="import-sheet-row import-sheet-head">
                <span>{t('admin.residents.colOwner')}</span><span>{t('admin.residents.colUnit')}</span><span>{t('admin.residents.colEmail')}</span><span>{t('admin.residents.colPhone')}</span>
              </div>
              <div>
                {grid.map((row, ri) => (
                  <div className="import-sheet-row" key={ri}>
                    {GRID_COLS.map((key, ci) => (
                      <label key={key} className="import-field">
                        <span className="import-field-label">{gridColLabels[ci]}</span>
                        <input className="import-cell" value={row[key]}
                          placeholder={ri === 0 ? gridColPlaceholders[ci] : ''}
                          aria-label={t('admin.residents.ariaGridCell', { col: gridColLabels[ci], row: String(ri + 1) })}
                          onChange={e => setCell(ri, key, e.target.value)}
                          onPaste={e => onPasteCell(e, ri, ci)} />
                      </label>
                    ))}
                    <button type="button" className="import-del" onClick={() => removeRow(ri)}
                      tabIndex={-1} aria-label={t('admin.residents.ariaDeleteRow', { row: String(ri + 1) })}>&times;</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="import-addrow-bar">
              <button type="button" className="import-addrow" onClick={addRow}>{t('admin.residents.addRow')}</button>
              <span className="import-scroll-hint" aria-hidden="true" style={{ opacity: hintOpacity }}>{t('admin.residents.scrollMore')}</span>
            </div>
            <div className="row-actions">
              <button type="button" className="admin-primary-btn" onClick={importGrid} disabled={!gridHasData}>
                {t('admin.residents.pasteImport')}
              </button>
              <button type="button" className="admin-secondary-btn"
                title={t('admin.residents.uploadFileTitle')}
                disabled={aiBusy}
                onClick={() => fileRef.current && fileRef.current.click()}>
                {aiBusy ? t('admin.residents.aiReading') : t('admin.residents.uploadFile')}
              </button>
              <button type="button" className="admin-btn-ghost"
                title={t('admin.residents.downloadTemplateTitle')}
                onClick={downloadTemplate}>
                {t('admin.residents.downloadTemplate')}
              </button>
              {error && <span className="admin-err-inline">{error}</span>}
            </div>
            <input name="residents-upload" ref={fileRef} type="file"
              accept=".csv,text/csv,.pdf,application/pdf,image/png,image/jpeg,image/webp"
              onChange={onPickAny} style={{ display: 'none' }} />
          </div>

          {pending && (
            <>
              {/* Review before importing — every staged row is editable so the board
                  can fix a misread (AI) or a stray cell (CSV) before the migration
                  write. Remove drops a row; the tie-out total updates live. */}
              <div className="card import-review">
                <div className="card-head">
                  <div>
                    <h2>{t('admin.residents.reviewTitle')}</h2>
                    <div className="sub">{t('admin.residents.reviewNote')}</div>
                  </div>
                </div>
                {(() => {
                  const pageCount = Math.ceil(pending.length / REVIEW_SIZE)
                  const page = Math.min(reviewPage, Math.max(0, pageCount - 1))
                  const pagedPending = pending.slice(page * REVIEW_SIZE, (page + 1) * REVIEW_SIZE)
                  return (
                  <>
                  <div style={{ overflowX: 'auto' }}>
                    <table className="tbl" style={{ width: '100%', tableLayout: 'fixed' }}>
                      <thead>
                        <tr>
                          <th style={{ width: '23%' }}>{t('admin.residents.colOwner')}</th>
                          <th style={{ width: '11%' }}>{t('admin.residents.colUnit')}</th>
                          <th style={{ width: '29%' }}>{t('admin.residents.colEmail')}</th>
                          <th style={{ width: '18%' }}>{t('admin.residents.colPhone')}</th>
                          <th style={{ width: '13%' }}>{t('admin.residents.colBalance')}</th>
                          <th className="act" style={{ width: '6%' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedPending.map((p, i) => {
                          const gi = page * REVIEW_SIZE + i
                          return (
                          <tr className="tr" key={p._k}>
                            <td><input className="admin-input" style={{ width: '100%' }} value={p.full_name || ''}
                              onChange={e => editPending(p._k, 'full_name', e.target.value)} /></td>
                            <td><input className="admin-input" style={{ width: '100%' }} value={p.unit_number || ''}
                              onChange={e => editPending(p._k, 'unit_number', e.target.value)} /></td>
                            <td><input className="admin-input" type="email" style={{ width: '100%' }} value={p.email || ''}
                              onChange={e => editPending(p._k, 'email', e.target.value)} /></td>
                            <td><input className="admin-input" style={{ width: '100%' }} value={p.phone || ''}
                              onChange={e => editPending(p._k, 'phone', e.target.value)} /></td>
                            <td><input className="admin-input" inputMode="decimal" placeholder={t('admin.residents.phBalance')}
                              style={{ width: '100%', textAlign: 'right' }} value={p._balText || ''}
                              onChange={e => editPendingBal(p._k, e.target.value)} /></td>
                            <td className="act">
                              <button type="button" className="import-del" onClick={() => removePending(p._k)}
                                aria-label={t('admin.residents.ariaRemovePending', { row: String(gi + 1) })}>&times;</button>
                            </td>
                          </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                  {pageCount > 1 && <Pager page={page} pageCount={pageCount} onPage={setReviewPage} />}
                  </>
                  )
                })()}
              </div>
              <div className="res-import-bar">
                <span>
                  {t('admin.residents.foundResidents', { count: String(pending.length), suffix: pending.length === 1 ? '' : 's' })}
                  {pendingMoney && (
                    <span className="muted" style={{ marginLeft: 8 }}>
                      {t('admin.residents.importOpeningPreview', { count: String(pendingMoney.count), total: fmtUSD(pendingMoney.total) })}
                    </span>
                  )}
                </span>
                <button type="button" className="admin-primary-btn" disabled={importing} onClick={confirmImport}>
                  {importing ? t('admin.residents.importing') : t('admin.residents.importAll', { count: String(pending.length) })}
                </button>
                <button type="button" className="admin-btn-ghost" onClick={() => setPending(null)}>
                  {t('admin.residents.cancel')}
                </button>
              </div>
            </>
          )}

          {/* Search / filter / export toolbar over the roster table. */}
          {status === 'ready' && rows.length > 0 && (
            <div className="toolbar">
              <div className="toolbar-left">
                <div className="search">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
                  </svg>
                  <input value={query} onChange={e => setQuery(e.target.value)}
                    placeholder={t('admin.residents.searchPlaceholder')} aria-label={t('admin.residents.ariaSearchRoster')} />
                </div>
                {subOptions.length > 1 && (
                  <Dropdown value={subFilter} onChange={setSubFilter} options={subOptions} ariaLabel={t('admin.residents.ariaSubdivision')} />
                )}
              </div>
              <div className="etrack-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {uninvited.length > 0 && (
                  <button type="button" className="admin-primary-btn" disabled={bulkBusy}
                    title={t('admin.residents.inviteOwnersTitle')}
                    onClick={inviteAllUninvited}>
                    {bulkBusy ? t('admin.residents.sendingBulk') : t('admin.residents.inviteOwners', { count: String(uninvited.length), suffix: uninvited.length === 1 ? '' : 's' })}
                  </button>
                )}
                <button type="button" className="admin-secondary-btn"
                  title={t('admin.residents.exportCSVTitle')}
                  onClick={exportRoster} disabled={rows.length === 0}>
                  {t('admin.residents.exportCSV')}
                </button>
              </div>
            </div>
          )}

          {status === 'loading' && <div className="admin-note">{t('admin.residents.loading')}</div>}
          {status === 'ready' && rows.length === 0 && (
            <div className="card"><div className="roster-empty">{t('admin.residents.emptyRoster')}</div></div>
          )}
          {status === 'ready' && rows.length > 0 && (() => {
            const pageCount = Math.ceil(filtered.length / ROSTER_SIZE)
            const page = Math.min(rosterPage, Math.max(0, pageCount - 1))
            const paged = filtered.slice(page * ROSTER_SIZE, (page + 1) * ROSTER_SIZE)
            const payFailCount = rows.filter(r => r.last_charge_failed_at).length
            return (
            <>
            {payFailCount > 0 && (
              <div className="admin-note admin-note-err" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 9 }}>
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                {t('admin.residents.payFailedBanner', { count: payFailCount })}
              </div>
            )}
            <div className="card">
              <table className="tbl roster-tbl">
                <thead>
                  <tr>
                    <th>{t('admin.residents.thOwner')}</th><th>{t('admin.residents.thUnit')}</th><th className="contact-col">{t('admin.residents.thContact')}</th>
                    <th>{t('admin.residents.thStatus')}</th><th className="act"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={5}><div className="roster-empty">{t('admin.residents.noSearchResults')}</div></td></tr>
                  ) : paged.map(r => (
                    <ResidentRow key={r.id} r={r}
                      onLocal={editLocal} onCommit={commit} onRemove={remove}
                      onInvite={sendInvite} inviteBusy={inviteBusyId === r.id}
                      onInviteTenant={sendTenantInvite} onRemoveTenant={removeTenant}
                      transfer={transferByResident.get(r.id)} onTransfer={transferOwnership} />
                  ))}
                </tbody>
              </table>
              <Pager page={page} pageCount={pageCount} onPage={setRosterPage} />
            </div>
            </>
            )
          })()}
        </>
      )}
    </div>
  )
}

// One roster row (mock table shape: avatar + name | unit | contact | balance |
// activation pill | Open). "Open" expands the full household editor in-place so
// every working field (address, subdivision, opening balance, mailing address,
// tenant) is still editable — nothing is read-only-only.
function ResidentRow({ r, onLocal, onCommit, onRemove, onInvite, inviteBusy, onInviteTenant, onRemoveTenant, transfer, onTransfer }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const activated = !!(r.activated_at || r.profile_id)
  const pill = inviteState(r)
  const contact = r.email || r.phone || '—'
  // Admin transfer mini-form state.
  const [xferOpen, setXferOpen] = useState(false)
  const [xEmail, setXEmail] = useState('')
  const [xName, setXName] = useState('')
  const [xBusy, setXBusy] = useState(false)
  const [xMsg, setXMsg] = useState('')
  const doTransfer = async () => {
    if (!xEmail.trim()) return
    setXBusy(true); setXMsg('')
    const res = await onTransfer(r, xEmail.trim(), xName.trim())
    setXBusy(false)
    if (res?.error) { setXMsg(res.error); return }
    setXferOpen(false); setXEmail(''); setXName('')
  }
  // Resend/send-invite label: first send vs re-invite. (Activated owners need no
  // link, so the button is hidden for them — "resend the link only when pending".)
  const inviteLabel = r.invited_at ? t('admin.residents.inviteLabelReinvite') : t('admin.residents.inviteLabelSend')
  // Explicit save UX: fields still commit on blur, but Enter and the Save button
  // make it deliberate + show a "Saved" confirmation (blurring the focused input
  // fires its existing onCommit).
  const [saved, setSaved] = useState(false)
  const flashSaved = () => { setSaved(true); window.setTimeout(() => setSaved(false), 2500) }
  const onEnterSave = (e: any) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur?.(); flashSaved() } }
  const saveAll = () => { try { (document.activeElement as HTMLElement)?.blur?.() } catch { /* noop */ } flashSaved() }
  return (
    <>
      <tr className="tr">
        <td>
          <div className="owner-cell">
            <span className="av" aria-hidden="true">{initials(r.full_name)}</span>
            <span className="strong">
              {r.full_name}
              {r.subdivision ? <span className="muted" style={{ fontWeight: 400 }}> · {r.subdivision}</span> : null}
              {transfer && (
                <span className="pill dim res-xfer-badge" title={t('admin.residents.xferredTitle', { date: String(transfer.created_at).slice(0, 10) })}>
                  ↗ {t('admin.residents.xferredBadge')}
                </span>
              )}
              {r.last_charge_failed_at && (
                <span className="pill res-payfail-badge"
                  title={r.last_charge_fail_reason ? String(r.last_charge_fail_reason) : t('admin.residents.payFailedTitle')}
                  style={{ background: '#fdecec', color: '#a32020', border: '1px solid #f0b4a4', marginLeft: 6 }}>
                  {t('admin.residents.payFailedBadge')}
                </span>
              )}
            </span>
          </div>
        </td>
        <td className="muted">{r.unit_number || r.address || '—'}</td>
        <td className="muted contact-col">{contact}</td>
        <td><span className={`pill ${pill.cls}`}>{t(pill.key)}</span></td>
        <td className="act">
          <button type="button" className="go" onClick={() => setOpen(o => !o)}>
            {open ? t('admin.residents.rowClose') : t('admin.residents.rowOpen')}
          </button>
        </td>
      </tr>

      {open && (
        <tr className="tr-edit">
          <td colSpan={5}>
            <div className="edit-grid">
              <label className="admin-field"><span className="admin-field-label">{t('admin.residents.fieldAddress')}</span>
                <input className="admin-input" placeholder={t('admin.residents.phAddress')} value={r.address ?? ''}
                  onChange={e => onLocal(r.id, 'address', e.target.value)} onKeyDown={onEnterSave}
                  onBlur={e => onCommit(r.id, { address: e.target.value.trim() || null })} /></label>
              <label className="admin-field"><span className="admin-field-label">{t('admin.residents.fieldSubdivision')}</span>
                <input className="admin-input" placeholder={t('admin.residents.phSubdivision')} value={r.subdivision ?? ''}
                  onChange={e => onLocal(r.id, 'subdivision', e.target.value)} onKeyDown={onEnterSave}
                  onBlur={e => onCommit(r.id, { subdivision: e.target.value.trim() || null })} /></label>
            </div>

            <p className="edit-note">
              {t('admin.residents.mailingAddressNote')}
            </p>
            <label className="admin-field">
              <span className="admin-field-label">{t('admin.residents.fieldMailingAddress')}</span>
              <input className="admin-input" defaultValue={r.last_known_address ?? ''}
                placeholder={t('admin.residents.phMailingAddress')} onKeyDown={onEnterSave}
                onBlur={e => onCommit(r.id, { last_known_address: e.target.value.trim() || null })} />
            </label>
            <label className="edit-rented" style={{ margin: '12px 0' }}>
              <input type="checkbox" defaultChecked={!!r.is_rented}
                onChange={e => onCommit(r.id, { is_rented: e.target.checked })} />
              {t('admin.residents.checkboxRented')}
            </label>
            <div className="edit-grid">
              <label className="admin-field"><span className="admin-field-label">{t('admin.residents.fieldTenantName')}</span>
                <input className="admin-input" defaultValue={r.tenant_name ?? ''} onKeyDown={onEnterSave}
                  onBlur={e => onCommit(r.id, { tenant_name: e.target.value.trim() || null })} /></label>
              <label className="admin-field"><span className="admin-field-label">{t('admin.residents.fieldTenantEmail')}</span>
                <input className="admin-input" type="email" defaultValue={r.tenant_email ?? ''} onKeyDown={onEnterSave}
                  onBlur={e => onCommit(r.id, { tenant_email: e.target.value.trim() || null })} /></label>
              <label className="admin-field"><span className="admin-field-label">{t('admin.residents.fieldTenantPhone')}</span>
                <input className="admin-input" defaultValue={r.tenant_phone ?? ''} onKeyDown={onEnterSave}
                  onBlur={e => onCommit(r.id, { tenant_phone: e.target.value.trim() || null })} /></label>
            </div>
            {/* Tenant app account — a leased unit can invite its tenant to a
                non-voting account (they see Home/Requests/Documents/Schedule, not
                dues or voting). Needs a tenant email; shows "active" once linked. */}
            {(r.tenant_email || r.tenant_profile_id) && (
              <div className="res-tenant-invite" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '4px 0 4px' }}>
                {r.tenant_profile_id ? (
                  <>
                    <span className="pill ok" style={{ fontSize: 11.5 }}>{t('admin.residents.tenantAccountActive')}</span>
                    <button type="button" className="admin-btn-sm admin-btn-warn" disabled={inviteBusy}
                      onClick={() => onRemoveTenant(r.id)} title={t('admin.residents.tenantRemoveTitle')}>
                      {inviteBusy ? t('admin.residents.sendingSingle') : t('admin.residents.tenantRemoveBtn')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="admin-btn-sm" disabled={inviteBusy || !r.tenant_email}
                    onClick={() => onInviteTenant(r.id)} title={t('admin.residents.tenantInviteTitle')}>
                    {inviteBusy ? t('admin.residents.sendingSingle') : t('admin.residents.inviteTenantBtn')}
                  </button>
                )}
                <span className="muted" style={{ fontSize: 11.5 }}>{r.tenant_profile_id ? t('admin.residents.tenantRemoveHint') : t('admin.residents.tenantInviteHint')}</span>
              </div>
            )}

            {/* Admin-initiated ownership transfer — the expanded form. The
                trigger lives in the foot next to "Send invite" (below). Emails
                the new owner an invite to claim this unit; the owner's own
                self-serve transfer (with name-confirm) lives in their Settings. */}
            {xferOpen && (
              <div className="res-xfer" style={{ margin: '14px 0', padding: '14px 16px', background: 'rgba(0,0,0,0.025)', borderRadius: 10 }}>
                <span className="admin-field-label" style={{ display: 'block', marginBottom: 8 }}>
                  {t('admin.residents.xferLabel')}
                </span>
                <div className="edit-grid">
                  <label className="admin-field"><span className="admin-field-label">{t('admin.residents.xferBuyerEmail')}</span>
                    <input className="admin-input" type="email" value={xEmail} onChange={e => setXEmail(e.target.value)} placeholder="newowner@email.com" /></label>
                  <label className="admin-field"><span className="admin-field-label">{t('admin.residents.xferBuyerName')}</span>
                    <input className="admin-input" value={xName} onChange={e => setXName(e.target.value)} placeholder={t('admin.residents.xferBuyerNamePh')} /></label>
                </div>
                <p className="edit-note">{t('admin.residents.xferNote')}</p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <button type="button" className="admin-btn-sm admin-btn-warn" disabled={xBusy || !xEmail.trim()} onClick={doTransfer}>
                    {xBusy ? t('admin.residents.xferTransferring') : t('admin.residents.xferConfirmBtn')}
                  </button>
                  <button type="button" className="admin-btn-sm" onClick={() => setXferOpen(false)} disabled={xBusy}>{t('admin.residents.xferCancel')}</button>
                  {xMsg && <span style={{ fontSize: 12.5, fontWeight: 600, color: '#b42318' }}>{xMsg}</span>}
                </div>
              </div>
            )}

            <div className="edit-foot">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button type="button" className="admin-primary-btn" style={{ padding: '8px 18px', fontSize: 13.5 }} onClick={saveAll}>{t('admin.residents.saveBtn')}</button>
                {saved && <span style={{ color: '#067647', fontWeight: 700, fontSize: 12.5 }}>{t('admin.residents.savedMsg')}</span>}
                <span className="muted" style={{ fontSize: 12.5 }}>
                  {activated ? t('admin.residents.statusActivated') : r.invited_at ? t('admin.residents.statusInvited') : t('admin.residents.statusNone')}
                  {transfer && <> · {t('admin.residents.xferredFoot', { email: transfer.to_email, date: String(transfer.created_at).slice(0, 10) })}</>}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {/* Transfer ownership — sits next to Send invite. */}
                <button type="button" className="admin-btn-sm" onClick={() => { setXferOpen(o => !o); setXMsg('') }}>
                  {t('admin.residents.xferOpenBtn')}
                </button>
                {/* Resend the link only when the owner is still pending (not yet
                    activated). An activated owner needs no invite. */}
                {!activated && r.email && (
                  <button type="button" className="admin-btn-sm" disabled={inviteBusy} onClick={() => onInvite(r.id)}
                    title={t('admin.residents.inviteBtnTitle')}>
                    {inviteBusy ? t('admin.residents.sendingSingle') : inviteLabel}
                  </button>
                )}
                <button type="button" className="admin-btn-sm admin-btn-warn" onClick={() => onRemove(r.id)}>
                  {t('admin.residents.removeHousehold')}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
