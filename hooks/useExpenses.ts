import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

export type Expense = {
  id: string
  category_id: string | null
  amount: number
  spent_on: string
  description: string | null
  vendor: string | null
}

const SELECT = 'id, category_id, amount, spent_on, description, vendor'

const rowTo = (r: any): Expense => ({
  id: r.id,
  category_id: r.category_id ?? null,
  amount: Number(r.amount) || 0,
  spent_on: r.spent_on,
  description: r.description ?? null,
  vendor: r.vendor ?? null,
})

// Community expense ledger. Read-only here — used by the resident Home chart
// (members read their community via RLS) and as the base for the admin editor.
export function useExpenses() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !communityId) { setLoading(false); return }
    setLoading(true)
    try {
      const { data, error } = await withTimeout(
        supabase.from('ev_expenses').select(SELECT)
          .eq('community_id', communityId)
          .order('spent_on', { ascending: true }),
      )
      if (!error) setExpenses((data ?? []).map(rowTo))
    } finally {
      setLoading(false)
    }
  }, [communityId])

  useEffect(() => { load() }, [load])

  return { expenses, loading, reload: load, communityId }
}

export type NewExpense = {
  category_id: string | null
  amount: number
  spent_on: string
  description: string | null
  vendor: string | null
}

// Board-side editor: the read list plus add / remove. RLS enforces the
// board-only write; the form is only rendered in /admin anyway.
export function useExpensesAdmin() {
  const { expenses, loading, reload, communityId } = useExpenses()

  const addExpense = useCallback(async (e: NewExpense) => {
    if (!hasSupabase || !supabase || !communityId) return
    const { error } = await withTimeout(
      supabase.from('ev_expenses').insert({
        community_id: communityId,
        category_id: e.category_id,
        amount: e.amount,
        spent_on: e.spent_on,
        description: e.description,
        vendor: e.vendor,
      }),
    )
    if (error) throw error
    await reload()
  }, [communityId, reload])

  const removeExpense = useCallback(async (id: string) => {
    if (!hasSupabase || !supabase) return
    const { error } = await withTimeout(
      supabase.from('ev_expenses').delete().eq('id', id),
    )
    if (error) throw error
    await reload()
  }, [reload])

  return { expenses, loading, reload, addExpense, removeExpense }
}

// Cumulative spend per month (Jan..Dec) for a given year. Index 0 = Jan.
// Returns running totals so a charting caller can plot the curve directly.
export function cumulativeByMonth(expenses: Expense[], year: number): number[] {
  const monthly = new Array(12).fill(0)
  for (const e of expenses) {
    const d = new Date(e.spent_on + 'T00:00:00')
    if (d.getFullYear() !== year) continue
    monthly[d.getMonth()] += e.amount
  }
  const cum: number[] = []
  let running = 0
  for (let i = 0; i < 12; i++) { running += monthly[i]; cum.push(running) }
  return cum
}
