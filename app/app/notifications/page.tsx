'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMyNoticesPaged } from '@/hooks/useNotices'
import { NOTICE_KIND_LABELS, noticeHref, NoticeKind } from '@/lib/voice'

const KIND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'All notifications' },
  ...Object.entries(NOTICE_KIND_LABELS).map(([value, label]) => ({ value, label })),
]

const fmtTs = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function NotificationsInboxPage() {
  const router = useRouter()
  const [kind, setKind] = useState('')
  const {
    notices, loading, loadingMore, hasMore, error,
    loadMore, markRead, markAllRead,
  } = useMyNoticesPaged({ kind: kind || undefined, pageSize: 50 })

  const unreadCount = notices.filter((r: any) => !r.read_at).length

  const onPick = (r: any) => {
    const n = r.notice
    if (!n) return
    if (!r.read_at) markRead(r.id)
    router.push(noticeHref(n))
  }

  return (
    <div className="inbox-wrap">
      <div className="inbox-head">
        <div>
          <h1 className="inbox-title">Notifications</h1>
          <p className="inbox-sub">Everything your board has sent. Newest first.</p>
        </div>
        <Link href="/app" className="inbox-back">← Back to home</Link>
      </div>

      <div className="inbox-toolbar">
        <select className="inbox-filter" value={kind} onChange={e => setKind(e.target.value)}>
          {KIND_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button
          className="inbox-mark-all"
          onClick={markAllRead}
          disabled={unreadCount === 0}
        >
          {unreadCount === 0 ? 'All read' : `Mark all ${unreadCount} read`}
        </button>
      </div>

      {loading && <div className="inbox-empty">Loading…</div>}
      {error && <div className="voice-err">{error}</div>}
      {!loading && !error && notices.length === 0 && (
        <div className="inbox-empty">No notifications {kind ? 'of this kind' : 'yet'}.</div>
      )}

      <div className="inbox-list">
        {notices.map((r: any) => {
          const n = r.notice
          if (!n) return null
          const unread = !r.read_at
          return (
            <button
              key={r.id}
              className={`inbox-row${unread ? ' unread' : ''}`}
              onClick={() => onPick(r)}
            >
              <div className="inbox-row-meta">
                <span className="inbox-row-kind">{NOTICE_KIND_LABELS[n.kind as NoticeKind] ?? n.kind}</span>
                <span className="inbox-row-ts">{fmtTs(r.delivered_at)}</span>
              </div>
              <div className="inbox-row-subject">{n.subject || '(no subject)'}</div>
              {n.body && <div className="inbox-row-body">{n.body}</div>}
              {unread && <span className="inbox-row-dot" aria-label="Unread" />}
            </button>
          )
        })}
      </div>

      {hasMore && (
        <button className="inbox-load-more" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
