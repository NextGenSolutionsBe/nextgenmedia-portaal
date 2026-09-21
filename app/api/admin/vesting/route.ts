import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { volgendNr, wamSchema, DIENSTEN, FREQUENTIES, type Frequentie } from '@/lib/vesting'
import { inclFromExcl } from '@/lib/invoices'

export const dynamic = 'force-dynamic'

/**
 * Vestigingsprincipe — contracten, WAM-portefeuille, kosten en instellingen.
 *
 * ADMIN-ONLY. Hier staat de aandelenverdeling tussen de zaakvoerders; dat is
 * niets voor een setter of een medewerker, ook niet om te lezen.
 *
 * Eén route met een `resource`-veld in plaats van vijf routes: de tabellen
 * hebben exact dezelfde levenscyclus (toevoegen, wijzigen, verwijderen) en één
 * scherm bedient ze allemaal. Elke resource heeft een eigen witte lijst van
 * velden — wat daar niet op staat, komt niet in de databank.
 *
 * WAM-facturatie: een WAM-klant heeft een facturatieschema (start, looptijd,
 * bedrag per factuur, frequentie). Daaruit worden TERMIJNEN afgeleid. Een
 * termijn die nog 'gepland' is volgt het schema; zodra er een factuur voor
 * bestaat (gefactureerd/betaald) raakt het schema er nooit meer aan.
 */

type Resource = 'contract' | 'wam' | 'kost' | 'instellingen' | 'termijn'
const TABEL: Record<Resource, string> = {
  contract: 'vesting_contracten', wam: 'vesting_wam', kost: 'vesting_wam_kosten',
  instellingen: 'vesting_instellingen', termijn: 'vesting_wam_termijnen',
}

const STATUSSEN = ['actief', 'voltooid', 'stopgezet', 'niet_betaler']
const MODELLEN = ['maandcontract', 'eenmalig']
const TERMIJN_STATUSSEN = ['gepland', 'gefactureerd', 'betaald', 'geannuleerd']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const tekst = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }
const uuid = (v: unknown): string | null => { const s = tekst(v); return s && UUID.test(s) ? s : null }
const getal = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const x = Number(String(v).replace(',', '.'))
  return Number.isFinite(x) ? x : null
}
const datum = (v: unknown): string | null => {
  const s = tekst(v); if (!s) return null
  const d = new Date(s.slice(0, 10) + 'T00:00:00')
  return Number.isFinite(d.getTime()) ? s.slice(0, 10) : null
}
const ja = (v: unknown): boolean => v === true || v === 'true' || v === 'ja' || v === 1 || v === '1'
const vandaag = () => new Date().toISOString().slice(0, 10)

type Admin = ReturnType<typeof createAdminSupabaseClient>

/** De velden van één resource uit het verzoek halen — en NIETS anders. */
function velden(resource: Resource, b: Record<string, unknown>, bijAanmaak: boolean): { rij: Record<string, unknown>; fout?: string } {
  const rij: Record<string, unknown> = {}
  const heeft = (k: string) => b[k] !== undefined

  if (resource === 'contract') {
    if (heeft('klant')) rij.klant = tekst(b.klant)
    if (heeft('client_id')) rij.client_id = uuid(b.client_id)
    if (heeft('contract_id')) rij.contract_id = uuid(b.contract_id)
    if (heeft('ondertekend_op')) rij.ondertekend_op = datum(b.ondertekend_op)
    if (heeft('start_dienst')) rij.start_dienst = datum(b.start_dienst)
    if (heeft('einde_dienst')) rij.einde_dienst = datum(b.einde_dienst)
    if (heeft('dienst')) rij.dienst = tekst(b.dienst)
    if (heeft('facturatiemodel')) rij.facturatiemodel = MODELLEN.includes(String(b.facturatiemodel)) ? b.facturatiemodel : 'maandcontract'
    if (heeft('maandbedrag')) rij.maandbedrag = getal(b.maandbedrag)
    if (heeft('duur_maanden')) rij.duur_maanden = getal(b.duur_maanden)
    if (heeft('handmatige_totaalwaarde')) rij.handmatige_totaalwaarde = getal(b.handmatige_totaalwaarde)
    if (heeft('uitgesloten_kosten')) rij.uitgesloten_kosten = getal(b.uitgesloten_kosten) ?? 0
    if (heeft('status')) rij.status = STATUSSEN.includes(String(b.status)) ? b.status : 'actief'
    if (heeft('betalingen_op_schema')) rij.betalingen_op_schema = ja(b.betalingen_op_schema)
    if (heeft('appointment_door_marco')) rij.appointment_door_marco = ja(b.appointment_door_marco)
    if (heeft('closed_door_marco')) rij.closed_door_marco = ja(b.closed_door_marco)
    if (heeft('laatste_betaalde_maand')) rij.laatste_betaalde_maand = datum(b.laatste_betaalde_maand)
    if (heeft('reden_stop')) rij.reden_stop = tekst(b.reden_stop)
    if (heeft('notitie')) rij.notitie = tekst(b.notitie)
    if (heeft('nr')) rij.nr = tekst(b.nr)

    if (bijAanmaak) {
      if (!rij.klant) return { rij, fout: 'Klant is verplicht.' }
      if (!rij.ondertekend_op) return { rij, fout: 'De ondertekeningsdatum is verplicht — die bepaalt het contractjaar.' }
    }
    if (rij.dienst && !(DIENSTEN as readonly string[]).includes(String(rij.dienst))) rij.dienst = 'Andere'
    // Een stop zonder laatste betaalde maand is onvolledig, maar niet fout:
    // dan telt de hele contractwaarde als uitgevallen. Dat toont het scherm.
    return { rij }
  }

  if (resource === 'wam') {
    if (heeft('klant')) rij.klant = tekst(b.klant)
    if (heeft('client_id')) rij.client_id = uuid(b.client_id)
    if (heeft('contractwaarde')) rij.contractwaarde = getal(b.contractwaarde) ?? 0
    if (heeft('netto_ontvangen')) rij.netto_ontvangen = getal(b.netto_ontvangen) ?? 0
    if (heeft('status')) rij.status = STATUSSEN.includes(String(b.status)) ? b.status : 'actief'
    if (heeft('betalingen_op_schema')) rij.betalingen_op_schema = ja(b.betalingen_op_schema)
    if (heeft('notitie')) rij.notitie = tekst(b.notitie)
    if (heeft('nr')) rij.nr = tekst(b.nr)
    // Het facturatieschema.
    if (heeft('start_datum')) rij.start_datum = datum(b.start_datum)
    if (heeft('contract_maanden')) rij.contract_maanden = getal(b.contract_maanden)
    if (heeft('bedrag_per_factuur')) rij.bedrag_per_factuur = getal(b.bedrag_per_factuur)
    if (heeft('frequentie')) rij.frequentie = FREQUENTIES.some((f) => f.key === b.frequentie) ? (b.frequentie as Frequentie) : null
    if (heeft('btw_pct')) rij.btw_pct = getal(b.btw_pct) ?? 21
    if (heeft('omschrijving')) rij.omschrijving = tekst(b.omschrijving)
    if (bijAanmaak && !rij.klant) return { rij, fout: 'Klant is verplicht.' }
    if (rij.bedrag_per_factuur !== undefined && rij.bedrag_per_factuur !== null && Number(rij.bedrag_per_factuur) < 0) return { rij, fout: 'Het bedrag per factuur kan niet negatief zijn.' }
    return { rij }
  }

  if (resource === 'kost') {
    if (heeft('datum')) rij.datum = datum(b.datum)
    if (heeft('omschrijving')) rij.omschrijving = tekst(b.omschrijving)
    if (heeft('bedrag')) rij.bedrag = getal(b.bedrag) ?? 0
    if (bijAanmaak && !rij.omschrijving) return { rij, fout: 'Omschrijving is verplicht.' }
    return { rij }
  }

  if (resource === 'termijn') {
    if (bijAanmaak && heeft('wam_id')) rij.wam_id = uuid(b.wam_id)
    if (heeft('periode')) { const p = tekst(b.periode)?.slice(0, 7) ?? null; rij.periode = p && /^\d{4}-\d{2}$/.test(p) ? p : null }
    if (heeft('factuurdatum')) rij.factuurdatum = datum(b.factuurdatum)
    if (heeft('bedrag_excl')) rij.bedrag_excl = getal(b.bedrag_excl)
    if (heeft('btw_pct')) rij.btw_pct = getal(b.btw_pct) ?? 21
    if (heeft('status')) rij.status = TERMIJN_STATUSSEN.includes(String(b.status)) ? b.status : 'gepland'
    if (heeft('betaald_op')) rij.betaald_op = datum(b.betaald_op)
    if (heeft('notitie')) rij.notitie = tekst(b.notitie)
    if (bijAanmaak) {
      if (!rij.wam_id) return { rij, fout: 'wam_id ontbreekt.' }
      if (!rij.factuurdatum) return { rij, fout: 'De factuurdatum is verplicht.' }
      if (!rij.bedrag_excl || Number(rij.bedrag_excl) <= 0) return { rij, fout: 'Het bedrag is verplicht.' }
      if (!rij.periode) rij.periode = String(rij.factuurdatum).slice(0, 7)
    }
    if (rij.bedrag_excl !== undefined && rij.bedrag_excl !== null && Number(rij.bedrag_excl) < 0) return { rij, fout: 'Het bedrag kan niet negatief zijn.' }
    return { rij }
  }

  // instellingen
  for (const k of ['max_aandeel_marco', 'vast_aandeel_chiara', 'startaandeel_marco', 'startaandeel_bram',
    'wam_bedrag_per_pct', 'wam_max_aandeel', 'regulier_tarief', 'einde_goedkope_schijf',
    'jaar1_tarief', 'jaar2_tarief', 'jaar3_tarief']) {
    if (heeft(k)) { const g = getal(b[k]); if (g !== null) rij[k] = g }
  }
  for (const k of ['jaar1_start', 'jaar1_eind', 'jaar2_start', 'jaar2_eind', 'jaar3_start', 'jaar3_eind']) {
    if (heeft(k)) { const d = datum(b[k]); if (d) rij[k] = d }
  }
  return { rij }
}

function resourceVan(v: unknown): Resource | null {
  return v === 'contract' || v === 'wam' || v === 'kost' || v === 'instellingen' || v === 'termijn' ? v : null
}

// Veerkrachtig insert: een (nog niet gemigreerde) kolom die ontbreekt wordt
// weggelaten en het insert opnieuw geprobeerd — zelfde aanpak als bij Facturen.
async function veiligInsertId(admin: Admin, tabel: string, rij: Record<string, unknown>): Promise<string> {
  const r: Record<string, unknown> = { ...rij }
  for (let i = 0; i < 6; i++) {
    const { data, error } = await admin.from(tabel).insert(r).select('id').single()
    if (!error) return data.id as string
    const kol = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (kol && kol in r) { delete r[kol]; continue }
    throw new Error(error.message)
  }
  throw new Error('Insert mislukt')
}

type TermijnRij = {
  id: string; wam_id: string; volgnr: number; periode: string; factuurdatum: string
  bedrag_excl: number | string; btw_pct: number | string; status: string; invoice_id: string | null; clickup_task_id: string | null
}

/**
 * De termijnen van een WAM-klant gelijktrekken met het schema.
 *
 * Geplande termijnen volgen het schema (bedrag, datum, aantal). Termijnen met
 * een factuur (gefactureerd/betaald) of die bewust geannuleerd zijn, blijven
 * exact zoals ze zijn — anders zou een tikfout in de looptijd een verstuurde
 * factuur uit de boeken laten verdwijnen.
 */
async function synchroniseerTermijnen(admin: Admin, wamId: string): Promise<void> {
  const { data: wam } = await admin.from('vesting_wam').select('*').eq('id', wamId).maybeSingle()
  if (!wam) return
  const schema = wamSchema({
    start_datum: (wam.start_datum as string | null) ?? null,
    contract_maanden: getal(wam.contract_maanden),
    bedrag_per_factuur: getal(wam.bedrag_per_factuur),
    frequentie: (wam.frequentie as Frequentie | null) ?? null,
    btw_pct: getal(wam.btw_pct) ?? 21,
  })
  const { data: bestaand } = await admin.from('vesting_wam_termijnen').select('*').eq('wam_id', wamId)
  const huidig = (bestaand ?? []) as TermijnRij[]
  const perVolgnr = new Map(huidig.map((t) => [t.volgnr, t]))
  const nu = new Date().toISOString()

  for (const s of schema) {
    const t = perVolgnr.get(s.volgnr)
    if (!t) {
      await admin.from('vesting_wam_termijnen').insert({ wam_id: wamId, ...s, status: 'gepland' })
    } else if (t.status === 'gepland') {
      await admin.from('vesting_wam_termijnen').update({ periode: s.periode, factuurdatum: s.factuurdatum, bedrag_excl: s.bedrag_excl, btw_pct: s.btw_pct, updated_at: nu }).eq('id', t.id)
    }
  }
  // Geplande termijnen die buiten het (ingekorte of gewiste) schema vallen.
  const teVer = huidig.filter((t) => t.status === 'gepland' && !t.invoice_id && t.volgnr > schema.length).map((t) => t.id)
  if (teVer.length) await admin.from('vesting_wam_termijnen').delete().in('id', teVer)
}

/** Een echte factuur voor één termijn: rij in Facturen (en dus in de planner). */
async function factureerTermijn(admin: Admin, termijnId: string, actorId: string): Promise<{ invoiceId: string; waarschuwing: string | null }> {
  const { data: t } = await admin.from('vesting_wam_termijnen').select('*').eq('id', termijnId).maybeSingle()
  if (!t) throw new Error('Termijn niet gevonden.')
  if (t.invoice_id) throw new Error('Voor deze termijn bestaat al een factuur.')
  if (t.status === 'geannuleerd') throw new Error('Deze termijn is geannuleerd. Zet ze eerst terug op gepland.')
  const { data: wam } = await admin.from('vesting_wam').select('*').eq('id', t.wam_id).maybeSingle()
  if (!wam) throw new Error('WAM-klant niet gevonden.')

  const excl = getal(t.bedrag_excl) ?? 0
  const btw = getal(t.btw_pct) ?? 21
  const incl = inclFromExcl(excl, btw)
  const factuurdatum = String(t.factuurdatum).slice(0, 10)
  const periode = String(t.periode).slice(0, 7)

  // Klantnaam: uit het klantenbestand als de WAM-klant gekoppeld is, anders de vrije naam.
  let klantnaam = String(wam.klant ?? 'WAM-klant')
  if (wam.client_id) {
    const { data: c } = await admin.from('clients').select('company_name').eq('id', wam.client_id).maybeSingle()
    if (c?.company_name) klantnaam = String(c.company_name)
  }

  const omschrijving = [`WAM ${wam.nr ?? ''}`.trim(), klantnaam, wam.omschrijving ? String(wam.omschrijving) : null, `termijn ${t.volgnr} · ${periode}`].filter(Boolean).join(' · ')

  // kind 'wam': dit is omzet van Marco's WAM-portefeuille, geen NGM-klantomzet.
  // Financiën telt enkel kind 'client'; zo blijft de NGM-omzet zuiver.
  const invoiceId = await veiligInsertId(admin, 'invoices', {
    client_id: wam.client_id ?? null, service_slug: null, invoice_month: periode, invoice_date: factuurdatum,
    description: omschrijving, amount_excl: excl, vat_pct: btw, amount_incl: incl,
    status: 'te_versturen', created_by: actorId,
    kind: 'wam', source: 'vesting', wam_id: wam.id, contract_bedrag_excl: excl, currency: 'EUR',
  })
  await admin.from('vesting_wam_termijnen').update({
    status: 'gefactureerd', invoice_id: invoiceId, updated_at: new Date().toISOString(),
  }).eq('id', termijnId)
  try { revalidatePath('/admin/invoices') } catch { }
  return { invoiceId, waarschuwing: null }
}

/** Alles wat het scherm over de WAM-termijnen en de Contractenmodule nodig heeft. */
async function extraLezen(admin: Admin) {
  const [termijnen, moduleContracten] = await Promise.all([
    admin.from('vesting_wam_termijnen').select('*').order('factuurdatum').order('volgnr'),
    admin.from('contracts').select('id, title, status, client_id, start_date, end_date, signed_at, service_slug, clients ( company_name )').order('created_at', { ascending: false }).limit(500),
  ])
  return { termijnen: termijnen.data ?? [], moduleContracten: moduleContracten.data ?? [] }
}

// GET — alles wat het scherm nodig heeft, in één keer.
export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const [inst, contracten, wam, kosten, oud, extra] = await Promise.all([
      admin.from('vesting_instellingen').select('*').eq('id', 1).maybeSingle(),
      admin.from('vesting_contracten').select('*').order('ondertekend_op').order('nr'),
      admin.from('vesting_wam').select('*').order('nr'),
      admin.from('vesting_wam_kosten').select('*').order('datum'),
      // De registraties van vóór dit model. Ze tellen niet mee, maar blijven
      // zichtbaar zodat niemand hoeft te zoeken waar ze gebleven zijn.
      admin.from('vesting_revenue').select('*').order('entry_date'),
      extraLezen(admin),
    ])
    return NextResponse.json({
      instellingen: inst.data ?? null,
      contracten: contracten.data ?? [],
      wam: wam.data ?? [],
      kosten: kosten.data ?? [],
      oudeRegistraties: oud.data ?? [],
      termijnen: extra.termijnen,
      moduleContracten: extra.moduleContracten,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuw contract, WAM-klant, kost of termijn; of een factuur voor een termijn.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json() as Record<string, unknown>
    const resource = resourceVan(b.resource)
    if (!resource || resource === 'instellingen') return NextResponse.json({ error: 'Onbekende resource' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)

    // Factuur aanmaken voor een bestaande termijn.
    if (resource === 'termijn' && b.action === 'factuur') {
      const id = uuid(b.id)
      if (!id) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })
      const { invoiceId, waarschuwing } = await factureerTermijn(admin, id, actor.id)
      await logAudit({
        action: 'vesting.termijn.factuur', entityType: 'vesting_wam_termijnen', entityId: id,
        summary: `Vesting: factuur aangemaakt voor WAM-termijn (factuur ${invoiceId})`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
        ip: meta.ip, userAgent: meta.userAgent,
      })
      return NextResponse.json({ ok: true, invoice_id: invoiceId, warning: waarschuwing })
    }

    const { rij, fout } = velden(resource, b, true)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })

    // Nummer automatisch, tenzij er bewust een meegegeven is.
    if ((resource === 'contract' || resource === 'wam') && !rij.nr) {
      const { data } = await admin.from(TABEL[resource]).select('nr')
      rij.nr = volgendNr(((data ?? []) as { nr: string }[]).map((r) => r.nr), resource === 'contract' ? 'C' : 'CW')
    }
    // Een losse extra termijn krijgt het volgende volgnummer.
    if (resource === 'termijn') {
      const { data } = await admin.from(TABEL.termijn).select('volgnr').eq('wam_id', String(rij.wam_id))
      rij.volgnr = Math.max(0, ...((data ?? []) as { volgnr: number }[]).map((t) => Number(t.volgnr) || 0)) + 1
      rij.status = 'gepland'
    }

    // Enkel contracten en WAM-klanten hebben een nummer. Kosten en termijnen
    // niet — `select('id, nr')` op die tabellen werd `RETURNING id, nr` en gaf
    // "column nr does not exist", waardoor elke nieuwe kost strandde (niets
    // opgeslagen, wel een foutmelding).
    const metNr = resource === 'contract' || resource === 'wam'
    const { data, error } = metNr
      ? await admin.from(TABEL[resource]).insert(rij).select('id, nr').maybeSingle()
      : await admin.from(TABEL[resource]).insert(rij).select('id').maybeSingle()
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return NextResponse.json({ error: 'Dat nummer bestaat al.' }, { status: 409 })
      throw new Error(error.message)
    }
    const rijTerug = data as unknown as { id?: string; nr?: string } | null
    const nieuwId = rijTerug?.id ?? null
    if (resource === 'wam' && nieuwId) await synchroniseerTermijnen(admin, nieuwId)

    await logAudit({
      action: `vesting.${resource}.create`, entityType: TABEL[resource], entityId: nieuwId,
      summary: `Vesting: ${resource} toegevoegd${rijTerug?.nr ? ` (${rijTerug.nr})` : ''}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id: nieuwId })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — bestaande rij wijzigen, of de instellingen.
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json() as Record<string, unknown>
    const resource = resourceVan(b.resource)
    if (!resource) return NextResponse.json({ error: 'Onbekende resource' }, { status: 400 })

    const { rij, fout } = velden(resource, b, false)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })
    if (Object.keys(rij).length === 0) return NextResponse.json({ ok: true })
    rij.updated_at = new Date().toISOString()

    const admin = createAdminSupabaseClient()
    let error: { message: string } | null = null
    const id = tekst(b.id)
    if (resource === 'instellingen') {
      ;({ error } = await admin.from(TABEL.instellingen).upsert({ id: 1, ...rij }, { onConflict: 'id' }))
    } else {
      if (!id) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })
      if (resource === 'kost') delete rij.updated_at   // die tabel heeft geen updated_at

      if (resource === 'termijn') {
        const { data: oud } = await admin.from(TABEL.termijn).select('*').eq('id', id).maybeSingle()
        if (!oud) return NextResponse.json({ error: 'Termijn niet gevonden.' }, { status: 404 })
        const nieuweStatus = (rij.status as string | undefined) ?? String(oud.status)
        // Betaald zonder datum = vandaag; niet meer betaald = datum weg.
        if (nieuweStatus === 'betaald' && !rij.betaald_op && !oud.betaald_op) rij.betaald_op = vandaag()
        if (nieuweStatus !== 'betaald' && rij.status !== undefined) rij.betaald_op = null
        // Terug naar 'gepland' kan enkel zonder factuur; met factuur is het minstens 'gefactureerd'.
        if (nieuweStatus === 'gepland' && oud.invoice_id) rij.status = 'gefactureerd'
        // Annuleren met factuur: de factuur mee annuleren.
        if (nieuweStatus === 'geannuleerd' && oud.invoice_id && oud.status !== 'geannuleerd') {
          await admin.from('invoices').update({ status: 'geannuleerd', updated_at: rij.updated_at }).eq('id', oud.invoice_id)
          try { revalidatePath('/admin/invoices') } catch { }
        }
      }
      ;({ error } = await admin.from(TABEL[resource]).update(rij).eq('id', id))
      if (!error && resource === 'wam') await synchroniseerTermijnen(admin, id)
    }
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return NextResponse.json({ error: 'Dat nummer bestaat al.' }, { status: 409 })
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: `vesting.${resource}.update`, entityType: TABEL[resource], entityId: id,
      summary: `Vesting: ${resource} gewijzigd (${Object.keys(rij).filter((k) => k !== 'updated_at').join(', ')})`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?resource=&id=
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const resource = resourceVan(req.nextUrl.searchParams.get('resource'))
    const id = req.nextUrl.searchParams.get('id')
    if (!resource || resource === 'instellingen' || !id) return NextResponse.json({ error: 'resource en id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    if (resource === 'termijn') {
      const { data: t } = await admin.from(TABEL.termijn).select('invoice_id').eq('id', id).maybeSingle()
      if (t?.invoice_id) return NextResponse.json({ error: 'Deze termijn heeft al een factuur. Annuleer ze in plaats van ze te verwijderen.' }, { status: 409 })
    }
    if (resource === 'wam') {
      // Een WAM-klant met facturen verdwijnt niet zomaar; de facturen zouden hun herkomst verliezen.
      const { count } = await admin.from(TABEL.termijn).select('id', { count: 'exact', head: true }).eq('wam_id', id).not('invoice_id', 'is', null)
      if ((count ?? 0) > 0) return NextResponse.json({ error: 'Deze WAM-klant heeft al facturen. Zet de status op stopgezet in plaats van te verwijderen.' }, { status: 409 })
    }
    const { error } = await admin.from(TABEL[resource]).delete().eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: `vesting.${resource}.delete`, entityType: TABEL[resource], entityId: id,
      summary: `Vesting: ${resource} verwijderd`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
