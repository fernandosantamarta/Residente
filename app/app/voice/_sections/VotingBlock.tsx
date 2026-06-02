'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCommunityVotes } from '@/hooks/useCommunityVotes'
import { VOTE_TYPES, proposalStatus } from '@/lib/voice'
import { VoteDetailDialog } from './VoteDetailDialog'
import { Countdown } from './Countdown'

const fmtDueDate = (iso: string | null) =>
  !iso ? '' : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// Voting + Results + the Proposals/Rules CTA, packaged so the Board tab can
// show the same warm vote cards the Meetings dashboard uses. Self-contained:
// it fetches votes and owns its own meeting-detail popup so it can drop into
// any layout. Wrapped in .vd-scope so the dashboard tokens resolve.

export function VotingBlock() {
  const { votes, loading, reload } = useCommunityVotes()
  const [openVote, setOpenVote] = useState<any | null>(null)

  const openVotes = votes.filter(v => v.status === 'open')
  const results   = votes.filter(v => ['closed', 'tallied', 'published'].includes(v.status))

  if (loading) return null

  return (
    <>
      {/* Votes + results, one section */}
      <section className="brd-card vd-scope">
        <div className="brd-card-head">
          <h2 className="brd-card-title">Votes</h2>
        </div>

        {openVotes.length === 0 && results.length === 0 ? (
          <div className="voice-placeholder">No votes yet.</div>
        ) : (
          <div className="vd-votegrid">
            {openVotes.map(v => <OpenVoteCard key={v.id} vote={v} onOpen={setOpenVote} />)}
            {results.map(v => <ResultCard key={v.id} vote={v} onOpen={setOpenVote} />)}
          </div>
        )}
      </section>

      {openVote && (
        <VoteDetailDialog
          vote={openVote}
          onClose={() => setOpenVote(null)}
          onVoted={() => { reload(); setOpenVote(null) }}
        />
      )}
    </>
  )
}

// "Your votes" rail card for the Board tab — sits under Committees. Lists
// open + recent votes; clicking one opens the ballot popup to cast.
export function BoardYourVotes() {
  const { votes, reload } = useCommunityVotes()
  const [openVote, setOpenVote] = useState<any | null>(null)
  const list = votes
    .filter(v => v.status === 'open' || ['closed', 'tallied', 'published'].includes(v.status))
    .slice(0, 4)
  if (list.length === 0) return null
  return (
    <section className="brd-card brd-tile-tight vd-scope">
      <div className="brd-card-head"><h3 className="brd-tile-title">Your votes</h3></div>
      <div>
        {list.map(v => {
          const open = v.status === 'open'
          return (
            <button key={v.id} className="vd-yourvote" onClick={() => setOpenVote(v)}>
              <span className="vd-yourvote-body">
                <span className="vd-yourvote-title">{v.title}</span>
                <span className="vd-yourvote-meta">{v.description || (VOTE_TYPES.find(t => t.value === v.type)?.label ?? '')}</span>
              </span>
              {open
                ? <span className="vd-yourvote-cta"><Icon name="clock" /> Vote now</span>
                : <span className="vd-yourvote-done"><Icon name="check" /> Closed</span>}
            </button>
          )
        })}
      </div>
      {openVote && (
        <VoteDetailDialog vote={openVote} onClose={() => setOpenVote(null)} onVoted={() => { reload(); setOpenVote(null) }} />
      )}
    </section>
  )
}

// Full-width banner — proposals & rules live in Easy Documents.
export function ProposalsRulesCTA() {
  return (
    <Link href="/app/documents#rules" className="vd-scope vd-proposals-cta">
      <span className="vd-proposals-ic"><Icon name="gavel" /></span>
      <span className="vd-proposals-body">
        <span className="vd-proposals-title">New proposals &amp; rules added</span>
        <span className="vd-proposals-sub">See the rules and policy changes recently posted to your community.</span>
      </span>
      <span className="vd-proposals-go">Open Easy Documents <Icon name="chevron" /></span>
    </Link>
  )
}

// Open vote — vertical card: title + close countdown/due (right), an
// expandable description, then Yes / No. Yes/No open the official ballot in
// the meeting detail (casting + consent + secret-ballot crypto live there).
// Exported so the Meetings dashboard and the Board tab show the same card.
// Open vote — square tile (Easy-Rules style, bigger): title + "Open" badge,
// expandable description, close countdown/due, then Yes / No.
export function OpenVoteCard({ vote: v, onOpen, meetingLabel }: { vote: any; onOpen: (vote: any) => void; meetingLabel?: string }) {
  const [open, setOpen] = useState(false)
  const typeLabel = VOTE_TYPES.find(t => t.value === v.type)?.label ?? v.type
  const desc = v.description || typeLabel
  const due = fmtDueDate(v.closes_at)
  const isSecret = v.ballot_type === 'secret'
  const yes = v.yes_count ?? 0, no = v.no_count ?? 0, abs = v.abstain_count ?? 0
  const total = yes + no + abs
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  return (
    <div className="vd-votetile">
      <div className="vd-vt-head">
        <span className="vd-vt-title">{v.title}</span>
        <span className="vd-vt-badge open"><Icon name="clock" /> Open</span>
      </div>

      {due && <span className="vd-vt-due vd-vt-due-top">Due {due}</span>}

      {meetingLabel && (
        <span className="vd-vt-meeting"><Icon name="calendar" /> Discussed at {meetingLabel}</span>
      )}

      {desc && (
        <button type="button" className="vd-vt-descbtn" onClick={() => setOpen(o => !o)} aria-expanded={open}>
          <span className={open ? '' : 'vd-clamp'}>{desc}</span>
          <span className="vd-votecard-more">{open ? 'Show less' : 'Show more'}</span>
        </button>
      )}

      {v.closes_at && (
        <div className="vd-vt-deadline">
          <Countdown to={v.closes_at} label="Closes in" compact />
        </div>
      )}

      <div className="vd-vt-actions">
        <button type="button" className="vd-vote-btn yes" onClick={() => onOpen(v)}><Icon name="check" /> Yes</button>
        <button type="button" className="vd-vote-btn no"  onClick={() => onOpen(v)}><Icon name="x" /> No</button>
      </div>

      {/* Live tally — how the votes are coming in. Open ballots show the running
          split; secret ballots stay hidden until the vote is tallied. */}
      {isSecret ? (
        <div className="vd-vt-secret"><Icon name="lock" /> Live tally hidden until close — secret ballot</div>
      ) : (
        <div className="vd-vt-tally">
          <div className="vd-vt-tally-label">How it's coming in</div>
          <div className="vd-resultbar">
            {total === 0 && <span className="seg empty" />}
            {yes > 0 && <span className="seg yes" style={{ width: `${pct(yes)}%` }} />}
            {no  > 0 && <span className="seg no"  style={{ width: `${pct(no)}%` }} />}
            {abs > 0 && <span className="seg abs" style={{ width: `${pct(abs)}%` }} />}
          </div>
          <div className="vd-resultlegend">
            <span className="leg yes"><b>{yes}</b> Yes</span>
            <span className="leg no"><b>{no}</b> No</span>
            {abs > 0 && <span className="leg abs"><b>{abs}</b> Abstain</span>}
            <span className="leg total">{total} cast</span>
          </div>
        </div>
      )}
    </div>
  )
}

// Decided vote — same square tile, but a green/red "Closed" badge by the title
// (who won) and a yes/no/abstain breakdown bar instead of Yes/No buttons.
export function ResultCard({ vote: v, onOpen }: { vote: any; onOpen: (vote: any) => void }) {
  const st = proposalStatus(v)
  const lost = st.tone === 'rejected'
  const typeLabel = VOTE_TYPES.find(t => t.value === v.type)?.label ?? v.type
  const yes = v.yes_count ?? 0, no = v.no_count ?? 0, abs = v.abstain_count ?? 0
  const total = yes + no + abs
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  return (
    <div className="vd-votetile clickable" role="button" tabIndex={0} onClick={() => onOpen(v)}>
      <div className="vd-vt-head">
        <span className="vd-vt-title">{v.title}</span>
        <span className={`vd-vt-badge ${lost ? 'lost' : 'won'}`}>
          <Icon name={lost ? 'x' : 'check'} /> Closed
        </span>
      </div>
      <span className="vd-vt-sub">{v.description || typeLabel}</span>
      <div className="vd-resultbar">
        {total === 0 && <span className="seg empty" />}
        {yes > 0 && <span className="seg yes" style={{ width: `${pct(yes)}%` }} />}
        {no  > 0 && <span className="seg no"  style={{ width: `${pct(no)}%` }} />}
        {abs > 0 && <span className="seg abs" style={{ width: `${pct(abs)}%` }} />}
      </div>
      <div className="vd-resultlegend">
        <span className="leg yes"><b>{yes}</b> Yes</span>
        <span className="leg no"><b>{no}</b> No</span>
        {abs > 0 && <span className="leg abs"><b>{abs}</b> Abstain</span>}
        <span className="leg total">{total} cast</span>
      </div>
    </div>
  )
}

function Icon({ name }: { name: string }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'vote':    return <svg viewBox="0 0 24 24" {...p}><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
    case 'check':   return <svg viewBox="0 0 24 24" {...p}><polyline points="20 6 9 17 4 12"/></svg>
    case 'x':       return <svg viewBox="0 0 24 24" {...p}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    case 'chevron': return <svg viewBox="0 0 24 24" {...p}><polyline points="9 18 15 12 9 6"/></svg>
    case 'clock':   return <svg viewBox="0 0 24 24" {...p}><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>
    case 'lock':    return <svg viewBox="0 0 24 24" {...p}><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
    case 'calendar':return <svg viewBox="0 0 24 24" {...p}><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    case 'gavel':   return <svg viewBox="0 0 24 24" {...p}><path d="M14 13l-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10"/><path d="M9.5 6.5l8 8"/><path d="M14 4l6 6"/><path d="M11 7l6 6"/><line x1="16" y1="20" x2="22" y2="20"/></svg>
    default:        return null
  }
}
