'use client'

// Public, unauthenticated vote verifier. Anyone (voter, neighbor, arbitrator)
// can confirm: (1) their own ballot is on the bulletin board, (2) the ballot set
// wasn't altered after close, (3) the published tally is reproducible from the
// revealed key. Reads only the anon-readable published views.

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import {
  loadVoteForVerification, runFullVerification, findMyBallot,
  type VerifierData, type VerificationResult,
} from '@/lib/voteVerifier'

const wrap: React.CSSProperties = { maxWidth: 760, margin: '0 auto', padding: '32px 20px 64px', fontFamily: 'Inter, system-ui, sans-serif', color: '#0A2440' }
const card: React.CSSProperties = { border: '1px solid rgba(10,36,64,0.12)', borderRadius: 14, padding: '16px 18px', marginTop: 16, background: '#fff' }
const mono: React.CSSProperties = { fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, wordBreak: 'break-all' }

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  const color = ok === true ? '#067647' : ok === false ? '#B42318' : '#98A2B3'
  const mark = ok === true ? '✓' : ok === false ? '✗' : '…'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
      <span style={{ width: 22, height: 22, borderRadius: 999, background: color + '1a', color, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, flexShrink: 0 }}>{mark}</span>
      <span style={{ fontSize: 14 }}>{label}</span>
    </div>
  )
}

export default function VerifyVotePage() {
  const params = useParams()
  const voteId = String(params?.voteId ?? '')
  const [data, setData] = useState<VerifierData | null>(null)
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [code, setCode] = useState('')
  const [lookup, setLookup] = useState<{ found: boolean; position: number | null } | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const d = await loadVoteForVerification(voteId)
      if (cancelled) return
      setData(d)
      if (d.vote) setResult(await runFullVerification(d))
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [voteId])

  const check = useCallback(async () => {
    if (!data) return
    setLookup(await findMyBallot(data, code))
  }, [data, code])

  const download = () => {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `vote-${voteId}-verification.json`; a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <div style={wrap}>Loading verification data…</div>
  if (!data?.vote) {
    return (
      <div style={wrap}>
        <h1 style={{ fontSize: 22 }}>Verify your vote</h1>
        <div style={card}>This vote isn&rsquo;t available for public verification yet. Results become verifiable once the board publishes them.</div>
      </div>
    )
  }

  const v = data.vote
  const c = data.commitment

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>Verify your vote</h1>
      <div style={{ fontSize: 15, fontWeight: 700 }}>{v.title}</div>
      <div style={{ fontSize: 13, color: 'rgba(10,36,64,0.6)', marginTop: 2 }}>
        Published result: <strong>{v.result === 'pass' ? 'Passed' : v.result === 'fail' ? 'Failed' : '—'}</strong>
        {' · '}Yes {v.yes_count} · No {v.no_count} · Abstain {v.abstain_count}
      </div>

      {/* 1) Find my ballot */}
      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>1. Find your ballot</div>
        <p style={{ fontSize: 13, color: 'rgba(10,36,64,0.7)', marginTop: 0 }}>
          Enter the verification code you saved when you voted. We recompute its fingerprint and look for it on the public board — your choice stays secret.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={code} onChange={e => setCode(e.target.value)} placeholder="K3F9-A0TX-…"
            style={{ flex: 1, minWidth: 200, padding: '9px 12px', borderRadius: 10, border: '1px solid rgba(10,36,64,0.25)', ...mono }} />
          <button onClick={check} style={{ padding: '9px 18px', borderRadius: 10, border: 'none', background: '#E14909', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Check</button>
        </div>
        {lookup && (
          <div style={{ marginTop: 10, fontSize: 14, color: lookup.found ? '#067647' : '#B42318', fontWeight: 600 }}>
            {lookup.found
              ? `✓ Your ballot is on the board at position ${lookup.position}, unaltered.`
              : '✗ No ballot found for that code. Double-check it, or contact your board.'}
          </div>
        )}
      </div>

      {/* 2) Integrity + 3) Re-tally */}
      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>2. Integrity &amp; count</div>
        <Check ok={result?.chainOk ?? null} label={`Hash chain intact — ${data.box.length} ballots, nothing added, removed, or reordered since close.`} />
        {result && !result.chainOk && result.chainBrokenAt != null && (
          <div style={{ fontSize: 13, color: '#B42318', marginLeft: 32 }}>Chain breaks at position {result.chainBrokenAt}.</div>
        )}
        <Check ok={result?.headMatches ?? null} label="Recomputed chain head matches the value committed at close." />
        <Check ok={result?.ballotCountMatches ?? null} label="Ballot count matches the published commitment." />
        {c?.revealed_secret_key ? (
          <Check ok={result?.tallyMatches ?? null}
            label={result?.retallied
              ? `Independently re-tallied: Yes ${result.retallied.yes} · No ${result.retallied.no} · Abstain ${result.retallied.abstain}${result.retallied.failed ? ` (${result.retallied.failed} undecryptable)` : ''} — ${result.tallyMatches ? 'matches the published result.' : 'does NOT match — investigate.'}`
              : 'Re-tallying…'} />
        ) : (
          <Check ok={null} label="The vote key has not been revealed yet — re-tally becomes available at publish." />
        )}
      </div>

      {/* Attestation + download */}
      <div style={card}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>Provenance</div>
        <div style={{ fontSize: 13, marginBottom: 6 }}>Committed at close: <strong>{c?.committed_at ?? '—'}</strong>{c?.revealed_at ? ` · key revealed ${c.revealed_at}` : ''}</div>
        <div style={{ fontSize: 12.5, marginBottom: 4 }}>Chain head hash:</div>
        <div style={mono}>{c?.chain_head_hash ?? '—'}</div>
        <div style={{ fontSize: 12.5, margin: '8px 0 4px' }}>Deployed ev_cast_ballot SHA-256 (compare to the published .sql):</div>
        <div style={mono}>{c?.cast_function_sha ?? '—'}</div>
        <button onClick={download} style={{ marginTop: 14, padding: '9px 16px', borderRadius: 10, border: '1px solid rgba(10,36,64,0.3)', background: 'transparent', fontWeight: 700, cursor: 'pointer' }}>
          Download verification data (JSON)
        </button>
        <p style={{ fontSize: 12, color: 'rgba(10,36,64,0.55)', marginTop: 10 }}>
          Don&rsquo;t trust this page — run <code style={mono}>scripts/verify-vote.mjs</code> on the downloaded file to verify the chain and re-tally yourself. See <code style={mono}>docs/verify-vote.md</code>.
        </p>
      </div>
    </div>
  )
}
