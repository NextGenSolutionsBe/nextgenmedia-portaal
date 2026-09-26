import { leesGetal } from '@/lib/getal'
import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { PERSONEN, RECHT_TYPES, STANDAARD_AANNAMES } from '@/lib/bv-transitie'

export const dynamic = 'force-dynamic'

/**
 * BV-transitie — rechtenbalans, BV-kosten, winstverdeling en de EZ-raming.
 *
 * ADMIN-ONLY: dit gaat over wat de zaakvoerders elkaar nog verschuldigd zijn
 * en over hun privé-inkomen. Zelfde opzet als de vesting-route: één route,
 * een `resource`-veld, en per resource een witte lijst van velden.
 */

type Resource = 'recht' | 'kost' | 'verdeling' | 'ez' | 'aannames'
const TABEL: Record<Resource, string> = {
  recht: 'bv_rechten', kost: 'bv_kosten', verdeling: 'bv_winstverdeling', ez: 'ez_fiscaal', aannames: 'ez_aannames',
}

const tekst = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }
const getal = (v: unknown): number | null => leesGetal(v)
const datum = (v: unknown): string | null => {
  const s = tekst(v); if (!s) return null
  const d = new Date(s.slice(0, 10) + 'T00:00:00')
  return Number.isFinite(d.getTime()) ? s.slice(0, 10) : null
}
const persoon = (v: unknown): string | null => (PERSONEN as string[]).includes(String(v)) ? String(v) : null

function velden(resource: Resource, b: Record<string, unknown>, bijAanmaak: boolean): { rij: Record<string, unknown>; fout?: string } {
  const rij: Record<string, unknown> = {}
  const heeft = (k: string) => b[k] !== undefined

  if (resource === 'recht') {
    if (heeft('datum')) rij.datum = datum(b.datum)
    if (heeft('persoon')) rij.persoon = persoon(b.persoon)
    if (heeft('type')) {
      const t = RECHT_TYPES.find((x) => x.type === b.type)
      if (t) {
        rij.type = t.type
        // De richting volgt uit het type; enkel bij een correctie kies je zelf.
        if (t.richting !== null) rij.richting = t.richting
      }
    }
    if (heeft('richting') && (rij.type === 'correctie' || (!heeft('type') && !rij.richting))) {
      rij.richting = Number(b.richting) === -1 ? -1 : 1
    }
    if (heeft('omschrijving')) rij.omschrijving = tekst(b.omschrijving)
    if (heeft('bedrag_excl')) rij.bedrag_excl = getal(b.bedrag_excl)
    if (heeft('bewijs')) rij.bewijs = tekst(b.bewijs)
    if (heeft('notitie')) rij.notitie = tekst(b.notitie)
    if (bijAanmaak) {
      if (!rij.datum) return { rij, fout: 'Datum is verplicht.' }
      if (!rij.persoon) return { rij, fout: 'Kies een persoon.' }
      if (!rij.type) return { rij, fout: 'Kies een type.' }
      if (rij.bedrag_excl === null || rij.bedrag_excl === undefined) return { rij, fout: 'Bedrag is verplicht.' }
    }
    return { rij }
  }

  if (resource === 'kost') {
    if (heeft('datum')) rij.datum = datum(b.datum)
    if (heeft('leverancier')) rij.leverancier = tekst(b.leverancier)
    if (heeft('categorie')) rij.categorie = tekst(b.categorie)
    if (heeft('omschrijving')) rij.omschrijving = tekst(b.omschrijving)
    if (heeft('bedrag_excl')) rij.bedrag_excl = getal(b.bedrag_excl)
    if (heeft('btw_pct')) rij.btw_pct = getal(b.btw_pct) ?? 21
    if (heeft('betaald_door')) rij.betaald_door = ['bv', 'bram_prive', 'chiara_prive', 'marco_prive'].includes(String(b.betaald_door)) ? b.betaald_door : 'bv'
    if (heeft('verrekenen_met')) rij.verrekenen_met = persoon(b.verrekenen_met)   // "Geen" → null
    if (bijAanmaak) {
      if (!rij.datum) return { rij, fout: 'Datum is verplicht.' }
      if (rij.bedrag_excl === null || rij.bedrag_excl === undefined) return { rij, fout: 'Bedrag is verplicht.' }
    }
    return { rij }
  }

  if (resource === 'verdeling') {
    rij.persoon = persoon(b.persoon)
    if (!rij.persoon) return { rij, fout: 'Kies een persoon.' }
    for (const k of ['ontvangen_op_rekening', 'nog_te_ontvangen', 'zakelijke_kosten_betaald', 'prive_gebruikt', 'al_ontvangen']) {
      if (heeft(k)) rij[k] = getal(b[k]) ?? 0
    }
    return { rij }
  }

  if (resource === 'ez') {
    rij.persoon = persoon(b.persoon)
    rij.jaar = getal(b.jaar)
    if (!rij.persoon || !rij.jaar) return { rij, fout: 'Persoon en jaar zijn verplicht.' }
    for (const k of ['winst', 'andere_inkomsten', 'aftrekken']) if (heeft(k)) rij[k] = getal(b[k]) ?? 0
    if (heeft('kwartalen')) rij.kwartalen = Math.min(4, Math.max(1, Math.round(getal(b.kwartalen) ?? 4)))
    if (heeft('statuut')) rij.statuut = ['hoofdberoep', 'bijberoep', 'primostarter'].includes(String(b.statuut)) ? b.statuut : 'bijberoep'
    return { rij }
  }

  // aannames
  rij.jaar = getal(b.jaar)
  if (!rij.jaar) return { rij, fout: 'Jaar is verplicht.' }
  for (const k of Object.keys(STANDAARD_AANNAMES)) {
    if (heeft(k)) { const g = getal(b[k]); if (g !== null) rij[k] = g }
  }
  return { rij }
}

function resourceVan(v: unknown): Resource | null {
  return v === 'recht' || v === 'kost' || v === 'verdeling' || v === 'ez' || v === 'aannames' ? v : null
}

export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const jaar = Number(req.nextUrl.searchParams.get('jaar')) || new Date().getFullYear()
    const admin = createAdminSupabaseClient()
    const [rechten, kosten, verdeling, ez, aannames] = await Promise.all([
      admin.from('bv_rechten').select('*').order('datum').order('created_at'),
      admin.from('bv_kosten').select('*').order('datum').order('created_at'),
      admin.from('bv_winstverdeling').select('*'),
      admin.from('ez_fiscaal').select('*').eq('jaar', jaar),
      admin.from('ez_aannames').select('*').eq('jaar', jaar).maybeSingle(),
    ])
    return NextResponse.json({
      jaar,
      rechten: rechten.data ?? [], kosten: kosten.data ?? [], verdeling: verdeling.data ?? [],
      ez: ez.data ?? [], aannames: aannames.data ?? null,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuwe regel in de rechtenbalans of de kosten.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json() as Record<string, unknown>
    const resource = resourceVan(b.resource)
    if (resource !== 'recht' && resource !== 'kost') return NextResponse.json({ error: 'Onbekende resource' }, { status: 400 })
    const { rij, fout } = velden(resource, b, true)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from(TABEL[resource]).insert(rij).select('id').maybeSingle()
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: `bv.${resource}.create`, entityType: TABEL[resource], entityId: (data as { id?: string } | null)?.id ?? null,
      summary: `BV-transitie: ${resource} toegevoegd`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id: (data as { id?: string } | null)?.id ?? null })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — regel wijzigen; verdeling, ez en aannames worden ge-upsert op hun sleutel.
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json() as Record<string, unknown>
    const resource = resourceVan(b.resource)
    if (!resource) return NextResponse.json({ error: 'Onbekende resource' }, { status: 400 })
    const { rij, fout } = velden(resource, b, false)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })

    const admin = createAdminSupabaseClient()
    let error: { message: string } | null = null
    if (resource === 'verdeling') {
      ;({ error } = await admin.from(TABEL.verdeling).upsert({ ...rij, updated_at: new Date().toISOString() }, { onConflict: 'persoon' }))
    } else if (resource === 'ez') {
      ;({ error } = await admin.from(TABEL.ez).upsert({ ...rij, updated_at: new Date().toISOString() }, { onConflict: 'persoon,jaar' }))
    } else if (resource === 'aannames') {
      ;({ error } = await admin.from(TABEL.aannames).upsert({ ...rij, updated_at: new Date().toISOString() }, { onConflict: 'jaar' }))
    } else {
      const id = tekst(b.id)
      if (!id) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })
      if (Object.keys(rij).length === 0) return NextResponse.json({ ok: true })
      ;({ error } = await admin.from(TABEL[resource]).update(rij).eq('id', id))
    }
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: `bv.${resource}.update`, entityType: TABEL[resource], entityId: tekst(b.id),
      summary: `BV-transitie: ${resource} bijgewerkt`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const resource = resourceVan(req.nextUrl.searchParams.get('resource'))
    const id = req.nextUrl.searchParams.get('id')
    if ((resource !== 'recht' && resource !== 'kost') || !id) return NextResponse.json({ error: 'resource en id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from(TABEL[resource]).delete().eq('id', id)
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({
      action: `bv.${resource}.delete`, entityType: TABEL[resource], entityId: id,
      summary: `BV-transitie: ${resource} verwijderd`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
