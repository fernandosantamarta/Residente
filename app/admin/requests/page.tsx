'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { EasyVoiceTabs } from '../EasyVoiceTabs'
import { useRequestThread, sendThreadMessage, systemLine, SYS_REOPENED, type ThreadMessage } from '@/lib/requestThread'
import {
  type WorkOrder,
  type WorkOrderStatus,
  type Priority as WoPriority,
  PRIORITIES as WO_PRIORITIES,
  createWorkOrder,
  updateWorkOrderStatus,
  startPatch,
  completePatch,
  cancelPatch,
  recordWorkOrderExpense,
} from '@/lib/workOrders'
import { useT } from '@/lib/i18n'

const withTimeout = <T,>(p: PromiseLike<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

type Category = 'maintenance' | 'appeal' | 'account' | 'other'
type Status = 'new' | 'in_progress' | 'resolved'
type Priority = 'low' | 'normal' | 'urgent'

const PRIORITIES: Priority[] = ['low', 'normal', 'urgent']
// Sort weight so urgent floats to the top, then normal, then low.
const PRIORITY_RANK: Record<string, number> = { urgent: 0, normal: 1, low: 2 }
const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#B42318',   // red
  normal: '#475467',   // slate
  low:    '#067647',   // green
}

const CATS: { value: Category; label: string }[] = [
  { value: 'maintenance', label: 'Maintenance issue' },
  { value: 'appeal',      label: 'Violation appeal' },
  { value: 'account',     label: 'Account question' },
  { value: 'other',       label: 'Other' },
]
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map(c => [c.value, c.label]))
// Color per category — shared by the mailbox list and the conversation header.
const CAT_COLOR: Record<string, string> = {
  maintenance: '#175CD3',   // blue
  appeal:      '#B54708',   // amber
  account:     '#7C3AED',   // purple
  other:       '#475467',   // slate
}
const catColor = (c: string) => CAT_COLOR[c] || '#475467'
// Small squared category tag.
function catTag(c: string): React.CSSProperties {
  const col = catColor(c)
  return { fontSize: 10.5, fontWeight: 700, color: col, background: col + '1A', padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap' }
}

// Small squared priority tag — same shape as the category tag.
function prioTag(p: string): React.CSSProperties {
  const col = PRIORITY_COLOR[p] || '#475467'
  return { fontSize: 10.5, fontWeight: 700, color: col, background: col + '1A', padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap' }
}

const STATUSES: { value: Status; label: string }[] = [
  { value: 'new',         label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved',    label: 'Resolved' },
]
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map(s => [s.value, s.label]))

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

// Status chip + left-accent colors — mirrors the Architectural (ARC) worklist
// cards so the two Easy Voice queues read the same way.
function chip(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 4, whiteSpace: 'nowrap' }
}
const STATUS_COLOR: Record<string, string> = {
  new:         '#175CD3',
  in_progress: '#B54708',
  resolved:    '#067647',
}

// Work-order helpers — used by the compact panel inside the open thread. The
// money/date formatters and the status/priority chip colors mirror the (now
// removed) standalone Work orders page so the panel reads the same way.
const fmtMoney = (n: number | null | undefined) =>
  n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtDateTime = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const WO_STATUS_COLOR: Record<WorkOrderStatus, string> = {
  assigned:    '#175CD3',
  in_progress: '#B54708',
  completed:   '#067647',
  cancelled:   '#475467',
}
const WO_PRIORITY_COLOR: Record<WoPriority, string> = {
  low:       '#475467',
  normal:    '#175CD3',
  urgent:    '#B54708',
  emergency: '#B42318',
}
// datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
const todayPlusDaysLocal = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  const pad = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

type VendorOption = { id: string; name: string; category: string | null }

type Request = {
  id: string
  profile_id: string
  community_id: string
  submitter_name: string | null
  submitter_unit: string | null
  category: string
  subject: string
  body: string | null
  status: string
  created_at: string
  attachment_path: string | null
  attachment_name: string | null
  board_note: string | null
  board_note_at: string | null
  board_note_attachment_path: string | null
  board_note_attachment_name: string | null
  emailed_at: string | null
  origin: string | null   // 'resident' (they submitted) | 'board' (we reached out)
  closed_at: string | null
  replies_locked: boolean | null
  last_message_at: string | null
  last_message_role: string | null
  priority: string | null
  sla_due_at: string | null
  assigned_to: string | null
}

type ResidentOption = { id: string; name: string; unit: string | null; email: string | null }
type BoardMember = { id: string; name: string }

const MAX_FILE = 10 * 1024 * 1024  // 10MB

// Admin → Requests. The board's triage queue for everything residents submit
// from /app/contact — maintenance issues, appeals, questions. Set the status
// to move each one New → In progress → Resolved.
export default function RequestsAdmin() {
  const t = useT()
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState<Request[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  // Mailbox folder by what needs doing (not who started it): Needs reply /
  // Resolved / All. Plus the selected conversation and compose state.
  const [tab, setTab] = useState<'needs' | 'resolved' | 'all'>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [composing, setComposing] = useState(false)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<'all' | Category>('all')
  const [prioFilter, setPrioFilter] = useState<'all' | Priority>('all')
  const [listPage, setListPage] = useState(0)
  // Board roster for the "Assign to" picker (residents.is_board → profiles.id).
  const [boardMembers, setBoardMembers] = useState<BoardMember[]>([])
  // Community vendor list for the in-thread work-order picker.
  const [vendors, setVendors] = useState<VendorOption[]>([])

  // "Message a resident" composer — board-initiated outreach.
  const [residents, setResidents] = useState<ResidentOption[]>([])
  const [compose, setCompose] = useState({ residentId: '', subject: '', message: '', allowReplies: true })
  const [composeFile, setComposeFile] = useState<File | null>(null)
  const [composeErr, setComposeErr] = useState('')
  const [sending, setSending] = useState(false)

  // Translated category labels (hook-safe, inside the component).
  const tCatLabel: Record<string, string> = {
    maintenance: t('admin.requests.catMaintenance'),
    appeal:      t('admin.requests.catAppeal'),
    account:     t('admin.requests.catAccount'),
    other:       t('admin.requests.catOther'),
  }
  // Translated status labels.
  const tStatusLabel: Record<string, string> = {
    new:         t('admin.requests.statusNew'),
    in_progress: t('admin.requests.statusInProgress'),
    resolved:    t('admin.requests.statusResolved'),
  }
  const tStatuses: { value: Status; label: string }[] = [
    { value: 'new',         label: tStatusLabel['new'] },
    { value: 'in_progress', label: tStatusLabel['in_progress'] },
    { value: 'resolved',    label: tStatusLabel['resolved'] },
  ]
  // Translated priority labels for the badge, filter, and per-request dropdown.
  const tPrioLabel: Record<string, string> = {
    low:    t('admin.requests.triagePrioLow'),
    normal: t('admin.requests.triagePrioNormal'),
    urgent: t('admin.requests.triagePrioUrgent'),
  }

  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const { data, error } = await withTimeout(
        supabase!.from('resident_requests').select('*')
          .eq('community_id', communityId)
          .order('created_at', { ascending: false })
      )
      if (error) throw error
      setRows((data as Request[]) || [])
      setStatus('ready')
    } catch (err: any) {
      const msg = err?.message || ''
      if (/schema cache|does not exist|find the table/i.test(msg)) {
        setStatus('none')
      } else {
        setError(msg || t('admin.requests.errorLoadRequests'))
        setStatus('error')
      }
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  // Live refresh: a new resident reply (which stamps last_message_* on the
  // request) or a new submission should surface without a manual reload.
  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    const ch = supabase
      .channel(`admin-requests:${communityId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'resident_requests',
        filter: `community_id=eq.${communityId}`,
      }, () => { load() })
      .subscribe()
    const onFocus = () => load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      supabase!.removeChannel(ch)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [communityId, load])

  // Community roster for the "Message a resident" picker.
  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase!
          .from('profiles')
          .select('id, full_name, unit_number, email')
          .eq('community_id', communityId)
          .order('full_name', { ascending: true })
        if (cancelled) return
        setResidents((data || []).map((p: any) => ({
          id: p.id, name: p.full_name || t('admin.requests.residentFallback'), unit: p.unit_number ?? null, email: p.email ?? null,
        })))
      } catch { /* leave empty */ }
    })()
    return () => { cancelled = true }
  }, [communityId])

  // Board roster for the triage "Assign to" picker. The board lives on
  // residents.is_board; assigned_to references profiles.id, so we key off
  // residents.profile_id (the account behind the roster entry).
  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase!
          .from('residents')
          .select('profile_id, full_name')
          .eq('community_id', communityId)
          .eq('is_board', true)
          .not('profile_id', 'is', null)
          .order('full_name', { ascending: true })
        if (cancelled) return
        setBoardMembers((data || [])
          .filter((r: any) => r.profile_id)
          .map((r: any) => ({ id: r.profile_id as string, name: r.full_name || t('admin.requests.triageBoardFallback') })))
      } catch { /* leave empty — assignment is optional */ }
    })()
    return () => { cancelled = true }
  }, [communityId])

  // Community vendor list for the in-thread work-order picker (community-scoped).
  useEffect(() => {
    if (!hasSupabase || !supabase || !communityId) return
    let cancelled = false
    ;(async () => {
      try {
        const { data } = await supabase!
          .from('vendors')
          .select('id, name, category')
          .eq('community_id', communityId)
          .order('name', { ascending: true })
        if (cancelled) return
        setVendors((data || []).map((v: any) => ({ id: v.id, name: v.name, category: v.category ?? null })))
      } catch { /* leave empty — vendor picker just shows "no vendor" */ }
    })()
    return () => { cancelled = true }
  }, [communityId])

  // Board-initiated message: create a tracked request row owned by the resident
  // (so it shows on their Contact page and in this queue), seed the first board
  // message (optionally with a photo), then email it. origin = 'board' marks who
  // started the thread. board_note stays null — the message lives in the thread,
  // so the seed trigger doesn't also create a duplicate text-only message.
  const sendMessage = async () => {
    const target = residents.find(r => r.id === compose.residentId)
    if (!target) { setComposeErr(t('admin.requests.errPickResident')); return }
    if (!compose.subject.trim()) { setComposeErr(t('admin.requests.errAddSubject')); return }
    if (!compose.message.trim()) { setComposeErr(t('admin.requests.errWriteMessage')); return }
    if (composeFile && composeFile.size > MAX_FILE) { setComposeErr(t('admin.requests.errPhotoSize')); return }
    setSending(true); setComposeErr('')
    try {
      // Upload first (into the resident's folder so their read policy covers it)
      // — if it fails we haven't created an orphaned request.
      let attachmentPath: string | null = null
      let attachmentName: string | null = null
      if (composeFile) {
        const ext = composeFile.name.includes('.') ? composeFile.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${communityId}/${target.id}/${crypto.randomUUID()}.${ext}`
        const up = await withTimeout(supabase!.storage.from('request-attachments').upload(path, composeFile), 30000)
        if ((up as any).error) throw (up as any).error
        attachmentPath = path
        attachmentName = composeFile.name
      }

      const { data: inserted, error } = await withTimeout(
        supabase!.from('resident_requests').insert({
          community_id:   communityId,
          profile_id:     target.id,
          submitter_name: target.name,
          submitter_unit: target.unit,
          category:       'other',
          subject:        compose.subject.trim(),
          body:           null,
          status:         'in_progress',
          origin:         'board',
          board_note:     null,
          replies_locked: !compose.allowReplies,
        }).select('id').single()
      )
      if (error) throw error
      const newId = (inserted as any)?.id as string | undefined
      if (!newId) throw new Error('Could not create the message')

      // Seed the opening board message (carries the photo, if any).
      await sendThreadMessage({
        requestId: newId,
        communityId: communityId!,
        body: compose.message.trim(),
        authorRole: 'board',
        authorId: profile?.id ?? null,
        authorName: 'Board',
        attachmentPath,
        attachmentName,
      })

      let emailed = false
      if (target.email) {
        const { data, error: fnErr } = await supabase!.functions.invoke('request-reply-email', {
          body: { request_id: newId, note: compose.message.trim() },
        })
        if (!fnErr && (data as any)?.email_sent) emailed = true
      }

      setCompose({ residentId: '', subject: '', message: '', allowReplies: true })
      setComposeFile(null)
      setComposing(false)
      setTab('all')
      setSelectedId(newId)
      setSuccessMsg(
        emailed ? t('admin.requests.successMsgEmailed', { name: target.name })
          : target.email ? t('admin.requests.successMsgEmailFailed', { name: target.name })
          : t('admin.requests.successMsgNoEmail', { name: target.name })
      )
      await load()
    } catch (err: any) {
      setComposeErr(err?.message || t('admin.requests.errCouldNotSend'))
    } finally {
      setSending(false)
    }
  }

  const openAttachment = async (path: string) => {
    try {
      const { data } = await supabase!.storage.from('request-attachments').createSignedUrl(path, 3600)
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener')
    } catch { /* ignore */ }
  }

  const setRequestStatus = async (r: Request, next: Status) => {
    const prev = { status: r.status, closed_at: r.closed_at }
    // Resolving a request CLOSES the conversation (stamps closed_at, which the
    // resident's reply box keys off). Any other status reopens it.
    const closedAt = next === 'resolved' ? new Date().toISOString() : null
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, status: next, closed_at: closedAt } : x))   // optimistic
    try {
      const { error } = await withTimeout(
        supabase!.from('resident_requests').update({ status: next, closed_at: closedAt }).eq('id', r.id)
      )
      if (error) throw error
      // Reopening a resolved thread drops a "reopened" line into the conversation
      // so the resident can see it was reopened (and gets re-notified).
      if (r.status === 'resolved' && next !== 'resolved') {
        try {
          await sendThreadMessage({
            requestId: r.id, communityId: r.community_id, body: SYS_REOPENED,
            authorRole: 'board', authorId: profile?.id ?? null, authorName: 'Board',
          })
        } catch { /* non-blocking */ }
      }
      setSuccessMsg(next === 'resolved'
        ? t('admin.requests.successConversationClosed', { name: r.submitter_name || t('admin.requests.theResident') })
        : t('admin.requests.successStatusChanged', { subject: r.subject, status: tStatusLabel[next] || next }))
    } catch (err: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, ...prev } : x))   // roll back
      setError(err?.message || t('admin.requests.errorUpdateRequest'))
    }
  }

  // Lock/unlock resident replies on a thread (a one-way message vs. a back-and-
  // forth). Enforced in RLS too — the UI just mirrors it.
  const setRepliesLocked = async (r: Request, locked: boolean) => {
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, replies_locked: locked } : x))   // optimistic
    try {
      const { error } = await withTimeout(
        supabase!.from('resident_requests').update({ replies_locked: locked }).eq('id', r.id)
      )
      if (error) throw error
      setSuccessMsg(locked ? t('admin.requests.successRepliesOff') : t('admin.requests.successRepliesOn'))
    } catch (err: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, replies_locked: !locked } : x))   // roll back
      setError(err?.message || t('admin.requests.errorUpdateRequest'))
    }
  }

  // Triage: set a request's priority (low / normal / urgent). Optimistic, with
  // rollback on failure — mirrors the status/lock writers.
  const setRequestPriority = async (r: Request, next: Priority) => {
    const prev = r.priority
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, priority: next } : x))   // optimistic
    try {
      const { error } = await withTimeout(
        supabase!.from('resident_requests').update({ priority: next }).eq('id', r.id)
      )
      if (error) throw error
      setSuccessMsg(t('admin.requests.triageSuccessPriority', { subject: r.subject, priority: tPrioLabel[next] || next }))
    } catch (err: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, priority: prev } : x))   // roll back
      setError(err?.message || t('admin.requests.errorUpdateRequest'))
    }
  }

  // Triage: assign a request to a board member (or unassign with '').
  const setRequestAssignee = async (r: Request, assignedTo: string) => {
    const prev = r.assigned_to
    const next = assignedTo || null
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, assigned_to: next } : x))   // optimistic
    try {
      const { error } = await withTimeout(
        supabase!.from('resident_requests').update({ assigned_to: next }).eq('id', r.id)
      )
      if (error) throw error
      const who = boardMembers.find(b => b.id === next)?.name
      setSuccessMsg(next
        ? t('admin.requests.triageSuccessAssigned', { subject: r.subject, name: who || t('admin.requests.triageBoardFallback') })
        : t('admin.requests.triageSuccessUnassigned', { subject: r.subject }))
    } catch (err: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, assigned_to: prev } : x))   // roll back
      setError(err?.message || t('admin.requests.errorUpdateRequest'))
    }
  }

  // A thread is "awaiting your reply" when the last message was the resident's
  // and it isn't closed — the board owes a response.
  const awaiting = (r: Request) => r.last_message_role === 'resident' && r.status !== 'resolved'
  const lastActivity = (r: Request) =>
    (r.last_message_at && r.last_message_at > r.created_at ? r.last_message_at : r.created_at)
  const byActivity = (a: Request, b: Request) => lastActivity(b).localeCompare(lastActivity(a))

  // Triage rank: an open URGENT thread that's awaiting your reply is the most
  // pressing thing in the queue, so it floats above everything else.
  const prioRank = (r: Request) => PRIORITY_RANK[r.priority || 'normal'] ?? 1
  const urgentAwaiting = (r: Request) => r.priority === 'urgent' && awaiting(r)

  // Every conversation, sorted: urgent+awaiting first, then awaiting-reply, then
  // by priority, then newest activity. Folders are just filtered views of this
  // one list (no more confusing Received/Sent split).
  const allSorted = [...rows]
    .sort((a, b) =>
      (urgentAwaiting(b) ? 1 : 0) - (urgentAwaiting(a) ? 1 : 0) ||
      (awaiting(b) ? 1 : 0) - (awaiting(a) ? 1 : 0) ||
      prioRank(a) - prioRank(b) ||
      byActivity(a, b))
  const needsList = allSorted.filter(awaiting)
  const resolvedList = allSorted.filter(r => r.status === 'resolved')
  const awaitingCount = needsList.length
  const activeList = tab === 'needs' ? needsList : tab === 'resolved' ? resolvedList : allSorted
  // Search + category filter narrow the visible list.
  const q = search.trim().toLowerCase()
  const shownList = activeList.filter(r => {
    if (catFilter !== 'all' && r.category !== catFilter) return false
    if (prioFilter !== 'all' && (r.priority || 'normal') !== prioFilter) return false
    if (q && !`${r.submitter_name || ''} ${r.subject || ''}`.toLowerCase().includes(q)) return false
    return true
  })
  // Paginate the mailbox list so long inboxes stay manageable.
  const LIST_PAGE = 12
  const listPageCount = Math.max(1, Math.ceil(shownList.length / LIST_PAGE))
  const listPg = Math.min(listPage, listPageCount - 1)
  const pagedList = shownList.slice(listPg * LIST_PAGE, listPg * LIST_PAGE + LIST_PAGE)
  const selected = rows.find(r => r.id === selectedId) || null

  // Opening a thread whose last message is the resident's marks it "seen" for the
  // Easy Voice nav badge. The receipt lives server-side (board_read_receipts, per
  // board member) so it clears the badge on every device this member uses, not
  // just this browser. This is what stops an already-read message from
  // re-notifying — the badge clears the moment you open it, even before you reply.
  // It does NOT touch the "Needs reply" folder, which still lists every unanswered
  // thread so nothing a resident is waiting on falls through.
  useEffect(() => {
    if (!hasSupabase || !supabase || !profile?.id) return
    if (!selected || selected.last_message_role !== 'resident') return
    const itemId = selected.id
    ;(async () => {
      try {
        await supabase!.from('board_read_receipts').upsert(
          { profile_id: profile.id, item_type: 'request', item_id: itemId, read_at: new Date().toISOString() },
          { onConflict: 'profile_id,item_type,item_id' },
        )
        window.dispatchEvent(new Event('board-read'))
      } catch { /* receipts table may not exist yet — non-fatal */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selected?.last_message_at, selected?.last_message_role])

  // Back to page 1 whenever the folder, search, category, or priority filter changes.
  useEffect(() => { setListPage(0) }, [tab, search, catFilter, prioFilter])

  // Keep a valid selection: when the folder/list changes, fall back to the first
  // conversation in view (and never point at a row from the other folder).
  useEffect(() => {
    if (composing) return
    if (!activeList.some(r => r.id === selectedId)) {
      setSelectedId(activeList[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, rows.length, composing])

  return (
    <div className="admin-page cset">
      <EasyVoiceTabs active="contact" />
      <div className="admin-kicker">{t('admin.requests.kicker')}</div>
      <h1 className="admin-h1" style={{ display: 'inline-flex', alignItems: 'center' }}>
        {t('admin.requests.heading')}
        {awaitingCount > 0 && <span className="admin-nav-badge" title={t('admin.requests.badgeTitle')}>{awaitingCount}</span>}
      </h1>
      <p className="admin-dek">
        {t('admin.requests.dek')}
        <strong> {t('admin.requests.dekNeedsReply')}</strong> {t('admin.requests.dekSuffix')}
      </p>

      {(status === 'ready' || status === 'loading') && awaitingCount > 0 && (
        <button
          type="button"
          onClick={() => { setTab('needs'); setComposing(false); if (needsList[0]) setSelectedId(needsList[0].id) }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', marginBottom: 14, background: 'rgba(229,72,77,0.07)', border: '1px solid rgba(229,72,77,0.28)', borderRadius: 10, padding: '11px 14px', font: 'inherit' }}
        >
          <span className="con-pending-dot" />
          <span style={{ fontSize: 13.5, fontWeight: 700, color: '#B42318' }}>
            {awaitingCount === 1
              ? t('admin.requests.awaitingBannerSingular')
              : t('admin.requests.awaitingBannerPlural', { count: awaitingCount })}
          </span>
          <span style={{ marginLeft: 'auto', fontWeight: 800, color: '#E5484D' }}>{t('admin.requests.viewArrow')}</span>
        </button>
      )}

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          {t('admin.requests.noCommunityNote')}
        </div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.requests.retry')}</button>
        </div>
      )}

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {/* Folder tabs + compose */}
          <div className="msg-head-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            <div className="seg-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'all'}
                className={`seg-tab${tab === 'all' ? ' active' : ''}`}
                onClick={() => { setTab('all'); setComposing(false) }}>
                {t('admin.requests.tabAll')}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'needs'}
                className={`seg-tab${tab === 'needs' ? ' active' : ''}`}
                onClick={() => { setTab('needs'); setComposing(false) }}>
                {t('admin.requests.tabNeedsReply')}
                {awaitingCount > 0 && <span className="seg-tab-badge">{awaitingCount}</span>}
              </button>
              <button type="button" role="tab" aria-selected={tab === 'resolved'}
                className={`seg-tab${tab === 'resolved' ? ' active' : ''}`}
                onClick={() => { setTab('resolved'); setComposing(false) }}>
                {t('admin.requests.tabResolved')}
              </button>
            </div>
            <span className="msg-head-actions" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <div className="msg-head-cat" style={{ width: 160 }}>
                <Dropdown<'all' | Priority>
                  value={prioFilter}
                  onChange={setPrioFilter}
                  ariaLabel={t('admin.requests.triageFilterByPriorityLabel')}
                  options={[{ value: 'all', label: t('admin.requests.triageAllPriorities') }, ...PRIORITIES.map(p => ({ value: p, label: tPrioLabel[p] || p }))]}
                />
              </div>
              <div className="msg-head-cat" style={{ width: 180 }}>
                <Dropdown<'all' | Category>
                  value={catFilter}
                  onChange={setCatFilter}
                  ariaLabel={t('admin.requests.filterByCategoryLabel')}
                  options={[{ value: 'all', label: t('admin.requests.allCategories') }, ...CATS.map(c => ({ value: c.value, label: tCatLabel[c.value] || c.label }))]}
                />
              </div>
              <button type="button" className="admin-primary-btn"
                onClick={() => { setComposing(true); setSelectedId(null) }}>
                {t('admin.requests.newMessage')}
              </button>
            </span>
          </div>

          {/* Two-pane on desktop; single-pane Messages flow on mobile (the
              has-selection class drives which pane shows — see admin.css). */}
          <div className={`msg-layout${(selected || composing) ? ' has-selection' : ''}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(230px, 320px) 1fr', minHeight: 460 }}>
            {/* LEFT — mailbox list */}
            <div style={{ borderRight: '1px solid var(--border)', maxHeight: 640, overflowY: 'auto' }}>
              {/* Search */}
              <div style={{ position: 'sticky', top: 0, zIndex: 1, background: 'var(--bg-elev)', borderBottom: '1px solid var(--border)', padding: 8 }}>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ position: 'absolute', left: 9, pointerEvents: 'none' }}>
                    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder={t('admin.requests.searchPlaceholder')}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '7px 9px 7px 28px', fontSize: 12.5, font: 'inherit', color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 4, outline: 'none' }}
                  />
                </div>
              </div>
              {status === 'loading' && <div className="admin-note" style={{ margin: 12 }}>{t('admin.requests.loading')}</div>}
              {status === 'ready' && activeList.length === 0 && (
                <div style={{ padding: '24px 16px', color: 'var(--text-dim)', fontSize: 13 }}>
                  {tab === 'needs' ? t('admin.requests.emptyNeedsReply')
                    : tab === 'resolved' ? t('admin.requests.emptyResolved')
                    : t('admin.requests.emptyAll')}
                </div>
              )}
              {status === 'ready' && activeList.length > 0 && shownList.length === 0 && (
                <div style={{ padding: '20px 16px', color: 'var(--text-dim)', fontSize: 13 }}>{t('admin.requests.noMatches', { search })}</div>
              )}
              {pagedList.map(r => {
                const sel = selected?.id === r.id
                const need = awaiting(r)
                return (
                  <button key={r.id} type="button"
                    onClick={() => { setSelectedId(r.id); setComposing(false) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none', borderRadius: 0, borderBottom: '1px solid var(--border)', borderLeft: `3px solid ${sel ? '#E14909' : 'transparent'}`, background: sel ? 'rgba(225,73,9,0.06)' : 'transparent', padding: '10px 14px', font: 'inherit' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.submitter_name || t('admin.requests.residentFallback')}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)', whiteSpace: 'nowrap', flexShrink: 0 }}>{fmtDate(lastActivity(r))}</span>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{r.subject}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, minHeight: 16, flexWrap: 'wrap' }}>
                      {(r.priority === 'urgent' || r.priority === 'low') && (
                        <span style={prioTag(r.priority)}>{tPrioLabel[r.priority] || r.priority}</span>
                      )}
                      <span style={catTag(r.category)}>{tCatLabel[r.category] || r.category}</span>
                      {need && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#E14909' }}>
                          <span style={{ width: 6, height: 6, borderRadius: 1, background: '#E14909' }} />{t('admin.requests.awaitingReply')}
                        </span>
                      )}
                      {!need && r.status === 'resolved' && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{t('admin.requests.statusResolved')}</span>}
                      {r.replies_locked && <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>· {t('admin.requests.repliesOff')}</span>}
                    </div>
                  </button>
                )
              })}
              {listPageCount > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', borderTop: '1px solid var(--border)', position: 'sticky', bottom: 0, background: 'var(--bg-elev)' }}>
                  <button type="button" className="admin-btn-ghost" style={{ marginLeft: 0 }}
                    onClick={() => setListPage(p => Math.max(0, p - 1))} disabled={listPg === 0}>{t('admin.requests.prevPage')}</button>
                  <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{listPg + 1} / {listPageCount}</span>
                  <button type="button" className="admin-btn-ghost" style={{ marginLeft: 0 }}
                    onClick={() => setListPage(p => Math.min(listPageCount - 1, p + 1))} disabled={listPg >= listPageCount - 1}>{t('admin.requests.nextPage')}</button>
                </div>
              )}
            </div>

            {/* RIGHT — composer / conversation / empty */}
            <div style={{ padding: 16, minWidth: 0 }}>
              {/* Mobile-only: back to the conversation list. */}
              <button type="button" className="msg-back" onClick={() => { setSelectedId(null); setComposing(false) }}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                {t('admin.requests.backToList')}
              </button>
              {composing ? (
                <div>
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>{t('admin.requests.newMessage')}</h2>
                  <p style={{ fontSize: 12.5, color: 'var(--text-dim)', margin: '0 0 14px' }}>{t('admin.requests.composerDek')}</p>
                  <div style={{ display: 'grid', gap: 12 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.requests.labelResident')}</label>
                      <Dropdown<string>
                        value={compose.residentId}
                        onChange={v => setCompose(c => ({ ...c, residentId: v }))}
                        ariaLabel={t('admin.requests.labelResident')}
                        options={[
                          { value: '', label: t('admin.requests.selectResident') },
                          ...residents.map(r => ({ value: r.id, label: `${r.name}${r.unit ? ` · ${r.unit}` : ''}${r.email ? '' : ` (${t('admin.requests.noEmail')})`}` })),
                        ]}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.requests.labelSubject')}</label>
                      <input className="admin-input" style={{ width: '100%', boxSizing: 'border-box' }}
                        value={compose.subject} onChange={e => setCompose(c => ({ ...c, subject: e.target.value }))}
                        placeholder={t('admin.requests.subjectPlaceholder')} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text)', marginBottom: 5 }}>{t('admin.requests.labelMessage')}</label>
                      <textarea className="admin-input admin-textarea" rows={4} style={{ width: '100%', boxSizing: 'border-box' }}
                        value={compose.message} onChange={e => setCompose(c => ({ ...c, message: e.target.value }))}
                        placeholder={t('admin.requests.messagePlaceholder')} />
                    </div>
                    {composeErr && <div className="admin-note admin-note-err">{composeErr}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#E14909' }}>
                          <input type="file" accept="image/*" hidden onChange={e => setComposeFile(e.target.files?.[0] || null)} />
                          <Clip />
                          {composeFile ? composeFile.name : t('admin.requests.attachPhoto')}
                        </label>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12.5, color: 'var(--text-dim)' }}>
                          <input type="checkbox" checked={compose.allowReplies} onChange={e => setCompose(c => ({ ...c, allowReplies: e.target.checked }))} />
                          {t('admin.requests.allowResidentReply')}
                        </label>
                      </span>
                      <span style={{ display: 'inline-flex', gap: 8 }}>
                        <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" onClick={() => { setComposing(false); setComposeFile(null) }}>{t('admin.requests.cancel')}</button>
                        <button type="button" className="admin-primary-btn" onClick={sendMessage} disabled={sending}>
                          {sending ? t('admin.requests.sending') : t('admin.requests.sendMessage')}
                        </button>
                      </span>
                    </div>
                  </div>
                </div>
              ) : selected ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start', borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text)' }}>{selected.subject}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 2 }}>
                        {selected.submitter_name || t('admin.requests.residentFallback')}{selected.submitter_unit ? ` · ${selected.submitter_unit}` : ''} · {fmtDate(selected.created_at)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {(selected.priority === 'urgent' || selected.priority === 'low') && (
                        <span style={chip(PRIORITY_COLOR[selected.priority] || '#475467')}>{tPrioLabel[selected.priority] || selected.priority}</span>
                      )}
                      <span style={chip(catColor(selected.category))}>{tCatLabel[selected.category] || selected.category}</span>
                      {selected.replies_locked && <span style={chip('#475467')}>{t('admin.requests.repliesOff')}</span>}
                      {selected.origin === 'board' && <span style={chip('#7C3AED')}>{t('admin.requests.outbound')}</span>}
                      <span style={chip(STATUS_COLOR[selected.status] || '#475467')}>{tStatusLabel[selected.status] || selected.status}</span>
                    </div>
                  </div>
                  {/* Triage controls: priority + assignee. Both write back to the
                      request and re-sort the queue. */}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', paddingTop: 12 }}>
                    <div style={{ minWidth: 150 }}>
                      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4 }}>{t('admin.requests.triagePriorityLabel')}</label>
                      <Dropdown<Priority>
                        value={(selected.priority as Priority) || 'normal'}
                        onChange={p => setRequestPriority(selected, p)}
                        ariaLabel={t('admin.requests.triagePriorityLabel')}
                        options={PRIORITIES.map(p => ({ value: p, label: tPrioLabel[p] || p }))}
                      />
                    </div>
                    <div style={{ minWidth: 180 }}>
                      <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4 }}>{t('admin.requests.triageAssignLabel')}</label>
                      <Dropdown<string>
                        value={selected.assigned_to || ''}
                        onChange={v => setRequestAssignee(selected, v)}
                        ariaLabel={t('admin.requests.triageAssignLabel')}
                        options={[
                          { value: '', label: t('admin.requests.triageUnassigned') },
                          ...boardMembers.map(b => ({ value: b.id, label: b.name })),
                        ]}
                      />
                    </div>
                  </div>
                  <AdminThread
                    request={selected}
                    profileId={profile?.id}
                    vendors={vendors}
                    openAttachment={openAttachment}
                    onSent={msg => setSuccessMsg(msg)}
                    onSetStatus={setRequestStatus}
                    onSetLocked={setRepliesLocked}
                  />
                </>
              ) : (
                <div style={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 360, color: 'var(--text-dim)', fontSize: 13, textAlign: 'center' }}>
                  <div>
                    <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="var(--border-hover)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 10 }}>
                      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
                    </svg>
                    <div>{t('admin.requests.emptySelectHint')}</div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Clip() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.5-7.5" />
    </svg>
  )
}

const fmtMsgTime = (d: string) =>
  new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// The board side of a Contact thread: the full message log plus a reply box.
// A board reply posts a 'board' message and (by default) emails the resident.
function AdminThread({
  request, profileId, vendors, openAttachment, onSent, onSetStatus, onSetLocked,
}: {
  request: Request
  profileId?: string
  vendors: VendorOption[]
  openAttachment: (path: string) => void
  onSent: (msg: string) => void
  onSetStatus: (r: Request, next: Status) => Promise<void>
  onSetLocked: (r: Request, locked: boolean) => Promise<void>
}) {
  const t = useT()
  const { messages, loading, reload } = useRequestThread(request.id)
  const [draft, setDraft] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [emailIt, setEmailIt] = useState(true)
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState('')
  const [expanded, setExpanded] = useState(false)   // closed convos minimize until expanded
  const closed = request.status === 'resolved'
  const locked = !!request.replies_locked

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sending && (draft.trim() || file)) send() }
  }

  const send = async () => {
    const text = draft.trim()
    if (!text && !file) return
    if (file && file.size > MAX_FILE) { setErr(t('admin.requests.errPhotoSize')); return }
    setSending(true); setErr('')
    try {
      let attachmentPath: string | null = null
      let attachmentName: string | null = null
      if (file) {
        // Upload into the resident's own folder so their read policy covers it.
        const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${request.community_id}/${request.profile_id}/${crypto.randomUUID()}.${ext}`
        const up = await supabase!.storage.from('request-attachments').upload(path, file)
        if ((up as any).error) throw (up as any).error
        attachmentPath = path
        attachmentName = file.name
      }
      await sendThreadMessage({
        requestId: request.id,
        communityId: request.community_id,
        body: text || '(photo)',
        authorRole: 'board',
        authorId: profileId ?? null,
        authorName: 'Board',
        attachmentPath,
        attachmentName,
      })
      let emailed = false
      if (emailIt && text) {
        const { data, error: fnErr } = await supabase!.functions.invoke('request-reply-email', {
          body: { request_id: request.id, note: text },
        })
        if (!fnErr && (data as any)?.email_sent) emailed = true
        else setErr((data as any)?.error || fnErr?.message || t('admin.requests.errEmailNotSent'))
      }
      setDraft(''); setFile(null)
      await reload()
      onSent(emailed
        ? t('admin.requests.successReplySentEmailed', { name: request.submitter_name || t('admin.requests.theResident') })
        : t('admin.requests.successReplyPosted', { name: request.submitter_name || t('admin.requests.theResident') }))
    } catch (e: any) {
      setErr(e?.message || t('admin.requests.errCouldNotSendReply'))
    } finally {
      setSending(false)
    }
  }

  const messageLog = (
    <div className="imsg-log">
      {loading && messages.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text-dim)', textAlign: 'center' }}>{t('admin.requests.loading')}</div>}
      {messages.map((m, i) => {
        const sys = systemLine(m.body)
        if (sys) {
          return <div key={m.id} className="imsg-sys">↻ {sys} · {fmtMsgTime(m.createdAt)}</div>
        }
        const board = m.authorRole === 'board'
        const prev = messages[i - 1]
        const next = messages[i + 1]
        const newGroup = !prev || !!systemLine(prev.body) || prev.authorRole !== m.authorRole
        const lastOfGroup = !next || !!systemLine(next.body) || next.authorRole !== m.authorRole
        const who = board ? (m.authorName || 'Board') : (m.authorName || t('admin.requests.residentFallback'))
        return (
          <div key={m.id} className={`imsg-row ${board ? 'sent' : 'recv'}${newGroup ? ' newgroup' : ''}`}>
            <div className="imsg-bubble">
              {m.body}
              {m.attachmentPath && (
                <button type="button" className="imsg-attach" onClick={() => openAttachment(m.attachmentPath!)}>
                  <Clip />{m.attachmentName || t('admin.requests.viewPhoto')}
                </button>
              )}
            </div>
            {lastOfGroup && <div className="imsg-meta">{who} · {fmtMsgTime(m.createdAt)}</div>}
          </div>
        )
      })}
    </div>
  )

  // Closed → minimize to a resolved summary bar; expand on demand to read it all.
  if (closed) {
    return (
      <div style={{ marginTop: 12 }}>
        <div role="button" tabIndex={0} aria-expanded={expanded} className="msg-resolved-bar"
          onClick={() => setExpanded(e => !e)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(x => !x) } }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span style={{ width: 22, height: 22, borderRadius: 999, background: '#1F7A4D', color: '#fff', display: 'inline-grid', placeItems: 'center', flexShrink: 0 }}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 13 4 4L19 7" /></svg>
            </span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12.5 }}>
              <span style={{ color: '#1F7A4D', fontWeight: 700 }}>{t('admin.requests.statusResolved')}</span>
              <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>
                {request.closed_at ? ` · ${fmtDate(request.closed_at)}` : ''} · {messages.length === 1
                  ? t('admin.requests.messageCountSingular')
                  : t('admin.requests.messageCountPlural', { count: messages.length })}
              </span>
            </span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
            <span style={{ fontSize: 11.5, color: 'var(--text-dim)', whiteSpace: 'nowrap', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {expanded ? t('admin.requests.hide') : t('admin.requests.viewConversation')}
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </span>
            <button type="button" onClick={e => { e.stopPropagation(); onSetStatus(request, 'in_progress') }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#E14909', font: 'inherit', fontSize: 12, fontWeight: 700, padding: 0, whiteSpace: 'nowrap' }}>
              {t('admin.requests.reopen')}
            </button>
          </span>
        </div>
        {expanded && <div style={{ marginTop: 12 }}>{messageLog}</div>}
      </div>
    )
  }

  return (
    <div style={{ marginTop: 12 }}>
      {messageLog}
      {/* Work-order panel — turn this maintenance thread into a tracked vendor
          job (create, assign, advance) without leaving the conversation. */}
      <WorkOrderPanel request={request} profileId={profileId} vendors={vendors} openAttachment={openAttachment} onSent={onSent} />
      {(
        <>
          {/* iMessage-style composer: a rounded field with an attach clip, plus a
              circular send button. */}
          <div className="imsg-composer">
            <div className="imsg-field">
              <textarea
                id={`reply-${request.id}`}
                rows={1}
                placeholder={t('admin.requests.replyPlaceholder')}
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
                aria-label={t('admin.requests.replyLabel')}
              />
              <label className={`imsg-clip${file ? ' has-file' : ''}`} title={file ? file.name : t('admin.requests.attachPhoto')}>
                <input type="file" accept="image/*" hidden onChange={e => setFile(e.target.files?.[0] || null)} />
                <Clip />
              </label>
            </div>
            <button type="button" className="imsg-send" onClick={send} disabled={sending || (!draft.trim() && !file)} aria-label={t('admin.requests.sendReply')}>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20V5M5 12l7-7 7 7" /></svg>
            </button>
          </div>
          {file && <div className="imsg-composer-opts" style={{ color: '#E14909' }}>{file.name}</div>}
          {err && <div className="admin-note admin-note-err" style={{ marginTop: 8 }}>{err}</div>}
          {/* Email toggle — on-theme orange. */}
          <div className="imsg-composer-opts">
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: '#E14909', fontWeight: 600 }}>
              <input type="checkbox" checked={emailIt} onChange={e => setEmailIt(e.target.checked)} style={{ accentColor: '#E14909' }} />
              {t('admin.requests.emailResident')}
            </label>
          </div>
          {/* Secondary management — both actions on one row, pushed right, orange. */}
          <div className="imsg-composer-opts" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
            <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" style={{ marginLeft: 0, color: '#E14909', borderColor: 'rgba(225,73,9,0.45)' }} onClick={() => onSetLocked(request, !locked)}>
              {locked ? t('admin.requests.allowReplies') : t('admin.requests.turnOffReplies')}
            </button>
            <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" style={{ marginLeft: 0, color: '#E14909', borderColor: 'rgba(225,73,9,0.45)' }} onClick={() => onSetStatus(request, 'resolved')}>
              {t('admin.requests.closeConversation')}
            </button>
          </div>
          {locked && (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 8 }}>
              {t('admin.requests.repliesLockedNote')}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Small squared chip — same shape as the thread's status chip, sized for the
// inline work-order summary row.
function woChip(color: string): React.CSSProperties {
  return { fontSize: 11.5, fontWeight: 700, color, background: color + '14', padding: '3px 9px', borderRadius: 4, whiteSpace: 'nowrap' }
}

// Compact work-order panel that lives inside the open maintenance thread. It
// replaces the old standalone /admin/work-orders page: the board can turn the
// conversation into a tracked vendor job (assign a vendor, set priority + SLA),
// then advance it Assigned → In progress → Completed (recording the actual cost,
// notes, and an optional photo) — all without leaving the thread. Existing thread
// features (messages, reply, status, triage) are untouched; this is additive.
function WorkOrderPanel({
  request, profileId, vendors, openAttachment, onSent,
}: {
  request: Request
  profileId?: string
  vendors: VendorOption[]
  openAttachment: (path: string) => void
  onSent: (msg: string) => void
}) {
  const t = useT()
  const [wo, setWo] = useState<WorkOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Create form (collapsed by default).
  const [creating, setCreating] = useState(false)
  const [vendorId, setVendorId] = useState('')
  const [priority, setPriority] = useState<WoPriority>('normal')
  const [estimate, setEstimate] = useState('')
  const [slaDueAt, setSlaDueAt] = useState('')
  const [saving, setSaving] = useState(false)

  // Completion form (revealed by the Complete action).
  const [completing, setCompleting] = useState(false)
  const [actualCost, setActualCost] = useState('')
  const [notes, setNotes] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [completeSaving, setCompleteSaving] = useState(false)

  // Budget integration: categories for the completion form's "file this spend
  // to" picker (a completed work order's cost becomes a community expense).
  const [budgetCats, setBudgetCats] = useState<{ id: string; name: string }[]>([])
  const [expenseCat, setExpenseCat] = useState('')

  // Translated work-order labels (reuse the existing admin.workOrders.* keys).
  const woStatusLabel: Record<WorkOrderStatus, string> = {
    assigned:    t('admin.workOrders.statusAssigned'),
    in_progress: t('admin.workOrders.statusInProgress'),
    completed:   t('admin.workOrders.statusCompleted'),
    cancelled:   t('admin.workOrders.statusCancelled'),
  }
  const woPrioLabel: Record<WoPriority, string> = {
    low:       t('admin.workOrders.priorityLow'),
    normal:    t('admin.workOrders.priorityNormal'),
    urgent:    t('admin.workOrders.priorityUrgent'),
    emergency: t('admin.workOrders.priorityEmergency'),
  }
  const vendorName = (id: string | null) =>
    id ? (vendors.find(v => v.id === id)?.name || t('admin.workOrders.unknownVendor')) : t('admin.workOrders.noVendor')

  // Newest work order for THIS request. No by-request helper exists in
  // lib/workOrders.ts (listWorkOrders filters status/priority/vendor only), so a
  // single scoped select is the minimal query here.
  const loadWo = useCallback(async () => {
    if (!hasSupabase || !supabase) { setLoading(false); return }
    setLoading(true); setErr('')
    try {
      const { data, error } = await withTimeout(
        supabase!.from('work_orders').select('*')
          .eq('request_id', request.id)
          .order('created_at', { ascending: false })
          .limit(1)
      )
      if (error) throw error
      setWo(((data as WorkOrder[]) || [])[0] || null)
    } catch (e: any) {
      const msg = e?.message || ''
      // Table missing (feature not provisioned) → just hide the panel silently.
      if (/schema cache|does not exist|find the table/i.test(msg)) setWo(null)
      else setErr(msg || t('admin.workOrders.errorLoad'))
    } finally {
      setLoading(false)
    }
  }, [request.id, t])
  useEffect(() => { loadWo() }, [loadWo])

  // Load this community's budget categories so the board can file the completed
  // work order's cost against a budget line; pre-select a maintenance/repair
  // category when one exists.
  useEffect(() => {
    if (!hasSupabase || !supabase) return
    let cancelled = false
    supabase.from('budget_categories').select('id, name').eq('community_id', request.community_id)
      .then(({ data }) => {
        if (cancelled) return
        const cats = ((data as { id: string; name: string }[]) || [])
        setBudgetCats(cats)
        const m = cats.find(c => /maint|repair|upkeep/i.test(c.name))
        if (m) setExpenseCat(m.id)
      })
    return () => { cancelled = true }
  }, [request.community_id])

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (estimate !== '' && (isNaN(Number(estimate)) || Number(estimate) < 0)) { setErr(t('admin.workOrders.errCost')); return }
    setSaving(true); setErr('')
    try {
      const created = await createWorkOrder({
        communityId: request.community_id,
        assignedBy: profileId ?? null,
        title: request.subject,
        description: request.body || null,
        requestId: request.id,
        vendorId: vendorId || null,
        priority,
        estimatedCost: estimate === '' ? null : Number(estimate),
        slaDueAt: slaDueAt ? new Date(slaDueAt).toISOString() : null,
      })
      setWo(created)
      setCreating(false)
      setVendorId(''); setPriority('normal'); setEstimate(''); setSlaDueAt('')
      onSent(t('admin.workOrders.successCreated', { title: created.title }))
    } catch (e: any) {
      setErr(e?.message || t('admin.workOrders.errCreate'))
    } finally {
      setSaving(false)
    }
  }

  const startWork = async () => {
    if (!wo) return
    setErr('')
    try {
      const updated = await updateWorkOrderStatus(wo.id, startPatch())
      setWo(updated)
      onSent(t('admin.workOrders.successStarted', { title: updated.title }))
    } catch (e: any) {
      setErr(e?.message || t('admin.workOrders.errUpdate'))
    }
  }

  const cancelWork = async () => {
    if (!wo) return
    setErr('')
    try {
      const updated = await updateWorkOrderStatus(wo.id, cancelPatch())
      setWo(updated)
      onSent(t('admin.workOrders.successCancelled', { title: updated.title }))
    } catch (e: any) {
      setErr(e?.message || t('admin.workOrders.errUpdate'))
    }
  }

  const submitComplete = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!wo) return
    if (actualCost !== '' && (isNaN(Number(actualCost)) || Number(actualCost) < 0)) { setErr(t('admin.workOrders.errCost')); return }
    if (photo && photo.size > MAX_FILE) { setErr(t('admin.workOrders.errPhotoSize')); return }
    setCompleteSaving(true); setErr('')
    try {
      let photoPath: string | null = null
      let photoName: string | null = null
      if (photo && supabase) {
        const ext = photo.name.includes('.') ? photo.name.split('.').pop()!.toLowerCase() : 'bin'
        const path = `${request.community_id}/${wo.id}/${crypto.randomUUID()}.${ext}`
        const up = await supabase.storage.from('request-attachments').upload(path, photo)
        if ((up as any).error) throw (up as any).error
        photoPath = path
        photoName = photo.name
      }
      const updated = await updateWorkOrderStatus(wo.id, completePatch({
        actualCost: actualCost === '' ? null : Number(actualCost),
        notes: notes.trim() || null,
        photoPath,
        photoName,
      }))
      // Budget integration: file the actual cost as a community expense
      // (idempotent). Wrapped so a missing migration / RLS hiccup never blocks
      // the completion itself.
      const spent = actualCost === '' ? null : Number(actualCost)
      let budgetMsg = ''
      if (spent != null && spent > 0) {
        try {
          const recorded = await recordWorkOrderExpense({
            communityId: request.community_id,
            workOrderId: wo.id,
            amount: spent,
            vendor: vendorName(wo.vendor_id),
            description: request.subject,
            categoryId: expenseCat || null,
            createdBy: profileId ?? null,
          })
          if (recorded) budgetMsg = ' ' + t('admin.requests.woExpenseRecorded', { amount: fmtMoney(spent) })
        } catch { /* expense is a nicety; never block completion on it */ }
      }
      setWo(updated)
      setCompleting(false)
      setActualCost(''); setNotes(''); setPhoto(null)
      onSent(t('admin.workOrders.successCompleted', { title: updated.title }) + budgetMsg)
    } catch (e: any) {
      setErr(e?.message || t('admin.workOrders.errUpdate'))
    } finally {
      setCompleteSaving(false)
    }
  }

  if (loading) return null

  const card: React.CSSProperties = {
    marginTop: 14, padding: '12px 14px', border: '1px solid var(--border)',
    borderRadius: 10, background: 'var(--bg-elev)',
  }
  const labelCss: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--text-dim)', marginBottom: 4 }

  // No work order yet — offer to create one (collapsed control + inline form).
  if (!wo) {
    return (
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0, flex: '1 1 200px' }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{t('admin.requests.woPanelTitle')}</div>
            {!creating && (
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>{t('admin.requests.woNoneHint')}</div>
            )}
          </div>
          {!creating && (
            <button type="button" className="admin-primary-btn" style={{ flexShrink: 0 }} onClick={() => { setCreating(true); setErr(''); setSlaDueAt(todayPlusDaysLocal(7)) }}>
              {t('admin.requests.woCreate')}
            </button>
          )}
        </div>
        {creating && (
          <form onSubmit={submitCreate} style={{ display: 'grid', gap: 10, marginTop: 10 }}>
            <div>
              <label style={labelCss}>{t('admin.workOrders.labelVendor')}</label>
              <Dropdown<string>
                value={vendorId}
                onChange={setVendorId}
                ariaLabel={t('admin.workOrders.labelVendor')}
                options={[
                  { value: '', label: t('admin.workOrders.noVendorYet') },
                  ...vendors.map(v => ({ value: v.id, label: v.category ? `${v.name} · ${v.category}` : v.name })),
                ]}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={labelCss}>{t('admin.workOrders.labelPriority')}</label>
                <Dropdown<WoPriority>
                  value={priority}
                  onChange={setPriority}
                  ariaLabel={t('admin.workOrders.labelPriority')}
                  options={WO_PRIORITIES.map(p => ({ value: p, label: woPrioLabel[p] }))}
                />
              </div>
              <div>
                <label style={labelCss}>{t('admin.workOrders.labelEstimate')}</label>
                <input className="admin-input" type="number" min="0" step="0.01" inputMode="decimal" style={{ width: '100%', boxSizing: 'border-box' }}
                  value={estimate} onChange={e => setEstimate(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div>
              <label style={labelCss}>{t('admin.workOrders.labelSla')}</label>
              <input className="admin-input" type="datetime-local" style={{ width: '100%', boxSizing: 'border-box' }}
                value={slaDueAt} onChange={e => setSlaDueAt(e.target.value)} />
            </div>
            {err && <div className="admin-note admin-note-err">{err}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" style={{ marginLeft: 0 }} onClick={() => { setCreating(false); setErr('') }} disabled={saving}>{t('admin.workOrders.cancel')}</button>
              <button type="submit" className="admin-primary-btn" disabled={saving}>
                {saving ? t('admin.workOrders.saving') : t('admin.workOrders.create')}
              </button>
            </div>
          </form>
        )}
      </div>
    )
  }

  const open = wo.status === 'assigned' || wo.status === 'in_progress'

  // A work order exists — summarize it and offer the lifecycle actions.
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{t('admin.requests.woPanelTitle')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 3 }}>
            {vendorName(wo.vendor_id)}
            {wo.sla_due_at ? ` · ${t('admin.workOrders.slaDue', { date: fmtDate(wo.sla_due_at) })}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={woChip(WO_PRIORITY_COLOR[wo.priority])}>{woPrioLabel[wo.priority]}</span>
          <span style={woChip(WO_STATUS_COLOR[wo.status])}>{woStatusLabel[wo.status]}</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>
        <span>{t('admin.workOrders.estimate')}: <strong style={{ color: 'var(--text)' }}>{fmtMoney(wo.estimated_cost)}</strong></span>
        {wo.status === 'completed' && (
          <span>{t('admin.workOrders.actual')}: <strong style={{ color: 'var(--text)' }}>{fmtMoney(wo.actual_cost)}</strong></span>
        )}
        {wo.started_at && <span>{t('admin.workOrders.startedAt', { date: fmtDateTime(wo.started_at) })}</span>}
        {wo.completed_at && <span>{t('admin.workOrders.completedAt', { date: fmtDateTime(wo.completed_at) })}</span>}
      </div>

      {wo.status === 'completed' && (wo.completion_notes || wo.completion_photo_path) && (
        <div style={{ marginTop: 8, padding: '8px 10px', background: 'rgba(6,118,71,0.06)', border: '1px solid rgba(6,118,71,0.22)', borderRadius: 6 }}>
          {wo.completion_notes && <div style={{ fontSize: 12.5, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{wo.completion_notes}</div>}
          {wo.completion_photo_path && (
            <button type="button" className="admin-btn-ghost" style={{ marginLeft: 0, marginTop: wo.completion_notes ? 6 : 0 }}
              onClick={() => openAttachment(wo.completion_photo_path!)}>
              {wo.completion_photo_name || t('admin.workOrders.viewPhoto')}
            </button>
          )}
        </div>
      )}

      {err && <div className="admin-note admin-note-err" style={{ marginTop: 8 }}>{err}</div>}

      {/* Lifecycle actions — Start / Complete / Cancel. */}
      {open && !completing && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          {wo.status === 'assigned' && (
            <button type="button" className="admin-primary-btn" onClick={startWork}>{t('admin.workOrders.startWork')}</button>
          )}
          {wo.status === 'in_progress' && (
            <button type="button" className="admin-primary-btn" onClick={() => { setCompleting(true); setErr(''); setActualCost(wo.estimated_cost != null ? String(wo.estimated_cost) : '') }}>
              {t('admin.workOrders.markComplete')}
            </button>
          )}
          <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" style={{ marginLeft: 0 }} onClick={cancelWork}>{t('admin.workOrders.cancel')}</button>
        </div>
      )}

      {/* Completion form — actual cost, notes, optional photo. */}
      {completing && (
        <form onSubmit={submitComplete} style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <div>
            <label style={labelCss}>{t('admin.workOrders.labelActualCost')}</label>
            <input className="admin-input" type="number" min="0" step="0.01" inputMode="decimal" style={{ width: '100%', boxSizing: 'border-box' }}
              value={actualCost} onChange={e => setActualCost(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <label style={labelCss}>{t('admin.workOrders.labelCompletionNotes')}</label>
            <textarea className="admin-input admin-textarea" rows={3} style={{ width: '100%', boxSizing: 'border-box' }}
              value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('admin.workOrders.completionNotesPlaceholder')} />
          </div>
          {budgetCats.length > 0 && (
            <div>
              <label style={labelCss}>{t('admin.requests.woExpenseCat')}</label>
              <select className="admin-input" style={{ width: '100%', boxSizing: 'border-box' }}
                value={expenseCat} onChange={e => setExpenseCat(e.target.value)}>
                <option value="">{t('admin.requests.woExpenseCatNone')}</option>
                {budgetCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{t('admin.requests.woExpenseHint')}</div>
            </div>
          )}
          <div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, color: '#E14909' }}>
              <input type="file" accept="image/*" hidden onChange={e => setPhoto(e.target.files?.[0] || null)} />
              <Clip />
              {photo ? photo.name : t('admin.workOrders.attachPhoto')}
            </label>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="admin-btn-ghost admin-btn-ghost-orange" style={{ marginLeft: 0 }} onClick={() => { setCompleting(false); setErr('') }} disabled={completeSaving}>{t('admin.workOrders.cancel')}</button>
            <button type="submit" className="admin-primary-btn" disabled={completeSaving}>
              {completeSaving ? t('admin.workOrders.saving') : t('admin.workOrders.markComplete')}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
