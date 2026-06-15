import { useState, useEffect } from 'react'
import { useAuth } from '@/app/providers'
import { supabase, hasSupabase } from '@/lib/supabase'

const withTimeout = <T,>(p: PromiseLike<T>, ms = 10000): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("Can't reach the server")), ms)),
  ])

export type PubReportCategory =
  | 'financial' | 'maintenance' | 'operations' | 'community'
  | 'safety' | 'vendor' | 'compliance' | 'board'

export type PubReport = {
  id: string
  title: string
  category: PubReportCategory
  date: string
  status: 'published' | 'updated' | 'draft'
  size?: string
  blurb?: string
  featured?: boolean
  storagePath?: string
}

// Human-friendly file size from a bytes count (reports.file_size is bigint).
function humanSize(bytes?: number | null): string | undefined {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return undefined
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// Board-published reports the resident can browse (`reports` table). RLS limits
// residents to published/updated rows; board sees drafts too. Files live in the
// private `reports` storage bucket — `download` mints a short-lived signed URL.
// Returns an empty list (so the page falls back to its demo) when there's no
// community linked or Supabase is off.
export function usePublishedReports() {
  const { profile } = useAuth() || {}
  const communityId = profile?.community_id
  const [reports, setReports] = useState<PubReport[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!hasSupabase || !supabase || !communityId) {
        if (!cancelled) { setReports([]); setLoading(false) }
        return
      }
      try {
        const res: any = await withTimeout(
          supabase.from('reports').select('*')
            .eq('community_id', communityId)
            .order('report_date', { ascending: false }),
        )
        if (cancelled) return
        const data: any[] | null = res?.data
        if (res?.error || !data) { setReports([]); setLoading(false); return }
        setReports(data.map((r: any) => ({
          id: r.id,
          title: r.title,
          category: r.category as PubReportCategory,
          date: (r.report_date || r.created_at || '').slice(0, 10),
          status: r.status,
          blurb: r.blurb || undefined,
          featured: !!r.featured,
          size: humanSize(r.file_size),
          storagePath: r.storage_path || undefined,
        })))
        setLoading(false)
      } catch {
        if (!cancelled) { setReports([]); setLoading(false) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [communityId])

  // Open a report's PDF via a short-lived signed URL (private bucket).
  const download = async (storagePath?: string) => {
    if (!storagePath || !supabase) return
    try {
      const { data, error } = await supabase.storage
        .from('reports').createSignedUrl(storagePath, 60)
      if (!error && data?.signedUrl && typeof window !== 'undefined') {
        window.open(data.signedUrl, '_blank', 'noopener')
      }
    } catch { /* link just won't open — no hard failure */ }
  }

  return { loading, reports, download }
}
