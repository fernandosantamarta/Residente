#!/usr/bin/env node
// Standalone, independent verifier for a Residente E2E-V vote.
//
//   node scripts/verify-vote.mjs vote-<id>-verification.json [TRACKING-CODE]
//
// The JSON is the bundle downloaded from /verify/<voteId>. This script trusts
// NOTHING from the app — it recomputes the hash chain, the chain head, the
// ballot count, and (if a key is revealed and tweetnacl is installed) the tally,
// using only its own code. Chain + find-my-ballot need ZERO dependencies
// (node:crypto only); the re-tally needs `npm i tweetnacl tweetnacl-util`.
//
// Algorithm MUST match lib/ballotCrypto.ts + supabase/e2e-verifiable-voting.sql.

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const file = process.argv[2]
const code = process.argv[3]
if (!file) { console.error('usage: node verify-vote.mjs <bundle.json> [tracking-code]'); process.exit(2) }

const data = JSON.parse(readFileSync(file, 'utf8'))
const vote = data.vote, commitment = data.commitment
const box = [...(data.box || [])].sort((a, b) => a.chain_index - b.chain_index)

const sha256b64 = (buf) => createHash('sha256').update(buf).digest('base64')
const normalize = (s) => (s || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
const canonical = (r) => `${r.chain_index}|${r.encrypted_answer}|${r.candidate_ids_enc ?? ''}|${r.receipt_commit}`

let ok = true
const fail = (m) => { ok = false; console.log('  ✗ ' + m) }
const pass = (m) => console.log('  ✓ ' + m)

console.log(`\nVote: ${vote?.title ?? '(unknown)'}  [${vote?.vote_id ?? ''}]`)
console.log(`Published: Yes ${vote?.yes_count} · No ${vote?.no_count} · Abstain ${vote?.abstain_count} · ${vote?.result ?? '—'}`)

// 1) hash chain
console.log('\nHash chain:')
let prev = null
for (const r of box) {
  const prevBytes = prev ? Buffer.from(prev, 'base64') : Buffer.alloc(0)
  const expected = sha256b64(Buffer.concat([prevBytes, Buffer.from(canonical(r), 'utf8')]))
  if (r.prev_hash !== prev) fail(`position ${r.chain_index}: prev_hash mismatch`)
  if (r.ballot_hash !== expected) fail(`position ${r.chain_index}: ballot_hash mismatch`)
  prev = expected
}
if (ok) pass(`${box.length} ballots chained, nothing added/removed/reordered`)
if (commitment?.chain_head_hash) {
  if (prev === commitment.chain_head_hash) pass('chain head matches the committed head hash')
  else fail('chain head does NOT match the committed head hash')
}
if (commitment?.ballot_count != null) {
  if (box.length === commitment.ballot_count) pass(`ballot count matches commitment (${box.length})`)
  else fail(`ballot count ${box.length} ≠ committed ${commitment.ballot_count}`)
}

// 2) find my ballot
if (code) {
  console.log('\nFind your ballot:')
  const commit = sha256b64(Buffer.from(normalize(code), 'utf8'))
  const row = box.find(b => b.receipt_commit === commit)
  if (row) pass(`your ballot is at position ${row.chain_index}, unaltered`)
  else fail('no ballot found for that tracking code')
}

// 3) re-tally (needs the revealed key + tweetnacl)
console.log('\nRe-tally:')
if (!commitment?.revealed_secret_key) {
  console.log('  … key not revealed yet — re-tally unavailable')
} else {
  let nacl, util
  try {
    const naclMod = await import('tweetnacl'); nacl = naclMod.default ?? naclMod
    const utilMod = await import('tweetnacl-util'); util = utilMod.default ?? utilMod
  } catch { console.log('  … install tweetnacl + tweetnacl-util to re-tally: npm i tweetnacl tweetnacl-util'); nacl = null }
  if (nacl) {
    const sk = util.decodeBase64(commitment.revealed_secret_key)
    const counts = { yes: 0, no: 0, abstain: 0, failed: 0 }
    for (const r of box) {
      try {
        const blob = util.decodeBase64(r.encrypted_answer)
        const ephPub = blob.slice(1, 33), nonce = blob.slice(33, 57), ct = blob.slice(57)
        const plain = nacl.box.open(ct, nonce, ephPub, sk)
        const ans = plain ? util.encodeUTF8(plain) : null
        if (ans === 'yes' || ans === 'no' || ans === 'abstain') counts[ans]++
        else counts.failed++
      } catch { counts.failed++ }
    }
    console.log(`  re-tallied: Yes ${counts.yes} · No ${counts.no} · Abstain ${counts.abstain}${counts.failed ? ` (${counts.failed} undecryptable)` : ''}`)
    const cy = commitment.tally_yes ?? vote?.yes_count, cn = commitment.tally_no ?? vote?.no_count, ca = commitment.tally_abstain ?? vote?.abstain_count
    if (counts.yes === cy && counts.no === cn && counts.abstain === ca) pass('re-tally matches the published result')
    else fail('re-tally does NOT match the published result')
  }
}

console.log(`\n${ok ? '✓ VERIFICATION PASSED' : '✗ VERIFICATION FAILED'}\n`)
process.exit(ok ? 0 : 1)
