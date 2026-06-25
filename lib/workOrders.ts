// Work orders — the board's record of a maintenance task handed to a vendor.
// A work order moves through assigned → in_progress → completed (or
// cancelled); on completion the board records the actual cost + notes. Backed
// by the public.work_orders table (see supabase/work-orders.sql for the schema
// + RLS). These helpers are thin wrappers over the Supabase client so the admin
// page stays declarative.

import { supabase, hasSupabase } from '@/lib/supabase'

export type WorkOrderStatus = 'assigned' | 'in_progress' | 'completed' | 'cancelled'
export type Priority = 'low' | 'normal' | 'urgent' | 'emergency'

export const WORK_ORDER_STATUSES: WorkOrderStatus[] = ['assigned', 'in_progress', 'completed', 'cancelled']
export const PRIORITIES: Priority[] = ['low', 'normal', 'urgent', 'emergency']

export type WorkOrder = {
  id: string
  community_id: string
  request_id: string | null
  vendor_id: string | null
  assigned_by: string | null
  assigned_at: string
  title: string
  description: string | null
  priority: Priority
  status: WorkOrderStatus
  started_at: string | null
  completed_at: string | null
  sla_due_at: string | null
  estimated_cost: number | null
  actual_cost: number | null
  completion_notes: string | null
  completion_photo_path: string | null
  completion_photo_name: string | null
  created_at: string
  updated_at: string
  quote_status: 'none' | 'submitted' | 'approved' | 'rejected'
  quoted_cost: number | null
  quote_note: string | null
  quote_submitted_at: string | null
}

const withTimeout = <T,>(p: PromiseLike<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

export type WorkOrderFilters = {
  status?: WorkOrderStatus | 'all'
  priority?: Priority | 'all'
  vendorId?: string | 'all'
}

// All work orders in a community, newest first. Filters (status / priority /
// vendor) are applied server-side when set to a concrete value; 'all' (or
// undefined) means no filter on that field.
export async function listWorkOrders(
  communityId: string,
  filters: WorkOrderFilters = {},
): Promise<WorkOrder[]> {
  if (!hasSupabase || !supabase) return []
  let q = supabase
    .from('work_orders')
    .select('*')
    .eq('community_id', communityId)
    .order('created_at', { ascending: false })
  if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status)
  if (filters.priority && filters.priority !== 'all') q = q.eq('priority', filters.priority)
  if (filters.vendorId && filters.vendorId !== 'all') q = q.eq('vendor_id', filters.vendorId)
  const { data, error } = await withTimeout(q)
  if (error) throw error
  return (data as WorkOrder[]) || []
}

export type CreateWorkOrderInput = {
  communityId: string
  assignedBy: string | null
  title: string
  description?: string | null
  requestId?: string | null
  vendorId?: string | null
  priority: Priority
  estimatedCost?: number | null
  slaDueAt?: string | null
}

// Create a work order and (when it came from a request) stamp that request's
// active_work_order_id so the request row knows it has open work. Returns the
// inserted row.
export async function createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder> {
  if (!hasSupabase || !supabase) throw new Error("Can't reach the server")
  const { data, error } = await withTimeout(
    supabase
      .from('work_orders')
      .insert({
        community_id:   input.communityId,
        assigned_by:    input.assignedBy,
        title:          input.title,
        description:    input.description ?? null,
        request_id:     input.requestId ?? null,
        vendor_id:      input.vendorId ?? null,
        priority:       input.priority,
        estimated_cost: input.estimatedCost ?? null,
        sla_due_at:     input.slaDueAt ?? null,
        status:         'assigned',
      })
      .select('*')
      .single(),
  )
  if (error) throw error
  const row = data as WorkOrder
  // Link the request back to this work order (best-effort — a failure here
  // doesn't invalidate the work order itself).
  if (row.request_id) {
    try {
      await supabase
        .from('resident_requests')
        .update({ active_work_order_id: row.id })
        .eq('id', row.request_id)
    } catch { /* non-blocking */ }
  }
  return row
}

export type WorkOrderPatch = Partial<{
  status: WorkOrderStatus
  started_at: string | null
  completed_at: string | null
  actual_cost: number | null
  completion_notes: string | null
  completion_photo_path: string | null
  completion_photo_name: string | null
  vendor_id: string | null
  priority: Priority
  sla_due_at: string | null
  estimated_cost: number | null
  quote_status: 'none' | 'submitted' | 'approved' | 'rejected'
  quoted_cost: number | null
}>

// Apply a patch (typically a status advance, optionally with completion data)
// and return the updated row.
export async function updateWorkOrderStatus(id: string, patch: WorkOrderPatch): Promise<WorkOrder> {
  if (!hasSupabase || !supabase) throw new Error("Can't reach the server")
  const { data, error } = await withTimeout(
    supabase.from('work_orders').update(patch).eq('id', id).select('*').single(),
  )
  if (error) throw error
  return data as WorkOrder
}

// Convenience patches for the lifecycle transitions the UI drives.
export function startPatch(): WorkOrderPatch {
  return { status: 'in_progress', started_at: new Date().toISOString() }
}

export function completePatch(opts: {
  actualCost?: number | null
  notes?: string | null
  photoPath?: string | null
  photoName?: string | null
}): WorkOrderPatch {
  return {
    status: 'completed',
    completed_at: new Date().toISOString(),
    actual_cost: opts.actualCost ?? null,
    completion_notes: opts.notes ?? null,
    completion_photo_path: opts.photoPath ?? null,
    completion_photo_name: opts.photoName ?? null,
  }
}

export function cancelPatch(): WorkOrderPatch {
  return { status: 'cancelled' }
}

// Budget integration: a completed work order's actual cost IS a community
// expense, so record it once in public.ev_expenses — the same ledger Budget
// actuals, Reports, and the resident Home chart all read. Idempotent on
// work_order_id so re-completing never double-posts. Returns true if a new
// expense row was written. Requires supabase/work-order-expense.sql (which adds
// the ev_expenses.work_order_id column).
export async function recordWorkOrderExpense(input: {
  communityId: string
  workOrderId: string
  amount: number
  vendor: string | null
  description: string | null
  categoryId: string | null
  createdBy: string | null
}): Promise<boolean> {
  if (!hasSupabase || !supabase) return false
  // Never double-post for the same work order.
  const { data: existing } = await withTimeout(
    supabase.from('ev_expenses').select('id').eq('work_order_id', input.workOrderId).limit(1),
  )
  if (existing && (existing as any[]).length) return false
  const { error } = await withTimeout(
    supabase.from('ev_expenses').insert({
      community_id:  input.communityId,
      work_order_id: input.workOrderId,
      category_id:   input.categoryId,
      amount:        input.amount,
      spent_on:      new Date().toISOString().slice(0, 10),
      vendor:        input.vendor,
      description:   input.description,
      created_by:    input.createdBy,
    }),
  )
  if (error) throw error
  return true
}
