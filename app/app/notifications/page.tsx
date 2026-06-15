'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useMyNoticesPaged } from '@/hooks/useNotices'
import { NOTICE_KIND_LABELS, noticeHref, noticeTone, noticeKindLabel, localizeNoticeText } from '@/lib/voice'
import { useT } from '@/lib/i18n'
import { Dropdown } from '@/components/Dropdown'

const fmtTs = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const PAGE_SIZE = 10

export default function NotificationsInboxPage() {
  const t = useT()
  const router = useRouter()
  const [kind, setKind] = useState('')
  const KIND_OPTIONS: { value: string; label: string }[] = [
    { value: '', label: t('community.notifications.allKinds') },
    ...Object.keys(NOTICE_KIND_LABELS).map(value => ({ value, label: noticeKindLabel(value, t) })),
  ]
  const {
    notices, loading, loadingMore, hasMore, error,
    loadMore, markRead, markAllRead,
  } = useMyNoticesPaged({ kind: kind || undefined, pageSize: 50 })

  const unreadCount = notices.filter((r: any) => !r.read_at).length

  // Page through the loaded notices. When the reader reaches the end of what's
  // loaded and the server still has more, fetch the next batch then advance.
  const [page, setPage] = useState(0)
  useEffect(() => { setPage(0) }, [kind])
  const loadedPages = Math.max(1, Math.ceil(notices.length / PAGE_SIZE))
  const pageRows = notices.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
  const canPrev = page > 0
  const canNext = page < loadedPages - 1 || hasMore
  const goPrev = () => setPage(p => Math.max(0, p - 1))
  const goNext = async () => {
    if (page >= loadedPages - 1 && hasMore) await loadMore()
    setPage(p => p + 1)
  }

  const onPick = async (r: any) => {
    const n = r.notice
    if (!n) return
    // Await before navigating — router.push() aborts the in-flight markRead
    // PATCH otherwise, so the row never persists as read (see NotificationBell).
    if (!r.read_at) await markRead(r.id)
    router.push(noticeHref(n))
  }

  return (
    <div className="inbox-wrap">
      <div className="inbox-head">
        <div>
          <h1 className="inbox-title">{t('community.notifications.title')}</h1>
          <p className="inbox-sub">{t('community.notifications.sub')}</p>
        </div>
        <Link href="/app" className="inbox-back">{t('community.notifications.backHome')}</Link>
      </div>

      <div className="inbox-toolbar">
        <div className="inbox-filter-dd">
          <Dropdown
            value={kind}
            onChange={setKind}
            options={KIND_OPTIONS}
            ariaLabel={t('community.notifications.allKinds')}
          />
        </div>
        <button
          className="inbox-mark-all"
          onClick={markAllRead}
          disabled={unreadCount === 0}
        >
          {unreadCount === 0 ? t('community.notifications.allRead') : t('community.notifications.markAllRead', { count: unreadCount })}
        </button>
      </div>

      {loading && <div className="inbox-empty">{t('community.notifications.loading')}</div>}
      {error && <div className="voice-err">{error}</div>}
      {!loading && !error && notices.length === 0 && (
        <div className="inbox-empty">{kind ? t('community.notifications.emptyKind') : t('community.notifications.emptyAll')}</div>
      )}

      <div className="inbox-list">
        {pageRows.map((r: any) => {
          const n = r.notice
          if (!n) return null
          const unread = !r.read_at
          return (
            <button
              key={r.id}
              className={`inbox-row${unread ? ' unread' : ''}`}
              data-tone={noticeTone(n.kind)}
              onClick={() => onPick(r)}
            >
              <div className="inbox-row-meta">
                <span className="inbox-row-kind">{noticeKindLabel(n.kind, t)}</span>
                <span className="inbox-row-ts">{fmtTs(r.delivered_at)}</span>
              </div>
              <div className="inbox-row-subject">{localizeNoticeText(n.subject, t) || t('community.notifications.noSubject')}</div>
              {n.body && <div className="inbox-row-body">{localizeNoticeText(n.body, t)}</div>}
              {unread && <span className="inbox-row-dot" aria-label={t('community.notifications.unread')} />}
            </button>
          )
        })}
      </div>

      {!loading && notices.length > 0 && (canPrev || canNext) && (
        <div className="inbox-pager">
          <button className="inbox-pager-btn" onClick={goPrev} disabled={!canPrev}>
            {t('community.notifications.prev')}
          </button>
          <span className="inbox-pager-info">
            {t('community.notifications.pageOf', { page: page + 1, total: `${loadedPages}${hasMore ? '+' : ''}` })}
          </span>
          <button className="inbox-pager-btn" onClick={goNext} disabled={!canNext || loadingMore}>
            {loadingMore ? t('community.notifications.loading') : t('community.notifications.next')}
          </button>
        </div>
      )}
    </div>
  )
}
