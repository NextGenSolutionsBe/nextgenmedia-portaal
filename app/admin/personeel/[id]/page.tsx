import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { magIk } from '@/lib/instellingen/laden'
import { DossierClient } from './dossier-client'

export const dynamic = 'force-dynamic'

export default async function DossierPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await magIk('personeel', 'bekijken'))) redirect('/admin')
  const { id } = await params
  return <Suspense><DossierClient id={id} /></Suspense>
}
