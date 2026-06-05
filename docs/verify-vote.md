# Verify a Residente vote (end-to-end verifiable voting)

New secret votes in Residente are **end-to-end verifiable (E2E-V)**. After a vote
is published you can independently confirm three things — without trusting
Residente, the board, or even the `/verify` web page:

1. **Recorded-as-cast** — your own ballot is on the public bulletin board.
2. **Counted-as-recorded** — the published tally is reproducible from the data.
3. **Tamper-evidence** — no ballot was added, removed, altered, or reordered
   after the vote closed.

## What's published

Three anon-readable views expose only *published, verifiable* votes:

- `ev_public_votes` — title, status, published counts, result, `public_key`.
- `ev_public_ballot_box` — the anonymous ballots: `chain_index`, `prev_hash`,
  `ballot_hash`, `encrypted_answer`, `candidate_ids_enc`, `receipt_commit`,
  `cast_day`, `answer`. **No voter identity.**
- `ev_public_vote_commitments` — `ballot_count`, `chain_head_hash` (committed at
  close, before any decryption), `cast_function_sha`, `revealed_secret_key`
  (published at result time), the recorded tally, and timestamps.

## The two ways to verify

### A. In the browser
Open `/verify/<voteId>`. Enter the verification code you saved when you voted to
find your ballot, see the chain + count checks, and the re-tally. Then click
**Download verification data (JSON)** to verify independently (below).

### B. Standalone (don't trust our page)

```bash
# chain + find-my-ballot need ZERO dependencies (Node's built-in crypto):
node scripts/verify-vote.mjs vote-<id>-verification.json "YOUR-TRACKING-CODE"

# the re-tally additionally needs NaCl:
npm i tweetnacl tweetnacl-util
node scripts/verify-vote.mjs vote-<id>-verification.json
```

A clean run ends with `✓ VERIFICATION PASSED`; any mismatch prints the exact
position and exits non-zero.

## The algorithm (so you can reimplement it)

- **Tracking code → commitment:** `base64( SHA-256( utf8(normalize(code)) ) )`,
  where `normalize` upper-cases and strips everything except `0-9A-Z`. Compare to
  `ev_public_ballot_box.receipt_commit` to find your ballot.
- **Per-ballot canonical bytes:** UTF-8 of
  `"<chain_index>|<encrypted_answer>|<candidate_ids_enc or ''>|<receipt_commit>"`.
- **Hash chain:** for each ballot in `chain_index` order,
  `ballot_hash = base64( SHA-256( decode(prev_hash, base64) ++ canonical_bytes ) )`,
  with `prev_hash` empty for index 0. The final `ballot_hash` must equal
  `ev_public_vote_commitments.chain_head_hash`.
- **Re-tally:** base64-decode `revealed_secret_key`; for each
  `encrypted_answer` (`[1B version | 32B ephemeral pubkey | 24B nonce | NaCl
  box ciphertext]`, base64), `nacl.box.open(ciphertext, nonce, ephemeralPub,
  secretKey)` → `yes` / `no` / `abstain`. The counts must equal the published
  tally.

These match `lib/ballotCrypto.ts` and `supabase/e2e-verifiable-voting.sql`
(`ev_seal_vote`) byte-for-byte.

## What this does and does NOT prove

**Proven:** the published ballot set is frozen and tamper-evident; the count is
independently reproducible; your ballot is present and unaltered; voter identity
(`ev_participation`) and ballot content (`ev_ballot_box`) live in separate tables
with no stored join.

**Residual trust (disclosed):** unlinkability is *procedural, not
cryptographic* — a malicious operator could, with modified server code, record
the identity↔ballot correlation or infer it from timing. Residente mitigates
this (the only write path is `ev_cast_ballot`, which stores no correlation;
ballots are shuffled at close so chain order ≠ casting order; timestamps are
bucketed to the day; the deployed function's SHA-256 is published as
`cast_function_sha` for comparison against the audited `.sql`). A verifiable
mixnet or homomorphic tally would eliminate this; that is out of scope for this
design. Also: ballots are frozen at *close* (not append-verifiable during
voting), so checking your receipt after close is the live defense; and
cast-as-intended is only assured for ballots you actively challenge (optional
Benaloh "spoil & verify").
