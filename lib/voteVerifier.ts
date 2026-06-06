// Public vote verifier — reads the anon-readable published views and runs the
// three E2E-V checks entirely client-side:
//   1. find-my-ballot (recorded-as-cast) — a tracking code locates a box row;
//   2. chain integrity — recompute every ballot_hash, confirm the head matches
//      the committed chain_head_hash (nothing added/removed/reordered);
//   3. re-tally (counted-as-recorded) — with the revealed key, independently
//      reproduce the published counts.
// The same algorithm runs in scripts/verify-vote.mjs so a skeptic can verify
// without trusting our page.

import { supabase, hasSupabase } from '@/lib/supabase'
import { verifyChain, retally, receiptCommitment, type PublicBoxRow } from '@/lib/ballotCrypto'

export interface PublicVote {
  vote_id: string
  title: string
  type: string
  status: string
  yes_count: number
  no_count: number
  abstain_count: number
  result: 'pass' | 'fail' | null
  public_key: string | null
}

export interface VoteCommitment {
  vote_id: string
  ballot_count: number
  chain_head_hash: string | null
  cast_function_sha: string | null
  public_key: string | null
  revealed_secret_key: string | null
  tally_yes: number | null
  tally_no: number | null
  tally_abstain: number | null
  result: 'pass' | 'fail' | null
  committed_at: string | null
  revealed_at: string | null
}

export interface VerifierData {
  vote: PublicVote | null
  commitment: VoteCommitment | null
  box: PublicBoxRow[]
}

export async function loadVoteForVerification(voteId: string): Promise<VerifierData> {
  if (!hasSupabase || !supabase) return { vote: null, commitment: null, box: [] }
  const [voteRes, commitRes, boxRes] = await Promise.all([
    supabase.from('ev_public_votes').select('*').eq('vote_id', voteId).maybeSingle(),
    supabase.from('ev_public_vote_commitments').select('*').eq('vote_id', voteId).maybeSingle(),
    supabase.from('ev_public_ballot_box').select('*').eq('vote_id', voteId).order('chain_index', { ascending: true }),
  ])
  return {
    vote: (voteRes.data as PublicVote) ?? null,
    commitment: (commitRes.data as VoteCommitment) ?? null,
    box: ((boxRes.data ?? []) as PublicBoxRow[]),
  }
}

export interface VerificationResult {
  chainOk: boolean
  chainBrokenAt: number | null
  headMatches: boolean
  ballotCountMatches: boolean
  retallied: { yes: number; no: number; abstain: number; failed: number } | null
  tallyMatches: boolean | null
}

export async function runFullVerification(data: VerifierData): Promise<VerificationResult> {
  const chain = await verifyChain(data.box)
  const head = data.commitment?.chain_head_hash ?? null
  const headMatches = !!head && chain.headHash === head
  const ballotCountMatches =
    data.commitment?.ballot_count == null || data.box.length === data.commitment.ballot_count

  let retallied: VerificationResult['retallied'] = null
  let tallyMatches: boolean | null = null
  const key = data.commitment?.revealed_secret_key
  if (key) {
    retallied = retally(data.box, key)
    const cy = data.commitment?.tally_yes ?? data.vote?.yes_count ?? 0
    const cn = data.commitment?.tally_no ?? data.vote?.no_count ?? 0
    const ca = data.commitment?.tally_abstain ?? data.vote?.abstain_count ?? 0
    tallyMatches = retallied.yes === cy && retallied.no === cn && retallied.abstain === ca
  }
  return {
    chainOk: chain.ok,
    chainBrokenAt: chain.brokenAt,
    headMatches,
    ballotCountMatches,
    retallied,
    tallyMatches,
  }
}

// Locate the voter's own ballot on the bulletin board by tracking code.
export async function findMyBallot(
  data: VerifierData, code: string,
): Promise<{ found: boolean; position: number | null }> {
  const commit = await receiptCommitment(code)
  const row = data.box.find(b => b.receipt_commit === commit)
  return row ? { found: true, position: row.chain_index } : { found: false, position: null }
}
