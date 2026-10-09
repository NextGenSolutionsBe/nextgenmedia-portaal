import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { leesPeriode } from '@/lib/sales/statistieken-data'
import { laadPrestaties, laadRegistraties } from '@/lib/sales/prestaties-data'
import { listSalesMedewerkers } from '@/lib/sales/medewerkers'
import { logLeadEvent } from '@/lib/sales/service'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET ?van=JJJJ-MM-DD&tot=JJJJ-MM-DD[&registraties=1]
 * Salesprestaties per medewerker. Een admin ziet iedereen (met podium en
 * correcties); een medewerker ziet ALLEEN zijn eigen cijfers.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const isAdmin = !!(await requireAdmin())
    const sp = req.nextUrl.searchParams
    const periode = leesPeriode(sp.get('van'), sp.get('tot'))
    const admin = createAdminSupabaseClient()
    const data = await laadPrestaties(admin, periode.van, periode.tot)
    if (!isAdmin) {
      const eigen = data.perMedewerker.filter((r) => r.sleutel === actor.id)
      return NextResponse.json({ ...data, perMedewerker: eigen, team: null, podium: null, isAdmin, meId: actor.id })
    }
    const registraties = sp.get('registraties') === '1' ? await laadRegistraties(admin, periode.van, periode.tot) : null
    const medewerkers = await listSalesMedewerkers()
    return NextResponse.json({ ...data, registraties, medewerkers, isAdmin, meId: actor.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * POST { soort, id, waarde, reden } — een registratie rechtzetten.
 *  · aanwezigheid        afspraak gehouden | niet_gehouden | null (onbekend)
 *  · verantwoordelijke   wie verantwoordelijk was voor de afspraak (closer)
 *  · activiteit_medewerker  gesprek/faseverplaatsing aan een andere medewerker toeschrijven
 *  · activiteit_ongeldig    gesprek/faseverplaatsing als foutief markeren (telt niet meer)
 * De oude en nieuwe waarde, reden, datum en wie het deed komen in
 * sales_stat_correcties (en op de tijdlijn van de lead). De eerste bevestiging
 * van een afspraak (nog onbekend → gehouden/niet gehouden) mag ook door de
 * verantwoordelijke zelf; al het andere enkel door een admin, met reden.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const isAdmin = !!(await requireAdmin())
    const b = (await req.json().catch(() => ({}))) as { soort?: string; id?: string; waarde?: string | null; reden?: string }
    const soort = String(b.soort ?? '')
    const id = String(b.id ?? '')
    const reden = String(b.reden ?? '').trim().slice(0, 1000)
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const nu = new Date().toISOString()

    const log = async (entiteit: string, leadId: string | null, oud: unknown, nieuw: unknown, tekst: string, redenTekst: string) => {
      await admin.from('sales_stat_correcties').insert({ soort, entiteit, entiteit_id: id, lead_id: leadId, oud, nieuw, reden: redenTekst, door: actor.id, door_email: actor.email ?? null })
      if (leadId) await logLeadEvent(leadId, { kind: 'system', body: `${tekst}${redenTekst ? ` — ${redenTekst}` : ''}`, actorId: actor.id, actorEmail: actor.email ?? null })
    }

    if (soort === 'aanwezigheid' || soort === 'verantwoordelijke') {
      const { data: a } = await admin.from('sales_appointments').select('id, lead_id, aanwezigheid, verantwoordelijke_id, status').eq('id', id).maybeSingle()
      if (!a) return NextResponse.json({ error: 'Afspraak niet gevonden' }, { status: 404 })
      const afspraak = a as { id: string; lead_id: string | null; aanwezigheid: string | null; verantwoordelijke_id: string | null }
      if (soort === 'aanwezigheid') {
        const nieuw = b.waarde === 'gehouden' || b.waarde === 'niet_gehouden' ? b.waarde : null
        if (nieuw === afspraak.aanwezigheid) return NextResponse.json({ ok: true })
        const eersteBevestiging = afspraak.aanwezigheid === null && nieuw !== null
        const magZelf = eersteBevestiging && afspraak.verantwoordelijke_id === actor.id
        if (!isAdmin && !magZelf) return NextResponse.json({ error: 'Enkel een admin (of de verantwoordelijke bij de eerste bevestiging) kan dit aanpassen.' }, { status: 403 })
        if (!eersteBevestiging && !reden) return NextResponse.json({ error: 'Geef een reden voor deze correctie.' }, { status: 400 })
        const { error } = await admin.from('sales_appointments').update({ aanwezigheid: nieuw, aanwezigheid_op: nieuw ? nu : null, aanwezigheid_door: nieuw ? actor.id : null }).eq('id', id)
        if (error) throw new Error(error.message)
        const label = (v: string | null) => (v === 'gehouden' ? 'gehouden' : v === 'niet_gehouden' ? 'niet gehouden' : 'onbekend')
        await log('afspraak', afspraak.lead_id, { aanwezigheid: afspraak.aanwezigheid }, { aanwezigheid: nieuw }, eersteBevestiging ? `Afspraak bevestigd als ${label(nieuw)}` : `Correctie afspraak: ${label(afspraak.aanwezigheid)} → ${label(nieuw)}`, reden || (eersteBevestiging ? 'Eerste bevestiging' : ''))
        return NextResponse.json({ ok: true })
      }
      if (!isAdmin) return NextResponse.json({ error: 'Enkel een admin kan de verantwoordelijke corrigeren.' }, { status: 403 })
      const nieuw = b.waarde && UUID.test(String(b.waarde)) ? String(b.waarde) : null
      if (nieuw === afspraak.verantwoordelijke_id) return NextResponse.json({ ok: true })
      if (!reden) return NextResponse.json({ error: 'Geef een reden voor deze correctie.' }, { status: 400 })
      const { error } = await admin.from('sales_appointments').update({ verantwoordelijke_id: nieuw }).eq('id', id)
      if (error) throw new Error(error.message)
      await log('afspraak', afspraak.lead_id, { verantwoordelijke_id: afspraak.verantwoordelijke_id }, { verantwoordelijke_id: nieuw }, 'Correctie: verantwoordelijke van de afspraak gewijzigd', reden)
      return NextResponse.json({ ok: true })
    }

    if (soort === 'activiteit_medewerker' || soort === 'activiteit_ongeldig') {
      if (!isAdmin) return NextResponse.json({ error: 'Enkel een admin kan registraties corrigeren.' }, { status: 403 })
      if (!reden) return NextResponse.json({ error: 'Geef een reden voor deze correctie.' }, { status: 400 })
      const { data: r } = await admin.from('sales_activiteiten').select('id, lead_id, medewerker_id, type, verwijderd_op').eq('id', id).maybeSingle()
      if (!r) return NextResponse.json({ error: 'Registratie niet gevonden' }, { status: 404 })
      const act = r as { id: string; lead_id: string; medewerker_id: string | null; type: string; verwijderd_op: string | null }
      const wat = act.type === 'telefoongesprek' ? 'gesprek' : 'faseverplaatsing'
      if (soort === 'activiteit_ongeldig') {
        if (act.verwijderd_op) return NextResponse.json({ ok: true })
        // Zacht: de rij blijft bestaan (geschiedenis), maar telt niet meer mee.
        const { error } = await admin.from('sales_activiteiten').update({ verwijderd_op: nu }).eq('id', id)
        if (error) throw new Error(error.message)
        await log('activiteit', act.lead_id, { geldig: true }, { geldig: false }, `Correctie: ${wat} als foutief gemarkeerd`, reden)
        return NextResponse.json({ ok: true })
      }
      const nieuw = b.waarde && UUID.test(String(b.waarde)) ? String(b.waarde) : null
      if (!nieuw) return NextResponse.json({ error: 'Kies een medewerker.' }, { status: 400 })
      if (nieuw === act.medewerker_id) return NextResponse.json({ ok: true })
      const { error } = await admin.from('sales_activiteiten').update({ medewerker_id: nieuw, medewerker_email: null }).eq('id', id)
      if (error) throw new Error(error.message)
      await log('activiteit', act.lead_id, { medewerker_id: act.medewerker_id }, { medewerker_id: nieuw }, `Correctie: ${wat} toegeschreven aan een andere medewerker`, reden)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Onbekende correctie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
