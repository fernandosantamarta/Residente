'use client'

// Two-way Contact thread: the message log for a single resident request.
// Backs both the resident view (/app/voice#contact) and the board view
// (/admin/requests). Reads request_messages with realtime so a reply from the
// other side appears live; sendThreadMessage posts a new message.
//
// RLS scopes everything: residents see only their own request's messages, the
// board sees every request in its community. See supabase/request-messages.sql.

import { useCallback, useEffect, useState } from 'react'
import { supabase, hasSupabase } from '@/lib/supabase'

// System lines — board actions surfaced inside the conversation (not a real
// reply). Stored as a board message with a sentinel body, rendered centered.
export const SYS_REOPENED = '__sys:reopened__'
export function systemLine(body: string): string | null {
  if (body === SYS_REOPENED) return 'Conversation reopened by the board'
  return null
}

export type ThreadMessage = {
  id: string
  requestId: string
  authorRole: 'resident' | 'board'
  authorName: string | null
  body: string
  attachmentPath: string | null
  attachmentName: string | null
  createdAt: string
}

const rowToMsg = (r: any): ThreadMessage => ({
  id:             r.id,
  requestId:      r.request_id,
  authorRole:     r.author_role === 'board' ? 'board' : 'resident',
  authorName:     r.author_name ?? null,
  body:           r.body,
  attachmentPath: r.attachment_path ?? null,
  attachmentName: r.attachment_name ?? null,
  createdAt:      r.created_at,
})

export function useRequestThread(requestId: string | null) {
  const [messages, setMessages] = useState<ThreadMessage[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!hasSupabase || !supabase || !requestId) { setMessages([]); return }
    setLoading(true)
    try {
      const { data } = await supabase
        .from('request_messages')
        .select('*')
        .eq('request_id', requestId)
        .order('created_at', { ascending: true })
      setMessages((data || []).map(rowToMsg))
    } catch { /* leave what we have */ } finally {
      setLoading(false)
    }
  }, [requestId])

  useEffect(() => { load() }, [load])

  // Live updates — a reply from the other party appears without a refresh.
  useEffect(() => {
    if (!hasSupabase || !supabase || !requestId) return
    const ch = supabase
      .channel(`request-thread:${requestId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'request_messages',
        filter: `request_id=eq.${requestId}`,
      }, () => { load() })
      .subscribe()
    return () => { supabase!.removeChannel(ch) }
  }, [requestId, load])

  return { messages, loading, reload: load }
}

export async function sendThreadMessage(input: {
  requestId: string
  communityId: string
  body: string
  authorRole: 'resident' | 'board'
  authorId: string | null
  authorName: string | null
  attachmentPath?: string | null
  attachmentName?: string | null
}): Promise<void> {
  if (!hasSupabase || !supabase) return
  const { error } = await supabase.from('request_messages').insert({
    request_id:      input.requestId,
    community_id:    input.communityId,
    author_id:       input.authorId,
    author_role:     input.authorRole,
    author_name:     input.authorName,
    body:            input.body,
    attachment_path: input.attachmentPath ?? null,
    attachment_name: input.attachmentName ?? null,
  })
  if (error) throw error
}
