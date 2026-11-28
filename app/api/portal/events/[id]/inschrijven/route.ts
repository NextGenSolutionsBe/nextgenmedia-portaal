import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { akkoordTekst, inschrijfFout, inschrijvingOpen, valideerDeelnemers } from '@/lib/events'
import { leesEvent, naInschrijving, bezetting } from '@/lib/events-server'

export const dynamic = 'force-dynamic'
// Op de achtergrond na het antwoord: gastenlijst in Google en tot vijf bevestigingen.
export const maxDuration = 60

/**
 * Inschrijven voor een event: de ingelogde persoon zelf en/of collega's.
 * Betalend: enkel met akkoord op een Peppol-factuur achteraf (er wordt niets
 * betaald in de app). Daarna, op de achtergrond: op de gastenlijst in Google en
 * een bevestiging met de Meet-link en een agendabestand.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requirePortalPermission('events', 'inschrijven')
  if (!g.ok) return g.response
  const s = g.session
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) return NextResponse.json({ error: 'Onbekend event' }, { status: 400 })
  const b = await req.json().catch(() => ({})) as { zelf?: boolean; collegas?: unknown; akkoord?: boolean }
  const admin = createAdminSupabaseClient()
  const e = await leesEvent(admin, params.id)
  if (!e || e.status === 'concept') return NextResponse.json({ error: 'Dit event bestaat niet.' }, { status: 404 })
  const open = inschrijvingOpen(e, (await bezetting(admin, [e.id])).get(e.id) ?? 0)
  if (!open.open) return NextResponse.json({ error: inschrijfFout(open.reden === 'volzet' ? 'volzet' : open.reden === 'gesloten' ? 'gesloten' : open.reden === 'voorbij' ? 'voorbij' : 'niet_open') }, { status: 409 })

  const d = valideerDeelnemers({ naam: s.name ?? '', email: s.email ?? '' }, b.collegas, b.zelf !== false)
  if (!d.ok) return NextResponse.json({ error: d.fout }, { status: 400 })
  if (e.prijs_cents > 0 && b.akkoord !== true) return NextResponse.json({ error: 'Ga akkoord met de factuur achteraf om in te schrijven.' }, { status: 400 })

  const { data, error } = await admin.rpc('klant_event_inschrijven', {
    p_event: e.id, p_client: s.clientId, p_door_auth: s.userId, p_door_naam: s.name ?? s.email ?? null,
    p_deelnemers: d.lijst, p_akkoord_tekst: e.prijs_cents > 0 ? akkoordTekst(e, d.lijst.length) : null,
  })
  if (error) return NextResponse.json({ error: 'Inschrijven lukte niet. Probeer het opnieuw.' }, { status: 500 })
  const r = data as { ok?: boolean; fout?: string; ids?: string[]; email?: string; vrij?: number }
  if (!r?.ok || !r.ids?.length) return NextResponse.json({ error: inschrijfFout(r?.fout ?? '', { email: r?.email, vrij: r?.vrij }) }, { status: 409 })

  waitUntil(naInschrijving(admin, e.id, r.ids).catch(() => null))
  await logPortalAction(s, 'event.ingeschreven', { type: 'klant_event', id: e.id }, { req, meta: { aantal: d.lijst.length, betalend: e.prijs_cents > 0 } })
  return NextResponse.json({ ok: true, aantal: r.ids.length })
}
