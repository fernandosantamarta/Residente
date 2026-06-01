// Persists resident notification preferences to the DB (resident_preferences)
// so the server-side notice fan-out can honor them. The Settings UI still
// writes localStorage via usePreferences for instant feedback; this mirrors the
// notification subset to Supabase, keyed by the resident's profile id.
//
// Requires supabase/resident-notification-prefs.sql to have been run.

import { supabase } from './supabase'
import type { Preferences } from './preferences'

export type NotificationPrefs = Pick<
  Preferences,
  'email_pref' | 'sms_pref' | 'push_pref' | 'quiet_hours_start' | 'quiet_hours_end'
>

export async function loadNotificationPrefs(profileId: string): Promise<NotificationPrefs | null> {
  if (!supabase || !profileId) return null
  try {
    const { data, error } = await supabase
      .from('resident_preferences')
      .select('email_pref, sms_pref, push_pref, quiet_hours_start, quiet_hours_end')
      .eq('profile_id', profileId)
      .maybeSingle()
    if (error || !data) return null
    return data as NotificationPrefs
  } catch {
    return null   // table not created yet, or offline — keep the localStorage copy
  }
}

export async function saveNotificationPrefs(profileId: string, p: NotificationPrefs): Promise<void> {
  if (!supabase || !profileId) return
  try {
    await supabase.from('resident_preferences').upsert(
      {
        profile_id: profileId,
        email_pref: p.email_pref,
        sms_pref: p.sms_pref,
        push_pref: p.push_pref,
        quiet_hours_start: p.quiet_hours_start,
        quiet_hours_end: p.quiet_hours_end,
      },
      { onConflict: 'profile_id' },
    )
  } catch { /* table not created yet — localStorage still holds the choice */ }
}
