'use client'

import { useState } from 'react'
import { useAuth } from '@/app/providers'
import { EasyVoiceTabs } from '../../EasyVoiceTabs'
import { useCommunityVotes } from '@/hooks/useCommunityVotes'
import { VoteForm, VoteRow } from '../page'

// Standalone Votes admin — votes are their own thing now, created and run
// without a meeting (ev_votes.meeting_id stays null). Reuses VoteForm/VoteRow
// from the meetings page; VoteRow's "Open vote" gate is relaxed when there's
// no meeting status.
export default function VotesAdmin() {
  const { profile } = useAuth() || {}
  const { votes, loading, error, reload } = useCommunityVotes()
  const [showForm, setShowForm] = useState(false)
  // The vote currently being edited (click Edit on any row). null = not editing.
  const [editing, setEditing] = useState<any | null>(null)

  return (
    <div className="admin-section">
      <EasyVoiceTabs active="votes" />

      <div className="admin-section-head" style={{ marginTop: 18 }}>
        <div>
          <div className="admin-kicker">Easy Voice</div>
          <div className="admin-section-title">Votes</div>
          <div className="admin-section-sub">Create and run community votes — no meeting required.</div>
        </div>
        <button className="admin-primary-btn" onClick={() => { setEditing(null); setShowForm(v => !v) }}>
          {showForm ? 'Cancel' : '+ New Vote'}
        </button>
      </div>

      {showForm && !editing && (
        <VoteForm
          meetingId={null}
          communityId={profile?.community_id}
          onSaved={() => { setShowForm(false); reload() }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {editing && (
        <VoteForm
          existing={editing}
          communityId={profile?.community_id}
          onSaved={() => { setEditing(null); reload() }}
          onCancel={() => setEditing(null)}
        />
      )}

      {loading && <div className="admin-placeholder">Loading votes…</div>}
      {error && <div className="admin-err">{error}</div>}

      {!loading && !error && votes.length === 0 && !showForm && (
        <div className="admin-placeholder">No votes yet. Create your first one above.</div>
      )}

      {!loading && votes.length > 0 && (
        <div className="voice-vote-list" style={{ marginTop: 18 }}>
          {votes.map(v => (
            <VoteRow key={v.id} vote={v} onChanged={reload} onEdit={(vote: any) => { setShowForm(false); setEditing(vote) }} />
          ))}
        </div>
      )}
    </div>
  )
}
