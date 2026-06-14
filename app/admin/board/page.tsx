'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'
import { usePermissions } from '@/hooks/usePermissions'
import { PERMISSION_GROUPS, PERMISSION_LABEL, ALL_PERMISSIONS } from '@/lib/permissions'
import { Dropdown } from '@/components/Dropdown'
import { EasyVoiceTabs } from '../EasyVoiceTabs'
import { useT } from '@/lib/i18n'

const withTimeout = (p, ms = 10000) =>
  Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

const STATUSES = [
  { value: 'approved',   label: 'approved' },
  { value: 'pending',    label: 'pending' },
  { value: 'paid',       label: 'paid' },
  { value: 'discussion', label: 'discussion' },
]
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
  const t = useT()
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
  const [comForm, setComForm] = useState({ name: '', chair: '', icon: 'home', member_ids: [] })
  const [comEditId, setComEditId] = useState(null)
  const [comOpen, setComOpen] = useState(false)   // committee add/edit popup
  const [comQuery, setComQuery] = useState('')
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

  const statusLabel = (s) => {
    const key = (STATUSES.find(x => x.value === s) || STATUSES[3]).label
    const map = {
      approved:   t('admin.board.statusApproved'),
      pending:    t('admin.board.statusPending'),
      paid:       t('admin.board.statusPaid'),
      discussion: t('admin.board.statusDiscussion'),
    }
    return map[key] ?? key
  }

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
      setError(err?.message || t('admin.board.errLoadBoard')); setStatus('error')
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
      setSuccessMsg(value ? t('admin.board.addedToBoard') : t('admin.board.removedFromBoard'))
    } catch (err) {
      setResidents(prev) // roll back
      setError(err?.message || t('admin.board.errUpdateMembership'))
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
      setSuccessMsg(board_position ? t('admin.board.setPositionTo', { position: board_position }) : t('admin.board.clearedPosition'))
    } catch (err) {
      setResidents(prev) // roll back
      setError(err?.message || t('admin.board.errUpdatePosition'))
    }
  }

  const setField = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const add = async (e) => {
    e.preventDefault()
    if (!form.title.trim()) { setError(t('admin.board.errDecisionTitle')); return }
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
      setSuccessMsg(t('admin.board.loggedDecision', { title: row.title }))
    } catch (err) {
      setError(err?.message || t('admin.board.errAddDecision'))
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
      setError(err?.message || t('admin.board.errRemoveDecision'))
    }
  }

  // Members picked for the committee being built/edited, resolved to roster rows.
  const comSelected = useMemo(
    () => comForm.member_ids.map(id => residents.find(r => r.id === id)).filter(Boolean),
    [comForm.member_ids, residents]
  )
  // Roster typeahead for adding members — non-selected residents matching the query.
  const comMatches = useMemo(() => {
    const q = comQuery.trim().toLowerCase()
    if (!q) return []
    return residents
      .filter(r => !comForm.member_ids.includes(r.id) && String(r.full_name || '').toLowerCase().includes(q))
      .slice(0, 6)
  }, [residents, comQuery, comForm.member_ids])

  const addComMember = (id) => { setComForm(f => ({ ...f, member_ids: [...f.member_ids, id] })); setComQuery('') }
  const removeComMember = (id) => setComForm(f => {
    const name = residents.find(r => r.id === id)?.full_name
    return { ...f, member_ids: f.member_ids.filter(x => x !== id), chair: f.chair === name ? '' : f.chair }
  })

  const resetCommittee = () => { setComForm({ name: '', chair: '', icon: 'home', member_ids: [] }); setComEditId(null); setComQuery('') }
  const closeCommittee = () => { setComOpen(false); resetCommittee() }
  const openAddCommittee = () => { resetCommittee(); setError(''); setComOpen(true) }
  const startEditCommittee = (c) => {
    setComEditId(c.id)
    setComForm({ name: c.name || '', chair: c.chair || '', icon: c.icon || 'home', member_ids: c.member_ids || [] })
    setComQuery(''); setError(''); setComOpen(true)
  }

  const saveCommittee = async (e) => {
    e.preventDefault()
    if (!comForm.name.trim()) { setError(t('admin.board.errCommitteeName')); return }
    setComSaving(true); setError('')
    try {
      const payload = {
        community_id: communityId,
        name: comForm.name.trim(),
        chair: comForm.chair.trim() || null,
        member_ids: comForm.member_ids,
        member_count: comForm.member_ids.length,
        icon: comForm.icon,
      }
      // Run the write, retrying without member_ids if that column isn't migrated yet.
      const attempt = (body) => comEditId
        ? supabase.from('committees').update(body).eq('id', comEditId).select().single()
        : supabase.from('committees').insert({ ...body, sort_order: committees.length }).select().single()
      let res = await withTimeout(attempt(payload))
      if (res.error && /member_ids|column|schema cache/i.test(res.error.message || '')) {
        const { member_ids, ...rest } = payload
        res = await withTimeout(attempt(rest))
      }
      if (res.error) throw res.error
      const data = res.data
      if (comEditId) {
        setCommittees(cs => cs.map(c => (c.id === comEditId ? data : c)))
        setSuccessMsg(t('admin.board.updatedCommittee', { name: payload.name }))
      } else {
        setCommittees(cs => [...cs, data])
        setSuccessMsg(t('admin.board.addedCommittee', { name: payload.name }))
      }
      closeCommittee()
    } catch (err) {
      setError(err?.message || t('admin.board.errSaveCommittee'))
    } finally {
      setComSaving(false)
    }
  }

  const removeCommittee = async (id) => {
    const prev = committees
    if (comEditId === id) resetCommittee()
    setCommittees(cs => cs.filter(c => c.id !== id)) // optimistic
    try {
      const { error } = await withTimeout(supabase.from('committees').delete().eq('id', id))
      if (error) throw error
    } catch (err) {
      setCommittees(prev) // roll back
      setError(err?.message || t('admin.board.errRemoveCommittee'))
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
  const allPermsSelected = rolePerms.size >= ALL_PERMISSIONS.length
  const toggleAllPerms = () => setRolePerms(allPermsSelected ? new Set() : new Set(ALL_PERMISSIONS))

  const saveRole = async () => {
    if (!roleName.trim()) { setError(t('admin.board.errSaveRole')); return }
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
      setSuccessMsg(roleEditId ? t('admin.board.roleUpdated') : t('admin.board.roleCreated'))
      startNewRole(); load()
    } catch (err) { setError(err?.message || t('admin.board.errSaveRole')) }
    finally { setRoleSaving(false) }
  }

  const deleteRole = async (r) => {
    if (!window.confirm(t('admin.board.deleteRoleConfirm', { name: r.name }))) return
    setError('')
    try {
      const { error } = await withTimeout(supabase.rpc('ev_role_delete', { p_id: r.id }))
      if (error) throw error
      if (roleEditId === r.id) startNewRole()
      setSuccessMsg(t('admin.board.removedRole', { name: r.name })); load()
    } catch (err) { setError(err?.message || t('admin.board.errDeleteRole')) }
  }

  const assignRole = async (residentId, roleId) => {
    setError('')
    setResidents(rs => rs.map(m => m.id === residentId ? { ...m, role_id: roleId } : m)) // optimistic
    try {
      const { error } = await withTimeout(supabase.rpc('ev_role_assign', { p_resident: residentId, p_role: roleId }))
      if (error) throw error
      setSavedRoleFor(residentId)
      setTimeout(() => setSavedRoleFor(s => (s === residentId ? null : s)), 2500)
    } catch (err) { setError(err?.message || t('admin.board.errAssignRole')); load() }
  }

  const editingRole = useMemo(() => roles.find(r => r.id === roleEditId) || null, [roles, roleEditId])
  const editingProtected = !!editingRole?.is_admin

  // Committee add/edit form — rendered inside the expanded committee row (and the
  // "new committee" row), so the editing UI matches the Rules detail layout.
  const comEditor = (
    <form className="admin-form" onSubmit={saveCommittee} style={{ maxWidth: 'none' }}>
      <label className="admin-field">
        <span className="admin-field-label">{t('admin.board.committeeName')}</span>
        <input name="com-name" className="admin-input" placeholder={t('admin.board.committeeNamePlaceholder')}
          value={comForm.name} onChange={e => setComForm(f => ({ ...f, name: e.target.value }))} />
      </label>

      <div className="admin-field">
        <span className="admin-field-label">{t('admin.board.membersLabel')}</span>
        <div className="bm-search" style={{ maxWidth: 'none', marginBottom: 0 }}>
          <input name="com-member-search" className="admin-input" placeholder={t('admin.board.comMemberSearchPlaceholder')}
            value={comQuery} onChange={e => setComQuery(e.target.value)} />
          {comQuery.trim() && (
            <div className="bm-dropdown">
              {comMatches.length === 0 ? (
                <div className="bm-empty">{t('admin.board.noRosterMatchCom')}</div>
              ) : comMatches.map(m => (
                <button type="button" key={m.id} className="bm-option" onClick={() => addComMember(m.id)}>
                  <span className="bm-option-name">{m.full_name}</span>
                  {subline(m) && <span className="bm-option-sub">{subline(m)}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
        {comSelected.length > 0 && (
          <div className="cmem-chips">
            {comSelected.map(m => (
              <span className="cmem-chip" key={m.id}>
                {m.full_name}
                <button type="button" onClick={() => removeComMember(m.id)} aria-label={t('admin.board.removeMember', { name: m.full_name })}>&times;</button>
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="admin-field" style={{ flex: '1 1 200px' }}>
          <span className="admin-field-label">{t('admin.board.chairOptional')}</span>
          <Dropdown<string>
            value={comForm.chair}
            onChange={v => setComForm(f => ({ ...f, chair: v }))}
            ariaLabel={t('admin.board.committeeAriaLabel')}
            options={[
              { value: '', label: comSelected.length ? t('admin.board.noChair') : t('admin.board.addMembersToPickChair') },
              ...comSelected.map(m => ({ value: m.full_name, label: m.full_name })),
              ...(comForm.chair && !comSelected.some(m => m.full_name === comForm.chair)
                ? [{ value: comForm.chair, label: comForm.chair }] : []),
            ]}
          />
        </div>
        <div className="admin-field" style={{ width: 170 }}>
          <span className="admin-field-label">{t('admin.board.iconLabel')}</span>
          <Dropdown<string>
            value={comForm.icon}
            onChange={v => setComForm(f => ({ ...f, icon: v }))}
            ariaLabel={t('admin.board.committeeIconAriaLabel')}
            options={[
              { value: 'finance', label: t('admin.board.iconFinance') },
              { value: 'leaf', label: t('admin.board.iconLandscape') },
              { value: 'home', label: t('admin.board.iconArchitectural') },
              { value: 'shield', label: t('admin.board.iconSecurity') },
              { value: 'megaphone', label: t('admin.board.iconCommunications') },
            ]}
          />
        </div>
      </div>
      <div className="card-cta" style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="admin-btn-ghost" onClick={closeCommittee}>{t('admin.board.cancel')}</button>
        <button type="submit" className="admin-primary-btn" disabled={comSaving}>
          {comSaving ? t('admin.board.saving') : comEditId ? t('admin.board.saveChanges') : t('admin.board.addCommittee')}
        </button>
        {error && <span className="admin-err-inline">{error}</span>}
      </div>
    </form>
  )

  return (
    <div className="admin-page cset">
      <EasyVoiceTabs active="board" />
      <div className="admin-kicker">{t('admin.board.kicker')}</div>
      <h1 className="admin-h1">{t('admin.board.heading')}</h1>
      <p className="admin-dek">
        {t('admin.board.dek')}
      </p>

      {status === 'none' && (
        <div className="admin-note admin-note-warn">
          {t('admin.board.noCommLinked')}
        </div>
      )}

      {status === 'error' && (
        <div className="admin-note admin-note-err">
          {error}
          <button type="button" className="admin-btn-ghost" onClick={load}>{t('admin.board.retry')}</button>
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
                <h2>{t('admin.board.boardMembersTitle')}</h2>
                <div className="sub">{canRoles ? t('admin.board.boardMembersSubRoles') : t('admin.board.boardMembersSub')}</div>
              </div>
            </div>

            <div className="bm-search">
              <input name="member-search" className="admin-input" placeholder={t('admin.board.memberSearchPlaceholder')}
                value={memberQuery} onChange={e => setMemberQuery(e.target.value)} />
              {memberQuery.trim() && (
                <div className="bm-dropdown">
                  {matches.length === 0 ? (
                    <div className="bm-empty">
                      {t('admin.board.noRosterMatch')}
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
              <div className="bc-empty">{t('admin.board.noBoardMembers')}</div>
            ) : (
              <div className="bm-list">
                {boardMembers.map(m => (
                  <div className="bm-row" key={m.id}>
                    <div className="bm-row-main">
                      <div className="bm-row-name">{m.full_name}</div>
                      {m.board_position && (
                        <div className="bm-row-sub">
                          <span style={{ color: 'var(--pink)', fontWeight: 600 }}>{m.board_position}</span>
                        </div>
                      )}
                    </div>
                    {canRoles && savedRoleFor === m.id && (
                      <span className="bm-saved" style={{ color: '#067647', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap' }}>{t('admin.board.saved')}</span>
                    )}
                    <div className="bm-row-ctrl bm-row-pos" style={{ width: 160, flexShrink: 0 }}>
                      <Dropdown<string>
                        value={m.board_position || ''}
                        onChange={v => setPosition(m.id, v || null)}
                        ariaLabel={t('admin.board.positionFor', { name: m.full_name })}
                        options={[
                          { value: '', label: t('admin.board.noPosition') },
                          ...POSITIONS.map(p => ({ value: p, label: p })),
                        ]}
                      />
                    </div>
                    {canRoles && (
                      <div className="bm-row-ctrl bm-row-role" style={{ width: 170, flexShrink: 0 }}>
                        <Dropdown<string>
                          value={m.role_id || ''}
                          onChange={v => assignRole(m.id, v || null)}
                          ariaLabel={t('admin.board.roleFor', { name: m.full_name })}
                          options={[{ value: '', label: t('admin.board.noRole') }, ...rolesForMember(m.id, m.role_id).map(r => ({ value: r.id, label: r.name }))]}
                        />
                      </div>
                    )}
                    <button type="button" className="bc-del" onClick={() => setBoard(m.id, false)}
                      aria-label={t('admin.board.removeFromBoard')}>&times;</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canRoles && (
            <div className="card">
              <div className="card-head">
                <div>
                  <h2>{roleEditId ? (editingProtected ? t('admin.board.viewingRole', { name: roleName }) : t('admin.board.editingRole', { name: roleName })) : t('admin.board.rolesPermissionsTitle')}</h2>
                  <div className="sub">
                    {editingProtected
                      ? t('admin.board.adminRoleSub')
                      : t('admin.board.buildRoleSub')}
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <label className="admin-field" style={{ flex: '1 1 240px', maxWidth: 320 }}>
                  <span className="admin-field-label">{t('admin.board.roleName')}</span>
                  <input className="admin-input" value={roleName} disabled={editingProtected}
                    placeholder={t('admin.board.roleNamePlaceholder')} onChange={e => setRoleName(e.target.value)} />
                </label>
                <label className="admin-field" style={{ width: 190 }}>
                  <span className="admin-field-label">{t('admin.board.howManyCanHoldIt')}</span>
                  <input className="admin-input" type="number" min={0} step={1} value={roleMax}
                    disabled={editingProtected} placeholder="1" onChange={e => setRoleMax(e.target.value)} />
                  <span style={{ fontSize: 12, opacity: 0.6, marginTop: 4, textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>
                    {t('admin.board.holdLimitHint')}
                  </span>
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                <span className="admin-field-label" style={{ marginBottom: 0 }}>{t('admin.board.permissions')}</span>
                {!editingProtected && (
                  <button type="button" className="admin-btn-ghost" onClick={toggleAllPerms}>
                    {allPermsSelected ? t('admin.board.clearAll') : t('admin.board.selectAll')}
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18, margin: '12px 0 16px' }}>
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
                  {roleEditId && <button className="admin-btn-ghost" type="button" onClick={startNewRole}>{t('admin.board.cancel')}</button>}
                  <button className="admin-primary-btn" disabled={roleSaving} onClick={saveRole}>
                    {roleSaving ? t('admin.board.saving') : roleEditId ? t('admin.board.saveChanges') : t('admin.board.createRole')}
                  </button>
                </div>
              )}
              {editingProtected && <button className="admin-btn-ghost" type="button" onClick={startNewRole}>{t('admin.board.backToNewRole')}</button>}

              {roles.length > 0 && (
                <div className="bm-list" style={{ marginTop: 18 }}>
                  {roles.map(r => (
                    <div className="bm-row bm-role-row" key={r.id}>
                      <div className="bm-row-main">
                        <div className="bm-row-name">
                          {r.name}
                          {r.is_admin && <span className="amen-pay-tag paid" style={{ marginLeft: 8 }}>{t('admin.board.fullAccess')}</span>}
                          {r.is_system && !r.is_admin && <span className="amen-pay-tag pending" style={{ marginLeft: 8 }}>{t('admin.board.defaultLabel')}</span>}
                          {!r.is_admin && (() => { const cap = capOf(r); const held = residents.filter(m => m.role_id === r.id).length; return (
                            <span className="amen-pay-tag" style={{ marginLeft: 8, opacity: 0.85 }}>
                              {cap === 0 ? t('admin.board.heldNoLimit', { held }) : t('admin.board.heldOfCap', { held, cap })}
                            </span>
                          ) })()}
                        </div>
                        <div className="bm-row-sub">
                          {r.is_admin ? t('admin.board.everyPermission') : (r.permissions?.length ? r.permissions.map(p => PERMISSION_LABEL[p] || p).join(' · ') : t('admin.board.noPermissionsYet'))}
                        </div>
                      </div>
                      {!r.is_admin && (
                        <div className="bm-role-actions" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button type="button" className="admin-sched-row-del" onClick={() => startEditRole(r)}>{t('admin.board.editBtn')}</button>
                          <button type="button" className="admin-sched-row-del" onClick={() => deleteRole(r)}>{t('admin.board.deleteBtn')}</button>
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
                <h2>{t('admin.board.committeesTitle')}</h2>
                <div className="sub">{t('admin.board.committeesSub')}</div>
              </div>
              <button type="button" className="admin-primary-btn" onClick={openAddCommittee}>{t('admin.board.addCommittee')}</button>
            </div>

            {committees.length === 0 && !(comOpen && !comEditId) ? (
              <div className="bc-empty">{t('admin.board.noCommittees')}</div>
            ) : (
              <div className="rulelist">
                {committees.map((c, i) => {
                  const open = comOpen && comEditId === c.id
                  return (
                    <div className="rulerow" key={c.id}>
                      <span className="rulenum">{i + 1}</span>
                      <div className="rulemain">
                        <div className="ruletitle">{c.name}</div>
                        <div className="rulemeta">
                          {c.chair ? `${c.chair} · ` : ''}{c.member_count || 0} {Number(c.member_count) === 1 ? t('admin.board.memberSingular') : t('admin.board.memberPlural')}
                        </div>
                        {open && <div className="rule-detail" style={{ background: '#fff' }}>{comEditor}</div>}
                      </div>
                      <div className="ruleactions">
                        <button type="button" className="rule-edit"
                          onClick={() => (open ? closeCommittee() : startEditCommittee(c))} aria-expanded={open}>
                          {open ? t('admin.board.close') : t('admin.board.editArrow')}
                        </button>
                        <button type="button" className="vdel" onClick={() => removeCommittee(c.id)}
                          aria-label={t('admin.board.removeCommittee', { name: c.name })}>&times;</button>
                      </div>
                    </div>
                  )
                })}

                {comOpen && !comEditId && (
                  <div className="rulerow">
                    <span className="rulenum">{committees.length + 1}</span>
                    <div className="rulemain">
                      <div className="ruletitle">{comForm.name.trim() || t('admin.board.newCommittee')}</div>
                      <div className="rulemeta">{t('admin.board.addMembersChair')}</div>
                      <div className="rule-detail" style={{ background: '#fff' }}>{comEditor}</div>
                    </div>
                    <div className="ruleactions">
                      <button type="button" className="rule-edit" onClick={closeCommittee}>{t('admin.board.close')}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>{t('admin.board.logDecisionTitle')}</h2>
                <div className="sub">{t('admin.board.logDecisionSub')}</div>
              </div>
            </div>

            <form className="admin-form" onSubmit={add}>
              <label className="admin-field">
                <span className="admin-field-label">{t('admin.board.whatWasDecided')}</span>
                <input name="title" className="admin-input" placeholder={t('admin.board.decisionTitlePlaceholder')}
                  value={form.title} onChange={e => setField('title', e.target.value)} />
              </label>
              <label className="admin-field">
                <span className="admin-field-label">{t('admin.board.vendorOptional')}</span>
                <input name="vendor" className="admin-input" placeholder={t('admin.board.vendorPlaceholder')}
                  value={form.vendor} onChange={e => setField('vendor', e.target.value)} />
              </label>
              <div className="bd-form-row">
                <label className="admin-field">
                  <span className="admin-field-label">{t('admin.board.amountOptional')}</span>
                  <input name="amount" className="admin-input" type="number" placeholder="5200"
                    value={form.amount} onChange={e => setField('amount', e.target.value)} />
                </label>
                <div className="admin-field">
                  <span className="admin-field-label">{t('admin.board.statusLabel')}</span>
                  <Dropdown<string>
                    value={form.status}
                    onChange={v => setField('status', v)}
                    ariaLabel={t('admin.board.decisionStatusAria')}
                    options={STATUSES.map(s => ({ value: s.value, label: statusLabel(s.value) }))}
                  />
                </div>
                <label className="admin-field">
                  <span className="admin-field-label">{t('admin.board.dateLabel')}</span>
                  <input name="decided_on" className="admin-input" type="date"
                    value={form.decided_on} onChange={e => setField('decided_on', e.target.value)} />
                </label>
              </div>
              <div className="card-cta">
                <button type="submit" className="admin-primary-btn" disabled={saving}>
                  {saving ? t('admin.board.adding') : t('admin.board.addDecision')}
                </button>
                {error && <span className="admin-err-inline">{error}</span>}
              </div>
            </form>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <h2>{t('admin.board.decisionFeedTitle')}</h2>
                <div className="sub">{t('admin.board.decisionFeedSub')}</div>
              </div>
            </div>

            <div className="bd-list">
              {status === 'loading' && <div className="admin-note">{t('admin.board.loading')}</div>}
              {status === 'ready' && rows.length === 0 && (
                <div className="bc-empty">{t('admin.board.noDecisions')}</div>
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
                    aria-label={t('admin.board.removeDecision')}>&times;</button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
