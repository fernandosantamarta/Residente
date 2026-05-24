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
