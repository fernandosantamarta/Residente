import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = <T,>(p: PromiseLike<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const fmtUsd = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')

// Pie palette — terracotta / navy / clay / sage, then a few more so any
// number of budget categories renders distinctly.
const PALETTE = ['#E14909', '#0A2440', '#C76F45', '#7D8C5C', '#3E7CB1', '#B0741F', '#5B8C5A', '#8C5B7A']

export type GenReportCategory =
  | 'financial' | 'maintenance' | 'operations' | 'community'
  | 'safety' | 'vendor' | 'compliance' | 'board'

export type GenReport = {
  id: string
  title: string
  category: GenReportCategory
  date: string
  status: 'published' | 'updated' | 'draft'
  blurb?: string
  featured?: boolean
}

export type GeneratedReports = {
  loading: boolean
  hasData: boolean
  reports: GenReport[]
  finance: { segments: { label: string; amount: number; color: string }[]; total: number }
  dues: { collected: number; outstanding: number; paid: number; due: number; late: number; households: number; rate: number }
}

const EMPTY: GeneratedReports = {
  loading: false,
  hasData: false,
  reports: [],
  finance: { segments: [], total: 0 },
  dues: { collected: 0, outstanding: 0, paid: 0, due: 0, late: 0, households: 0, rate: 0 },
}

// Builds the resident Reports page entirely from data the community already
// has in the other tabs — Community budget, Residents, Payments, Board
// decisions. Nothing is hand-published. Returns hasData=false when there's no
// community linked (or Supabase is off), so the page falls back to its demo.
export function useGeneratedReports(): GeneratedReports {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [state, setState] = useState<GeneratedReports>({ ...EMPTY, loading: true })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!hasSupabase || !supabase || !communityId) {
        if (!cancelled) setState(EMPTY)
        return
      }
      try {
        const [cRes, catRes, resRes, duesRes, decRes] = await Promise.all([
          withTimeout(supabase.from('communities').select('*').eq('id', communityId).single()),
          withTimeout(supabase.from('budget_categories').select('*').eq('community_id', communityId).order('sort_order')),
          withTimeout(supabase.from('residents').select('*').eq('community_id', communityId)),
          // Dues totals come from a SECURITY DEFINER aggregate, NOT the payments
          // rows: residents may not read other households' payments (RLS), but
          // everyone may see the community collection %. See
          // supabase/migrations/0002_community_dues_summary.sql.
          withTimeout(supabase.rpc('community_dues_summary', { p_community: communityId })),
          withTimeout(supabase.from('board_decisions').select('*').eq('community_id', communityId).order('decided_on', { ascending: false })),
        ])
        if (cancelled) return

        const community: any = (cRes as any).data
        if (!community) { setState(EMPTY); return }
        const categories: any[] = (catRes as any).data || []
        const residents: any[] = (resRes as any).data || []
        const decisions: any[] = (decRes as any).data || []

        // --- Finance: pie of budget per category ---
        const segments = categories
          .filter(c => (Number(c.budget) || 0) > 0)
          .map((c, i) => ({ label: c.name, amount: Number(c.budget) || 0, color: PALETTE[i % PALETTE.length] }))
        const totalBudget = segments.reduce((s, x) => s + x.amount, 0) || (Number(community.annual_budget) || 0)
        const totalSpent = categories.reduce((s, c) => s + (Number(c.spent) || 0), 0)
        const spentPct = totalBudget > 0 ? Math.round((totalSpent / totalBudget) * 100) : 0

        // --- Dues: community aggregate from the SECURITY DEFINER function.
        // Returns totals + status counts only; no per-payer amounts cross the
        // wire, so a resident sees the collection % but never who paid.
        const duesRow: any = Array.isArray((duesRes as any).data)
          ? (duesRes as any).data[0]
          : (duesRes as any).data
        const collected   = Number(duesRow?.collected) || 0
        const outstanding = Number(duesRow?.outstanding) || 0
        const paid        = Number(duesRow?.paid) || 0
        const due         = Number(duesRow?.due) || 0
        const late        = Number(duesRow?.late) || 0
        const collRate    = duesRow ? (Number(duesRow.rate) || 0) : 100

        // --- Generated report entries ---
        const today = new Date().toISOString().slice(0, 10)
        const period = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        const reports: GenReport[] = []
        if (totalBudget > 0) {
          reports.push({
            id: 'gen-budget', title: `Budget Summary — ${period}`, category: 'financial',
            date: today, status: 'updated', featured: true,
            blurb: `${fmtUsd(totalBudget)} annual budget across ${segments.length} categor${segments.length === 1 ? 'y' : 'ies'}.`,
          })
        }
        if (residents.length > 0) {
          reports.push({
            id: 'gen-dues', title: `Dues Collection — ${period}`, category: 'financial',
            date: today, status: 'updated', featured: true,
            blurb: `${collRate}% collected · ${fmtUsd(outstanding)} outstanding across ${residents.length} household${residents.length === 1 ? '' : 's'}.`,
          })
        }
        if (totalBudget > 0) {
          reports.push({
            id: 'gen-spend', title: 'Budget vs Spend', category: 'operations',
            date: today, status: 'updated',
            blurb: `${spentPct}% of the annual budget spent so far (${fmtUsd(totalSpent)} of ${fmtUsd(totalBudget)}).`,
          })
        }
        if (decisions.length > 0) {
          reports.push({
            id: 'gen-board', title: 'Board Activity', category: 'board',
            date: decisions[0].decided_on || today, status: 'updated', featured: true,
            blurb: `${decisions.length} decision${decisions.length === 1 ? '' : 's'} logged · latest: ${decisions[0].title}.`,
          })
        }
        if (late > 0) {
          reports.push({
            id: 'gen-delinquency', title: 'Delinquency Report', category: 'financial',
            date: today, status: 'updated',
            blurb: `${late} household${late === 1 ? '' : 's'} behind on dues.`,
          })
        }

        if (cancelled) return
        setState({
          loading: false,
          hasData: reports.length > 0 || segments.length > 0,
          reports,
          finance: { segments, total: totalBudget },
          dues: { collected, outstanding, paid, due, late, households: residents.length, rate: collRate },
        })
      } catch {
        if (!cancelled) setState(EMPTY)
      }
    }
    load()
    return () => { cancelled = true }
  }, [communityId])

  return state
}
