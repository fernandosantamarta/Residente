// Shared AI usage metering for the extraction edge functions (extract-roster,
// extract-setup, extract-doc). Resolves the caller's community, enforces a
// per-community monthly $ cap, and records each call's cost.
//
// Fails OPEN by design: if the service-role key is missing or supabase/ai-usage.sql
// hasn't been run yet (no ev_ai_usage table / no cap column), checkCap returns
// allowed=true and recordUsage is a no-op — so the readers keep working and the
// metering simply switches on once the SQL is applied. Uses the SERVICE ROLE key
// (auto-injected) to read/write past RLS.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
// Fallback cap when a community has no explicit ai_monthly_cap_cents (or the
// column doesn't exist yet). $5.00. Override per-deployment via env.
const DEFAULT_CAP_CENTS = Number(Deno.env.get('AI_MONTHLY_CAP_CENTS') ?? '500')

// Per-1M-token USD prices — keep in sync with the model table. Unknown models
// price as Haiku (the cheap default) so a missing entry never over-charges.
const PRICING: Record<string, { in: number; out: number }> = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-opus-4-7': { in: 5, out: 25 },
  'claude-opus-4-6': { in: 5, out: 25 },
  'claude-sonnet-4-6': { in: 3, out: 15 },
}

export function costCents(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model] || PRICING['claude-haiku-4-5']
  const dollars = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out
  return Math.round(dollars * 100 * 10000) / 10000 // cents, 4 decimals
}

const svc = () => (SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null)

// The signed-in board member's community, from their profile.
export async function communityOf(userId: string): Promise<string | null> {
  const db = svc()
  if (!db) return null
  try {
    const { data } = await db.from('profiles').select('community_id').eq('id', userId).single()
    return (data as any)?.community_id ?? null
  } catch { return null }
}

// First day of the current month, UTC, as ISO — the window for the monthly cap.
function monthStartISO(): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
}

export interface CapState { allowed: boolean; capCents: number; spentCents: number }

// Is this community under its monthly AI cap? Fails open on any infra gap.
export async function checkCap(communityId: string | null): Promise<CapState> {
  const db = svc()
  if (!db || !communityId) return { allowed: true, capCents: DEFAULT_CAP_CENTS, spentCents: 0 }
  try {
    const { data: c } = await db.from('communities').select('ai_monthly_cap_cents').eq('id', communityId).single()
    const cap = Number((c as any)?.ai_monthly_cap_cents ?? DEFAULT_CAP_CENTS)
    const { data: rows, error } = await db.from('ev_ai_usage')
      .select('cost_cents').eq('community_id', communityId).gte('created_at', monthStartISO())
    if (error) return { allowed: true, capCents: cap, spentCents: 0 } // table not created yet → fail open
    const spent = (rows || []).reduce((s: number, r: any) => s + (Number(r.cost_cents) || 0), 0)
    // cap 0 = AI turned OFF for this community (spent < 0 is never true → blocked).
    // A positive cap allows up to that monthly amount.
    return { allowed: spent < cap, capCents: cap, spentCents: spent }
  } catch {
    return { allowed: true, capCents: DEFAULT_CAP_CENTS, spentCents: 0 }
  }
}

// Record one call's token usage + cost. Best-effort; never throws into the caller.
export async function recordUsage(args: {
  communityId: string | null; userId: string | null
  fn: string; kind?: string; model: string; usage: any
}): Promise<void> {
  const db = svc()
  if (!db || !args.communityId) return
  try {
    const u = args.usage || {}
    const inTok = Number(u.input_tokens || 0) + Number(u.cache_read_input_tokens || 0) + Number(u.cache_creation_input_tokens || 0)
    const outTok = Number(u.output_tokens || 0)
    await db.from('ev_ai_usage').insert({
      community_id: args.communityId,
      fn: args.fn,
      kind: args.kind || null,
      model: args.model,
      input_tokens: inTok,
      output_tokens: outTok,
      cost_cents: costCents(args.model, inTok, outTok),
      created_by: args.userId,
    })
  } catch { /* metering is best-effort — a logging failure must not block the read */ }
}
