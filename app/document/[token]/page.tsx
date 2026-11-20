export const dynamic = 'force-dynamic'

import { headers } from 'next/headers'
import { FileText } from 'lucide-react'
import { Logo } from '@/components/logo'
import { createAdminSupabaseClient, getSessionUser, getUserRole, isActiveStaff } from '@/lib/supabase/server'
import { isAutomatischeBezoeker } from '@/lib/klant-geopend'
import { markeerGeopend, vindLink } from '@/lib/algemene-contracten/server'
import { standaardZone } from '@/lib/algemene-contracten/model'
import { DocumentTekenen } from './document-tekenen'

/**
 * Publieke pagina voor de andere partij van een algemeen contract (huur,
 * verzekering, NDA …): bekijken, downloaden en, als het gevraagd is,
 * ondertekenen. Enkel met de persoonlijke link uit de mail (30 dagen).
 */
export default async function DocumentPagina({ params }: { params: Promise<{ token: string }> }) {
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
            <div className="h-12 w-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3"><FileText className="h-6 w-6 text-gray-500" /></div>
            <h1 className="font-semibold text-lg mb-1">Deze link werkt niet meer.</h1>
            <p className="text-sm text-gray-500">Ze is verlopen of het document is niet meer beschikbaar. Vraag NextGenMedia om een nieuwe link.</p>
          </div>
        </div>
      </div>
    )
  }

  // Geopend: enkel als de andere partij kijkt (niet het team, geen linkvoorbeeld of virusscanner).
  const ua = (await headers()).get('user-agent')
  let team = false
  try {
    const ik = await getSessionUser()
    team = !!ik && ((await getUserRole(ik.id)) === 'admin' || (await isActiveStaff(ik.id)))
  } catch { team = false }
  if (!team && !isAutomatischeBezoeker(ua)) await markeerGeopend(admin, l.linkId, l.contract.id).catch(() => null)

  const c = l.contract
  return (
    <div className="min-h-screen flex flex-col">
      {kop}
      <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
        <DocumentTekenen
          token={token}
          titel={c.titel}
          moetTekenen={c.partij_nodig && !c.partij_getekend_op}
          zone={c.partij_zone ?? standaardZone('partij', c.paginas ?? 1)}
          onsGetekend={c.ons_getekend_op ? { door: c.ons_getekend_door, op: c.ons_getekend_op } : null}
          partijGetekend={c.partij_getekend_op ? { naam: c.partij_naam, op: c.partij_getekend_op } : null}
        />
      </main>
    </div>
  )
}
