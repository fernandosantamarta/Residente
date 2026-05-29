import { supabase, hasSupabase } from './supabase'

// Client helpers for the self-serve /signup flow. The heavy lifting (creating
// the community, profile, membership, and roster row) happens server-side in
// the `signup-provision` edge function, which runs with the service role. The
// browser's only job is to authenticate (supabase.auth.signUp) and then hand
// the collected answers to that function.

export type SignupRole = 'resident' | 'board_member' | 'admin'
export type PropertyType = 'condo' | 'hoa'

export interface ProvisionCreate {
  mode: 'create'
  association_type: PropertyType
  community_name: string
  location?: string
  unit_count?: number
  role: 'board_member' | 'admin'
  full_name: string
  unit_number?: string
}

export interface ProvisionJoin {
  mode: 'join'
  full_name: string
  join_code?: string
  unit_number?: string
}

export type ProvisionInput = ProvisionCreate | ProvisionJoin

export interface ProvisionResult {
  ok: boolean
  community_id: string
  role: SignupRole
  join_code?: string
}

// Error thrown by provisionAccount. `code` mirrors the edge function's
// business-error codes (bad_code | no_match | ambiguous) so the UI can react
// — e.g. fall back from email-match to asking for a join code.
export class ProvisionError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ProvisionError'
    this.code = code
  }
}

// supabase.functions.invoke surfaces a non-2xx response as a FunctionsHttpError
// whose `context` is the raw Response. Pull our { error, code } body out of it.
async function readFnError(error: unknown): Promise<ProvisionError> {
  const anyErr = error as { message?: string; context?: Response }
  try {
    const res = anyErr?.context
    if (res && typeof res.json === 'function') {
      const body = await res.json()
      if (body?.error) return new ProvisionError(body.error, body.code)
    }
  } catch {
    /* fall through to the generic message */
  }
  return new ProvisionError(anyErr?.message || 'Could not finish setting up your account')
}

export async function provisionAccount(input: ProvisionInput): Promise<ProvisionResult> {
  if (!hasSupabase || !supabase) throw new ProvisionError('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke('signup-provision', { body: input })
  if (error) throw await readFnError(error)
  if (data?.error) throw new ProvisionError(data.error, data.code)
  return data as ProvisionResult
}
