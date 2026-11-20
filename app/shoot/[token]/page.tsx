export const dynamic = 'force-dynamic'

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { Aperture } from 'lucide-react'
import { Logo } from '@/components/logo'
import { createAdminSupabaseClient, getSessionUser, getUserRole, isActiveStaff } from '@/lib/supabase/server'
import { isAutomatischeBezoeker } from '@/lib/klant-geopend'
import { markeerGeopend, vindLink } from '@/lib/shoots/server'
import { ShootplanWeergave } from './weergave'

export const metadata: Metadata = { title: 'Shootplan', robots: { index: false, follow: false } }

/**
 * Het shootplan voor wie de mail kreeg: programma per uur, adressen met een
 * routeknop, wie er is (tikken om te bellen), shotlist, paklijst en de pdf.
 * Enkel met de persoonlijke link; toont altijd de laatste versie.
 */
export default async function ShootPagina({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminSupabaseClient()
  const l = await vindLink(admin, token)

  const kop = (
    <header className="bg-white/80 backdrop-blur border-b border-gray-200 px-4 py-4 flex items-center gap-3">
      <Logo className="h-8 w-8" />
      <span className="font-semibold text-sm">NextGenMedia</span>
    </header>
  )

  if (!l) {
    return (
      <div className="min-h-screen flex flex-col">
        {kop}
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center max-w-md">
            <div className="h-12 w-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3"><Aperture className="h-6 w-6 text-gray-500" /></div>
            <h1 className="font-semibold text-lg mb-1">Deze link werkt niet meer.</h1>
            <p className="text-sm text-gray-500">Ze is verlopen of de shoot is niet meer beschikbaar. Vraag NextGenMedia om een nieuwe link.</p>
          </div>
        </div>
      </div>
    )
  }

  // Geopend: enkel als de ontvanger kijkt (niet het team, geen linkvoorbeeld of virusscanner).
  const ua = (await headers()).get('user-agent')
  let team = false
  try {
    const ik = await getSessionUser()
    team = !!ik && ((await getUserRole(ik.id)) === 'admin' || (await isActiveStaff(ik.id)))
  } catch { team = false }
  if (!team && !isAutomatischeBezoeker(ua)) await markeerGeopend(admin, l.linkId).catch(() => null)

  return (
    <div className="min-h-screen flex flex-col">
      {kop}
      <ShootplanWeergave s={l.shoot} pdf={`/api/shoot/${token}/pdf`} />
    </div>
  )
}
