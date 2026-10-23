import { Suspense } from 'react'
import { CommunityInbox } from './community-inbox'

export const dynamic = 'force-dynamic'

export default function CommunityPage() {
  return (
    <Suspense>
      <CommunityInbox />
    </Suspense>
  )
}
