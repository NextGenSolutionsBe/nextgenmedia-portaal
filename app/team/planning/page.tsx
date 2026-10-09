import { Suspense } from 'react'
import { TeamPlanning } from './team-planning'

export const dynamic = 'force-dynamic'

export default function Page() {
  return <Suspense><TeamPlanning /></Suspense>
}
