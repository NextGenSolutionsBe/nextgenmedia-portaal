import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { laadZicht, metToegewezen, itemsInBereik } from '@/lib/agenda/server'
import { icalVanToken, icalPeriode, reeksenInBereik } from '@/lib/agenda/team-server'
import { icalFeed } from '@/lib/agenda/ical-feed'
import { zoneNaarIso } from '@/lib/agenda/model'

export const dynamic = 'force-dynamic'

/**
 * Agenda-abonnement (iCal) voor Google Agenda, Apple Agenda of Outlook. De persoonlijke
 * link is de toegang (zoals /sign/[token]): we bewaren enkel de SHA-256, ze is in te trekken
 * in de agenda (Instellingen → Agenda-abonnement). Enkel lezen, enkel wat die persoon in de
 * app ziet: de eigen agenda, of met de teamlink alles wat die persoon van het team ziet.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminSupabaseClient()
  const link = await icalVanToken(admin, token.replace(/\.ics$/i, ''))
  if (!link) return new NextResponse('Deze link werkt niet (meer).', { status: 404 })
  const { data: p } = await admin.from('ag_personen').select('id, naam, user_id, actief').eq('id', link.persoonId).maybeSingle()
  const persoon = p as { id: string; naam: string; user_id: string | null; actief: boolean } | null
  if (!persoon || persoon.actief === false) return new NextResponse('Deze link werkt niet (meer).', { status: 404 })

  const { van, tot } = icalPeriode()
  const vanIso = zoneNaarIso(van, '00:00'), totIso = zoneNaarIso(tot, '00:00')
  const k = { persoonId: persoon.id, userId: persoon.user_id ?? '', naam: persoon.naam, isAdmin: false }
  const [z, ruw] = await Promise.all([laadZicht(admin, k), itemsInBereik(admin, vanIso, totIso)])
  const [items, reeksen] = await Promise.all([metToegewezen(admin, ruw, z), reeksenInBereik(admin, z, vanIso, totIso).catch(() => [])])
  const alles = [...items, ...reeksen]
  const mijn = link.team ? alles : alles.filter((i) => i.toegewezen.includes(persoon.id) || (!i.toegewezen.length && i.eigenaar_id === persoon.id))
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.nextgenmedia.be').replace(/\/$/, '')
  const body = icalFeed(mijn, { naam: link.team ? 'NextGen Agency · team' : `NextGen Agency · ${persoon.naam}`, appUrl })
  return new NextResponse(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=600', 'X-Robots-Tag': 'noindex' } })
}
