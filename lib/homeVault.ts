import { supabase, hasSupabase } from './supabase'

// Home Vault — a homeowner's private space. Documents about their home (deed,
// insurance, warranties…) stored in the private `home-vault` bucket under
// {profile_id}/, and self-logged dues payments with optional proof. RLS keeps
// everything scoped to the owner (profile_id = auth.uid()).

export interface HomeDoc {
  id: string
  title: string
  note: string | null
  category: string | null
  storage_path: string
  file_size: number | null
  conveys: boolean
  uploaded_at: string
}

// Categories double as the starter checklist: an item is "done" once a doc of
// that category exists.
export const HOME_DOC_CATEGORIES = [
  'Deed & closing', 'Insurance', 'Warranties', 'Permits',
  'Appliance manuals', 'HOA documents', 'Other',
] as const

export async function listHomeDocs(profileId: string): Promise<HomeDoc[]> {
  if (!hasSupabase || !supabase) return []
  const { data, error } = await supabase
    .from('home_documents').select('*')
    .eq('profile_id', profileId)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return (data || []) as HomeDoc[]
}

export async function uploadHomeDoc(opts: {
  file: File; title: string; note?: string; category: string
  profileId: string; communityId: string | null; residentId: string | null
}): Promise<HomeDoc> {
  if (!hasSupabase || !supabase) throw new Error('Supabase is not configured')
  const ext = (opts.file.name.split('.').pop() || 'bin').toLowerCase()
  const path = `${opts.profileId}/${crypto.randomUUID()}.${ext}`
  const up = await supabase.storage.from('home-vault').upload(path, opts.file)
  if (up.error) throw up.error
  const { data, error } = await supabase.from('home_documents').insert({
    profile_id: opts.profileId,
    community_id: opts.communityId,
    resident_id: opts.residentId,
    title: opts.title.trim() || opts.file.name,
    note: opts.note?.trim() || null,
    category: opts.category,
    storage_path: path,
    file_size: opts.file.size,
  }).select().single()
  if (error) throw error
  return data as HomeDoc
}

export async function setConveys(id: string, conveys: boolean): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('home_documents').update({ conveys }).eq('id', id)
  if (error) throw error
}

export async function deleteHomeDoc(doc: HomeDoc): Promise<void> {
  if (!supabase) return
  await supabase.storage.from('home-vault').remove([doc.storage_path])
  const { error } = await supabase.from('home_documents').delete().eq('id', doc.id)
  if (error) throw error
}

export async function homeDocUrl(path: string): Promise<string | null> {
  if (!supabase) return null
  const { data, error } = await supabase.storage.from('home-vault').createSignedUrl(path, 3600)
  if (error) return null
  return data?.signedUrl ?? null
}

export interface TransferResult {
  ok: boolean
  docs_conveyed: number
  email_sent: boolean
}

// Hand this home off to the next buyer. Calls the `home-transfer` edge function
// (service role): reassigns the roster row to the buyer, moves the conveying
// documents to them, and emails them an invite. The caller must be the current
// owner or the board — the function re-checks. residentId is the roster row id
// for this owner's unit.
export async function transferHome(opts: {
  residentId: string; buyerEmail: string; buyerName?: string
}): Promise<TransferResult> {
  if (!hasSupabase || !supabase) throw new Error('Supabase is not configured')
  const { data, error } = await supabase.functions.invoke('home-transfer', {
    body: {
      resident_id: opts.residentId,
      buyer_email: opts.buyerEmail,
      buyer_name: opts.buyerName,
    },
  })
  if (error) {
    // functions.invoke surfaces a non-2xx as FunctionsHttpError; dig out the
    // JSON {error} the function returns so the UI shows a real message.
    let msg = error.message || 'Transfer failed.'
    try {
      const ctx = (error as any).context
      if (ctx && typeof ctx.json === 'function') {
        const body = await ctx.json()
        if (body?.error) msg = body.error
      }
    } catch { /* keep the generic message */ }
    throw new Error(msg)
  }
  return data as TransferResult
}
