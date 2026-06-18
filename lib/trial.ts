// Trial window for new communities: 3 months free (no card), then the plan
// bills. We don't store a trial_end column — the window is derived from when
// the community was created, so this stays a pure function the UI can call.
// Only the new 'trial' subscription_status is gated; legacy statuses are left
// alone so existing communities are never surprise-locked.
import { FREE_TRIAL_MONTHS } from './plan'

export const FREE_TRIAL_DAYS = FREE_TRIAL_MONTHS * 30

export type TrialPhase = 'active' | 'trial' | 'expired' | 'none'

export interface TrialState {
  phase: TrialPhase
  endsAt: Date | null
  daysLeft: number   // 0 when expired or not applicable
}

export function trialState(input: {
  created_at?: string | null
  subscription_status?: string | null
}): TrialState {
  const status = input.subscription_status
  if (status === 'active') return { phase: 'active', endsAt: null, daysLeft: 0 }
  if (status !== 'trial')   return { phase: 'none',   endsAt: null, daysLeft: 0 }

  const created = input.created_at ? new Date(input.created_at).getTime() : Date.now()
  const endsAt = new Date(created + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000)
  const msLeft = endsAt.getTime() - Date.now()
  if (msLeft <= 0) return { phase: 'expired', endsAt, daysLeft: 0 }
  return { phase: 'trial', endsAt, daysLeft: Math.ceil(msLeft / (24 * 60 * 60 * 1000)) }
}
