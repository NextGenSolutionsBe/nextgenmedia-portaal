import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { laadAankoopActor, rechtenVoor, BEVESTIGD } from '@/lib/aankopen/rechten'
import { bevestigAankoop } from '@/lib/aankopen/bewijs'

export const dynamic = 'force-dynamic'

/**
 * Eén aankoopaanvraag: aanpassen (PATCH), veilig verwijderen (DELETE,
 * soft-delete) en herstellen (POST). Zelfde staff-guard als de rest van
 * Aankopen, plus rechten per aanvraag (lib/aankopen/rechten.ts).
 */

const THRESHOLD = 1000
const UUID = /^[0-9a-f-]{36}$/i
const VELDEN = ['title', 'description', 'amount_excl', 'vat_pct', 'supplier', 'category', 'entry_date'] as const
type Veld = (typeof VELDEN)[number]
const LABEL: Record<Veld, string> = { title: 'Titel', description: 'Omschrijving', amount_excl: 'Bedrag excl. btw', vat_pct: 'Btw %', supplier: 'Leverancier', category: 'Categorie', entry_date: 'Datum' }
/** Velden waarbij een al gegeven goedkeuring niet meer geldt. */
const MATERIEEL: Veld[] = ['title', 'amount_excl', 'vat_pct', 'supplier']

const tekst = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }
const getal = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? x : null }

async function laad(admin: ReturnType<typeof createAdminSupabaseClient>, id: string) {
  const { data } = await admin.from('purchases').select('*').eq('id', id).maybeSingle()
  return data as Record<string, unknown> | null
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await laadAankoopActor()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const p = await laad(admin, params.id)
    if (!p) return NextResponse.json({ error: 'Aankoop niet gevonden' }, { status: 404 })
    const rechten = rechtenVoor(actor, p as never)
    if (rechten.blokkade) return NextResponse.json({ error: rechten.blokkade }, { status: 409 })
    if (!rechten.bewerken) return NextResponse.json({ error: 'Je mag deze aanvraag niet aanpassen.' }, { status: 403 })

    const b = await req.json() as Record<string, unknown>
    // Zelfde validatie als bij het aanmaken.
    const nieuw: Record<string, unknown> = {
      title: tekst(b.title), description: tekst(b.description), amount_excl: getal(b.amount_excl), vat_pct: getal(b.vat_pct) ?? 21,
      supplier: tekst(b.supplier), category: tekst(b.category), entry_date: tekst(b.entry_date)?.slice(0, 10) ?? String(p.entry_date),
    }
    if (!nieuw.title) return NextResponse.json({ error: 'Titel is verplicht' }, { status: 400 })
    if (!nieuw.amount_excl || Number(nieuw.amount_excl) <= 0) return NextResponse.json({ error: 'Bedrag is verplicht' }, { status: 400 })
    if (Number(nieuw.vat_pct) < 0 || Number(nieuw.vat_pct) > 100) return NextResponse.json({ error: 'Btw % moet tussen 0 en 100 liggen' }, { status: 400 })
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(nieuw.entry_date))) return NextResponse.json({ error: 'Datum is ongeldig' }, { status: 400 })

    // Wat verandert er echt?
    const oud: Record<string, unknown> = {}; const wijzigingen: Record<string, unknown> = {}
    for (const v of VELDEN) {
      const was = p[v] === null || p[v] === undefined ? null : (v === 'amount_excl' || v === 'vat_pct' ? Number(p[v]) : String(p[v]))
      const wordt = nieuw[v] === null || nieuw[v] === undefined ? null : (v === 'amount_excl' || v === 'vat_pct' ? Number(nieuw[v]) : String(nieuw[v]))
      if (was !== wordt) { oud[v] = was; wijzigingen[v] = wordt }
    }
    if (Object.keys(wijzigingen).length === 0) return NextResponse.json({ ok: true, ongewijzigd: true })

    const incl = Number(nieuw.amount_excl) * (1 + Number(nieuw.vat_pct) / 100)
    const needsApproval = incl > THRESHOLD
    const wasBevestigd = BEVESTIGD.includes(String(p.status))
    const materieel = MATERIEEL.some((v) => v in wijzigingen)
    const opmerking = tekst(b.opmerking)
    const nu = new Date().toISOString()
    const update: Record<string, unknown> = { ...wijzigingen, needs_approval: needsApproval }
    let nieuweStatus = String(p.status)
    let nieuweVersie = Number(p.version ?? 1)
    let goedkeuringenVervallen = false
    let bewijsNieuw = false

    if (wasBevestigd) {
      // Nieuwe versie: de oude staat blijft bewaard, het oude bewijs wordt 'vervangen'.
      nieuweVersie += 1
      await admin.from('purchase_versions').insert({ purchase_id: params.id, version: Number(p.version ?? 1), snapshot: p, reden: 'gewijzigd na bevestiging', created_by_email: actor.email })
      await admin.from('purchase_certificates').update({ status: 'vervangen' }).eq('purchase_id', params.id).eq('status', 'actueel')
      update.version = nieuweVersie
      update.confirmed_at = null; update.confirmed_by_email = null
      if (needsApproval) {
        // Opnieuw ter goedkeuring: de eerdere goedkeuringen golden voor de vorige versie.
        await admin.from('purchase_approvals').delete().eq('purchase_id', params.id)
        goedkeuringenVervallen = true
        nieuweStatus = 'pending'
      } else {
        nieuweStatus = 'approved_under_threshold'
        bewijsNieuw = true
      }
      update.status = nieuweStatus
    } else if (String(p.status) === 'pending') {
      if (materieel) {
        const { count } = await admin.from('purchase_approvals').select('id', { count: 'exact', head: true }).eq('purchase_id', params.id)
        if ((count ?? 0) > 0) { await admin.from('purchase_approvals').delete().eq('purchase_id', params.id); goedkeuringenVervallen = true }
      }
      // Onder de drempel gezakt? Dan is er geen goedkeuring meer nodig — de aanvraag wordt bevestigd zoals bij aanmaken.
      if (!needsApproval) { nieuweStatus = 'approved_under_threshold'; bewijsNieuw = true; update.status = nieuweStatus }
    }
    // Concept: velden aanpassen, status blijft concept.

    const { error } = await admin.from('purchases').update(update).eq('id', params.id)
    if (error) throw new Error(error.message)

    await admin.from('purchase_edits').insert({
      purchase_id: params.id, version: nieuweVersie, actie: wasBevestigd ? 'nieuwe_versie' : 'gewijzigd',
      actor_user_id: actor.id, actor_email: actor.email, oud, nieuw: wijzigingen, opmerking,
    })
    let certificaat = null
    if (bewijsNieuw) { try { certificaat = await bevestigAankoop(admin, params.id, actor.email) } catch (e) { console.error('[purchases] bewijs:', e instanceof Error ? e.message : e) } }

    const meta = requestMeta(req)
    await logAudit({
      action: 'purchase.update', entityType: 'purchase', entityId: params.id,
      summary: `Aankoopaanvraag ${p.reference ?? ''} aangepast (${Object.keys(wijzigingen).map((k) => LABEL[k as Veld] ?? k).join(', ')})${wasBevestigd ? ` → versie ${nieuweVersie}` : ''}`,
      actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.isAdmin ? 'admin' : 'staff',
      metadata: { oud, nieuw: wijzigingen, status: nieuweStatus, versie: nieuweVersie, goedkeuringen_vervallen: goedkeuringenVervallen }, ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath('/admin/purchases') } catch { }
    return NextResponse.json({ ok: true, status: nieuweStatus, versie: nieuweVersie, goedkeuringenVervallen, certificaat: certificaat ? { certificate_no: certificaat.certificate_no, file_name: certificaat.file_name } : null })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await laadAankoopActor()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const p = await laad(admin, params.id)
    if (!p) return NextResponse.json({ error: 'Aankoop niet gevonden' }, { status: 404 })
    // Dubbele klik: al verwijderd → gewoon ok, niets tweemaal verwerken.
    if (p.deleted_at) return NextResponse.json({ ok: true, alVerwijderd: true })
    const rechten = rechtenVoor(actor, p as never)
    if (!rechten.verwijderen) return NextResponse.json({ error: 'Je mag deze aanvraag niet verwijderen.' }, { status: 403 })

    const nu = new Date().toISOString()
    // Soft-delete: uit het actieve overzicht, maar geschiedenis, goedkeuringen en documenten blijven.
    const { data: bijgewerkt, error } = await admin.from('purchases').update({ deleted_at: nu, deleted_by_email: actor.email, deleted_by_user_id: actor.id }).eq('id', params.id).is('deleted_at', null).select('id')
    if (error) throw new Error(error.message)
    if (!bijgewerkt || (bijgewerkt as unknown[]).length === 0) return NextResponse.json({ ok: true, alVerwijderd: true })
    await admin.from('purchase_edits').insert({ purchase_id: params.id, version: p.version ?? 1, actie: 'verwijderd', actor_user_id: actor.id, actor_email: actor.email, oud: { status: p.status }, nieuw: { deleted_at: nu } })
    const meta = requestMeta(req)
    await logAudit({
      action: 'purchase.delete', entityType: 'purchase', entityId: params.id, summary: `Aankoopaanvraag ${p.reference ?? ''} "${p.title ?? ''}" verwijderd (archief)`,
      actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.isAdmin ? 'admin' : 'staff', ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath('/admin/purchases') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await laadAankoopActor()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const b = await req.json() as { action?: string }
    const admin = createAdminSupabaseClient()
    const p = await laad(admin, params.id)
    if (!p) return NextResponse.json({ error: 'Aankoop niet gevonden' }, { status: 404 })

    if (b.action === 'herstellen') {
      if (!rechtenVoor(actor, p as never).herstellen) return NextResponse.json({ error: 'Alleen een admin of zaakvoerder kan een aanvraag herstellen.' }, { status: 403 })
      if (!p.deleted_at) return NextResponse.json({ ok: true })
      const { error } = await admin.from('purchases').update({ deleted_at: null, deleted_by_email: null, deleted_by_user_id: null }).eq('id', params.id)
      if (error) throw new Error(error.message)
      await admin.from('purchase_edits').insert({ purchase_id: params.id, version: p.version ?? 1, actie: 'hersteld', actor_user_id: actor.id, actor_email: actor.email, oud: { deleted_at: p.deleted_at }, nieuw: { deleted_at: null } })
      const meta = requestMeta(req)
      await logAudit({ action: 'purchase.restore', entityType: 'purchase', entityId: params.id, summary: `Aankoopaanvraag ${p.reference ?? ''} hersteld uit het archief`, actorUserId: actor.id, actorEmail: actor.email, actorRole: actor.isAdmin ? 'admin' : 'staff', ip: meta.ip, userAgent: meta.userAgent })
      try { revalidatePath('/admin/purchases') } catch { }
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
