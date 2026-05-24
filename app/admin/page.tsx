'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

// /admin index redirects to /admin/community — matches the old
// <Route index element={<Navigate to="/admin/community" replace />} />.
export default function AdminIndex() {
  const router = useRouter()
  useEffect(() => { router.replace('/admin/community') }, [router])
  return null
}
