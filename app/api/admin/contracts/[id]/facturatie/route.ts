import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import {
  laadFacturatieOverzicht, genereerVoorstel, bewerkVoorstel, voegVoorstelToe, verwijderVoorstel, bevestigPlanning,
  herberekenToekomstig, stopContract, type VoorstelInvoer,
} from '@/lib/facturatie/opdrachten'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Facturatie van één contract: het factuurvoorstel (controleren, bewerken,
 * bevestigen) en het overzicht van de facturen die eruit voortkwamen.
 *
 * Rechten (bestaande rechtenmatrix, module "contracts"):
 *  · bekijken   → GET
 *  · aanpassen  → voorstel genereren, bewerken, toevoegen, dupliceren, verwijderen
 *  · goedkeuren → factuurplanning bevestigen, toekomstige facturen herberekenen, contract stoppen
 */

const UUID = /^[0-9a-f-]{36}$/i

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const d = await laadFacturatieOverzicht(admin, id)
    return NextResponse.json(d)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown> & { action?: string }
    const recht = ['bevestig', 'herbereken_toekomstig', 'stop'].includes(String(b.action)) ? 'goedkeuren' : 'aanpassen'
    const actor = await magIk('contracts', recht)
    if (!actor) return NextResponse.json({ error: recht === 'goedkeuren' ? 'Je hebt geen recht om een factuurplanning te bevestigen of te wijzigen na bevestiging.' : 'Je hebt geen recht om factuurvoorstellen aan te passen.' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)
    const persoon = { id: actor.userId, email: actor.email ?? null }
    const audit = (summary: string, extra: Record<string, unknown> = {}) => logAudit({
      action: `contract.facturatie.${b.action}`, entityType: 'contract', entityId: id, summary,
      actorUserId: actor.userId, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent, metadata: extra,
    })
    const ververs = () => { try { revalidatePath(`/admin/contracts/${id}`); revalidatePath('/admin/invoices'); revalidatePath('/admin/invoices/planner') } catch { } }
    const klaar = async (extra: Record<string, unknown> = {}) => { ververs(); return NextResponse.json({ ok: true, ...extra, ...(await laadFacturatieOverzicht(admin, id)) }) }

    switch (b.action) {
      case 'genereer': {
        const r = await genereerVoorstel(admin, id, persoon, { vervang: b.vervang === true })
        if (!r.ok) return NextResponse.json({ error: r.fout, handmatigGewijzigd: r.handmatigGewijzigd ?? 0, bevestigingNodig: true }, { status: 409 })
        await audit(`Factuurplanning gegenereerd: ${r.aangemaakt} voorstel(len)${r.verwijderd ? `, ${r.verwijderd} vervangen` : ''}${r.ontbrekend.length ? ` — controle vereist: ${r.ontbrekend.join('; ')}` : ''}`, { aangemaakt: r.aangemaakt, verwijderd: r.verwijderd })
        return klaar({ aangemaakt: r.aangemaakt, verwijderd: r.verwijderd, ontbrekend: r.ontbrekend })
      }
      case 'bewerk': {
        const opdrachtId = String(b.opdracht_id ?? '')
        if (!UUID.test(opdrachtId)) return NextResponse.json({ error: 'opdracht_id ontbreekt' }, { status: 400 })
        const r = await bewerkVoorstel(admin, id, opdrachtId, b as VoorstelInvoer, persoon)
        if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 400 })
        await audit('Voorgestelde factuur aangepast', { opdracht_id: opdrachtId })
        return klaar()
      }
      case 'toevoegen': case 'dupliceer': {
        const r = await voegVoorstelToe(admin, id, persoon, { ...(b as VoorstelInvoer), na_id: (b.na_id as string | null) ?? null, voor_id: (b.voor_id as string | null) ?? null, kopie_van: b.action === 'dupliceer' ? String(b.opdracht_id ?? '') : ((b.kopie_van as string | null) ?? null) })
        if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 400 })
        await audit(b.action === 'dupliceer' ? 'Voorgestelde factuur gedupliceerd' : 'Voorgestelde factuur toegevoegd', { opdracht_id: r.id })
        return klaar({ id: r.id })
      }
      case 'verwijder': {
        const opdrachtId = String(b.opdracht_id ?? '')
        if (!UUID.test(opdrachtId)) return NextResponse.json({ error: 'opdracht_id ontbreekt' }, { status: 400 })
        const r = await verwijderVoorstel(admin, id, opdrachtId, persoon)
        if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 400 })
        await audit('Voorgestelde factuur uit het voorstel verwijderd', { opdracht_id: opdrachtId })
        return klaar()
      }
      case 'gecontroleerd': {
        // "Controle vereist" → "open": bewust, door een mens, nadat de gegevens zijn nagekeken.
        const opdrachtId = String(b.opdracht_id ?? '')
        if (!UUID.test(opdrachtId)) return NextResponse.json({ error: 'opdracht_id ontbreekt' }, { status: 400 })
        const { data: o } = await admin.from('contract_facturatie_opdrachten').select('id, status, ontbrekend, bedrag_excl, omschrijving, factuurdatum, invoice_id').eq('id', opdrachtId).eq('contract_id', id).maybeSingle()
        if (!o || o.invoice_id) return NextResponse.json({ error: 'Voorstel niet gevonden of al bevestigd.' }, { status: 400 })
        if (!o.bedrag_excl || !o.omschrijving || !o.factuurdatum) return NextResponse.json({ error: 'Vul eerst datum, omschrijving en bedrag in voordat je dit voorstel als gecontroleerd markeert.' }, { status: 400 })
        const { error } = await admin.from('contract_facturatie_opdrachten').update({ status: 'open', ontbrekend: [], updated_at: new Date().toISOString() }).eq('id', opdrachtId)
        if (error) throw new Error(error.message)
        await audit('Voorgestelde factuur gecontroleerd', { opdracht_id: opdrachtId })
        return klaar()
      }
      case 'bevestig': {
        const ids = Array.isArray(b.ids) ? (b.ids as unknown[]).map(String).filter((x) => UUID.test(x)) : undefined
        const r = await bevestigPlanning(admin, id, persoon, ids)
        if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 409 })
        await audit(`Factuurplanning bevestigd: ${r.aangemaakt} factuur/facturen aangemaakt${r.overgeslagen ? `, ${r.overgeslagen} al bevestigd` : ''}`, { aangemaakt: r.aangemaakt, invoice_ids: r.invoiceIds })
        return klaar({ aangemaakt: r.aangemaakt, overgeslagen: r.overgeslagen, invoiceIds: r.invoiceIds })
      }
      case 'herbereken_toekomstig': {
        const r = await herberekenToekomstig(admin, id, persoon)
        if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 400 })
        await audit(`Toekomstige facturen herberekend na contractwijziging: ${r.bijgewerkt}`)
        return klaar({ bijgewerkt: r.bijgewerkt })
      }
      case 'behoud_planning': {
        await admin.from('contracts').update({ facturatie_gewijzigd_na_bevestiging: false }).eq('id', id)
        await audit('Bestaande factuurplanning behouden na contractwijziging')
        return klaar()
      }
      case 'stop': {
        const r = await stopContract(admin, id, persoon, {
          voorstellen_annuleren: Array.isArray(b.voorstellen_annuleren) ? (b.voorstellen_annuleren as unknown[]).map(String).filter((x) => UUID.test(x)) : [],
          facturen_annuleren: Array.isArray(b.facturen_annuleren) ? (b.facturen_annuleren as unknown[]).map(String).filter((x) => UUID.test(x)) : [],
          reden: String(b.reden ?? ''), einddatum: (b.einddatum as string | null) ?? null,
        })
        if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 400 })
        await audit(`Contract vroegtijdig gestopt: ${r.voorstellen} voorstel(len) en ${r.facturen} factuur/facturen geannuleerd`, { reden: b.reden ?? null })
        return klaar({ voorstellen: r.voorstellen, facturen: r.facturen })
      }
      case 'gekoppeld': {
        // Bestaande factuur aan een voorstel hangen (bv. handmatig gemaakt in Facturen).
        const opdrachtId = String(b.opdracht_id ?? ''), invoiceId = String(b.invoice_id ?? '')
        if (!UUID.test(opdrachtId) || !UUID.test(invoiceId)) return NextResponse.json({ error: 'opdracht_id en invoice_id vereist' }, { status: 400 })
        const { data: inv } = await admin.from('invoices').select('id').eq('id', invoiceId).maybeSingle()
        if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
        const { error } = await admin.from('contract_facturatie_opdrachten').update({ invoice_id: invoiceId, status: 'afgehandeld', bevestigd_op: new Date().toISOString(), bevestigd_door: actor.email ?? null, updated_at: new Date().toISOString() }).eq('id', opdrachtId).eq('contract_id', id)
        if (error) throw new Error(error.message)
        await admin.from('invoices').update({ contract_id: id }).eq('id', invoiceId).is('contract_id', null)
        await audit('Bestaande factuur gekoppeld aan een voorstel', { opdracht_id: opdrachtId, invoice_id: invoiceId })
        return klaar()
      }
      default:
        return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
