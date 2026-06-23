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

// Communities kept out of the trial UI entirely (banner / countdown / welcome /
// expiry gate) — e.g. the App Store demo, which should read as a clean,
// established community to reviewers.
export const TRIAL_EXCLUDED_COMMUNITIES = new Set<string>([
  '7ba2983b-f19f-4095-b744-b2773b00d230', // Sunset Lakes — Apple review demo
])

export function trialState(input: {
  id?: string | null
  created_at?: string | null
  subscription_status?: string | null
}): TrialState {
  if (input.id && TRIAL_EXCLUDED_COMMUNITIES.has(input.id)) {
    return { phase: 'none', endsAt: null, daysLeft: 0 }
  }
  const status = input.subscription_status
  if (status === 'active') return { phase: 'active', endsAt: null, daysLeft: 0 }
  // 'free' communities are on their 3 free months too — treat them like 'trial'
  // so the countdown / banner / welcome popup show during the free window, then
  // the soft expiry gate kicks in (3 months free, then you pay).
  if (status !== 'trial' && status !== 'free') return { phase: 'none', endsAt: null, daysLeft: 0 }

  const created = input.created_at ? new Date(input.created_at).getTime() : Date.now()
  const endsAt = new Date(created + FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000)
  const day = 24 * 60 * 60 * 1000
  const msLeft = endsAt.getTime() - Date.now()
  if (msLeft <= 0) return { phase: 'expired', endsAt, daysLeft: 0 }
  // Floor (not ceil) so this matches Stripe Checkout's "N days free", which
  // floors the same created_at+90d window — on signup day both read 89, not a
  // 90-vs-89 split. max(1,…) keeps the final partial day at "1 day left".
  return { phase: 'trial', endsAt, daysLeft: Math.max(1, Math.floor(msLeft / day)) }
}
