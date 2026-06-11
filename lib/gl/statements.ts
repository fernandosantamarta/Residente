// Pure roll-ups from the GL trial balance into the accrual statements.
//
// Inputs are rows from the DB views gl_trial_balance (CUMULATIVE since inception
// → Balance Sheet) and gl_trial_balance_fy (per fiscal year → Rev & Exp + the
// live audit-tier revenue). These functions are side-effect free and exact-round
// to cents; scripts/verify-gl-statements.mjs (npm run verify:gl-statements) golden-
// checks them, including the accounting identity Assets == Liabilities + Equity.
//
// Sign convention (gl_accounts.type): assets & expenses are debit-normal, so their
// "amount" is the row balance (debit − credit). Liabilities, equity and revenue are
// credit-normal, so their amount is −balance. Because the whole trial balance nets
// to zero by construction (the balanced-entry trigger), a balance sheet built this
// way ALWAYS satisfies Assets == Liabilities + Equity + NetIncome.

export type Fund = 'operating' | 'reserve'

export interface TBRow {
  community_id?: string
  fiscal_year?: number | null
  fund: Fund | string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense' | string
  debit?: number | string | null
  credit?: number | string | null
  balance?: number | string | null
}

export interface StatementLine { code: string; name: string; amount: number }

const round2 = (x: number) => Math.round((Number(x) || 0) * 100) / 100
const bal = (r: TBRow): number =>
  round2(r.balance != null ? Number(r.balance) : (Number(r.debit) || 0) - (Number(r.credit) || 0))
const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0))
// Operating first, then reserve, then anything else — stable display order.
const fundRank = (f: string) => (f === 'operating' ? 0 : f === 'reserve' ? 1 : 2)
const fundsIn = (rows: TBRow[]): string[] =>
  [...new Set(rows.map(r => String(r.fund)))].sort((a, b) => fundRank(a) - fundRank(b))
const byCode = (a: StatementLine, b: StatementLine) => a.code.localeCompare(b.code)

/**
 * Σ earned revenue (credit-normal ⇒ −balance) for one fiscal year — the live
 * figure that drives the CPA audit tier. Pass gl_trial_balance_fy rows; omit
 * fiscalYear to sum all rows already scoped by the caller.
 */
export function glCurrentFyRevenue(rows: TBRow[], fiscalYear?: number | null): number {
  return sum(rows
    .filter(r => r.type === 'revenue' && (fiscalYear == null || Number(r.fiscal_year) === Number(fiscalYear)))
    .map(r => -bal(r)))
}

export interface BalanceSheetFund {
  fund: Fund | string
  assets: StatementLine[]
  liabilities: StatementLine[]
  equity: StatementLine[]    // reported equity accounts (e.g. 3000/3010)
  netIncome: number          // cumulative revenue − expense within the fund
  totalAssets: number
  totalLiabilities: number
  totalEquity: number        // reported equity + netIncome
  balances: boolean          // totalAssets == totalLiabilities + totalEquity (± 1¢)
}
export interface BalanceSheet {
  funds: BalanceSheetFund[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  balances: boolean
}

/** Balance Sheet by fund from CUMULATIVE gl_trial_balance rows. */
export function balanceSheetByFund(rows: TBRow[]): BalanceSheet {
  const funds: BalanceSheetFund[] = fundsIn(rows).map(fund => {
    const fr = rows.filter(r => String(r.fund) === fund)
    const assets = fr.filter(r => r.type === 'asset').map(r => ({ code: r.code, name: r.name, amount: bal(r) })).sort(byCode)
    const liabilities = fr.filter(r => r.type === 'liability').map(r => ({ code: r.code, name: r.name, amount: -bal(r) })).sort(byCode)
    const equity = fr.filter(r => r.type === 'equity').map(r => ({ code: r.code, name: r.name, amount: -bal(r) })).sort(byCode)
    const netIncome = sum([
      ...fr.filter(r => r.type === 'revenue').map(r => -bal(r)),
      ...fr.filter(r => r.type === 'expense').map(r => -bal(r)),
    ])
    const totalAssets = sum(assets.map(a => a.amount))
    const totalLiabilities = sum(liabilities.map(a => a.amount))
    const totalEquity = round2(sum(equity.map(a => a.amount)) + netIncome)
    return {
      fund, assets, liabilities, equity, netIncome,
      totalAssets, totalLiabilities, totalEquity,
      balances: Math.abs(totalAssets - (totalLiabilities + totalEquity)) <= 0.01,
    }
  })
  const totalAssets = sum(funds.map(f => f.totalAssets))
  const totalLiabilities = sum(funds.map(f => f.totalLiabilities))
  const totalEquity = sum(funds.map(f => f.totalEquity))
  return {
    funds, totalAssets, totalLiabilities, totalEquity,
    balances: Math.abs(totalAssets - (totalLiabilities + totalEquity)) <= 0.01,
  }
}

export interface RevExpFund {
  fund: Fund | string
  revenue: StatementLine[]
  expense: StatementLine[]
  totalRevenue: number
  totalExpense: number
  net: number               // surplus (+) / deficit (−)
}
export interface RevExp {
  funds: RevExpFund[]
  totalRevenue: number
  totalExpense: number
  net: number
}

/** Accrual Statement of Revenue & Expenses by fund, scoped to one fiscal year. */
export function revExpByFund(rows: TBRow[], fiscalYear?: number | null): RevExp {
  const scoped = rows.filter(r => fiscalYear == null || Number(r.fiscal_year) === Number(fiscalYear))
  const funds: RevExpFund[] = fundsIn(scoped).map(fund => {
    const fr = scoped.filter(r => String(r.fund) === fund)
    const revenue = fr.filter(r => r.type === 'revenue').map(r => ({ code: r.code, name: r.name, amount: -bal(r) })).sort(byCode)
    const expense = fr.filter(r => r.type === 'expense').map(r => ({ code: r.code, name: r.name, amount: bal(r) })).sort(byCode)
    const totalRevenue = sum(revenue.map(a => a.amount))
    const totalExpense = sum(expense.map(a => a.amount))
    return { fund, revenue, expense, totalRevenue, totalExpense, net: round2(totalRevenue - totalExpense) }
  }).filter(f => f.revenue.length || f.expense.length)
  const totalRevenue = sum(funds.map(f => f.totalRevenue))
  const totalExpense = sum(funds.map(f => f.totalExpense))
  return { funds, totalRevenue, totalExpense, net: round2(totalRevenue - totalExpense) }
}
