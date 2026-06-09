'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSION_GROUPS, PERMISSION_LABEL } from '@/lib/permissions'
import { Dropdown } from '@/components/Dropdown'
import { EasyVoiceTabs } from '../EasyVoiceTabs'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const STATUSES = [
  { value: 'approved',   label: 'Approved' },
  { value: 'pending',    label: 'Pending' },
  { value: 'paid',       label: 'Paid' },
  { value: 'discussion', label: 'Discussion' },
]
const statusLabel = (s) => (STATUSES.find(x => x.value === s) || STATUSES[3]).label
const fmtMoney = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US')
const fmtDate = (d) => {
  if (!d) return ''
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US',
    { month: 'short', day: 'numeric', year: 'numeric' })
}
const subline = (r) => [r.subdivision, r.address].filter(Boolean).join(' · ')

// Standard HOA board positions, in seniority order.
const POSITIONS = ['President', 'Vice President', 'Secretary', 'Treasurer', 'Member at Large']
const posRank = (p) => { const i = POSITIONS.indexOf(p); return i === -1 ? 99 : i }

const EMPTY = { title: '', vendor: '', amount: '', status: 'approved', decided_on: '' }

// Board page — board members (drawn from the resident roster) + the decisions
// feed that surfaces on every resident's Home.
export default function Board() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const { can } = usePermissions()
  const canRoles = can('roles.manage')
  const [rows, setRows] = useState([])          // board_decisions
  const [residents, setResidents] = useState([]) // roster (for the member picker)
  const [roles, setRoles] = useState([])         // ev_roles (custom roles)
  const [status, setStatus] = useState('loading') // loading | ready | none | error
  const [error, setError] = useState('')
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [memberQuery, setMemberQuery] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const [committees, setCommittees] = useState([])
  const [comForm, setComForm] = useState({ name: '', chair: '', member_count: '', icon: 'home' })
  const [comSaving, setComSaving] = useState(false)
  // Role builder (merged in from the old Roles page).
  const [roleEditId, setRoleEditId] = useState(null)
  const [roleName, setRoleName] = useState('')
  const [rolePerms, setRolePerms] = useState(new Set())
  const [roleMax, setRoleMax] = useState('1')   // '' / 0 = no limit
  const [roleSaving, setRoleSaving] = useState(false)
  const [savedRoleFor, setSavedRoleFor] = useState(null) // member row that just saved a role

  // Auto-dismiss the green confirmation banner after 4 seconds.
  useEffect(() => {
    if (!successMsg) return
    const id = setTimeout(() => setSuccessMsg(''), 4000)
    return () => clearTimeout(id)
  }, [successMsg])

  const load = useCallback(async () => {
    if (!hasSupabase || !communityId) { setStatus('none'); return }
    setStatus('loading'); setError('')
    try {
      const [decR, resR, comR, roleR] = await Promise.all([
        withTimeout(supabase.from('board_decisions').select('*')
          .eq('community_id', communityId).order('decided_on', { ascending: false })),
        withTimeout(supabase.from('residents').select('*').eq('community_id', communityId)),
        withTimeout(supabase.from('committees').select('*')
          .eq('community_id', communityId).order('sort_order', { ascending: true })),
        withTimeout(supabase.from('ev_roles').select('*')
          .eq('community_id', communityId).order('is_admin', { ascending: false }).order('name')),
      ])
      if (decR.error) throw decR.error
      if (resR.error) throw resR.error
      // committees / ev_roles tables may not be migrated yet — don't fail the page.
      setRows(decR.data || [])
      setResidents(resR.data || [])
      setCommittees(comR.error ? [] : (comR.data || []))
      setRoles(roleR.error ? [] : (roleR.data || []))
      setStatus('ready')
    } catch (err) {
      setError(err?.message || 'Could not load the board'); setStatus('error')
    }
  }, [communityId])
  useEffect(() => { load() }, [load])

  // On the board if flagged is_board OR carrying a board_position (the old Roles
  // page only set the latter) — so the merge never hides anyone.
  const onBoard = (r) => r.is_board || !!r.board_position
  const boardMembers = useMemo(
    () => residents.filter(onBoard).sort((a, b) => {
      const p = posRank(a.board_position) - posRank(b.board_position)
      return p !== 0 ? p : String(a.full_name || '').localeCompare(String(b.full_name || ''))
    }),
    [residents]
  )
  // Typeahead — narrows the roster to non-board residents matching the query.
  const matches = useMemo(() => {
    const q = memberQuery.trim().toLowerCase()
    if (!q) return []
    return residents
      .filter(r => !onBoard(r) && String(r.full_name || '').toLowerCase().includes(q))
      .slice(0, 6)
  }, [residents, memberQuery])

  const setBoard = async (id, value) => {
    const prev = residents
    // Removing clears both signals (is_board + the legacy board_position) so the
    // member fully leaves the merged list; adding just sets the flag.
    const patch = value ? { is_board: true } : { is_board: false, board_position: null }
    setResidents(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)))
    setMemberQuery('')
    try {
      const { error } = await withTimeout(
        supabase.from('residents').update(patch).eq('id', id)
      )
      if (error) throw error
      setSuccessMsg(value ? 'Added to the board.' : 'Removed from the board.')
    } catch (err) {
      setResidents(prev) // roll back
      setError(err?.message || 'Could not update board membership')
    }
  }

  const setPosition = async (id, board_position) => {
    const prev = residents
    setResidents(rs => rs.map(r => (r.id === id ? { ...r, board_position } : r)))
    try {
      const { error } = await withTimeout(
        supabase.from('residents').update({ board_position }).eq('id', id)
      )
      if (error) throw error
      setSuccessMsg(board_position ? `Set position to ${board_position}.` : 'Cleared position.')
    } catch (err) {
      setResidents(prev) // roll back
      setError(err?.message || 'Could not update the position')
    }
  }

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const add = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Give the decision a title'); return }
    setSaving(true); setError('')
    try {
      const row = {
        community_id: communityId,
        title: form.title.trim(),
        vendor: form.vendor.trim() || null,
        amount: form.amount === '' ? null : Number(form.amount),
        status: form.status,
        decided_on: form.decided_on || new Date().toISOString().slice(0, 10),
      }
      const { data, error } = await withTimeout(
        supabase.from('board_decisions').insert(row).select().single()
      )
      if (error) throw error
      setRows(rs => [data, ...rs])
      setForm(EMPTY)
      setSuccessMsg(`Logged "${row.title}".`)
    } catch (err) {
      setError(err?.message || 'Could not add the decision')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    const prev = rows
    setRows(rs => rs.filter(r => r.id !== id)) // optimistic
    try {
      const { error } = await withTimeout(
        supabase.from('board_decisions').delete().eq('id', id)
      )
      if (error) throw error
    } catch (err) {
      setRows(prev) // roll back
      setError(err?.message || 'Could not remove that decision')
    }
  }

  const addCommittee = async (e) => {
    e.preventDefault()
    if (!comForm.name.trim()) { setError('Give the committee a name'); return }
    setComSaving(true); setError('')
    try {
      const row = {
        community_id: communityId,
        name: comForm.name.trim(),
        chair: comForm.chair.trim() || null,
        member_count: comForm.member_count === '' ? 0 : Number(comForm.member_count),
        icon: comForm.icon,
        sort_order: committees.length,
      }
      const { data, error } = await withTimeout(
        supabase.from('committees').insert(row).select().single()
      )
      if (error) throw error
      setCommittees(cs => [...cs, data])
      setComForm({ name: '', chair: '', member_count: '', icon: 'home' })
      setSuccessMsg(`Added the ${row.name}.`)
    } catch (err) {
      setError(err?.message || 'Could not add the committee')
    } finally {
      setComSaving(false)
    }
  }

  const removeCommittee = async (id) => {
    const prev = committees
    setCommittees(cs => cs.filter(c => c.id !== id)) // optimistic
    try {
      const { error } = await withTimeout(supabase.from('committees').delete().eq('id', id))
      if (error) throw error
    } catch (err) {
      setCommittees(prev) // roll back
      setError(err?.message || 'Could not remove that committee')
    }
  }

  // ----- Roles (merged from the old Roles page) -----
  // A role's capacity: explicit max_holders, else derived from the old flag.
  const capOf = (r) => r.max_holders == null ? (r.allow_multiple ? 0 : 1) : r.max_holders
  const roleLabel = (id) => roles.find(x => x.id === id)?.name || '—'
  // How many other board members already hold a role (excluding this member).
  const heldBy = (roleId, exceptId) =>
    boardMembers.filter(o => o.id !== exceptId && o.role_id === roleId).length
  // Roles a member may pick: admin/system always; otherwise capacity not full.
  const rolesForMember = (memberId, currentRoleId) =>
    roles.filter(r => {
      if (r.is_admin || r.is_system || r.id === currentRoleId) return true
      const cap = capOf(r)
      return cap === 0 || heldBy(r.id, memberId) < cap
    })

  const startNewRole = () => { setRoleEditId(null); setRoleName(''); setRolePerms(new Set()); setRoleMax('1') }
  const startEditRole = (r) => {
    setRoleEditId(r.id); setRoleName(r.name); setRolePerms(new Set(r.permissions || []))
    const cap = capOf(r); setRoleMax(cap === 0 ? '' : String(cap))
  }
  const togglePerm = (k) => setRolePerms(prev => {
    const next = new Set(prev); next.has(k) ? next.delete(k) : next.add(k); return next
  })

  const saveRole = async () => {
    if (!roleName.trim()) { setError('Name the role.'); return }
    const cap = Math.max(0, parseInt(roleMax, 10) || 0)
    const multi = cap !== 1
    setRoleSaving(true); setError('')
    try {
      let { error } = await withTimeout(supabase.rpc('ev_role_save', {
        p_id: roleEditId, p_name: roleName.trim(), p_perms: Array.from(rolePerms), p_multi: multi, p_max_holders: cap,
      }))
      if (error && /function|schema cache|p_max_holders/i.test(error.message || '')) {
        ;({ error } = await withTimeout(supabase.rpc('ev_role_save', {
          p_id: roleEditId, p_name: roleName.trim(), p_perms: Array.from(rolePerms), p_multi: multi,
        })))
      }
      if (error && /function|schema cache|p_multi/i.test(error.message || '')) {
        ;({ error } = await withTimeout(supabase.rpc('ev_role_save', {
          p_id: roleEditId, p_name: roleName.trim(), p_perms: Array.from(rolePerms),
        })))
      }
      if (error) throw error
      setSuccessMsg(roleEditId ? 'Role updated.' : 'Role created.')
      startNewRole(); load()
    } catch (err) { setError(err?.message || 'Could not save the role.') }
    finally { setRoleSaving(false) }
  }

  const deleteRole = async (r) => {
    if (!window.confirm(`Delete the "${r.name}" role? Members holding it will lose its access.`)) return
    setError('')
    try {
      const { error } = await withTimeout(supabase.rpc('ev_role_delete', { p_id: r.id }))
      if (error) throw error
      if (roleEditId === r.id) startNewRole()
      setSuccessMsg(`Removed "${r.name}".`); load()
    } catch (err) { setError(err?.message || 'Could not delete the role.') }
  }

  const assignRole = async (residentId, roleId) => {
    setError('')
    setResidents(rs => rs.map(m => m.id === residentId ? { ...m, role_id: roleId } : m)) // optimistic
    try {
      const { error } = await withTimeout(supabase.rpc('ev_role_assign', { p_resident: residentId, p_role: roleId }))
      if (error) throw error
      setSavedRoleFor(residentId)
      setTimeout(() => setSavedRoleFor(s => (s === residentId ? null : s)), 2500)
    } catch (err) { setError(err?.message || 'Could not assign the role.'); load() }
  }

  const editingRole = useMemo(() => roles.find(r => r.id === roleEditId) || null, [roles, roleEditId])
  const editingProtected = !!editingRole?.is_admin

  return (
    <div className="admin-page cset">
      <EasyVoiceTabs active="board" />
      <div className="admin-kicker">Easy Voice</div>
      <h1 className="admin-h1">Board <span className="amp">&</span> roles</h1>
      <p className="admin-dek">
        Who sits on the board, the role each one holds, committees, and the
        decisions they make — every decision shows on each resident's Home
        under &ldquo;This Week on the Board.&rdquo;
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          No community is linked to your account yet. Run the one-time setup SQL, then reload.
        </div>
      )}

      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>Retry</button>
        </div>
      )}

      {successMsg && (
        <div className="admin-success" role="status">
          <span className="admin-success-check" aria-hidden="true">✓</span>
          {successMsg}
        </div>
      )}

      {(status === 'ready' || status === 'loading') && (
        <>
          <div className="card">
            <div className="card-head">
              <div>
                <h2>Board members</h2>
                <div className="sub">Add anyone from your resident roster — start typing their name.{canRoles ? ' Set each one’s position and role.' : ''}</div>
              </div>
            </div>

            <div className="bm-search">
              <input name="member-search" className="admin-input" placeholder="Type a resident's name…"
                value={memberQuery} onChange={e => setMemberQuery(e.target.value)} />
              {memberQuery.trim() && (
                <div className="bm-dropdown">
                  {matches.length === 0 ? (
                    <div className="bm-empty">
                      No roster match — add them on the Residents page first.
                    </div>
                  ) : matches.map(m => (
                    <button type="button" key={m.id} className="bm-option"
                      onClick={() => setBoard(m.id, true)}>
                      <span className="bm-option-name">{m.full_name}</span>
                      {subline(m) && <span className="bm-option-sub">{subline(m)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {boardMembers.length === 0 ? (
              <div className="bc-empty">No board members yet — search above to add one.</div>
            ) : (
              <div className="bm-list">
                {boardMembers.map(m => (
                  <div className="bm-row" key={m.id}>
                    <div className="bm-row-main">
                      <div className="bm-row-name">{m.full_name}</div>
                      <div className="bm-row-sub">
                        {subline(m) || '—'}
                        {canRoles && m.role_id && <> · <span style={{ color: 'var(--pink)' }}>{roleLabel(m.role_id)}</span></>}
                      </div>
                    </div>
                    {canRoles && savedRoleFor === m.id && (
                      <span style={{ color: '#067647', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>Saved ✓</span>
                    )}
                    <div style={{ width: 160, flexShrink: 0 }}>
                      <Dropdown<string>
                        value={m.board_position || ''}
                        onChange={v => setPosition(m.id, v || null)}
                        ariaLabel={`Position for ${m.full_name}`}
                        options={[
                          { value: '', label: 'No position' },
                          ...POSITIONS.map(p => ({ value: p, label: p })),
                        ]}
                      />
                    </div>
                    {canRoles && (
                      <div style={{ width: 170, flexShrink: 0 }}>
                        <Dropdown<string>
                          value={m.role_id || ''}
                          onChange={v => assignRole(m.id, v || null)}
                          ariaLabel={`Role for ${m.full_name}`}
                          options={[{ value: '', label: 'No role' }, ...rolesForMember(m.id, m.role_id).map(r => ({ value: r.id, label: r.name }))]}
                        />
                      </div>
                    )}
                    <button type="button" className="bc-del" onClick={() => setBoard(m.id, false)}
                      aria-label="Remove from board">&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canRoles && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>{roleEditId ? (editingProtected ? `Viewing “${roleName}”` : `Edit “${roleName}”`) : 'Roles & permissions'}</h2>
                  <div className="sub">
                    {editingProtected
                      ? 'The Admin role has full access and can’t be edited.'
                      : 'Build a role, set how many board members can hold it, then assign it above.'}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <label className="admin-field" style={{ flex: '1 1 240px', maxWidth: 320 }}>
                  <span className="admin-field-label">Role name</span>
                  <input className="admin-input" value={roleName} disabled={editingProtected}
                    placeholder="e.g. Secretary" onChange={e => setRoleName(e.target.value)} />
                </label>
                <label className="admin-field" style={{ width: 190 }}>
                  <span className="admin-field-label">How many can hold it?</span>
                  <input className="admin-input" type="number" min={0} step={1} value={roleMax}
                    disabled={editingProtected} placeholder="1" onChange={e => setRoleMax(e.target.value)} />
                  <span style={{ fontSize: 12, opacity: 0.6, marginTop: 4, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                    e.g. 2 secretaries, 5 board members. Use 0 for no limit.
                  </span>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, margin: '16px 0' }}>
                {PERMISSION_GROUPS.map(g => (
                  <div key={g.label}>
                    <div style={{ fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.6, fontWeight: 600, marginBottom: 8 }}>{g.label}</div>
                    {g.perms.map(p => (
                      <label key={p.key} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, padding: '4px 0', opacity: editingProtected ? 0.5 : 1 }}>
                        <input type="checkbox" checked={editingProtected || rolePerms.has(p.key)} disabled={editingProtected}
                          onChange={() => togglePerm(p.key)} />
                        {p.label}
                      </label>
                    ))}
                  </div>
                ))}
              </div>

              {!editingProtected && (
                <div className="card-cta" style={{ display: 'flex', gap: 10 }}>
                  {roleEditId && <button className="admin-btn-ghost" type="button" onClick={startNewRole}>Cancel</button>}
                  <button className="admin-primary-btn" disabled={roleSaving} onClick={saveRole}>
                    {roleSaving ? 'Saving…' : roleEditId ? 'Save changes' : 'Create role'}
                  </button>
                </div>
              )}
              {editingProtected && <button className="admin-btn-ghost" type="button" onClick={startNewRole}>Back to new role</button>}

              {roles.length > 0 && (
                <div className="bm-list" style={{ marginTop: 18 }}>
                  {roles.map(r => (
                    <div className="bm-row" key={r.id}>
                      <div className="bm-row-main">
                        <div className="bm-row-name">
                          {r.name}
                          {r.is_admin && <span className="amen-pay-tag paid" style={{ marginLeft: 8 }}>Full access</span>}
                          {r.is_system && !r.is_admin && <span className="amen-pay-tag pending" style={{ marginLeft: 8 }}>Default</span>}
                          {!r.is_admin && (() => { const cap = capOf(r); const held = residents.filter(m => m.role_id === r.id).length; return (
                            <span className="amen-pay-tag" style={{ marginLeft: 8, opacity: 0.85 }}>
                              {cap === 0 ? `${held} held · no limit` : `${held}/${cap} held`}
                            </span>
                          ) })()}
                        </div>
                        <div className="bm-row-sub">
                          {r.is_admin ? 'Every permission' : (r.permissions?.length ? r.permissions.map(p => PERMISSION_LABEL[p] || p).join(' · ') : 'No permissions yet')}
                        </div>
                      </div>
                      {!r.is_admin && (
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button type="button" className="admin-sched-row-del" onClick={() => startEditRole(r)}>Edit</button>
                          <button type="button" className="admin-sched-row-del" onClick={() => deleteRole(r)}>Delete</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Committees</h2>
                <div className="sub">Show your committees on every resident's Board page.</div>
              </div>
            </div>

            <form className="admin-form" onSubmit={addCommittee}>
              <label className="admin-field">
                <span className="admin-field-label">Committee name</span>
                <input name="com-name" className="admin-input" placeholder="Finance Committee"
                  value={comForm.name} onChange={e => setComForm(f => ({ ...f, name: e.target.value }))} />
              </label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <label className="admin-field" style={{ flex: '1 1 180px' }}>
                  <span className="admin-field-label">Chair (optional)</span>
                  <input name="com-chair" className="admin-input" placeholder="Michael Chen"
                    value={comForm.chair} onChange={e => setComForm(f => ({ ...f, chair: e.target.value }))} />
                </label>
                <label className="admin-field" style={{ width: 130 }}>
                  <span className="admin-field-label"># members</span>
                  <input name="com-count" type="number" className="admin-input" placeholder="4"
                    value={comForm.member_count} onChange={e => setComForm(f => ({ ...f, member_count: e.target.value }))} />
                </label>
                <div className="admin-field" style={{ width: 160 }}>
                  <span className="admin-field-label">Icon</span>
                  <Dropdown<string>
                    value={comForm.icon}
                    onChange={v => setComForm(f => ({ ...f, icon: v }))}
                    ariaLabel="Committee icon"
                    options={[
                      { value: 'finance', label: 'Finance' },
                      { value: 'leaf', label: 'Landscape' },
                      { value: 'home', label: 'Architectural' },
                      { value: 'shield', label: 'Security' },
                      { value: 'megaphone', label: 'Communications' },
                    ]}
                  />
                </div>
              </div>
              <div className="card-cta">
                <button type="submit" className="admin-primary-btn" disabled={comSaving}>
                  {comSaving ? 'Adding…' : 'Add committee'}
                </button>
              </div>
            </form>

            {committees.length > 0 && (
              <div className="bm-list">
                {committees.map(c => (
                  <div className="bm-row" key={c.id}>
                    <div className="bm-row-main">
                      <div className="bm-row-name">{c.name}</div>
                      <div className="bm-row-sub">
                        {c.chair ? `${c.chair} · ` : ''}{c.member_count || 0} {Number(c.member_count) === 1 ? 'member' : 'members'}
                      </div>
                    </div>
                    <button type="button" className="bc-del" onClick={() => removeCommittee(c.id)}
                      aria-label={`Remove ${c.name}`}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Log a decision</h2>
                <div className="sub">Approvals, payments and motions.</div>
              </div>
            </div>

            <form className="admin-form" onSubmit={add}>
              <label className="admin-field">
                <span className="admin-field-label">What was decided</span>
                <input name="title" className="admin-input" placeholder="Approved landscaping contract"
                  value={form.title} onChange={e => setField('title', e.target.value)} />
              </label>
              <label className="admin-field">
                <span className="admin-field-label">Vendor / who (optional)</span>
                <input name="vendor" className="admin-input" placeholder="Oak Ridge Nursery"
                  value={form.vendor} onChange={e => setField('vendor', e.target.value)} />
              </label>
              <div className="bd-form-row">
                <label className="admin-field">
                  <span className="admin-field-label">Amount $ (optional)</span>
                  <input name="amount" className="admin-input" type="number" placeholder="5200"
                    value={form.amount} onChange={e => setField('amount', e.target.value)} />
                </label>
                <div className="admin-field">
                  <span className="admin-field-label">Status</span>
                  <Dropdown<string>
                    value={form.status}
                    onChange={v => setField('status', v)}
                    ariaLabel="Decision status"
                    options={STATUSES}
                  />
                </div>
                <label className="admin-field">
                  <span className="admin-field-label">Date</span>
                  <input name="decided_on" className="admin-input" type="date"
                    value={form.decided_on} onChange={e => setField('decided_on', e.target.value)} />
                </label>
              </div>
              <div className="card-cta">
                <button type="submit" className="admin-primary-btn" disabled={saving}>
                  {saving ? 'Adding…' : 'Add decision'}
                </button>
                {error && <span className="admin-err-inline">{error}</span>}
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>Decision feed</h2>
                <div className="sub">Most recent first — the newest five appear on Home.</div>
              </div>
            </div>

            <div className="bd-list">
              {status === 'loading' && <div className="admin-note">Loading…</div>}
              {status === 'ready' && rows.length === 0 && (
                <div className="bc-empty">No decisions logged yet — add the first one above.</div>
              )}
              {rows.map(r => (
                <div className="bd-row" key={r.id}>
                  <div className="bd-main">
                    <div className="bd-title">{r.title}</div>
                    <div className="bd-meta">
                      {r.vendor && <><span>{r.vendor}</span><span className="bd-dot">·</span></>}
                      <span>{fmtDate(r.decided_on)}</span>
                    </div>
                  </div>
                  {r.amount != null && <div className="bd-amount">{fmtMoney(r.amount)}</div>}
                  <span className={`bd-status bd-${r.status}`}>{statusLabel(r.status)}</span>
                  <button type="button" className="bc-del" onClick={() => remove(r.id)}
                    aria-label="Remove decision">&times;</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
