// DB-backed resident lists (emergency contacts, vehicles, pets). Replaces the
// localStorage-only storage so these reach the board and sync across devices.
// The Settings editors call these when the resident is authed; in preview /
// no-auth they fall back to localStorage via usePreferences.
//
// Requires supabase/resident-lists.sql.

import { supabase } from './supabase'
import type { EmergencyContact, Vehicle, Pet } from './preferences'

export async function loadResidentLists(profileId: string): Promise<{
  contacts: EmergencyContact[]; vehicles: Vehicle[]; pets: Pet[]
} | null> {
  if (!supabase || !profileId) return null
  try {
    const [c, v, p] = await Promise.all([
      supabase.from('resident_emergency_contacts').select('*').eq('profile_id', profileId).order('created_at'),
      supabase.from('resident_vehicles').select('*').eq('profile_id', profileId).order('created_at'),
      supabase.from('resident_pets').select('*').eq('profile_id', profileId).order('created_at'),
    ])
    if (c.error || v.error || p.error) return null
    return {
      contacts: (c.data || []).map((r: any) => ({ id: r.id, name: r.name, relation: r.relation || '', phone: r.phone || '' })),
      vehicles: (v.data || []).map((r: any) => ({ id: r.id, make: r.make || '', model: r.model || '', plate: r.plate || '', color: r.color || '' })),
      pets:     (p.data || []).map((r: any) => ({ id: r.id, name: r.name, species: r.species || '', breed: r.breed || '' })),
    }
  } catch {
    return null   // tables not created yet, or offline — keep the localStorage copy
  }
}

// Add helpers return the inserted row (with its DB id) so the editor can use it
// as the React key + for removal. Return null on failure so the caller can fall
// back to a local-only entry.
export async function addContact(profileId: string, communityId: string | null, c: Omit<EmergencyContact, 'id'>): Promise<EmergencyContact | null> {
  if (!supabase || !profileId) return null
  try {
    const { data, error } = await supabase.from('resident_emergency_contacts')
      .insert({ profile_id: profileId, community_id: communityId, name: c.name, relation: c.relation || null, phone: c.phone || null })
      .select().single()
    if (error || !data) return null
    return { id: data.id, name: data.name, relation: data.relation || '', phone: data.phone || '' }
  } catch { return null }
}

export async function addVehicle(profileId: string, communityId: string | null, v: Omit<Vehicle, 'id'>): Promise<Vehicle | null> {
  if (!supabase || !profileId) return null
  try {
    const { data, error } = await supabase.from('resident_vehicles')
      .insert({ profile_id: profileId, community_id: communityId, make: v.make || null, model: v.model || null, plate: v.plate || null, color: v.color || null })
      .select().single()
    if (error || !data) return null
    return { id: data.id, make: data.make || '', model: data.model || '', plate: data.plate || '', color: data.color || '' }
  } catch { return null }
}

export async function addPet(profileId: string, communityId: string | null, p: Omit<Pet, 'id'>): Promise<Pet | null> {
  if (!supabase || !profileId) return null
  try {
    const { data, error } = await supabase.from('resident_pets')
      .insert({ profile_id: profileId, community_id: communityId, name: p.name, species: p.species || null, breed: p.breed || null })
      .select().single()
    if (error || !data) return null
    return { id: data.id, name: data.name, species: data.species || '', breed: data.breed || '' }
  } catch { return null }
}

// Generic remove — all three tables share an `id` PK. table is one of the three.
export async function removeResidentRow(
  table: 'resident_emergency_contacts' | 'resident_vehicles' | 'resident_pets',
  id: string,
): Promise<void> {
  if (!supabase || !id) return
  try { await supabase.from(table).delete().eq('id', id) } catch { /* keep local removal */ }
}
