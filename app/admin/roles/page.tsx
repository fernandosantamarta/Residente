'use client'

// Roles & permissions — the custom role builder. Create named roles with a
// permission set, then assign them to board members. All writes go through the
// security-definer RPCs in supabase/custom-roles.sql (ev_role_save / _delete /
// _assign), which enforce roles.manage and a "never remove the last role
// manager" lockout guard. Gated on roles.manage; admins (legacy or 'Admin'
// role) qualify.

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSION_GROUPS, PERMISSION_LABEL, type Permission } from '@/lib/permissions'
import { Dropdown } from '@/components/Dropdown'

const withTimeout = (p: any, ms = 10000) =>
  Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms))])

type Role = { id: string; name: string; permissions: string[]; is_admin: boolean; is_system: boolean }
type Member = { id: string; full_name: string | null; board_position: string | null; role_id: string | null }

export default function RolesPage() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const { can, loading: permLoading } = usePermissions()

  const [roles, setRoles] = useState<Role[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState('')
  const [msg, setMsg] = useState('')

  // Role editor form
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [perms, setPerms] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 4000); return () => clearTimeout(t) }, [msg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [{ data: r }, { data: m }] = (await Promise.all([
        withTimeout(supabase!.from('ev_roles').select('id, name, permissions, is_admin, is_system')
          .eq('community_id', communityId).order('is_admin', { ascending: false }).order('name')),
        withTimeout(supabase!.from('residents').select('id, full_name, board_position, role_id')
          .eq('community_id', communityId).not('board_position', 'is', null).order('full_name')),
      ])) as any
      setRoles(r || []); setMembers(m || [])
      setStatus('ready')
    } catch (err: any) {
      setError(err?.message || 'Could not load roles'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  const roleName = useCallback((id: string | null) => roles.find(x => x.id === id)?.name || '—', [roles])

  const startNew = () => { setEditId(null); setName(''); setPerms(new Set()) }
  const startEdit = (r: Role) => {
    setEditId(r.id); setName(r.name); setPerms(new Set(r.permissions || []))
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const togglePerm = (k: string) => setPerms(prev => {
    const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next
  })

  const saveRole = async () => {
    if (!name.trim()) { setError('Name the role.'); return }
    setSaving(true); setError('')
    try {
      const { error } = (await withTimeout(supabase!.rpc('ev_role_save', {
        p_id: editId, p_name: name.trim(), p_perms: Array.from(perms),
      }))) as any
      if (error) throw error
      setMsg(editId ? 'Role updated.' : 'Role created.')
      startNew(); load()
    } catch (err: any) { setError(err?.message || 'Could not save the role.') }
    finally { setSaving(false) }
  }

  const deleteRole = async (r: Role) => {
    if (!window.confirm(`Delete the "${r.name}" role? Members holding it will lose its access.`)) return
    setError('')
    try {
      const { error } = (await withTimeout(supabase!.rpc('ev_role_delete', { p_id: r.id }))) as any
      if (error) throw error
      if (editId === r.id) startNew()
      setMsg(`Removed "${r.name}".`); load()
    } catch (err: any) { setError(err?.message || 'Could not delete the role.') }
  }

  const assignRole = async (residentId: string, roleId: string | null) => {
    setError('')
    // optimistic
    setMembers(ms => ms.map(m => m.id === residentId ? { ...m, role_id: roleId } : m))
    try {
      const { error } = (await withTimeout(supabase!.rpc('ev_role_assign', {
        p_resident: residentId, p_role: roleId,
      }))) as any
      if (error) throw error
      setMsg('Role assigned.')
    } catch (err: any) { setError(err?.message || 'Could not assign the role.'); load() }
  }

  const editingRole = useMemo(() => roles.find(r => r.id === editId) || null, [roles, editId])
  const editingProtected = !!editingRole?.is_admin

  // ----- access gate -----
  if (!permLoading && !can('roles.manage')) {
    return (
      <div className="admin-page">
        <div className="admin-kicker">Administration</div>
        <h1 className="admin-h1">Roles &amp; permissions</h1>
        <div className="admin-note admin-note-warn">You don&rsquo;t have permission to manage roles.</div>
      </div>
    )
  }

  return (
    <div className="admin-page">
      <div className="admin-kicker">Administration</div>
      <h1 className="admin-h1">Roles &amp; permissions</h1>
      <p className="admin-dek">
        Build roles with exactly the access each board member needs, then assign
        them below. The <strong>Admin</strong> role always has full access.
      </p>

      {msg && <div className="admin-success" role="status"><span className="admin-success-check" aria-hidden>✓</span>{msg}</div>}
      {status === 'none' && <div className="admin-note admin-note-warn">No community is linked to your account yet.</div>}
      {status === 'error' && <div className="admin-note admin-note-err">{error}<button type="button" className="admin-btn-ghost" onClick={load}>Retry</button></div>}
      {status === 'loading' && <div className="admin-note">Loading…</div>}

      {status === 'ready' && (
        <>
          {/* Role editor */}
          <section className="admin-sched-card">
            <div className="admin-sched-card-head">
              <h2>{editId ? (editingProtected ? `Viewing “${name}”` : `Edit “${name}”`) : 'Create a role'}</h2>
              <span className="admin-sched-card-sub">
                {editingProtected ? 'The Admin role has full access and can’t be edited.' : 'Pick a name and the areas this role can use.'}
              </span>
            </div>

            <label className="admin-field" style={{ maxWidth: 360 }}>
              <span className="admin-field-label">Role name</span>
              <input className="admin-input" value={name} disabled={editingProtected}
                placeholder="e.g. Treasurer" onChange={e => setName(e.target.value)} />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, margin: '16px 0' }}>
              {PERMISSION_GROUPS.map(g => (
                <div key={g.label}>
                  <div style={{ fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6, fontWeight: 600, marginBottom: 8 }}>{g.label}</div>
                  {g.perms.map(p => (
                    <label key={p.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, padding: '4px 0', opacity: editingProtected ? 0.5 : 1 }}>
                      <input type="checkbox" checked={editingProtected || perms.has(p.key)} disabled={editingProtected}
                        onChange={() => togglePerm(p.key)} />
                      {p.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>

            {!editingProtected && (
              <div style={{ display: 'flex', gap: 10 }}>
                <button className="admin-primary-btn" disabled={saving} onClick={saveRole}>
                  {saving ? 'Saving…' : editId ? 'Save changes' : 'Create role'}
                </button>
                {editId && <button className="admin-btn-ghost" type="button" onClick={startNew}>Cancel</button>}
              </div>
            )}
            {editingProtected && <button className="admin-btn-ghost" type="button" onClick={startNew}>Back to new role</button>}
            {error && <div className="admin-note admin-note-err" style={{ marginTop: 10 }}>{error}</div>}
          </section>

          {/* Roles list */}
          <section className="admin-sched-card">
            <div className="admin-sched-card-head"><h2>Roles</h2><span className="admin-sched-card-sub">{roles.length} total</span></div>
            <div className="admin-sched-list">
              {roles.map(r => (
                <div key={r.id} className="admin-sched-row">
                  <div className="admin-sched-row-body">
                    <div className="admin-sched-row-title">
                      {r.name}{r.is_admin && <span className="amen-pay-tag paid" style={{ marginLeft: 8 }}>Full access</span>}{r.is_system && !r.is_admin && <span className="amen-pay-tag pending" style={{ marginLeft: 8 }}>Default</span>}
                    </div>
                    <div className="admin-sched-row-meta">
                      {r.is_admin ? 'Every permission' : (r.permissions.length ? r.permissions.map(p => PERMISSION_LABEL[p] || p).join(' · ') : 'No permissions yet')}
                    </div>
                  </div>
                  <div className="admin-amen-row-actions">
                    {!r.is_admin && <button className="admin-sched-row-del" onClick={() => startEdit(r)}>Edit</button>}
                    {!r.is_admin && <button className="admin-sched-row-del" onClick={() => deleteRole(r)}>Delete</button>}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Assign */}
          <section className="admin-sched-card">
            <div className="admin-sched-card-head"><h2>Board members</h2><span className="admin-sched-card-sub">Assign a role to each.</span></div>
            {members.length === 0 ? (
              <div className="admin-sched-empty">No board members yet. Set a board position on a resident in Easy Track.</div>
            ) : (
              <div className="admin-sched-list">
                {members.map(m => (
                  <div key={m.id} className="admin-sched-row">
                    <div className="admin-sched-row-body">
                      <div className="admin-sched-row-title">{m.full_name || 'Resident'}</div>
                      <div className="admin-sched-row-meta">{m.board_position} · {roleName(m.role_id)}</div>
                    </div>
                    <div style={{ minWidth: 200 }}>
                      <Dropdown<string>
                        value={m.role_id || ''}
                        onChange={v => assignRole(m.id, v || null)}
                        ariaLabel={`Role for ${m.full_name || 'resident'}`}
                        options={[{ value: '', label: 'No role' }, ...roles.map(r => ({ value: r.id, label: r.name }))]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
