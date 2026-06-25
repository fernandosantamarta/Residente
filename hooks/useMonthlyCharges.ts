import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = <T,>(p: PromiseLike<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

export type MonthlyChargeStatus = 'pending' | 'paid-in-full' | 'partial' | 'reversed'

export type MonthlyCharge = {
  id: string
  community_id: string
  resident_id: string
  billing_period_start: string
  billing_period_end: string
  due_date: string
  amount: number
  status: MonthlyChargeStatus
  created_at: string
  notes: string | null
  // Joined for display — the household the charge was raised against.
  residentName: string | null
  residentUnit: string | null
}

// The auto-generated monthly-dues ledger for the board's community, newest
// (most recent due_date) first. RLS scopes the board to its own community
// (monthly-charges.sql). AUDIT view only — balances stay formula-based in
// lib/dues.ts, so nothing here is summed into what a resident owes.
export function useMonthlyCharges() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [charges, setCharges] = useState<MonthlyCharge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) {
      setCharges([]); setLoading(false); setError(null)
      return
    }
    setLoading(true); setError(null)
    try {
      const { data, error: qErr } = await withTimeout(
        supabase
          .from('ev_monthly_charges')
          .select('id, community_id, resident_id, billing_period_start, billing_period_end, due_date, amount, status, created_at, notes, residents(full_name, unit_number, address)')
          .eq('community_id', communityId)
          .order('due_date', { ascending: false }),
      )
      if (qErr) throw qErr
      const rows: MonthlyCharge[] = (data || []).map((r: any) => ({
        id: r.id,
        community_id: r.community_id,
        resident_id: r.resident_id,
        billing_period_start: r.billing_period_start,
        billing_period_end: r.billing_period_end,
        due_date: r.due_date,
        amount: Number(r.amount) || 0,
        status: r.status,
        created_at: r.created_at,
        notes: r.notes ?? null,
        residentName: r.residents?.full_name ?? null,
        residentUnit: r.residents?.unit_number ?? r.residents?.address ?? null,
      }))
      setCharges(rows)
      setLoading(false)
    } catch (e: any) {
      setError(e?.message || 'Could not load charges')
      setCharges([])
      setLoading(false)
    }
  }, [communityId])

  useEffect(() => { reload() }, [reload])

  return { charges, loading, error, reload }
}
