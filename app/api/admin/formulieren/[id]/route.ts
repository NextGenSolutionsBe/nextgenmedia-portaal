import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { formulierGuard, migratieAntwoord, isUuid } from '@/lib/formulieren/server'
import {
  normaliseerVelden, normaliseerInstellingen, geldigeDienst, isFormulierStatus, FORMULIER_STATUS_INFO, linkStatusVan,
} from '@/lib/formulieren/model'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

/** Eén formulier met zijn links (incl. status en aantal inzendingen per link). */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const g = await formulierGuard('bekijken')
    if (!g.ok) return g.response
    if (!isUuid(params.id)) return NextResponse.json({ error: 'Formulier niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const { data: f, error } = await admin.from('formulieren').select('*').eq('id', params.id).maybeSingle()
    if (error) return migratieAntwoord(error.message) ?? NextResponse.json({ error: safeMessage(error, 'formulier') }, { status: 500 })
    if (!f) return NextResponse.json({ error: 'Formulier niet gevonden' }, { status: 404 })

    const [{ data: links }, { data: inz }] = await Promise.all([
      admin.from('formulier_links').select('id, client_id, token, label, verloopt_op, ingetrokken_op, eenmalig, created_at').eq('formulier_id', params.id).order('created_at', { ascending: false }),
      admin.from('formulier_inzendingen').select('link_id, status').eq('formulier_id', params.id).limit(20000),
    ])
    const perLink = new Map<string, number>()
    let totaal = 0, nieuw = 0
    for (const r of (inz ?? []) as { link_id: string | null; status: string }[]) {
      totaal++; if (r.status === 'nieuw') nieuw++
      if (r.link_id) perLink.set(r.link_id, (perLink.get(r.link_id) ?? 0) + 1)
    }
    const klantIds = [...new Set(((links ?? []) as { client_id: string | null }[]).map((l) => l.client_id).filter(Boolean))] as string[]
    const { data: klanten } = klantIds.length ? await admin.from('clients').select('id, company_name').in('id', klantIds) : { data: [] }
    const naam = new Map(((klanten ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))

    const formulier = { ...f, velden: normaliseerVelden(f.velden), instellingen: normaliseerInstellingen(f.instellingen) }
    const linkRijen = ((links ?? []) as { id: string; client_id: string | null; token: string; label: string | null; verloopt_op: string | null; ingetrokken_op: string | null; eenmalig: boolean; created_at: string }[]).map((l) => {
      const aantal = perLink.get(l.id) ?? 0
      return { ...l, klant_naam: l.client_id ? naam.get(l.client_id) ?? null : null, inzendingen: aantal, status: linkStatusVan(l, f, aantal) }
    })
    return NextResponse.json({ formulier, links: linkRijen, aantallen: { totaal, nieuw } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier') }, { status: 400 })
  }
}

/**
 * Bijwerken: velden, instellingen, metadata, status en (de)archiveren.
 * Enkel meegestuurde sleutels worden aangepast.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  try {
    const g = await formulierGuard('aanpassen')
    if (!g.ok) return g.response
    if (!isUuid(params.id)) return NextResponse.json({ error: 'Formulier niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    // Archiveren valt in de rechtenmatrix onder "verwijderen of archiveren".
    if ('gearchiveerd' in b) {
      const mag = await formulierGuard('verwijderen')
      if (!mag.ok) return mag.response
    }
    const admin = createAdminSupabaseClient()
    const { data: oud, error: leesFout } = await admin.from('formulieren').select('id, titel, status, gearchiveerd_op').eq('id', params.id).maybeSingle()
    if (leesFout) return migratieAntwoord(leesFout.message) ?? NextResponse.json({ error: safeMessage(leesFout, 'formulier') }, { status: 500 })
    if (!oud) return NextResponse.json({ error: 'Formulier niet gevonden' }, { status: 404 })

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('titel' in b) {
      const t = String(b.titel ?? '').trim().slice(0, 200)
      if (!t) return NextResponse.json({ error: 'Geef het formulier een titel.' }, { status: 400 })
      patch.titel = t
    }
    if ('beschrijving' in b) patch.beschrijving = String(b.beschrijving ?? '').trim().slice(0, 2000) || null
    if ('doel' in b) patch.doel = String(b.doel ?? '').trim().slice(0, 120) || null
    if ('dienst' in b) patch.dienst = geldigeDienst(b.dienst)
    if ('velden' in b) patch.velden = normaliseerVelden(b.velden)
    if ('instellingen' in b) patch.instellingen = normaliseerInstellingen(b.instellingen)
    if ('status' in b) {
      if (!isFormulierStatus(b.status)) return NextResponse.json({ error: 'Ongeldige status' }, { status: 400 })
      patch.status = b.status
    }
    if ('gearchiveerd' in b) patch.gearchiveerd_op = b.gearchiveerd ? (oud.gearchiveerd_op ?? new Date().toISOString()) : null

    const { data, error } = await admin.from('formulieren').update(patch).eq('id', params.id).select('*').single()
    if (error) return NextResponse.json({ error: safeMessage(error, 'formulier') }, { status: 500 })

    const meta = requestMeta(req)
    const wijzigingen = Object.keys(patch).filter((k) => k !== 'updated_at')
    const samenvatting = 'gearchiveerd_op' in patch
      ? (patch.gearchiveerd_op ? `Formulier gearchiveerd: ${data.titel}` : `Formulier uit archief gehaald: ${data.titel}`)
      : patch.status && patch.status !== oud.status
        ? `Formulier "${data.titel}": ${FORMULIER_STATUS_INFO[oud.status as keyof typeof FORMULIER_STATUS_INFO]?.label ?? oud.status} → ${FORMULIER_STATUS_INFO[patch.status as keyof typeof FORMULIER_STATUS_INFO].label}`
        : `Formulier bijgewerkt: ${data.titel}`
    await logAudit({
      action: 'gearchiveerd_op' in patch ? (patch.gearchiveerd_op ? 'formulier.archive' : 'formulier.unarchive') : 'formulier.update',
      entityType: 'formulier', entityId: params.id, summary: samenvatting,
      actorUserId: g.actor.userId, actorEmail: g.actor.email, actorRole: 'staff',
      metadata: { velden: wijzigingen }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ formulier: { ...data, velden: normaliseerVelden(data.velden), instellingen: normaliseerInstellingen(data.instellingen) } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier') }, { status: 400 })
  }
}

/** Definitief verwijderen mag ENKEL zonder inzendingen; anders archiveren. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  try {
    const g = await formulierGuard('verwijderen')
    if (!g.ok) return g.response
    if (!isUuid(params.id)) return NextResponse.json({ error: 'Formulier niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const { data: f } = await admin.from('formulieren').select('id, titel').eq('id', params.id).maybeSingle()
    if (!f) return NextResponse.json({ error: 'Formulier niet gevonden' }, { status: 404 })
    const { count, error: telFout } = await admin.from('formulier_inzendingen').select('id', { count: 'exact', head: true }).eq('formulier_id', params.id)
    if (telFout) return NextResponse.json({ error: safeMessage(telFout, 'formulier') }, { status: 500 })
    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: `Dit formulier heeft ${count} inzending${count === 1 ? '' : 'en'} en kan niet verwijderd worden. Archiveer het in de plaats.` }, { status: 409 })
    }
    const { error } = await admin.from('formulieren').delete().eq('id', params.id)
    if (error) return NextResponse.json({ error: safeMessage(error, 'formulier') }, { status: 500 })
    const meta = requestMeta(req)
    await logAudit({
      action: 'formulier.delete', entityType: 'formulier', entityId: params.id, summary: `Formulier verwijderd: ${f.titel}`,
      actorUserId: g.actor.userId, actorEmail: g.actor.email, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier') }, { status: 400 })
  }
}
