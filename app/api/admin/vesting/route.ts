import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { volgendNr, DIENSTEN } from '@/lib/vesting'

export const dynamic = 'force-dynamic'

/**
 * Vestigingsprincipe — contracten, WAM-portefeuille, kosten en instellingen.
 *
 * ADMIN-ONLY. Hier staat de aandelenverdeling tussen de zaakvoerders; dat is
 * niets voor een setter of een medewerker, ook niet om te lezen.
 *
 * Eén route met een `resource`-veld in plaats van vier routes: de vier tabellen
 * hebben exact dezelfde levenscyclus (toevoegen, wijzigen, verwijderen) en één
 * scherm bedient ze alle vier. Elke resource heeft een eigen witte lijst van
 * velden — wat daar niet op staat, komt niet in de databank.
 */

type Resource = 'contract' | 'wam' | 'kost' | 'instellingen'
const TABEL: Record<Resource, string> = {
  contract: 'vesting_contracten', wam: 'vesting_wam', kost: 'vesting_wam_kosten', instellingen: 'vesting_instellingen',
}

const STATUSSEN = ['actief', 'voltooid', 'stopgezet', 'niet_betaler']
const MODELLEN = ['maandcontract', 'eenmalig']

const tekst = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }
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

/** De velden van één resource uit het verzoek halen — en NIETS anders. */
function velden(resource: Resource, b: Record<string, unknown>, bijAanmaak: boolean): { rij: Record<string, unknown>; fout?: string } {
  const rij: Record<string, unknown> = {}
  const heeft = (k: string) => b[k] !== undefined

  if (resource === 'contract') {
    if (heeft('klant')) rij.klant = tekst(b.klant)
    if (heeft('client_id')) rij.client_id = tekst(b.client_id)
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
    if (heeft('contractwaarde')) rij.contractwaarde = getal(b.contractwaarde) ?? 0
    if (heeft('netto_ontvangen')) rij.netto_ontvangen = getal(b.netto_ontvangen) ?? 0
    if (heeft('status')) rij.status = STATUSSEN.includes(String(b.status)) ? b.status : 'actief'
    if (heeft('betalingen_op_schema')) rij.betalingen_op_schema = ja(b.betalingen_op_schema)
    if (heeft('notitie')) rij.notitie = tekst(b.notitie)
    if (heeft('nr')) rij.nr = tekst(b.nr)
    if (bijAanmaak && !rij.klant) return { rij, fout: 'Klant is verplicht.' }
    return { rij }
  }

  if (resource === 'kost') {
    if (heeft('datum')) rij.datum = datum(b.datum)
    if (heeft('omschrijving')) rij.omschrijving = tekst(b.omschrijving)
    if (heeft('bedrag')) rij.bedrag = getal(b.bedrag) ?? 0
    if (bijAanmaak && !rij.omschrijving) return { rij, fout: 'Omschrijving is verplicht.' }
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
  return v === 'contract' || v === 'wam' || v === 'kost' || v === 'instellingen' ? v : null
}

// GET — alles wat het scherm nodig heeft, in één keer.
export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const [inst, contracten, wam, kosten, oud] = await Promise.all([
      admin.from('vesting_instellingen').select('*').eq('id', 1).maybeSingle(),
      admin.from('vesting_contracten').select('*').order('ondertekend_op').order('nr'),
      admin.from('vesting_wam').select('*').order('nr'),
      admin.from('vesting_wam_kosten').select('*').order('datum'),
      // De registraties van vóór dit model. Ze tellen niet mee, maar blijven
      // zichtbaar zodat niemand hoeft te zoeken waar ze gebleven zijn.
      admin.from('vesting_revenue').select('*').order('entry_date'),
    ])
    return NextResponse.json({
      instellingen: inst.data ?? null,
      contracten: contracten.data ?? [],
      wam: wam.data ?? [],
      kosten: kosten.data ?? [],
      oudeRegistraties: oud.data ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuw contract, WAM-klant of kost.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json() as Record<string, unknown>
    const resource = resourceVan(b.resource)
    if (!resource || resource === 'instellingen') return NextResponse.json({ error: 'Onbekende resource' }, { status: 400 })

    const { rij, fout } = velden(resource, b, true)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })

    const admin = createAdminSupabaseClient()
    // Nummer automatisch, tenzij er bewust een meegegeven is.
    if ((resource === 'contract' || resource === 'wam') && !rij.nr) {
      const { data } = await admin.from(TABEL[resource]).select('nr')
      rij.nr = volgendNr(((data ?? []) as { nr: string }[]).map((r) => r.nr), resource === 'contract' ? 'C' : 'CW')
    }

    const { data, error } = await admin.from(TABEL[resource]).insert(rij).select('id, nr').maybeSingle()
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return NextResponse.json({ error: 'Dat nummer bestaat al.' }, { status: 409 })
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: `vesting.${resource}.create`, entityType: TABEL[resource], entityId: (data as { id?: string } | null)?.id ?? null,
      summary: `Vesting: ${resource} toegevoegd${(data as { nr?: string } | null)?.nr ? ` (${(data as { nr: string }).nr})` : ''}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id: (data as { id?: string } | null)?.id ?? null })
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
    if (resource === 'instellingen') {
      ;({ error } = await admin.from(TABEL.instellingen).upsert({ id: 1, ...rij }, { onConflict: 'id' }))
    } else {
      const id = tekst(b.id)
      if (!id) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })
      if (resource === 'kost') delete rij.updated_at   // die tabel heeft geen updated_at
      ;({ error } = await admin.from(TABEL[resource]).update(rij).eq('id', id))
    }
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return NextResponse.json({ error: 'Dat nummer bestaat al.' }, { status: 409 })
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: `vesting.${resource}.update`, entityType: TABEL[resource], entityId: tekst(b.id),
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
