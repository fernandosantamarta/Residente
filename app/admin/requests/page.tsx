'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { Dropdown } from '@/components/Dropdown'
import { Pagination, paginate } from '@/components/Pagination'

const REQ_PAGE_SIZE = 10

const withTimeout = <T,>(p: Promise<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

type Category = 'maintenance' | 'appeal' | 'account' | 'other'
type Status = 'new' | 'in_progress' | 'resolved'

const CATS: { value: Category; label: string }[] = [
  { value: 'maintenance', label: 'Maintenance issue' },
  { value: 'appeal',      label: 'Violation appeal' },
  { value: 'account',     label: 'Account question' },
  { value: 'other',       label: 'Other' },
]
const CAT_LABEL: Record<string, string> = Object.fromEntries(CATS.map(c => [c.value, c.label]))

const STATUSES: { value: Status; label: string }[] = [
  { value: 'new',         label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved',    label: 'Resolved' },
]
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUSES.map(s => [s.value, s.label]))

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

type Request = {
  id: string
  submitter_name: string | null
  submitter_unit: string | null
  category: string
  subject: string
  body: string | null
  status: string
  created_at: string
}

// Admin → Requests. The board's triage queue for everything residents submit
// from /app/contact — maintenance issues, appeals, questions. Set the status
// to move each one New → In progress → Resolved.
export default function RequestsAdmin() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [rows, setRows] = useState<Request[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [filterCategory, setFilterCategory] = useState<'all' | Category>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | Status>('all')
  const [page, setPage] = useState(1)

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
        setError(msg || 'Could not load requests')
        setStatus('error')
      }
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const setRequestStatus = async (r: Request, next: Status) => {
    const prevStatus = r.status
    setRows(rs => rs.map(x => x.id === r.id ? { ...x, status: next } : x))   // optimistic
    try {
      const { error } = await withTimeout(
        supabase!.from('resident_requests').update({ status: next }).eq('id', r.id)
      )
      if (error) throw error
      setSuccessMsg(`"${r.subject}" → ${STATUS_LABEL[next]}.`)
    } catch (err: any) {
      setRows(rs => rs.map(x => x.id === r.id ? { ...x, status: prevStatus } : x))   // roll back
      setError(err?.message || 'Could not update that request')
    }
  }

  const newCount = rows.filter(r => r.status === 'new').length
  const filtered = rows.filter(r =>
    (filterCategory === 'all' || r.category === filterCategory) &&
    (filterStatus === 'all' || r.status === filterStatus)
  )
  const visible = paginate(filtered, page, REQ_PAGE_SIZE)

  return (
    <div className="admin-page">
      <div className="admin-kicker">Requests</div>
      <h1 className="admin-h1">Resident requests</h1>
      <p className="admin-dek">
        Everything residents submit from their Contact page — maintenance issues,
        appeals, and questions. Set each one&rsquo;s status to keep residents in the loop.
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked yet, or the requests table isn&rsquo;t set up. Run the
          resident requests setup SQL (see supabase/resident-requests.sql), then reload.
        </div>
      )}
      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <>
          <div className="bc-head" style={{ marginTop: 8, marginBottom: 14 }}>
            <h2 className="bc-title">Queue</h2>
            <span className="bc-sub">
              {rows.length} {rows.length === 1 ? 'request' : 'requests'}
              {newCount > 0 ? ` · ${newCount} new` : ''}.
            </span>
          </div>

          <div className="admin-sched-filters" style={{ marginTop: 4, marginBottom: 12 }}>
            <div className="admin-sched-filter">
              <label>Category</label>
              <Dropdown<'all' | Category>
                value={filterCategory}
                onChange={v => { setFilterCategory(v); setPage(1) }}
                ariaLabel="Filter requests by category"
                options={[
                  { value: 'all', label: `All (${rows.length})` },
                  ...CATS.map(c => ({ value: c.value, label: `${c.label} (${rows.filter(r => r.category === c.value).length})` })),
                ]}
              />
            </div>
            <div className="admin-sched-filter">
              <label>Status</label>
              <Dropdown<'all' | Status>
                value={filterStatus}
                onChange={v => { setFilterStatus(v); setPage(1) }}
                ariaLabel="Filter requests by status"
                options={[
                  { value: 'all', label: 'All statuses' },
                  ...STATUSES.map(s => ({ value: s.value, label: `${s.label} (${rows.filter(r => r.status === s.value).length})` })),
                ]}
              />
            </div>
          </div>

          {status === 'loading' && <div className="admin-note">Loading…</div>}
          {status === 'ready' && rows.length === 0 && (
            <div className="bc-empty">No requests yet — they&rsquo;ll appear here as residents submit them.</div>
          )}
          {status === 'ready' && rows.length > 0 && filtered.length === 0 && (
            <div className="bc-empty">No requests match these filters.</div>
          )}

          <div className="bd-list">
            {visible.map(r => (
              <div className="bd-row" key={r.id}>
                <div className="bd-main">
                  <div className="bd-title">{r.subject}</div>
                  <div className="bd-meta">
                    <span>{r.submitter_name || 'Resident'}</span>
                    {r.submitter_unit && <><span className="bd-dot">·</span><span>{r.submitter_unit}</span></>}
                    <span className="bd-dot">·</span>
                    <span>{CAT_LABEL[r.category] || r.category}</span>
                    <span className="bd-dot">·</span>
                    <span>{fmtDate(r.created_at)}</span>
                  </div>
                  {r.body && <div className="bd-meta" style={{ marginTop: 4 }}>{r.body}</div>}
                </div>
                <div style={{ width: 170, flexShrink: 0 }}>
                  <Dropdown<Status>
                    value={r.status as Status}
                    onChange={v => setRequestStatus(r, v)}
                    ariaLabel={`Status for ${r.subject}`}
                    options={STATUSES}
                  />
                </div>
              </div>
            ))}
          </div>
          <Pagination
            page={page}
            pageSize={REQ_PAGE_SIZE}
            total={filtered.length}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}
