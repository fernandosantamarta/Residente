'use client'

// Admin collections document route — renders the shared letter component with
// the full admin toolbar ("Mail certified"). The letter logic lives in
// components/CollectionLetterDoc.tsx (shared with the resident read-only route).

import { CollectionLetterDoc } from '@/components/CollectionLetterDoc'

export default function CollectionDocumentPage() {
  return <CollectionLetterDoc />
}
