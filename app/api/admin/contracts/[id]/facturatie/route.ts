import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { facturatieLijst, VERWACHTE_FACTURATIELOCATIE, clickupConfigured, completeInvoiceTask, plaatsTaakOpmerking } from '@/lib/clickup'
import { verwerkOndertekening, synchroniseerOpdracht, type Opdracht } from '@/lib/facturatie/opdrachten'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Facturatieopdrachten van één contract: lezen, (opnieuw) synchroniseren met
 * ClickUp, status zetten, koppelen aan de factuur die het team in Facturen
 * aanmaakte, of — voor contracten van vóór de automatisering — de opdrachten
 * alsnog aanmaken. Nooit een ClickUp-taak verwijderen.
 */

const UUID = /^[0-9a-f-]{36}$/i

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const [{ data: opdrachten }, { data: log }, lijst] = await Promise.all([
      admin.from('contract_facturatie_opdrachten').select('*').eq('contract_id', params.id).order('factuurdatum').order('volgnr'),
      admin.from('contract_facturatie_log').select('id, gebeurtenis, sync_status, fout, poging, clickup_task_id, created_at').eq('contract_id', params.id).order('created_at', { ascending: false }).limit(20),
      facturatieLijst(),
    ])
    return NextResponse.json({
      opdrachten: opdrachten ?? [],
      log: log ?? [],
      // Geen sleutels of id's van andere lijsten: enkel of het klopt, waar het heen gaat, en anders waarom niet.
      lijst: lijst.ok ? { ok: true, pad: lijst.pad, url: lijst.url } : { ok: false, ingesteld: lijst.ingesteld, reden: lijst.reden, verwacht: `${VERWACHTE_FACTURATIELOCATIE.space} → ${VERWACHTE_FACTURATIELOCATIE.folder} → ${VERWACHTE_FACTURATIELOCATIE.list}` },
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const b = await req.json() as { action?: string; opdracht_id?: string; status?: string; invoice_id?: string }
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)
    const audit = (summary: string, entityId: string | null = params.id) => logAudit({
      action: `contract.facturatie.${b.action}`, entityType: 'contract_facturatie_opdrachten', entityId, summary,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent,
    })
    const ververs = () => { try { revalidatePath(`/admin/contracts/${params.id}`) } catch { } }

    const eigenOpdracht = async (id: string | undefined): Promise<Opdracht> => {
      if (!id || !UUID.test(id)) throw new Error('opdracht_id ontbreekt.')
      const { data } = await admin.from('contract_facturatie_opdrachten').select('*').eq('id', id).eq('contract_id', params.id).maybeSingle()
      if (!data) throw new Error('Opdracht niet gevonden bij dit contract.')
      return data as Opdracht
    }

    if (b.action === 'genereer') {
      const r = await verwerkOndertekening(admin, params.id, 'handmatig', actor.email ?? null)
      if (!r.gestart) return NextResponse.json({ error: r.reden ?? 'Niet gestart.' }, { status: 400 })
      await audit(`Facturatieopdrachten aangemaakt: ${r.aangemaakt} nieuw, ${r.bestaand} bestonden al, ClickUp ${r.gesynct} ok / ${r.mislukt} mislukt`)
      ververs()
      return NextResponse.json({ ok: true, ...r })
    }

    if (b.action === 'sync') {
      const o = await eigenOpdracht(b.opdracht_id)
      const r = await synchroniseerOpdracht(admin, o.id)
      await audit(`ClickUp-sync ${r.ok ? 'gelukt' : 'mislukt'} voor facturatieopdracht ${o.volgnr}/${o.aantal}${r.fout ? ` — ${r.fout.slice(0, 120)}` : ''}`, o.id)
      ververs()
      return r.ok ? NextResponse.json({ ok: true, taskId: r.taskId, bijgewerkt: !!r.bijgewerkt }) : NextResponse.json({ error: r.fout ?? 'Synchronisatie mislukt' }, { status: 502 })
    }

    if (b.action === 'sync_alle') {
      const { data } = await admin.from('contract_facturatie_opdrachten').select('id').eq('contract_id', params.id).in('status', ['open', 'controle_vereist'])
      let ok = 0, mislukt = 0
      for (const r of (data ?? []) as { id: string }[]) { const u = await synchroniseerOpdracht(admin, r.id); if (u.ok) ok++; else mislukt++ }
      await audit(`ClickUp-sync alle opdrachten: ${ok} ok, ${mislukt} mislukt`)
      ververs()
      return NextResponse.json({ ok: mislukt === 0, gelukt: ok, mislukt })
    }

    if (b.action === 'status') {
      const o = await eigenOpdracht(b.opdracht_id)
      const status = ['open', 'afgehandeld', 'geannuleerd'].includes(String(b.status)) ? String(b.status) : null
      if (!status) return NextResponse.json({ error: 'Ongeldige status' }, { status: 400 })
      // Van 'controle vereist' naar 'open' kan pas als iemand dat bewust doet; dat is deze actie.
      const { error } = await admin.from('contract_facturatie_opdrachten').update({ status, updated_at: new Date().toISOString() }).eq('id', o.id)
      if (error) throw new Error(error.message)
      try { await admin.from('contract_facturatie_log').insert({ contract_id: params.id, opdracht_id: o.id, gebeurtenis: `status_${status}`, clickup_task_id: o.clickup_task_id, sync_status: o.sync_status, details: { door: actor.email ?? actor.id } }) } catch { }
      await audit(`Facturatieopdracht ${o.volgnr}/${o.aantal} op "${status}" gezet`, o.id)
      ververs()
      return NextResponse.json({ ok: true })
    }

    if (b.action === 'gekoppeld') {
      const o = await eigenOpdracht(b.opdracht_id)
      if (!b.invoice_id || !UUID.test(b.invoice_id)) return NextResponse.json({ error: 'invoice_id ontbreekt' }, { status: 400 })
      const { data: inv } = await admin.from('invoices').select('id, contract_id').eq('id', b.invoice_id).maybeSingle()
      if (!inv) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
      const { error } = await admin.from('contract_facturatie_opdrachten').update({ invoice_id: b.invoice_id, status: 'afgehandeld', updated_at: new Date().toISOString() }).eq('id', o.id)
      if (error) throw new Error(error.message)
      // De factuur bestaat: de ClickUp-taak voor Bram mag dicht, anders wordt er
      // een tweede keer gefactureerd. Met een opmerking erbij die zegt waarom.
      if (o.clickup_task_id && clickupConfigured()) {
        const { data: f } = await admin.from('invoices').select('invoice_date, amount_excl').eq('id', b.invoice_id).maybeSingle()
        await plaatsTaakOpmerking(o.clickup_task_id, `Deze facturatieopdracht is gekoppeld aan een bestaande factuur${f?.invoice_date ? ` van ${String(f.invoice_date).slice(0, 10)}` : ''}${f?.amount_excl != null ? ` (€ ${Number(f.amount_excl).toFixed(2)} excl. btw)` : ''} en is daarmee afgehandeld — niet opnieuw factureren.`)
        await completeInvoiceTask(o.clickup_task_id)
      }
      try { await admin.from('contract_facturatie_log').insert({ contract_id: params.id, opdracht_id: o.id, gebeurtenis: 'factuur_aangemaakt', clickup_task_id: o.clickup_task_id, sync_status: o.sync_status, details: { invoice_id: b.invoice_id, door: actor.email ?? actor.id } }) } catch { }
      await audit(`Factuur aangemaakt vanuit facturatieopdracht ${o.volgnr}/${o.aantal}`, o.id)
      ververs()
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
