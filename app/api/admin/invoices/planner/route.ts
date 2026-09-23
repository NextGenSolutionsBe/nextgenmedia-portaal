import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { laadMomenten } from '@/lib/facturatie/planner'
import { vandaagBrussel, isDatum, ontleedSleutel, ymVan } from '@/lib/facturatie/planner-model'
import { zetMaandStatus, ANNULERING_OPMERKING } from '@/lib/facturatie/recurring'
import { billingDateFor, inclFromExcl } from '@/lib/invoices'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_DAGEN = 400

/**
 * GET ?van=YYYY-MM-DD&tot=YYYY-MM-DD — alle facturatiemomenten in die periode,
 * uit één centrale bron (lib/facturatie/planner.ts). Enkel de gevraagde
 * periode wordt geladen.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sp = req.nextUrl.searchParams
    const van = sp.get('van') ?? '', tot = sp.get('tot') ?? ''
    if (!isDatum(van) || !isDatum(tot) || van > tot) return NextResponse.json({ error: 'Geef een geldige periode (van/tot).' }, { status: 400 })
    if ((Date.parse(tot) - Date.parse(van)) / 86_400_000 > MAX_DAGEN) return NextResponse.json({ error: `De periode mag maximaal ${MAX_DAGEN} dagen beslaan.` }, { status: 400 })
    const vandaag = vandaagBrussel()
    const admin = createAdminSupabaseClient()
    const r = await laadMomenten(admin, van, tot, vandaag)
    return NextResponse.json({ ...r, vandaag, van, tot })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

const NIET_TE_ANNULEREN = 'Een verstuurde of betaalde factuur kan niet geannuleerd worden. Crediteer ze via de factuur zelf.'

/**
 * POST { actie, id, datum? } — annuleer | verplaats | verstuurd | heropen (terug naar te factureren).
 * Werkt op de bron achter het moment; een mislukte nevenstap blokkeert
 * de actie niet maar wordt wél teruggemeld en gelogd.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => null)) as { actie?: string; id?: string; datum?: string; reden?: string } | null
    const sleutel = b?.id ? ontleedSleutel(b.id) : null
    if (!b || !sleutel) return NextResponse.json({ error: 'Onbekend planneritem.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)
    const waarschuwingen: string[] = []
    const audit = (summary: string, extra: Record<string, unknown> = {}) => logAudit({
      action: `facturatieplanner.${b.actie}`, entityType: sleutel.bron, entityId: sleutel.bronId, summary,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', metadata: { moment: b.id, ...extra, waarschuwingen }, ip: meta.ip, userAgent: meta.userAgent,
    })
    const klaar = () => { try { revalidatePath('/admin/invoices'); revalidatePath('/admin/invoices/planner') } catch { /* */ } }
    // ── Eenmalige factuur ──
    if (sleutel.bron === 'invoice') {
      const { data: inv } = await admin.from('invoices').select('*').eq('id', sleutel.bronId).maybeSingle()
      if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden.' }, { status: 404 })
      const definitief = ['verstuurd', 'gefactureerd', 'betaald'].includes(String(inv.status))
      if (b.actie === 'annuleer') {
        if (definitief) return NextResponse.json({ error: NIET_TE_ANNULEREN }, { status: 400 })
        const patch: Record<string, unknown> = { status: 'geannuleerd', cancelled_at: new Date().toISOString(), cancelled_by_email: actor.email ?? null }
        let { error } = await admin.from('invoices').update(patch).eq('id', inv.id)
        if (error && /cancelled_/.test(error.message)) ({ error } = await admin.from('invoices').update({ status: 'geannuleerd' }).eq('id', inv.id))
        if (error) throw new Error(error.message)
        try { await admin.from('invoice_wijzigingen').insert({ invoice_id: inv.id, actie: 'geannuleerd', veld: 'status', oud: String(inv.status), nieuw: 'geannuleerd', reden: String(b.reden ?? 'Geannuleerd in de facturatieplanner'), actor_email: actor.email ?? null }) } catch { /* */ }
        await audit(`Factuur geannuleerd (${inv.invoice_date}, € ${Number(inv.amount_excl).toFixed(2)})`)
        klaar(); return NextResponse.json({ ok: true, waarschuwingen })
      }
      if (b.actie === 'verplaats') {
        if (!isDatum(b.datum ?? '')) return NextResponse.json({ error: 'Geef een geldige datum.' }, { status: 400 })
        // Ook een verstuurde of betaalde factuur mag van datum veranderen (een
        // verkeerde datum moet je kunnen rechtzetten); contract en Facturen volgen mee.
        // De vervaldatum schuift mee: geplande datum + betaaltermijn (standaard 30 dagen).
        const termijn = Number(inv.payment_term_days); const dagen = Number.isFinite(termijn) && termijn > 0 ? Math.round(termijn) : 30
        const verval = new Date(`${b.datum}T12:00:00Z`); verval.setUTCDate(verval.getUTCDate() + dagen)
        const { error } = await admin.from('invoices').update({ invoice_date: b.datum, invoice_month: ymVan(b.datum!), due_date: verval.toISOString().slice(0, 10), payment_term_days: dagen, updated_at: new Date().toISOString() }).eq('id', inv.id)
        if (error) throw new Error(error.message)
        try { await admin.from('invoice_wijzigingen').insert({ invoice_id: inv.id, actie: 'verplaatst', veld: 'invoice_date', oud: String(inv.invoice_date).slice(0, 10), nieuw: b.datum, reden: 'Verplaatst in de facturatieplanner', actor_email: actor.email ?? null }) } catch { /* */ }
        await audit(`Factuurdatum verplaatst ${inv.invoice_date} → ${b.datum}`, { van: inv.invoice_date, naar: b.datum })
        klaar(); return NextResponse.json({ ok: true, waarschuwingen })
      }
      if (b.actie === 'heropen') {
        const { error } = await admin.from('invoices').update({ status: 'te_versturen', sent_at: null, sent_by_email: null, cancelled_at: null, cancelled_by_email: null, status_reden: null, updated_at: new Date().toISOString() }).eq('id', inv.id)
        if (error) throw new Error(error.message)
        try { await admin.from('invoice_wijzigingen').insert({ invoice_id: inv.id, actie: 'aangepast', veld: 'status', oud: String(inv.status), nieuw: 'te_versturen', reden: 'Teruggezet in de facturatieplanner', actor_email: actor.email ?? null }) } catch { /* */ }
        await audit('Factuur teruggezet naar te factureren')
        klaar(); return NextResponse.json({ ok: true, waarschuwingen })
      }
      if (b.actie === 'verstuurd') {
        const { error } = await admin.from('invoices').update({ status: 'verstuurd', sent_at: new Date().toISOString(), sent_by_email: actor.email ?? null }).eq('id', inv.id)
        if (error) throw new Error(error.message)
        await audit('Factuur gemarkeerd als verstuurd')
        klaar(); return NextResponse.json({ ok: true, waarschuwingen })
      }
    }

    // ── Maand van een terugkerende facturatie ──
    if (sleutel.bron === 'recurring' && sleutel.maand) {
      const { data: rec } = await admin.from('recurring_invoices').select('*').eq('id', sleutel.bronId).maybeSingle()
      if (!rec) return NextResponse.json({ error: 'Terugkerende facturatie niet gevonden.' }, { status: 404 })
      const { data: rij } = await admin.from('recurring_invoice_months').select('*').eq('recurring_id', rec.id).eq('month', sleutel.maand).maybeSingle()
      const definitief = rij && (rij.status === 'verstuurd' || rij.status === 'betaald' || rij.invoice_id)
      const huidigeDatum: string = rij?.billing_date ?? billingDateFor(sleutel.maand, rec.invoice_day)
      if (b.actie === 'annuleer') {
        if (definitief) return NextResponse.json({ error: NIET_TE_ANNULEREN }, { status: 400 })
        await zetMaandStatus(admin, rec.id, sleutel.maand, 'geannuleerd', { id: actor.id, email: actor.email ?? null })
        await admin.from('recurring_invoice_months').update({ cancelled_at: new Date().toISOString(), cancelled_by_email: actor.email ?? null, billing_date: huidigeDatum }).eq('recurring_id', rec.id).eq('month', sleutel.maand)
        await audit(`Maand ${sleutel.maand} van terugkerende facturatie geannuleerd`)
        klaar(); return NextResponse.json({ ok: true, waarschuwingen })
      }
      if (b.actie === 'verplaats') {
        if (!isDatum(b.datum ?? '')) return NextResponse.json({ error: 'Geef een geldige datum.' }, { status: 400 })
        // Ook een verstuurde maand mag van datum veranderen; een gekoppelde factuur volgt mee.
        const r: Record<string, unknown> = { recurring_id: rec.id, month: sleutel.maand, status: rij?.status ?? 'te_versturen', billing_date: b.datum }
        const { error } = await admin.from('recurring_invoice_months').upsert(r, { onConflict: 'recurring_id,month' })
        if (error) throw new Error(error.message)
        // Hangt er al een echte factuur aan deze maand, dan krijgt die dezelfde datum.
        if (rij?.invoice_id) await admin.from('invoices').update({ invoice_date: b.datum, invoice_month: ymVan(b.datum!) }).eq('id', rij.invoice_id)
        await audit(`Factuurdatum maand ${sleutel.maand} verplaatst ${huidigeDatum} → ${b.datum}`, { van: huidigeDatum, naar: b.datum })
        klaar(); return NextResponse.json({ ok: true, waarschuwingen })
      }
      if (b.actie === 'heropen') {
        await zetMaandStatus(admin, rec.id, sleutel.maand, 'te_versturen', { id: actor.id, email: actor.email ?? null })
        try { await admin.from('recurring_invoice_months').update({ cancelled_at: null, cancelled_by_email: null, sent_at: null, sent_by_email: null }).eq('recurring_id', rec.id).eq('month', sleutel.maand) } catch { /* kolommen kunnen ontbreken */ }
        await audit(`Maand ${sleutel.maand} teruggezet naar te factureren`)
        klaar(); return NextResponse.json({ ok: true, waarschuwingen })
      }
      if (b.actie === 'verstuurd') {
        const r = await zetMaandStatus(admin, rec.id, sleutel.maand, 'verstuurd', { id: actor.id, email: actor.email ?? null })
        if (r.warning) waarschuwingen.push(r.warning)
        try { await admin.from('recurring_invoice_months').update({ sent_at: new Date().toISOString(), sent_by_email: actor.email ?? null }).eq('recurring_id', rec.id).eq('month', sleutel.maand) } catch { /* kolommen bestaan pas na migratie */ }
        await audit(`Maand ${sleutel.maand} gemarkeerd als verstuurd`)
        klaar(); return NextResponse.json({ ok: true, waarschuwingen })
      }
    }

    if (sleutel.bron === 'wam') return NextResponse.json({ error: 'WAM-termijnen beheer je in Vesting.' }, { status: 400 })
    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
