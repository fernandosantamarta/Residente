// Easy Voice — client-side ballot encryption.
//
// Design (one-line summary): each secret vote has a NaCl box keypair.
// Residents encrypt their answer with the public key. The matching
// secret key is wrapped to the admin's password-derived key and stored
// in the DB; only the admin can unwrap it, and only at tally time.
// The platform operator never holds the unwrapped secret — this is the
// legal point of a secret ballot.
//
// Wire format (all bytes are encoded as base64 strings in Supabase):
//   public_key            32 bytes    nacl box public key
//   wrapped_secret_key    1 + 16 + 24 + 48 bytes
//                          version(1) | pbkdf2-salt(16) | nonce(24) | secretbox(secret)
//   encrypted_answer      1 + 32 + 24 + N bytes
//                          version(1) | ephemeral-pub(32) | nonce(24) | box(plaintext)
//
// PBKDF2-SHA256 with 200_000 iterations satisfies OWASP 2024 guidance.

import nacl from 'tweetnacl'
import * as naclUtil from 'tweetnacl-util'

const PBKDF2_ITERATIONS = 200_000
const KEY_VERSION       = 1
const BALLOT_VERSION    = 1
const SALT_LEN = 16
const NONCE_LEN = nacl.box.nonceLength            // 24
const SECRET_NONCE_LEN = nacl.secretbox.nonceLength // 24

export type Answer = 'yes' | 'no' | 'abstain'
type Bytes = Uint8Array

export interface VoteKeypair {
  publicKey: Bytes   // 32 bytes
  secretKey: Bytes   // 32 bytes
}

export function generateVoteKeypair(): VoteKeypair {
  const kp = nacl.box.keyPair()
  return { publicKey: kp.publicKey, secretKey: kp.secretKey }
}

// ---------- Ballot encryption (resident's browser) ----------

export function encryptAnswer(answer: Answer, votePublicKeyB64: string): string {
  const votePub = base64ToBytes(votePublicKeyB64)
  if (votePub.length !== 32) throw new Error('Vote public key must be 32 bytes')
  const ephemeral = nacl.box.keyPair()
  const nonce     = nacl.randomBytes(NONCE_LEN)
  const message   = naclUtil.decodeUTF8(answer)
  const ciphertext = nacl.box(message, nonce, votePub, ephemeral.secretKey)
  const blob = concatBytes([
    new Uint8Array([BALLOT_VERSION]),
    ephemeral.publicKey,
    nonce,
    ciphertext,
  ])
  return bytesToBase64(blob)
}

// ---------- Ballot decryption (admin's browser at tally time) ----------

export function decryptAnswer(blobB64: string, voteSecretKey: Bytes): Answer {
  const blob = base64ToBytes(blobB64)
  if (blob[0] !== BALLOT_VERSION) {
    throw new Error('Unknown ballot format version (got ' + blob[0] + ')')
  }
  const ephemeralPub = blob.slice(1, 1 + 32)
  const nonce        = blob.slice(33, 33 + NONCE_LEN)
  const ciphertext   = blob.slice(33 + NONCE_LEN)
  const plain = nacl.box.open(ciphertext, nonce, ephemeralPub, voteSecretKey)
  if (!plain) throw new Error('Ballot decryption failed (wrong key or tampered)')
  const text = naclUtil.encodeUTF8(plain)
  if (text === 'yes' || text === 'no' || text === 'abstain') return text
  throw new Error('Decrypted ballot did not contain a valid answer')
}

// ---------- Secret-key wrapping (admin's browser when creating a secret vote) ----------

export async function wrapSecretKey(secret: Bytes, password: string): Promise<string> {
  if (!password || password.length < 6) {
    throw new Error('Tally password must be at least 6 characters')
  }
  const salt  = nacl.randomBytes(SALT_LEN)
  const key   = await deriveKey(password, salt)
  const nonce = nacl.randomBytes(SECRET_NONCE_LEN)
  const ciphertext = nacl.secretbox(secret, nonce, key)
  const blob = concatBytes([
    new Uint8Array([KEY_VERSION]),
    salt,
    nonce,
    ciphertext,
  ])
  return bytesToBase64(blob)
}

export async function unwrapSecretKey(blobB64: string, password: string): Promise<Bytes> {
  const blob = base64ToBytes(blobB64)
  if (blob[0] !== KEY_VERSION) {
    throw new Error('Unknown wrapped-key format')
  }
  const salt        = blob.slice(1, 1 + SALT_LEN)
  const nonce       = blob.slice(1 + SALT_LEN, 1 + SALT_LEN + SECRET_NONCE_LEN)
  const ciphertext  = blob.slice(1 + SALT_LEN + SECRET_NONCE_LEN)
  const key         = await deriveKey(password, salt)
  const plain       = nacl.secretbox.open(ciphertext, nonce, key)
  if (!plain) throw new Error('Wrong tally password (or wrapped key is corrupted)')
  return plain
}

// ---------- Key-card export ----------
// Printable hex with dashes every 8 chars. The admin writes this on
// paper and stores it offline. It's the only recovery path if they
// forget the tally password.

export function exportKeyCard(secret: Bytes): string {
  const hex = bytesToHex(secret)
  return hex.match(/.{1,8}/g)!.join('-')
}

export function importKeyCard(card: string): Bytes {
  const hex = card.replace(/[^a-fA-F0-9]/g, '').toLowerCase()
  if (hex.length !== 64) throw new Error('Key card must contain 64 hex characters (32 bytes)')
  return hexToBytes(hex)
}

// ============================================================
// Pragmatic E2E-V helpers — tracking codes, the hash chain, public re-tally.
// The hash functions MUST byte-match supabase/e2e-verifiable-voting.sql
// (ev_seal_vote). A fixed-vector cross-language test guards this.
// ============================================================

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'  // no I,L,O,U

// A voter's secret tracking code: 16 random bytes → Crockford base32, dashed
// for readability. The raw code is the receipt; only its hash is stored.
export function generateTrackingCode(): string {
  const bytes = nacl.randomBytes(16)
  let bits = 0, value = 0, out = ''
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8
    while (bits >= 5) { out += CROCKFORD[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31]
  return out.match(/.{1,4}/g)!.join('-')   // e.g. "K3F9-A0TX-…"
}

// Normalize a code the way both the commitment and the verifier must: uppercase,
// strip anything that isn't a Crockford symbol (so dashes/spaces/case don't
// matter when the voter re-enters it).
export function normalizeCode(code: string): string {
  return (code || '').toUpperCase().replace(/[^0-9A-Z]/g, '')
}

async function sha256(data: Bytes): Promise<Bytes> {
  const buf = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource)
  return new Uint8Array(buf)
}

// base64( SHA-256( utf8(normalize(code)) ) ) — stored as ev_ballot_box.receipt_commit.
export async function receiptCommitment(code: string): Promise<string> {
  return bytesToBase64(await sha256(naclUtil.decodeUTF8(normalizeCode(code))))
}

export interface PublicBoxRow {
  chain_index: number
  prev_hash: string | null
  ballot_hash: string | null
  encrypted_answer: string
  candidate_ids_enc: string | null
  receipt_commit: string
  answer?: Answer | null
}

// Canonical bytes for one ballot — MUST equal ev_seal_vote's v_canon (UTF-8 of
// "<idx>|<encrypted_answer>|<candidate_ids_enc?>|<receipt_commit>").
export function canonicalBallotBytes(r: {
  chain_index: number; encrypted_answer: string; candidate_ids_enc: string | null; receipt_commit: string
}): Bytes {
  const s = `${r.chain_index}|${r.encrypted_answer}|${r.candidate_ids_enc ?? ''}|${r.receipt_commit}`
  return naclUtil.decodeUTF8(s)
}

// base64( SHA-256( prev_bytes || canonical_bytes ) ), prev_bytes = decode(prevHashB64).
export async function ballotHash(prevHashB64: string | null, canonical: Bytes): Promise<string> {
  const prev = prevHashB64 ? base64ToBytes(prevHashB64) : new Uint8Array(0)
  return bytesToBase64(await sha256(concatBytes([prev, canonical])))
}

// Recompute the whole chain in chain_index order and confirm the head matches
// the published commitment. Returns the first broken index, or null if intact.
export async function verifyChain(
  rows: PublicBoxRow[],
): Promise<{ ok: boolean; headHash: string | null; brokenAt: number | null }> {
  const ordered = [...rows].sort((a, b) => a.chain_index - b.chain_index)
  let prev: string | null = null
  for (const r of ordered) {
    const expected = await ballotHash(prev, canonicalBallotBytes(r))
    if (r.ballot_hash !== expected || r.prev_hash !== prev) {
      return { ok: false, headHash: prev, brokenAt: r.chain_index }
    }
    prev = expected
  }
  return { ok: true, headHash: prev, brokenAt: null }
}

// No-throw decrypt for re-tally over the published set.
export function decryptAnswerSafe(blobB64: string, voteSecretKey: Bytes): Answer | null {
  try { return decryptAnswer(blobB64, voteSecretKey) } catch { return null }
}

// Independent re-tally with the revealed secret key.
export function retally(
  rows: PublicBoxRow[], secretKeyB64: string,
): { yes: number; no: number; abstain: number; failed: number } {
  const key = base64ToBytes(secretKeyB64)
  const counts = { yes: 0, no: 0, abstain: 0, failed: 0 }
  for (const r of rows) {
    const a = decryptAnswerSafe(r.encrypted_answer, key)
    if (a === 'yes') counts.yes++
    else if (a === 'no') counts.no++
    else if (a === 'abstain') counts.abstain++
    else counts.failed++
  }
  return counts
}

// ---------- Benaloh "spoil & verify" cast-as-intended (optional / Phase 2E) ----------
// Same wire blob as encryptAnswer, but the ephemeral secret + nonce are returned
// so a challenged ballot can be independently re-encrypted and checked. A
// challenged ballot is then SPOILED (its randomness is public) and re-cast fresh.
export interface ChallengeableBallot { blob: string; ephemeralSecretKey: Bytes; nonce: Bytes }

export function encryptAnswerChallengeable(answer: Answer, votePublicKeyB64: string): ChallengeableBallot {
  const votePub = base64ToBytes(votePublicKeyB64)
  if (votePub.length !== 32) throw new Error('Vote public key must be 32 bytes')
  const ephemeral = nacl.box.keyPair()
  const nonce     = nacl.randomBytes(NONCE_LEN)
  const ciphertext = nacl.box(naclUtil.decodeUTF8(answer), nonce, votePub, ephemeral.secretKey)
  const blob = concatBytes([new Uint8Array([BALLOT_VERSION]), ephemeral.publicKey, nonce, ciphertext])
  return { blob: bytesToBase64(blob), ephemeralSecretKey: ephemeral.secretKey, nonce }
}

// Re-encrypt the claimed answer with the revealed randomness and confirm it
// reproduces the blob exactly. nacl.box is deterministic, so a match proves the
// blob really encrypts `claimedAnswer` to the vote's public key.
export function verifyChallenge(
  blobB64: string, votePublicKeyB64: string,
  ephemeralSecretKey: Bytes, nonce: Bytes, claimedAnswer: Answer,
): boolean {
  try {
    const votePub = base64ToBytes(votePublicKeyB64)
    const ciphertext = nacl.box(naclUtil.decodeUTF8(claimedAnswer), nonce, votePub, ephemeralSecretKey)
    const ephemeralPub = nacl.box.keyPair.fromSecretKey(ephemeralSecretKey).publicKey
    const expected = concatBytes([new Uint8Array([BALLOT_VERSION]), ephemeralPub, nonce, ciphertext])
    return bytesToBase64(expected) === blobB64
  } catch { return false }
}

// ---------- Byte / encoding helpers ----------

export function bytesToBase64(b: Bytes): string {
  return naclUtil.encodeBase64(b)
}

export function base64ToBytes(s: string): Bytes {
  return naclUtil.decodeBase64(s)
}

async function deriveKey(password: string, salt: Bytes): Promise<Bytes> {
  // PBKDF2 via Web Crypto (available in browsers + Node 20+).
  const pwBytes = naclUtil.decodeUTF8(password)
  const passKey = await crypto.subtle.importKey(
    'raw', pwBytes,
    'PBKDF2', false, ['deriveBits']
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passKey,
    256,
  )
  return new Uint8Array(bits)
}

function concatBytes(arrs: Bytes[]): Bytes {
  const len = arrs.reduce((a, b) => a + b.length, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const a of arrs) { out.set(a, off); off += a.length }
  return out
}

function bytesToHex(b: Bytes): string {
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Bytes {
  if (hex.length % 2) throw new Error('Hex string must be even length')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return out
}
