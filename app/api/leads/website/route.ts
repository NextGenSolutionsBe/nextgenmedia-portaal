import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { raadDiensten, bedrijfVan } from '@/lib/opdrachten-kanban'
import { vandaagISO } from '@/lib/opdrachten'

export const dynamic = 'force-dynamic'

/**
 * POST /api/leads/website — websiteaanvraag → kaart in Opvolging (Projecten), bron inbound.
 *
 * PUBLIEK, maar token-beveiligd. De website (of het formulier-platform) stuurt:
 *
 *   POST https://app.nextgenmedia.be/api/leads/website
 *   Headers:  Content-Type: application/json
 *             x-lead-token: <WEBSITE_LEAD_TOKEN>          (verplicht)
 *   Body:     { bedrijf, naam, email, telefoon, website, bericht, dienst,
 *               utm_source, utm_medium, utm_campaign, utm_term, utm_content, pagina }
 *
 * Alle velden zijn tekst en optioneel behalve: minstens een bedrijfsnaam OF een
 * naam, en minstens een e-mail OF een telefoonnummer. Het token staat in de
 * env-variabele WEBSITE_LEAD_TOKEN; ontbreekt die op de server, dan is deze
 * route dicht (503).
 *
 * Antwoord: { ok: true, opdrachtId, leadId (zelfde id, voor oudere formulieren),
 * bestaand: boolean }. `bestaand` = er was al een lopende kaart met dit
 * e-mailadres of deze bedrijfsnaam; die kreeg een notitie in plaats van een
 * dubbele kaart.
 *
 * Lichte ratelimiet per IP (in geheugen, per serverinstantie): 20 per 10 min.
 */

const LIMIET = 20
const VENSTER_MS = 10 * 60_000
const teller = new Map<string, { n: number; tot: number }>()

function overLimiet(ip: string): boolean {
  const nu = Date.now()
  const r = teller.get(ip)
  if (!r || r.tot < nu) { teller.set(ip, { n: 1, tot: nu + VENSTER_MS }); return false }
  r.n++
  if (teller.size > 5000) for (const [k, v] of teller) if (v.tot < nu) teller.delete(k)
  return r.n > LIMIET
}

function tokenKlopt(req: NextRequest): boolean | null {
  const verwacht = process.env.WEBSITE_LEAD_TOKEN?.trim()
  if (!verwacht) return null
  const gegeven = (req.headers.get('x-lead-token') ?? '').trim()
  if (!gegeven || gegeven.length !== verwacht.length) return false
  return timingSafeEqual(Buffer.from(gegeven), Buffer.from(verwacht))
}

const tekst = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function POST(req: NextRequest) {
  const klopt = tokenKlopt(req)
  if (klopt === null) return NextResponse.json({ error: 'Websiteaanvragen staan niet ingesteld (WEBSITE_LEAD_TOKEN).' }, { status: 503 })
  if (!klopt) return NextResponse.json({ error: 'Geen toegang' }, { status: 401 })

  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'onbekend'
  if (overLimiet(ip)) return NextResponse.json({ error: 'Te veel aanvragen, probeer het zo opnieuw.' }, { status: 429 })

  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!b || typeof b !== 'object') return NextResponse.json({ error: 'Geen geldige JSON.' }, { status: 400 })

    const bedrijf = tekst(b.bedrijf, 200)
    const naam = tekst(b.naam, 120)
    const email = tekst(b.email, 200).toLowerCase()
    const telefoon = tekst(b.telefoon, 40)
    const website = tekst(b.website, 200)
    const bericht = tekst(b.bericht, 4000)
    const dienst = tekst(b.dienst, 120)
    if (!bedrijf && !naam) return NextResponse.json({ error: 'Bedrijf of naam is verplicht.' }, { status: 400 })
    if (!email && !telefoon) return NextResponse.json({ error: 'E-mail of telefoon is verplicht.' }, { status: 400 })
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Het e-mailadres klopt niet.' }, { status: 400 })

    const aanvraag = {
      bedrijf, naam, email, telefoon, website, bericht, dienst,
      utm_source: tekst(b.utm_source), utm_medium: tekst(b.utm_medium), utm_campaign: tekst(b.utm_campaign),
      utm_term: tekst(b.utm_term), utm_content: tekst(b.utm_content), pagina: tekst(b.pagina, 500),
      ontvangen_op: new Date().toISOString(),
    }

    const admin = createAdminSupabaseClient()
    const contactRegels = [naam && `Contact: ${naam}`, email && `E-mail: ${email}`, telefoon && `Telefoon: ${telefoon}`, website && `Website: ${website}`].filter(Boolean) as string[]
    const notitie = [
      'Websiteaanvraag ontvangen',
      dienst ? `Dienst: ${dienst}` : null,
      bericht || null,
      aanvraag.utm_source ? `UTM: ${[aanvraag.utm_source, aanvraag.utm_medium, aanvraag.utm_campaign].filter(Boolean).join(' / ')}` : null,
      aanvraag.pagina ? `Pagina: ${aanvraag.pagina}` : null,
    ].filter(Boolean).join('\n')

    // Ontdubbelen: wie al een lopende kaart heeft (Opvolging of Offerte gestuurd,
    // zelfde e-mail of bedrijfsnaam), krijgt een notitie in plaats van een tweede kaart.
    const { data: lopend } = await admin.from('opdrachten').select('id, status, klant_vrij, omschrijving, client_id')
      .in('status', ['open', 'voorstel_gevraagd', 'voorstel_bezig', 'voorstel_klaar', 'voorstel_voorgelegd', 'interesse'])
      .order('created_at', { ascending: false }).limit(500)
    const sleutel = (v: string | null | undefined) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
    const bestaand = ((lopend ?? []) as { id: string; klant_vrij: string | null; omschrijving: string | null }[]).find((o) =>
      (email && String(o.omschrijving ?? '').toLowerCase().includes(email)) || (bedrijf && sleutel(o.klant_vrij) === sleutel(bedrijf)))
    if (bestaand) {
      await voegNotitieToe(admin, bestaand.id, notitie, 'systeem', null)
      return NextResponse.json({ ok: true, leadId: bestaand.id, opdrachtId: bestaand.id, bestaand: true })
    }

    // Bestaande klant (zelfde e-mail of bedrijfsnaam)? Dan de kaart aan dat dossier.
    let clientId: string | null = null
    if (email) {
      const { data: k } = await admin.from('clients').select('id').ilike('email', email).is('archived_at', null).limit(1).maybeSingle()
      clientId = (k as { id: string } | null)?.id ?? null
    }
    if (!clientId && bedrijf) {
      const { data: k } = await admin.from('clients').select('id').ilike('company_name', bedrijf).is('archived_at', null).limit(1).maybeSingle()
      clientId = (k as { id: string } | null)?.id ?? null
    }

    const diensten = raadDiensten(`${dienst} ${bericht}`)
    const rij: Record<string, unknown> = {
      client_id: clientId, klant_vrij: clientId ? null : (bedrijf || naam),
      titel: (dienst || 'Websiteaanvraag').slice(0, 200), omschrijving: contactRegels.join('\n') || null,
      status: 'open', status_bron: 'handmatig', status_gewijzigd_op: new Date().toISOString(),
      bron: 'inbound', diensten, merk: bedrijfVan(null, diensten), datum: vandaagISO(),
    }
    let { data: nieuw, error } = await admin.from('opdrachten').insert(rij).select('id').single()
    if (error && /merk|datum|bron|diensten|schema cache|column/i.test(error.message)) {
      delete rij.merk; delete rij.datum
      ;({ data: nieuw, error } = await admin.from('opdrachten').insert(rij).select('id').single())
    }
    if (error) throw new Error(error.message)
    const id = String((nieuw as { id: string }).id)
    await voegNotitieToe(admin, id, notitie, 'systeem', null)
    return NextResponse.json({ ok: true, leadId: id, opdrachtId: id, bestaand: false })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Verwerken mislukt' }, { status: 500 })
  }
}
