import { cumulativeByMonth, type Expense } from '@/hooks/useExpenses'

// Community "health" rating (0–100) — the single source of truth shared by the
// resident Home "Where your dues go" card and the admin Compliance dashboard so
// both always read the same number. It grades how the community's money is being
// run: budget pace (on pace = 100, over pace lowers it) with a +15 reserve-funded
// bonus. Real spend comes from the dated expense ledger when present, otherwise it
// falls back to the per-category manual "spent" totals — same as the Home card.
export function computeCommunityRating(opts: {
  community: any
  categories: any[]
  expenses?: Expense[]
  /** Dues received ÷ dues expected to date (0–1), from the
   *  community_collection_rate RPC. null/undefined = signal unavailable
   *  (SQL not run yet / no expected dues) — the grade falls back to
   *  budget-pace only, exactly as before. */
  collectionRate?: number | null
  now?: Date
}): number {
  const now = opts.now ?? new Date()
  const num = (v: any) => Number(v) || 0
  const cats = opts.categories || []

  const yStart = new Date(now.getFullYear(), 0, 1)
  const yEnd = new Date(now.getFullYear() + 1, 0, 1)
  const yearPct = Math.max(0, Math.min(1, (now.getTime() - yStart.getTime()) / (yEnd.getTime() - yStart.getTime())))

  const catSpent = cats.reduce((s, x) => s + num(x.spent), 0)
  const catBudgetSum = cats.reduce((s, x) => s + num(x.budget), 0)
  const annualBudget = num(opts.community?.annual_budget) || catBudgetSum

  const expenses = opts.expenses || []
  const expensesToDate = cumulativeByMonth(expenses, now.getFullYear())[now.getMonth()]
  const hasExpenses = expenses.length > 0 && expensesToDate > 0
  const totalSpent = hasExpenses ? expensesToDate : catSpent
  const spentPct = annualBudget > 0 ? totalSpent / annualBudget : 0

  const expectedPctNum = Math.round(yearPct * 100)
  const actualPctNum = Math.round(spentPct * 100)
  const paceRatio = expectedPctNum > 0 ? actualPctNum / expectedPctNum : 1
  const healthPct = Math.max(0, Math.min(100, Math.round((1 - Math.max(0, paceRatio - 1)) * 100)))

  const reserveCats = cats.filter((x: any) => x.is_reserve)
  const reserveSource = reserveCats.length ? reserveCats : cats.filter((x: any) => /reserve/i.test(x.name || ''))
  const reserveTotal = reserveSource.reduce((s, x) => s + (num(x.budget) - num(x.spent)), 0)

  const base = Math.max(0, Math.min(100, Math.round(healthPct * 0.85) + (reserveTotal > 0 ? 15 : 0)))

  // Collections reality check: a community where the dues aren't actually
  // being paid isn't "run well" no matter how on-pace the budget looks. When
  // the received/expected rate is available it takes 40% of the grade.
  if (opts.collectionRate == null || isNaN(Number(opts.collectionRate))) return base
  const collected = Math.max(0, Math.min(1, Number(opts.collectionRate)))
  return Math.max(0, Math.min(100, Math.round(base * 0.6 + collected * 100 * 0.4)))
}
