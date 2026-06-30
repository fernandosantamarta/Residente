'use client'

// Resident collections document route — the owner's READ-ONLY view of a notice
// on their account (no "Mail certified", no admin draft framing). Reuses the
// same letter renderer as the admin route; data loads via RLS so the owner can
// read their own case. Opened from the Notices tab on the Pay/Track screen.

import { CollectionLetterDoc } from '@/components/CollectionLetterDoc'

export default function ResidentCollectionDocumentPage() {
  return <CollectionLetterDoc readOnly />
}
