import { Suspense } from 'react'
import { MeetingsClient } from './meetings-client'

export const dynamic = 'force-dynamic'

export default function MeetingsPage() {
  return <Suspense><MeetingsClient /></Suspense>
}
