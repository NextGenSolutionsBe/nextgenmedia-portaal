import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { createLead, getOrCreateSalesOrg, logLeadEvent } from '@/lib/sales/service'
import { defaultPipelineId } from '@/lib/sales/pipelines'

export const dynamic = 'force-dynamic'

/**
 * POST /api/leads/website — websiteaanvraag → Inbound-kolom van de pipeline.
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
 * Antwoord: { ok: true, leadId, bestaand: boolean }. `bestaand` = er was al een
 * lead met dit e-mailadres; die kreeg een tijdlijnregel "Nieuwe websiteaanvraag"
 * in plaats van een dubbele kaart.
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
    const org = await getOrCreateSalesOrg()

    // Ontdubbelen op e-mail: dezelfde persoon die het formulier twee keer
    // invult, krijgt geen tweede kaart maar een regel op de bestaande.
    if (email) {
      const { data: contacten } = await admin.from('sales_contacts').select('id').ilike('email', email).limit(20)
      const ids = ((contacten ?? []) as { id: string }[]).map((c) => c.id)
      if (ids.length) {
        const { data: bestaand } = await admin.from('sales_leads')
          .select('id').eq('sales_client_id', org.id).in('contact_id', ids).is('archived_at', null)
          .order('created_at', { ascending: false }).limit(1).maybeSingle()
        if (bestaand) {
          const leadId = (bestaand as { id: string }).id
          const regels = [
            'Nieuwe websiteaanvraag',
            dienst ? `Dienst: ${dienst}` : null,
            bericht ? bericht : null,
            aanvraag.utm_source ? `UTM: ${[aanvraag.utm_source, aanvraag.utm_medium, aanvraag.utm_campaign].filter(Boolean).join(' / ')}` : null,
          ].filter(Boolean)
          await logLeadEvent(leadId, { kind: 'system', body: regels.join('\n'), laatsteNotitie: bericht || false })
          return NextResponse.json({ ok: true, leadId, bestaand: true })
        }
      }
    }

    const res = await createLead({
      salesClientId: org.id,
      pipelineId: await defaultPipelineId(),
      company: { name: bedrijf || naam, website: website || undefined, phone: telefoon || undefined, email: email || undefined },
      contact: { name: naam || undefined, email: email || undefined, phone: telefoon || undefined },
      labels: ['Website'],
      leadbron: 'website',
      stage: 'inbound',
      dienst: dienst || null,
      websiteAanvraag: aanvraag,
    })
    if (!res.ok) {
      // Bedrijf staat al in de pipeline (op naam/website): ook dan een regel
      // op de bestaande lead in plaats van een fout naar de website.
      if (res.existingLeadId) {
        await logLeadEvent(res.existingLeadId, {
          kind: 'system',
          body: ['Nieuwe websiteaanvraag', dienst ? `Dienst: ${dienst}` : null, bericht || null].filter(Boolean).join('\n'),
          laatsteNotitie: bericht || false,
        })
        return NextResponse.json({ ok: true, leadId: res.existingLeadId, bestaand: true })
      }
      return NextResponse.json({ error: res.error }, { status: 400 })
    }

    // "Websiteaanvraag ontvangen" als leesbare regel, mét het bericht.
    await logLeadEvent(res.leadId, {
      kind: 'system',
      body: [
        'Websiteaanvraag ontvangen',
        dienst ? `Dienst: ${dienst}` : null,
        bericht || null,
        aanvraag.utm_source ? `UTM: ${[aanvraag.utm_source, aanvraag.utm_medium, aanvraag.utm_campaign].filter(Boolean).join(' / ')}` : null,
        aanvraag.pagina ? `Pagina: ${aanvraag.pagina}` : null,
      ].filter(Boolean).join('\n'),
      laatsteNotitie: bericht || false,
    })

    return NextResponse.json({ ok: true, leadId: res.leadId, bestaand: false })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Verwerken mislukt' }, { status: 500 })
  }
}
