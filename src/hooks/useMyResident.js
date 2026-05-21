import { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { supabase, hasSupabase } from '../lib/supabase'
import { residentBalance, duesStatus } from '../lib/dues'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const EMPTY = { resident: null, balance: null, status: 'paid', payments: [], monthlyDues: 0, interestRate: 0, loading: false }

// Finds the roster row for the signed-in user (matched by email) and computes
// what they currently owe — opening balance + accrued dues − payments.
// resident is null when there's no roster match.
export function useMyResident() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const email = profile?.email
  const [state, setState] = useState({ ...EMPTY, loading: true })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!hasSupabase || !communityId || !email) {
        if (!cancelled) setState(EMPTY)
        return
      }
      try {
        const resR = await withTimeout(
          supabase.from('residents').select('*')
            .eq('community_id', communityId).ilike('email', email).limit(1)
        )
        if (resR.error) throw resR.error
        const resident = (resR.data && resR.data[0]) || null
        if (!resident) {
          if (!cancelled) setState(EMPTY)
          return
        }
        const [comR, payR] = await Promise.all([
          withTimeout(supabase.from('communities').select('*')
            .eq('id', communityId).single()),
          withTimeout(supabase.from('payments').select('*')
            .eq('resident_id', resident.id).order('paid_on', { ascending: false })),
        ])
        if (cancelled) return
        const monthlyDues = Number(comR.data?.monthly_dues) || 0
        const interestRate = Number(comR.data?.late_interest_rate) || 0
        const payments = payR.data || []
        const balance = residentBalance(resident, monthlyDues, payments, interestRate)
        setState({
          resident, balance, status: duesStatus(balance, monthlyDues),
          payments, monthlyDues, interestRate, loading: false,
        })
      } catch (err) {
        if (!cancelled) setState(EMPTY)
      }
    }
    load()
    return () => { cancelled = true }
  }, [communityId, email])

  return state
}
