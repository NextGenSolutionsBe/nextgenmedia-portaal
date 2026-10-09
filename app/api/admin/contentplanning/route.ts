import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { leesActorNamen } from '@/lib/actor-namen'
import {
  leesCp, beurtenMetBord, bordVanKlant, teMakenTaken, isReeks, plusDagen, maandVan, plusMaanden, maandEind, werkdagenVanMaand, FASE_KEYS, STANDAARD_CP,
  type ActiviteitRitme, type CpInstellingen, type Ritme, type Reeks,
} from '@/lib/contentplanning/model'

export const dynamic = 'force-dynamic'

/**
 * Contentplanning — één werkruimte voor Chiara’s contentworkflow (module
 * "Informatief", waar ook de Maandplanning leeft).
 *  · bekijken/aanpassen (bevoegde teamleden): taken uitvoeren, notities, routine-checks
 *  · instellingen (Chiara/hoofdbeheerders): klanten in de planning, ritmes,
 *    batches, cycli klaarzetten/pauzeren/archiveren, sjablonen en statussen
 * Klanten = de bestaande clients; batch = clients.batch_id + batches.
 * Verwijderen is altijd zacht (herstelbaar); een bewust verwijderde
 * sjabloontaak wordt nooit opnieuw aangemaakt.
 */

const UUID = /^[0-9a-f-]{36}$/i
const DAG = /^\d{4}-\d{2}-\d{2}$/
const YM = /^\d{4}-\d{2}$/
const tekst = (v: unknown, max = 500): string | null => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null }
const dag = (v: unknown): string | null | undefined => (v === null || v === '' ? null : typeof v === 'string' && DAG.test(v) ? v : undefined)
const uuid = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v) ? v : null)
const SLEUTEL = 'contentplanning'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

async function leesInstellingenCp(admin: Admin): Promise<CpInstellingen> {
  const { data } = await admin.from('app_settings').select('value').eq('key', SLEUTEL).maybeSingle()
  return leesCp(data?.value)
}

/** Wie mag wat? Hoofdbeheerder altijd; anders via de rechtenmatrix van module "info". */
async function rechten() {
  const [bekijken, aanpassen, beheren] = await Promise.all([magIk('info', 'bekijken'), magIk('info', 'aanpassen'), magIk('info', 'instellingen')])
  const p = bekijken ?? aanpassen ?? beheren
  return { persoon: p, bekijken: !!bekijken, aanpassen: !!aanpassen, beheren: !!beheren || !!p?.isAdmin }
}
const wie = (p: { naam?: string | null; email?: string | null } | null) => p?.naam || p?.email?.split('@')[0] || null

export async function GET(req: NextRequest) {
  try {
    const r = await rechten()
    if (!r.bekijken) return NextResponse.json({ error: 'Geen toegang tot de contentplanning.' }, { status: 403 })
    const sp = req.nextUrl.searchParams
    const van = sp.get('van') ?? '', tot = sp.get('tot') ?? ''
    if (!DAG.test(van) || !DAG.test(tot) || van > tot) return NextResponse.json({ error: 'Ongeldige periode.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const ruimVan = plusDagen(van, -200)
    const maandVanaf = plusMaanden(maandVan(van), -6), maandTot = plusMaanden(maandVan(tot), 3)
    const [inst, { data: batches }, { data: klanten }, { data: cpKlanten }, { data: cycli }, { data: taken }, { data: notities }, { data: checks }, { data: fases }, { data: staff }, { data: admins }, { data: bord }, { data: social }, { data: meetings }] = await Promise.all([
      leesInstellingenCp(admin),
      admin.from('batches').select('*').order('sort_order').order('name'),
      admin.from('clients').select('id, company_name, batch_id, contact_name, email').is('archived_at', null).order('company_name'),
      admin.from('cp_klanten').select('*'),
      admin.from('cp_cycli').select('*').gte('maand', maandVanaf).lte('maand', maandTot),
      admin.from('cp_taken').select('*').is('verwijderd_op', null).or(`werkdatum.is.null,werkdatum.gte.${ruimVan},deadline.gte.${ruimVan}`).order('werkdatum', { nullsFirst: false }).order('volgorde'),
      admin.from('cp_notities').select('*').is('verwijderd_op', null).order('vastgepind', { ascending: false }).order('updated_at', { ascending: false }).limit(1000),
      admin.from('cp_routine_checks').select('*').gte('datum', plusDagen(van, -7)).lte('datum', tot),
      admin.from('month_planning_overrides').select('plan_date, categories').gte('plan_date', `${maandVan(van)}-01`).lte('plan_date', plusDagen(tot, 31)),
      admin.from('staff_members').select('name, auth_user_id, active, verwijderd_at').eq('active', true).is('verwijderd_at', null),
      admin.from('user_roles').select('user_id').eq('role', 'admin'),
      // Klantenbatches: welke reeks doet welke klant in welke maand.
      admin.from('cp_maand_reeksen').select('*').gte('maand', maandVanaf).lte('maand', maandTot),
      // Alle klanten met de dienst social media (de rijen van het bord).
      admin.from('client_services').select('client_id, active').eq('service_slug', 'social-media'),
      // Reeks 3: meetings voor de volgende maand (per klant: nodig / niet nodig / ingepland).
      admin.from('cp_meeting_planning').select('*').gte('maand', maandVanaf).lte('maand', maandTot),
    ])
    // Mensen om taken aan toe te wijzen: de hoofdbeheerders + actieve werknemers.
    let mensen: string[] = []
    try {
      const namen = await leesActorNamen(admin as never, ((admins ?? []) as { user_id: string }[]).map((a) => a.user_id))
      mensen = [...new Set([...Object.values(namen).map((n) => n.kort), ...((staff ?? []) as { name: string | null }[]).map((s) => (s.name ?? '').split(' ')[0])].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'nl'))
    } catch { /* lijst is een gemak, geen vereiste */ }
    return NextResponse.json({
      instellingen: inst, batches: batches ?? [], klanten: klanten ?? [], cpKlanten: cpKlanten ?? [], cycli: cycli ?? [], taken: taken ?? [],
      notities: notities ?? [], checks: checks ?? [],
      faseAanpassingen: Object.fromEntries(((fases ?? []) as { plan_date: string; categories: string[] }[]).map((f) => [String(f.plan_date).slice(0, 10), f.categories])),
      mensen, kan: { aanpassen: r.aanpassen, beheren: r.beheren }, ik: wie(r.persoon),
      bord: bord ?? [], meetings: meetings ?? [], socialKlanten: [...new Set(((social ?? []) as { client_id: string; active: boolean | null }[]).filter((x) => x.active !== false).map((x) => x.client_id))],
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** Taakvelden uit de invoer — enkel wat op de witte lijst staat. */
function taakVelden(b: Record<string, unknown>): { velden: Record<string, unknown>; fout?: string } {
  const v: Record<string, unknown> = {}
  if ('titel' in b) { const t = tekst(b.titel, 300); if (!t) return { velden: v, fout: 'Geef de taak een titel.' }; v.titel = t }
  if ('onderdeel' in b) v.onderdeel = tekst(b.onderdeel, 60) ?? 'los'
  if ('reeks' in b) v.reeks = isReeks(Number(b.reeks)) ? Number(b.reeks) : null
  for (const k of ['werkdatum', 'deadline', 'startmoment'] as const) if (k in b) { const d = dag(b[k]); if (d === undefined) return { velden: v, fout: 'Ongeldige datum.' }; v[k] = d }
  if ('verantwoordelijke' in b) v.verantwoordelijke = tekst(b.verantwoordelijke, 120)
  if ('status' in b) v.status = tekst(b.status, 60) ?? 'nog_in_te_plannen'
  if ('client_id' in b) v.client_id = uuid(b.client_id)
  if ('cyclus_id' in b) v.cyclus_id = uuid(b.cyclus_id)
  return { velden: v }
}

export async function POST(req: NextRequest) {
  try {
    const r = await rechten()
    if (!r.aanpassen && !r.beheren) return NextResponse.json({ error: 'Je hebt geen recht om de contentplanning aan te passen.' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const actie = String(b.actie ?? '')
    const admin = createAdminSupabaseClient()
    const nu = new Date().toISOString()
    const ik = wie(r.persoon)
    const beheer = () => (r.beheren ? null : NextResponse.json({ error: 'Enkel wie de planning beheert (Chiara of een hoofdbeheerder) kan dit aanpassen.' }, { status: 403 }))

    // ── Taken ──
    if (actie === 'taak.maak') {
      const { velden, fout } = taakVelden(b)
      if (fout) return NextResponse.json({ error: fout }, { status: 400 })
      if (!velden.titel) return NextResponse.json({ error: 'Geef de taak een titel.' }, { status: 400 })
      if (!velden.status) velden.status = velden.werkdatum ? 'ingepland' : 'nog_in_te_plannen'
      const { data, error } = await admin.from('cp_taken').insert({ ...velden, created_by: ik }).select('*').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ taak: data })
    }
    if (actie === 'taak.wijzig') {
      const id = uuid(b.id); if (!id) return NextResponse.json({ error: 'Onbekende taak.' }, { status: 400 })
      const { velden, fout } = taakVelden(b)
      if (fout) return NextResponse.json({ error: fout }, { status: 400 })
      // Een werkdatum geven aan een taak die nog in te plannen was → ingepland (tenzij de status zelf meegegeven is).
      if (velden.werkdatum && !('status' in b)) {
        const { data: oud } = await admin.from('cp_taken').select('status').eq('id', id).maybeSingle()
        if (oud?.status === 'nog_in_te_plannen') velden.status = 'ingepland'
      }
      const { data, error } = await admin.from('cp_taken').update({ ...velden, updated_at: nu }).eq('id', id).is('verwijderd_op', null).select('*').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ taak: data })
    }
    if (actie === 'taak.verwijder' || actie === 'taak.herstel') {
      const id = uuid(b.id); if (!id) return NextResponse.json({ error: 'Onbekende taak.' }, { status: 400 })
      const { data, error } = await admin.from('cp_taken').update({ verwijderd_op: actie === 'taak.verwijder' ? nu : null, updated_at: nu }).eq('id', id).select('*').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ taak: data })
    }

    // ── Notities en herinneringen ──
    if (actie === 'notitie.maak' || actie === 'notitie.wijzig') {
      const v: Record<string, unknown> = {}
      if ('tekst' in b || actie === 'notitie.maak') { const t = tekst(b.tekst, 4000); if (!t) return NextResponse.json({ error: 'Schrijf een notitie.' }, { status: 400 }); v.tekst = t }
      if ('soort' in b) v.soort = ['afspraak', 'cyclus', 'herinnering'].includes(String(b.soort)) ? b.soort : 'cyclus'
      for (const k of ['client_id', 'taak_id', 'cyclus_id', 'batch_id'] as const) if (k in b) v[k] = uuid(b[k])
      if ('reeks' in b) v.reeks = isReeks(Number(b.reeks)) ? Number(b.reeks) : null
      if ('maand' in b) v.maand = typeof b.maand === 'string' && YM.test(b.maand) ? b.maand : null
      if ('herinner_op' in b) { const d = dag(b.herinner_op); if (d === undefined) return NextResponse.json({ error: 'Ongeldige herinneringsdatum.' }, { status: 400 }); v.herinner_op = d }
      if ('vastgepind' in b) v.vastgepind = b.vastgepind === true
      if ('afgevinkt' in b) v.afgevinkt_op = b.afgevinkt === true ? nu : null
      if (v.soort === 'herinnering' && actie === 'notitie.maak' && !v.herinner_op) return NextResponse.json({ error: 'Kies de dag van de herinnering.' }, { status: 400 })
      if (actie === 'notitie.maak') {
        const { data, error } = await admin.from('cp_notities').insert({ ...v, auteur: ik }).select('*').single()
        if (error) throw new Error(error.message)
        return NextResponse.json({ notitie: data })
      }
      const id = uuid(b.id); if (!id) return NextResponse.json({ error: 'Onbekende notitie.' }, { status: 400 })
      const { data, error } = await admin.from('cp_notities').update({ ...v, updated_at: nu }).eq('id', id).select('*').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ notitie: data })
    }
    if (actie === 'notitie.verwijder' || actie === 'notitie.herstel') {
      const id = uuid(b.id); if (!id) return NextResponse.json({ error: 'Onbekende notitie.' }, { status: 400 })
      const { data, error } = await admin.from('cp_notities').update({ verwijderd_op: actie === 'notitie.verwijder' ? nu : null, updated_at: nu }).eq('id', id).select('*').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ notitie: data })
    }

    // ── Inner Stance-checks (per dag bewaard) ──
    if (actie === 'routine.check') {
      const key = tekst(b.routine_key, 80); const d = dag(b.datum)
      if (!key || !d) return NextResponse.json({ error: 'Onbekende check.' }, { status: 400 })
      if (b.aan === false) { await admin.from('cp_routine_checks').delete().eq('routine_key', key).eq('datum', d); return NextResponse.json({ ok: true }) }
      const { error } = await admin.from('cp_routine_checks').upsert({ routine_key: key, datum: d, door: ik }, { onConflict: 'routine_key,datum', ignoreDuplicates: true })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    // ── Dagelijkse werking: klant afvinken binnen een reeks (✓ op het bord) ──
    if (actie === 'reeksvink.zet') {
      const cid = uuid(b.client_id); const maand = typeof b.maand === 'string' && YM.test(b.maand) ? b.maand : null; const rk = Number(b.reeks)
      if (!cid || !maand || !isReeks(rk)) return NextResponse.json({ error: 'Kies klant, maand en reeks.' }, { status: 400 })
      const d = b.gedaan === false ? null : (dag(b.datum) ?? nu.slice(0, 10))
      const { data, error } = await admin.from('cp_maand_reeksen').update({ afgewerkt_op: d, afgewerkt_door: d ? ik : null }).eq('client_id', cid).eq('maand', maand).eq('reeks', rk).eq('actief', true).select('client_id')
      if (error) throw new Error(error.message)
      if (!data?.length) return NextResponse.json({ error: 'Deze klant staat deze maand niet aangevinkt in Klantenbatches voor die reeks.' }, { status: 400 })
      return NextResponse.json({ ok: true })
    }
    // ── Reeks 3: meetings voor de volgende maand inplannen ──
    if (actie === 'meetingplan.zet') {
      const cid = uuid(b.client_id); const maand = typeof b.maand === 'string' && YM.test(b.maand) ? b.maand : null
      const status = b.status === 'nodig' || b.status === 'niet_nodig' || b.status === 'ingepland' ? b.status : null
      if (!cid || !maand) return NextResponse.json({ error: 'Kies klant en maand.' }, { status: 400 })
      const { error } = status
        ? await admin.from('cp_meeting_planning').upsert({ client_id: cid, maand, status, door: ik, updated_at: nu }, { onConflict: 'client_id,maand' })
        : await admin.from('cp_meeting_planning').delete().eq('client_id', cid).eq('maand', maand)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    // ── Vanaf hier: de planning beheren ──
    const nee = beheer(); if (nee) return nee

    // Klant (on)zichtbaar op het Klantenbatches-bord — de klant en zijn diensten blijven ongewijzigd.
    if (actie === 'bord.verberg') {
      const cid = uuid(b.client_id)
      if (!cid) return NextResponse.json({ error: 'Kies een klant.' }, { status: 400 })
      const inst = await leesInstellingenCp(admin)
      const set = new Set(inst.bord_verborgen)
      if (b.verborgen === false) set.delete(cid); else set.add(cid)
      const nieuw = { ...inst, bord_verborgen: [...set] }
      const { error } = await admin.from('app_settings').upsert({ key: SLEUTEL, value: nieuw, updated_at: nu }, { onConflict: 'key' })
      if (error) throw new Error(error.message)
      return NextResponse.json({ instellingen: nieuw })
    }
    // Werkwijze (stappenplan) van één reeks of één vaste taak bewaren, zonder de rest te overschrijven.
    if (actie === 'werkwijze.opslaan') {
      const inst = await leesInstellingenCp(admin)
      const t = typeof b.tekst === 'string' ? b.tekst.slice(0, 20000) : ''
      let nieuw: CpInstellingen
      if (isReeks(Number(b.reeks))) nieuw = { ...inst, reeks_detail: { ...inst.reeks_detail, [String(b.reeks)]: t } }
      else if (typeof b.taak === 'string' && inst.vaste_taken.some((x) => x.key === b.taak)) nieuw = { ...inst, vaste_taken: inst.vaste_taken.map((x) => (x.key === b.taak ? { ...x, detail: t } : x)) }
      else return NextResponse.json({ error: 'Kies een reeks of taak.' }, { status: 400 })
      const { error } = await admin.from('app_settings').upsert({ key: SLEUTEL, value: nieuw, updated_at: nu }, { onConflict: 'key' })
      if (error) throw new Error(error.message)
      return NextResponse.json({ instellingen: nieuw })
    }

    if (actie === 'klant.voegtoe' || actie === 'klant.herstel') {
      const id = uuid(b.client_id); if (!id) return NextResponse.json({ error: 'Kies een klant.' }, { status: 400 })
      const { error } = await admin.from('cp_klanten').upsert({ client_id: id, actief: true, updated_at: nu }, { onConflict: 'client_id' })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    if (actie === 'klant.verwijder') {
      // Enkel uit de contentplanning — de klant zelf blijft in de rest van de app.
      const id = uuid(b.client_id); if (!id) return NextResponse.json({ error: 'Kies een klant.' }, { status: 400 })
      const { error } = await admin.from('cp_klanten').update({ actief: false, updated_at: nu }).eq('client_id', id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    if (actie === 'klant.wijzig') {
      const id = uuid(b.client_id); if (!id) return NextResponse.json({ error: 'Kies een klant.' }, { status: 400 })
      const scope = b.scope === 'cyclus' ? 'cyclus' : 'toekomst'
      const v: Record<string, unknown> = {}
      if ('ritme' in b) v.ritme = b.ritme === 'maandelijks' || b.ritme === 'driemaandelijks' ? b.ritme : null
      if ('activiteiten' in b && b.activiteiten && typeof b.activiteiten === 'object') {
        const a: Record<string, ActiviteitRitme> = {}
        for (const [k, w] of Object.entries(b.activiteiten as Record<string, unknown>)) if (w === 'elke_cyclus' || w === 'per_kwartaal' || w === 'nvt') a[k.slice(0, 60)] = w
        v.activiteiten = a
      }
      if ('verantwoordelijke' in b) v.verantwoordelijke = tekst(b.verantwoordelijke, 120)
      if ('goedkeuring_werkdagen' in b) v.goedkeuring_werkdagen = b.goedkeuring_werkdagen === null || b.goedkeuring_werkdagen === '' ? null : Math.max(0, Math.min(60, Math.round(Number(b.goedkeuring_werkdagen) || 0)))
      if ('afspraken' in b) v.afspraken = tekst(b.afspraken, 4000)
      if ('materiaal' in b) v.materiaal = tekst(b.materiaal, 4000)
      if ('contactpersonen' in b && Array.isArray(b.contactpersonen)) v.contactpersonen = (b.contactpersonen as Record<string, unknown>[]).slice(0, 20).map((c) => ({ naam: tekst(c.naam, 120) ?? '', rol: tekst(c.rol, 120), email: tekst(c.email, 200), telefoon: tekst(c.telefoon, 40) })).filter((c) => c.naam)
      if ('links' in b && Array.isArray(b.links)) v.links = (b.links as Record<string, unknown>[]).slice(0, 30).map((l) => ({ label: tekst(l.label, 120) ?? '', url: tekst(l.url, 800) ?? '' })).filter((l) => /^https?:\/\//i.test(l.url))
      // Ritme en activiteiten zijn terugkerende instellingen: "alleen deze cyclus" of "ook toekomstige".
      const terugkerend = 'ritme' in v || 'activiteiten' in v
      if (terugkerend && scope === 'cyclus') {
        const cid = uuid(b.cyclus_id); if (!cid) return NextResponse.json({ error: 'Kies de cyclus.' }, { status: 400 })
        const { data: c } = await admin.from('cp_cycli').select('instellingen').eq('id', cid).maybeSingle()
        const inst = { ...((c?.instellingen ?? {}) as Record<string, unknown>), ...('ritme' in v ? { ritme: v.ritme } : {}), ...('activiteiten' in v ? { activiteiten: v.activiteiten } : {}) }
        await admin.from('cp_cycli').update({ instellingen: inst, updated_at: nu }).eq('id', cid)
        delete v.ritme; delete v.activiteiten
      }
      if (Object.keys(v).length) {
        const { error } = await admin.from('cp_klanten').upsert({ client_id: id, ...v, updated_at: nu }, { onConflict: 'client_id' })
        if (error) throw new Error(error.message)
      }
      // Batch = het bestaande batchveld op de klant (geen kopie).
      if ('batch_id' in b) {
        const bid = b.batch_id ? uuid(b.batch_id) : null
        const { error } = await admin.from('clients').update({ batch_id: bid }).eq('id', id)
        if (error) throw new Error(error.message)
      }
      return NextResponse.json({ ok: true })
    }

    if (actie === 'batch.maak' || actie === 'batch.wijzig') {
      const v: Record<string, unknown> = {}
      if ('name' in b || actie === 'batch.maak') { const n = tekst(b.name, 80); if (!n) return NextResponse.json({ error: 'Geef de batch een naam.' }, { status: 400 }); v.name = n }
      if ('color' in b) v.color = /^#[0-9a-f]{6}$/i.test(String(b.color)) ? b.color : '#112546'
      if ('start_month' in b || actie === 'batch.maak') {
        const m = Number(b.start_month)
        if (b.start_month === null || b.start_month === '' || b.start_month === undefined || !Number.isFinite(m)) return NextResponse.json({ error: 'Kies de startmaand van de batch (nodig om kwartalen te bepalen).' }, { status: 400 })
        v.start_month = Math.max(0, Math.min(11, Math.round(m)))
      }
      if (actie === 'batch.maak') {
        const { data, error } = await admin.from('batches').insert({ ...v, sort_order: 99 }).select('*').single()
        if (error) throw new Error(error.message)
        return NextResponse.json({ batch: data })
      }
      const id = uuid(b.id); if (!id) return NextResponse.json({ error: 'Onbekende batch.' }, { status: 400 })
      const { data, error } = await admin.from('batches').update({ ...v, updated_at: nu }).eq('id', id).select('*').single()
      if (error) throw new Error(error.message)
      return NextResponse.json({ batch: data })
    }
    if (actie === 'batch.verwijder') {
      const id = uuid(b.id); if (!id) return NextResponse.json({ error: 'Onbekende batch.' }, { status: 400 })
      const { count } = await admin.from('clients').select('id', { count: 'exact', head: true }).eq('batch_id', id)
      if ((count ?? 0) > 0) return NextResponse.json({ error: 'Er staan nog klanten in deze batch. Verplaats ze eerst.' }, { status: 409 })
      const { error } = await admin.from('batches').delete().eq('id', id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    // ── Reeksen per maand (stap 2): bewaard als Maandplanning-aanpassingen ──
    if (actie === 'reeksen.opslaan') {
      const maand = typeof b.maand === 'string' && YM.test(b.maand) ? b.maand : null
      const dagen = b.dagen && typeof b.dagen === 'object' ? b.dagen as Record<string, unknown> : null
      if (!maand || !dagen) return NextResponse.json({ error: 'Kies de maand.' }, { status: 400 })
      const geldig = new Set(werkdagenVanMaand(maand))
      const rijen = Object.entries(dagen).filter(([d]) => geldig.has(d)).map(([d, cats]) => ({
        plan_date: d, categories: (Array.isArray(cats) ? cats : []).filter((c): c is string => typeof c === 'string' && (FASE_KEYS as string[]).includes(c)),
        updated_by: r.persoon?.userId ?? null, updated_at: nu,
      }))
      if (!rijen.length) return NextResponse.json({ error: 'Geen werkdagen om te bewaren.' }, { status: 400 })
      const { error } = await admin.from('month_planning_overrides').upsert(rijen, { onConflict: 'plan_date' })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    if (actie === 'reeksen.herstel') {
      const maand = typeof b.maand === 'string' && YM.test(b.maand) ? b.maand : null
      if (!maand) return NextResponse.json({ error: 'Kies de maand.' }, { status: 400 })
      const { error } = await admin.from('month_planning_overrides').delete().gte('plan_date', `${maand}-01`).lte('plan_date', maandEind(maand))
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    // ── Klantenbatches: ✓ / ✗ / leeg per klant, maand en reeks ──
    if (actie === 'batchbord.zet') {
      const cid = uuid(b.client_id); const maand = typeof b.maand === 'string' && YM.test(b.maand) ? b.maand : null
      const cellen = Array.isArray(b.reeksen) ? (b.reeksen as unknown[]).map(Number).filter(isReeks) : isReeks(Number(b.reeks)) ? [Number(b.reeks)] : []
      if (!cid || !maand || !cellen.length) return NextResponse.json({ error: 'Kies klant, maand en reeks.' }, { status: 400 })
      if (b.actief === null) {
        const { error } = await admin.from('cp_maand_reeksen').delete().eq('client_id', cid).eq('maand', maand).in('reeks', cellen)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await admin.from('cp_maand_reeksen').upsert(cellen.map((rk) => ({ client_id: cid, maand, reeks: rk, actief: b.actief === true, door: ik, updated_at: nu })), { onConflict: 'client_id,maand,reeks' })
        if (error) throw new Error(error.message)
        // Wie op het bord staat, hoort bij de contentplanning (de klant zelf blijft ongewijzigd).
        await admin.from('cp_klanten').upsert({ client_id: cid, actief: true, updated_at: nu }, { onConflict: 'client_id' })
      }
      return NextResponse.json({ ok: true })
    }
    if (actie === 'batchbord.kopieer') {
      // Vorige maand overnemen als vertrekpunt: enkel lege vakjes worden ingevuld.
      const van = typeof b.van === 'string' && YM.test(b.van) ? b.van : null
      const naar = typeof b.naar === 'string' && YM.test(b.naar) ? b.naar : null
      if (!van || !naar) return NextResponse.json({ error: 'Kies de maanden.' }, { status: 400 })
      const [{ data: bron }, { data: doel }] = await Promise.all([
        admin.from('cp_maand_reeksen').select('client_id, reeks, actief').eq('maand', van),
        admin.from('cp_maand_reeksen').select('client_id, reeks').eq('maand', naar),
      ])
      const bestaat = new Set(((doel ?? []) as { client_id: string; reeks: number }[]).map((x) => `${x.client_id}:${x.reeks}`))
      const nieuw = ((bron ?? []) as { client_id: string; reeks: number; actief: boolean }[]).filter((x) => !bestaat.has(`${x.client_id}:${x.reeks}`)).map((x) => ({ ...x, maand: naar, door: ik, updated_at: nu }))
      if (nieuw.length) { const { error } = await admin.from('cp_maand_reeksen').insert(nieuw); if (error) throw new Error(error.message) }
      return NextResponse.json({ ok: true, overgenomen: nieuw.length })
    }

    // Taken voor een maand klaarzetten: enkel wat aan de beurt is en nog niet bestaat.
    if (actie === 'cyclus.klaarzetten') {
      const maand = typeof b.maand === 'string' && YM.test(b.maand) ? b.maand : null
      if (!maand) return NextResponse.json({ error: 'Kies een maand.' }, { status: 400 })
      const enkel = uuid(b.client_id)
      const inst = await leesInstellingenCp(admin)
      let q = admin.from('cp_klanten').select('*').eq('actief', true)
      if (enkel) q = q.eq('client_id', enkel)
      const [{ data: kl }, { data: clients }, { data: batches }, { data: bordRijen }] = await Promise.all([q, admin.from('clients').select('id, batch_id, company_name'), admin.from('batches').select('id, start_month'), admin.from('cp_maand_reeksen').select('client_id, reeks, actief').eq('maand', maand)])
      // Klantenbatches-bord van deze maand: gaat voor op ritme en batch.
      // Eén ✓ op het bord = het bord is in gebruik → niet aangevinkt betekent "deze maand niet".
      const bordAlle = (bordRijen ?? []) as { client_id: string; reeks: Reeks; actief: boolean }[]
      const batchStart = new Map(((batches ?? []) as { id: string; start_month: number | null }[]).map((x) => [x.id, x.start_month]))
      const batchVan = new Map(((clients ?? []) as { id: string; batch_id: string | null }[]).map((c) => [c.id, c.batch_id]))
      let nieuw = 0, cycliNieuw = 0
      const ontbrekend: { client_id: string; reden: string }[] = []
      for (const k of (kl ?? []) as { client_id: string; ritme: Ritme | null; activiteiten: Record<string, ActiviteitRitme>; verantwoordelijke: string | null }[]) {
        const bid = batchVan.get(k.client_id) ?? null
        const ki = { ritme: k.ritme, activiteiten: k.activiteiten ?? {}, batch_start_maand: bid ? (batchStart.get(bid) ?? null) : null }
        // Bestaande cyclus: haar eigen momentopname telt (een wijziging "alleen deze cyclus").
        let { data: cyc } = await admin.from('cp_cycli').select('*').eq('client_id', k.client_id).eq('maand', maand).maybeSingle()
        if (cyc && cyc.status !== 'actief') continue   // gepauzeerd of gearchiveerd: niets bijmaken
        const eff = cyc ? { ...ki, ...(cyc.instellingen as Record<string, unknown>) } as typeof ki : ki
        const bt = beurtenMetBord(maand, inst.onderdelen, eff, bordVanKlant(bordAlle, k.client_id))
        const onbekend = bt.find((x) => x.aanDeBeurt === null)
        if (onbekend) ontbrekend.push({ client_id: k.client_id, reden: onbekend.reden ?? 'Instelling ontbreekt.' })
        if (!bt.some((x) => x.aanDeBeurt === true)) continue
        if (!cyc) {
          const { data: c, error } = await admin.from('cp_cycli').upsert({ client_id: k.client_id, maand, instellingen: { ritme: ki.ritme, activiteiten: ki.activiteiten, batch_id: bid }, created_by: ik }, { onConflict: 'client_id,maand', ignoreDuplicates: true }).select('*').maybeSingle()
          if (error) throw new Error(error.message)
          cyc = c ?? (await admin.from('cp_cycli').select('*').eq('client_id', k.client_id).eq('maand', maand).maybeSingle()).data
          if (c) cycliNieuw++
        }
        if (!cyc) continue
        // Ook zacht verwijderde taken tellen als "bestaand": die komen niet terug.
        const { data: bestaand } = await admin.from('cp_taken').select('sjabloon_sleutel').eq('cyclus_id', cyc.id).not('sjabloon_sleutel', 'is', null)
        const sleutels = new Set(((bestaand ?? []) as { sjabloon_sleutel: string }[]).map((x) => x.sjabloon_sleutel))
        const te = teMakenTaken(inst.onderdelen, bt, sleutels)
        if (!te.length) continue
        const { data: ins, error } = await admin.from('cp_taken').upsert(te.map((t) => ({ ...t, cyclus_id: cyc!.id, client_id: k.client_id, status: 'nog_in_te_plannen', verantwoordelijke: k.verantwoordelijke ?? null, created_by: ik })), { onConflict: 'cyclus_id,sjabloon_sleutel', ignoreDuplicates: true }).select('id')
        if (error) throw new Error(error.message)
        nieuw += ins?.length ?? 0
      }
      return NextResponse.json({ ok: true, taken: nieuw, cycli: cycliNieuw, ontbrekend })
    }
    if (actie === 'cyclus.status') {
      const id = uuid(b.id); const st = ['actief', 'gepauzeerd', 'gearchiveerd'].includes(String(b.status)) ? String(b.status) : null
      if (!id || !st) return NextResponse.json({ error: 'Onbekende cyclus of status.' }, { status: 400 })
      const { error } = await admin.from('cp_cycli').update({ status: st, updated_at: nu }).eq('id', id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    if (actie === 'instellingen.opslaan') {
      const nieuw = leesCp(b.instellingen)
      // Statussen: de vaste sleutels blijven bestaan (de logica rekent erop); labels en kleuren zijn vrij.
      for (const s of STANDAARD_CP.statussen) if (!nieuw.statussen.some((x) => x.key === s.key)) nieuw.statussen.push(s)
      nieuw.onderdelen = nieuw.onderdelen.map((o) => ({ ...o, key: String(o.key).slice(0, 60).replace(/[^a-z0-9_]/gi, '_') || `onderdeel_${Date.now()}`, label: String(o.label).slice(0, 80) || 'Onderdeel' }))
      const { error } = await admin.from('app_settings').upsert({ key: SLEUTEL, value: nieuw, updated_at: nu }, { onConflict: 'key' })
      if (error) throw new Error(error.message)
      return NextResponse.json({ instellingen: nieuw })
    }

    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
