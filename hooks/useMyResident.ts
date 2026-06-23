import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { residentBalance, duesStatus, communityDuesConfig } from '@/lib/dues'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const EMPTY = { resident: null, balance: null, status: 'paid', payments: [], monthlyDues: 0, interestRate: 0, isTenant: false, loading: false }

// Finds the roster row for the signed-in user (matched by email) and computes
// what they currently owe — opening balance + accrued dues − payments.
// resident is null when there's no roster match.
export function useMyResident() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const email = profile?.email
  const profileId = profile?.id
  const [state, setState] = useState({ ...EMPTY, loading: true })

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!hasSupabase || !communityId || !email) {
        if (!cancelled) setState(EMPTY)
        return
      }
      try {
        // Match by the stable account link first. Before the
        // resident-self-service migration runs there's no profile_id
        // column, so this returns an error we ignore and fall back to the
        // legacy email match — dues never break during the transition.
        let resident: any = null
        let isTenant = false
        try {
          const byId = await withTimeout(
            supabase.from('residents').select('*').eq('profile_id', profileId).limit(1)
          )
          if (!byId.error && byId.data && byId.data[0]) resident = byId.data[0]
        } catch { /* column may not exist yet — fall through to email */ }

        // Email fallback + one-time claim (pins the row to this account).
        if (!resident) {
          const byEmail = await withTimeout(
            supabase.from('residents').select('*')
              .eq('community_id', communityId).ilike('email', email).limit(1)
          )
          if (byEmail.error) throw byEmail.error
          resident = (byEmail.data && byEmail.data[0]) || null
          if (resident && !resident.profile_id) {
            try {
              const claim = await withTimeout(
                supabase.from('residents').update({ profile_id: profileId })
                  .eq('id', resident.id).select().single()
              )
              if (!claim.error && claim.data) resident = claim.data
            } catch { /* pre-migration — no profile_id column, ignore */ }
          }
        }

        // Tenant match — a leased unit's tenant is linked via tenant_profile_id
        // (set by the tenant invite), not profile_id/email. They're NON-voting
        // and never see dues (the owner's obligation), so we flag isTenant and
        // skip the balance/payments load entirely.
        if (!resident) {
          try {
            const byTenant = await withTimeout(
              supabase.from('residents').select('*').eq('tenant_profile_id', profileId).limit(1)
            )
            if (!byTenant.error && byTenant.data && byTenant.data[0]) {
              resident = byTenant.data[0]
              isTenant = true
            }
          } catch { /* column may not exist yet — ignore */ }
        }

        if (!resident) {
          if (!cancelled) setState(EMPTY)
          return
        }

        // Tenants don't see dues — return the unit/community context only.
        if (isTenant) {
          if (!cancelled) setState({ ...EMPTY, resident, isTenant: true, loading: false })
          return
        }

        // Keep the roster email aligned with the (verified) login email
        // after an email change. No-op when they already match or when the
        // resident can't write yet (pre-migration RLS).
        if (resident.email && resident.email.toLowerCase() !== email.toLowerCase()) {
          try {
            const sync = await withTimeout(
              supabase.from('residents').update({ email }).eq('id', resident.id).select().single()
            )
            if (!sync.error && sync.data) resident = sync.data
          } catch { /* ignore — keep the matched row */ }
        }
        const [comR, payR] = await Promise.all([
          withTimeout(supabase.from('communities').select('*')
            .eq('id', communityId).single()),
          withTimeout(supabase.from('payments').select('*')
            .eq('resident_id', resident.id).order('paid_on', { ascending: false })),
        ])
        if (cancelled) return
        const monthlyDues = Number(comR.data?.monthly_dues) || 0
        const duesCfg = communityDuesConfig(comR.data)
        const payments = payR.data || []
        const balance = residentBalance(resident, monthlyDues, payments, duesCfg)
        setState({
          resident, balance, status: duesStatus(balance, monthlyDues),
          payments, monthlyDues, interestRate: duesCfg.apr, isTenant: false, loading: false,
        })
      } catch (err) {
        if (!cancelled) setState(EMPTY)
      }
    }
    load()
    return () => { cancelled = true }
  }, [communityId, email, profileId])

  return state
}
