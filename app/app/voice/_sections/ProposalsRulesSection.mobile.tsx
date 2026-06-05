'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCommunityVotes } from '@/hooks/useCommunityVotes'
import { useVoiceMeetings } from '@/hooks/useVoiceMeetings'
import { VOTE_CATEGORIES } from '@/lib/voice'
import { OpenVoteCard, ResultCard } from './VotingBlock'
import { VoteDetailDialog } from './VoteDetailDialog'

// Proposals & Rules — a tab of the Easy Voice hub. This is the voting home:
// proposals up for vote (grouped by category) + recently decided ones. The
// adopted rule book itself lives in Easy Documents → Rules, not here.
export function ProposalsRulesSection() {
  const { votes, reload } = useCommunityVotes()
  const { meetings } = useVoiceMeetings()
  const [openVote, setOpenVote] = useState<any | null>(null)

  const openVotes = votes.filter(v => v.status === 'open')
  const results   = votes.filter(v => ['closed', 'tallied', 'published'].includes(v.status))
  const meetingTitle = (id: string | null) =>
    id ? (meetings.find((m: any) => m.id === id)?.title ?? null) : null
  const byCategory = VOTE_CATEGORIES
    .map(c => ({ ...c, votes: openVotes.filter(v => (v.category || 'other') === c.value) }))
    .filter(c => c.votes.length > 0)

  return (
    <section id="proposals" className="ev-section vd-scope">
      <div className="voice-page-head">
        <h2 className="voice-page-title">Voting</h2>
        <p className="voice-page-sub">Vote on what the board is proposing. Adopted rules live in Easy Documents.</p>
      </div>

      {/* Up for vote — grouped by category */}
      {byCategory.length === 0 ? (
        <div className="vd-rules-group">
          <div className="vd-rules-section">Up for vote</div>
          <div className="voice-placeholder">Nothing up for vote right now.</div>
        </div>
      ) : byCategory.map(c => (
        <div key={c.value} className="vd-rules-group">
          <div className="vd-rules-section">{c.label}</div>
          <div className="vd-votegrid">
            {c.votes.map(v => (
              <OpenVoteCard key={v.id} vote={v} onOpen={setOpenVote} meetingLabel={meetingTitle(v.meeting_id) ?? undefined} />
            ))}
          </div>
        </div>
      ))}

      {/* Recently decided */}
      {results.length > 0 && (
        <div className="vd-rules-group">
          <div className="vd-rules-divider">Recently decided</div>
          <div className="vd-votegrid">
            {results.map(v => <ResultCard key={v.id} vote={v} onOpen={setOpenVote} />)}
          </div>
        </div>
      )}

      {/* Quick links — propose a rule, the rule book, elections. One tidy card
          instead of three stacked gradient panels. */}
      <div className="vd-links">
        <Link href="/app/voice?cat=rule_proposal#contact" className="vd-link">
          <span className="vd-link-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 13l-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10"/><path d="M9.5 6.5l8 8"/><path d="M14 4l6 6"/><path d="M11 7l6 6"/><line x1="16" y1="20" x2="22" y2="20"/>
            </svg>
          </span>
          <span className="vd-link-body">
            <span className="vd-link-title">Propose a rule</span>
            <span className="vd-link-sub">Have one in mind? Put it to the board for a vote.</span>
          </span>
          <span className="vd-link-go" aria-hidden="true">→</span>
        </Link>

        <Link href="/app/documents#rules" className="vd-link">
          <span className="vd-link-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
            </svg>
          </span>
          <span className="vd-link-body">
            <span className="vd-link-title">See the rule book</span>
            <span className="vd-link-sub">Adopted rules live in Easy Documents → Rules.</span>
          </span>
          <span className="vd-link-go" aria-hidden="true">→</span>
        </Link>

        <Link href="/app/meetings" className="vd-link">
          <span className="vd-link-ic">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2"/><path d="m8 12 2.5 2.5L16 9"/>
            </svg>
          </span>
          <span className="vd-link-body">
            <span className="vd-link-title">Board elections &amp; recall</span>
            <span className="vd-link-sub">Election timeline, candidacy, and any recall.</span>
          </span>
          <span className="vd-link-go" aria-hidden="true">→</span>
        </Link>
      </div>

      {openVote && (
        <VoteDetailDialog vote={openVote} onClose={() => setOpenVote(null)} onVoted={() => { reload(); setOpenVote(null) }} />
      )}
    </section>
  )
}
