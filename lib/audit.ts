import { supabase, hasSupabase } from '@/lib/supabase'

// Compliance audit log. Append-only (ev_audit_log has no update/delete grant).
// MUST NOT throw — auditing failures should never block a user action.
// RLS: `any member writes audit` permits insert when community_id matches caller.

export type AuditEventType =
  // votes
  | 'vote.opened'
  | 'vote.closed'
  | 'vote.published'
  // ballots
  | 'ballot.cast'
  // meetings
  | 'meeting.status_changed'
  | 'meeting.quorum_confirmed'
  // documents
  | 'document.uploaded'
  | 'document.deleted'
  // notices
  | 'notice.sent'
  // proxies (Session 4)
  | 'proxy.submitted'
  | 'proxy.verified'
  | 'proxy.used'
  | 'proxy.revoked'
  // candidates (Session 5)
  | 'candidate.nominated'
  | 'candidate.withdrawn'
  | 'candidate.approved'
  // attendance (Session 6)
  | 'attendance.marked'
  | 'attendance.self_checkin'
  // consent (Session 3)
  | 'consent.recorded'
  // roster + invites (Phase 4)
  | 'roster.imported'
  | 'invite.sent'
  | 'invite.accepted'
  // collections / liens (compliance domain F)
  | 'collection.case_opened'
  | 'collection.stage_changed'
  | 'collection.notice_logged'
  | 'collection.payment_plan_created'
  | 'collection.payment_plan_updated'
  | 'collection.payment_plan_decided'
  | 'collection.resolved'
  // structural / SIRS (compliance domain A)
  | 'structural.building_added'
  | 'structural.assessment_created'
  | 'structural.assessment_status_changed'
  | 'structural.sirs_recorded'
  // official records (compliance domain B)
  | 'records.document_posted'
  | 'records.request_responded'
  // financial reporting & reserves (compliance domain C)
  | 'financial.filing_recorded'
  | 'financial.reserve_updated'
  // directors / certification / conflicts / CAM (compliance domain D)
  | 'governance.term_recorded'
  | 'governance.cert_recorded'
  | 'governance.eligibility_updated'
  | 'governance.manager_recorded'
  | 'governance.conflict_disclosed'
  // violations / fines / hearings / suspension (compliance domain G)
  | 'enforcement.fine_proposed'
  | 'enforcement.hearing_noticed'
  | 'enforcement.hearing_decided'
  | 'enforcement.fine_levied'
  | 'enforcement.committee_updated'
  | 'enforcement.suspension_recorded'
  | 'enforcement.suspension_lifted'
  // meetings & statutory notice (compliance domain H)
  | 'meeting.notice_recorded'
  | 'meeting.agenda_posted'
  | 'meeting.minutes_published'
  // elections & recall (compliance domain I)
  | 'election.scheduled'
  | 'election.notice_recorded'
  | 'election.completed'
  | 'recall.served'
  | 'recall.certified'
  // architectural review / ARC (compliance domain J)
  | 'arc.request_submitted'
  | 'arc.decided'

export type AuditTargetType =
  | 'vote' | 'ballot' | 'meeting' | 'document' | 'notice'
  | 'proxy' | 'candidate' | 'attendance' | 'consent'
  | 'roster' | 'resident'
  | 'collection_case' | 'collection_notice' | 'payment_plan'
  | 'building' | 'structural_assessment' | 'sirs_component'
  | 'records_request'
  | 'financial_filing' | 'reserve_component'
  | 'director' | 'manager' | 'conflict_disclosure'
  | 'violation' | 'fining_committee_member' | 'violation_hearing' | 'suspension'
  | 'election' | 'recall'
  | 'arc_request'

export interface LogAuditArgs {
  community_id: string
  event_type: AuditEventType
  target_type: AuditTargetType
  target_id?: string | null
  metadata?: Record<string, unknown>
}

export async function logAudit(args: LogAuditArgs): Promise<void> {
  if (!hasSupabase || !supabase) return
  try {
    await supabase.from('ev_audit_log').insert({
      community_id: args.community_id,
      event_type:   args.event_type,
      target_type:  args.target_type,
      target_id:    args.target_id ?? null,
      metadata:     args.metadata ?? {},
    })
  } catch (err) {
    console.warn('[audit] failed to log', args.event_type, err)
  }
}
