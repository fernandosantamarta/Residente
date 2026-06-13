'use client'

import { useState } from 'react'
import { useAuth } from '@/app/providers'
import { useT } from '@/lib/i18n'
import { EasyVoiceTabs } from '../../EasyVoiceTabs'
import { useCommunityVotes } from '@/hooks/useCommunityVotes'
import { VoteForm, VoteRow } from '../page'

// Standalone Votes admin — votes are their own thing now, created and run
// without a meeting (ev_votes.meeting_id stays null). Reuses VoteForm/VoteRow
// from the meetings page; VoteRow's "Open vote" gate is relaxed when there's
// no meeting status.
export default function VotesAdmin() {
  const t = useT()
  const { profile } = useAuth() || {}
  const { votes, loading, error, reload } = useCommunityVotes()
  const [showForm, setShowForm] = useState(false)
  // The vote currently being edited (click Edit on any row). null = not editing.
  const [editing, setEditing] = useState<any | null>(null)

  return (
    <div className="admin-page cset">
      <EasyVoiceTabs active="votes" />

      <div className="admin-section-head" style={{ marginTop: 18 }}>
        <div>
          <div className="admin-kicker">Easy Voice</div>
          <h1 className="admin-h1">{t('admin.voiceVotes.heading')}</h1>
          <p className="admin-dek">{t('admin.voiceVotes.dek')}</p>
        </div>
        <button className="admin-primary-btn" onClick={() => { setEditing(null); setShowForm(v => !v) }}>
          {showForm ? t('admin.voiceVotes.cancel') : t('admin.voiceVotes.newVote')}
        </button>
      </div>

      {showForm && !editing && (
        <div className="card">
          <VoteForm
            meetingId={null}
            communityId={profile?.community_id}
            onSaved={() => { setShowForm(false); reload() }}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {editing && (
        <div className="card">
          <VoteForm
            existing={editing}
            communityId={profile?.community_id}
            onSaved={() => { setEditing(null); reload() }}
            onCancel={() => setEditing(null)}
          />
        </div>
      )}

      {loading && <div className="admin-placeholder">{t('admin.voiceVotes.loading')}</div>}
      {error && <div className="admin-err">{error}</div>}

      {!loading && !error && votes.length === 0 && !showForm && (
        <div className="admin-placeholder">{t('admin.voiceVotes.emptyState')}</div>
      )}

      {!loading && votes.length > 0 && (
        <div className="card">
          <div className="card-head"><div><h2>{t('admin.voiceVotes.listHeading')}</h2><div className="sub">{t('admin.voiceVotes.listSub')}</div></div></div>
          <div className="voice-vote-list">
            {votes.map(v => (
              <VoteRow key={v.id} vote={v} onChanged={reload} onEdit={(vote: any) => { setShowForm(false); setEditing(vote) }} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
