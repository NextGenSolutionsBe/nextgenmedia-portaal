import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { inclFromExcl } from '@/lib/invoices'
import { SERVICE_LABELS } from '@/lib/utils'
import { laadAflettering } from '@/lib/contracten/aflettering-server'
import { isActiefItem } from '@/lib/contracten/aflettering'
import { duurUitContract, frequentieUitContract, maandPlus, type Afspraken } from '@/lib/facturatie/factuurvoorstellen'
import { leesVoorwaarden } from '@/lib/contract-voorwaarden-ai'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Factuurvoorstellen vanuit een contract.
 *  GET  → contract- en klantgegevens, vooringevulde afspraken (met bron) en de
 *         periodes die al een factuuritem hebben.
 *  POST {action:'ai'}        → afspraken uit de contract-PDF lezen (suggesties, niets bewaard).
 *  POST {action:'bevestigen'} → ENKEL de bevestigde voorstellen worden factuuritems
 *         "Te factureren" (zelfde tabellen als Facturen). Dubbels zijn onmogelijk:
 *         bestaande periodes worden overgeslagen en voorstel_sleutel is uniek.
 * Rechten: contracts.bekijken → GET; contracts.aanpassen → POST.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: any }
const UUID = /^[0-9a-f-]{36}$/i
const ISO = /^\d{4}-\d{2}-\d{2}$/

async function bestaandePeriodes(admin: Admin, id: string): Promise<Record<string, string>> {
  const afl = (await laadAflettering(admin, [id])).get(id)
  const uit: Record<string, string> = {}
  for (const i of afl?.items ?? []) {
    if (!isActiefItem(i.status)) continue
    const m = i.maand ?? i.datum?.slice(0, 7)
    if (m && !uit[m]) uit[m] = i.omschrijving ?? 'Bestaand factuuritem'
    if (!uit.eenmalig) uit.eenmalig = i.omschrijving ?? 'Bestaand factuuritem'
  }
  // Ook de prestatieperiode van bestaande facturen (factuur in december voor november).
  const { data } = await admin.from('invoices').select('periode, prestatie_van, description, status').eq('contract_id', id)
  for (const f of (data ?? []) as { periode: string | null; prestatie_van: string | null; description: string | null; status: string }[]) {
    if (['geannuleerd', 'gecrediteerd'].includes(f.status)) continue
    for (const m of [f.periode, f.prestatie_van].map((x) => (x && /^\d{4}-\d{2}/.test(x) ? x.slice(0, 7) : null))) if (m && !uit[m]) uit[m] = f.description ?? 'Bestaand factuuritem'
  }
  return uit
}

async function laad(admin: Admin, id: string) {
  const { data: c } = await admin.from('contracts').select('*').eq('id', id).maybeSingle()
  if (!c) throw new Error('Contract niet gevonden')
  const { data: k } = c.client_id ? await admin.from('clients').select('id, company_name, btw_nummer, email, facturatie_email, adres_straat, adres_postcode, adres_gemeente, adres_land').eq('id', c.client_id).maybeSingle() : { data: null }
  const duur = duurUitContract(c.duration_type, c.start_date, c.end_date)
  const freq = frequentieUitContract(c.invoice_frequency, c.duration_type)
  const waarde = c.contract_waarde_excl === null || c.contract_waarde_excl === undefined ? null : Number(c.contract_waarde_excl)
  const perFactuur = c.expected_invoice_amount_excl === null || c.expected_invoice_amount_excl === undefined ? null : Number(c.expected_invoice_amount_excl)
  const stappen = freq && freq !== 'eenmalig' && duur ? Math.ceil(duur / ({ maandelijks: 1, tweemaandelijks: 2, kwartaal: 3, halfjaarlijks: 6, jaarlijks: 12 } as Record<string, number>)[freq]) : freq === 'eenmalig' ? 1 : null
  const afgeleid = perFactuur === null && waarde !== null && stappen ? Math.round((waarde / stappen) * 100) / 100 : null
  const dienst = (c.service_slug ? SERVICE_LABELS[c.service_slug] : null) ?? (c.contract_type && c.contract_type !== 'Niet toegewezen' ? String(c.contract_type).replace(/contract$/i, '').trim() : null) ?? c.title ?? ''
  const afspraken: Afspraken = {
    dienst, klant: k?.company_name ?? '', start: c.start_date ? String(c.start_date).slice(0, 10) : null, frequentie: freq, duurMaanden: duur,
    bedrag: perFactuur ?? afgeleid, btwPct: null, moment: null, dag: null,
  }
  const bron: Record<string, string> = {
    dienst: c.service_slug ? 'Dienst van het contract' : c.contract_type ? 'Contracttype' : 'Titel van het contract',
    start: c.start_date ? 'Startdatum van de looptijd in de app — controleer of de dienstverlening dan start (de ondertekendatum telt niet).' : 'Niet gevonden',
    frequentie: freq ? (c.invoice_frequency ? 'Facturatiefrequentie in de app' : 'Afgeleid uit het looptijdtype') : 'Niet gevonden',
    duurMaanden: duur ? (/^\d+m$/.test(String(c.duration_type)) ? `Looptijd ${c.duration_type}` : 'Afgeleid uit start- en einddatum') : 'Niet gevonden',
    bedrag: perFactuur !== null ? 'Bedrag per factuur in de app' : afgeleid !== null ? `Afgeleid: contractwaarde ÷ ${stappen} periodes — controleer` : 'Niet gevonden',
    btwPct: 'Nog te bevestigen', moment: 'Nog te bevestigen',
  }
  return {
    contract: { id: c.id, title: c.title, start_date: c.start_date, end_date: c.end_date, signed_at: c.signed_at, waarde, status: c.status },
    klant: k ? { naam: k.company_name, btw: k.btw_nummer, email: k.facturatie_email || k.email || null, adres: [k.adres_straat, [k.adres_postcode, k.adres_gemeente].filter(Boolean).join(' '), k.adres_land].filter(Boolean).join(', ') || null } : null,
    velden: c.field_values && typeof c.field_values === 'object' ? c.field_values as Record<string, string> : {},
    afspraken, bron, bestaand: await bestaandePeriodes(admin, id),
    aiBeschikbaar: !!process.env.ANTHROPIC_API_KEY && !!c.pdf_path,
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('contracts', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    return NextResponse.json(await laad(createAdminSupabaseClient(), id))
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const actor = await magIk('contracts', 'aanpassen')
    if (!actor) return NextResponse.json({ error: 'Je hebt geen recht om facturen aan een contract toe te voegen.' }, { status: 403 })
    const admin = createAdminSupabaseClient() as unknown as Admin
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const { data: c } = await admin.from('contracts').select('id, title, client_id, service_slug, pdf_path').eq('id', id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })

    if (b.action === 'ai') {
      if (!c.pdf_path) return NextResponse.json({ error: 'Er is geen contract-PDF om te lezen.' }, { status: 400 })
      const { data: file } = await admin.storage.from('contracts').download(c.pdf_path)
      if (!file) return NextResponse.json({ error: 'De contract-PDF kon niet geladen worden.' }, { status: 400 })
      const voorwaarden = await leesVoorwaarden(Buffer.from(await file.arrayBuffer()).toString('base64'))
      return NextResponse.json({ ok: true, voorwaarden })
    }

    if (b.action === 'bevestigen') {
      if (!c.client_id) return NextResponse.json({ error: 'Koppel eerst een klant aan het contract.' }, { status: 400 })
      const lijst = Array.isArray(b.voorstellen) ? (b.voorstellen as Record<string, unknown>[]).slice(0, 120) : []
      if (!lijst.length) return NextResponse.json({ error: 'Selecteer minstens één voorstel.' }, { status: 400 })
      const termijn = Number.isFinite(Number(b.betaaltermijn)) ? Math.max(0, Math.min(365, Math.round(Number(b.betaaltermijn)))) : 30
      const bestaand = await bestaandePeriodes(admin, id)
      const aangemaakt: string[] = []; const overgeslagen: { periode: string; reden: string }[] = []
      for (const v of lijst) {
        const periode = String(v.periode ?? '')
        const datum = String(v.datum ?? ''), van = String(v.van ?? datum), tot = String(v.tot ?? datum)
        const bedrag = Math.round(Number(v.bedrag_excl) * 100) / 100, btw = Number(v.btw_pct)
        const artikel = String(v.artikel ?? '').trim().slice(0, 200), omschrijving = String(v.omschrijving ?? '').trim().slice(0, 2000)
        if (!/^(\d{4}-\d{2}|eenmalig)$/.test(periode) || !ISO.test(datum) || !ISO.test(van) || !ISO.test(tot) || !(bedrag > 0) || !(btw >= 0 && btw <= 100) || !artikel) { overgeslagen.push({ periode, reden: 'onvolledig' }); continue }
        // Bestaande periode: overslaan, tenzij de gebruiker uitdrukkelijk een extra item wil.
        const maanden = periode === 'eenmalig' ? ['eenmalig'] : Array.from({ length: Math.max(1, (Number(tot.slice(0, 4)) - Number(van.slice(0, 4))) * 12 + Number(tot.slice(5, 7)) - Number(van.slice(5, 7)) + 1) }, (_, j) => maandPlus(van.slice(0, 7), j))
        if (maanden.some((m) => bestaand[m]) && v.forceer !== true) { overgeslagen.push({ periode, reden: 'bestaat al' }); continue }
        const vervaldatum = new Date(datum + 'T12:00:00Z'); vervaldatum.setUTCDate(vervaldatum.getUTCDate() + termijn)
        const rij: Record<string, unknown> = {
          client_id: c.client_id, contract_id: id, service_slug: c.service_slug ?? null, invoice_date: datum, invoice_month: datum.slice(0, 7),
          periode: periode === 'eenmalig' ? datum.slice(0, 7) : periode, prestatie_van: van, prestatie_tot: tot, description: artikel,
          amount_excl: bedrag, vat_pct: btw, amount_incl: inclFromExcl(bedrag, btw), contract_bedrag_excl: bedrag,
          status: 'te_versturen', source: 'contract', kind: 'client', factuur_type: periode === 'eenmalig' ? 'eenmalig' : 'terugkerend', currency: 'EUR',
          payment_term_days: termijn, due_date: vervaldatum.toISOString().slice(0, 10), betaalstatus: 'niet_betaald', betaald_bedrag: 0,
          voorstel_sleutel: `${id}:${periode === 'eenmalig' ? `eenmalig:${datum}` : periode}${v.forceer === true ? `:extra:${datum}` : ''}`, created_by: actor.userId,
        }
        const res = await invoegen(admin, rij)
        if (res === 'dubbel') { overgeslagen.push({ periode, reden: 'bestaat al' }); continue }
        aangemaakt.push(res)
        for (const m of maanden) bestaand[m] = artikel
        try { await admin.from('invoice_lines').insert({ invoice_id: res, volgnr: 1, artikel, omschrijving: omschrijving || artikel, aantal: 1, eenheid: periode === 'eenmalig' ? 'forfait' : 'maand', prijs_excl: bedrag, btw_pct: btw, korting_pct: 0, is_extra: false, classificatie: 'dienst' }) } catch { /* bedrag staat ook op de factuur */ }
        try { await admin.from('invoice_wijzigingen').insert({ invoice_id: res, actie: 'aangemaakt', veld: 'contract', oud: null, nieuw: `Factuurvoorstel bevestigd vanuit contract ${c.title ?? id} (${periode})`, actor_email: actor.email ?? null }) } catch { /* */ }
      }
      const meta = requestMeta(req)
      await logAudit({ action: 'contract.factuurvoorstellen.bevestigd', entityType: 'contract', entityId: id, summary: `${aangemaakt.length} factuurvoorstel(len) bevestigd${overgeslagen.length ? `, ${overgeslagen.length} overgeslagen` : ''}`, actorUserId: actor.userId, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent, metadata: { invoice_ids: aangemaakt, overgeslagen } })
      try { revalidatePath(`/admin/contracts/${id}`); revalidatePath('/admin/contracts'); revalidatePath('/admin/invoices') } catch { }
      return NextResponse.json({ ok: true, aangemaakt: aangemaakt.length, overgeslagen, ...(await laad(admin, id)) })
    }
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** Insert die ontbrekende kolommen laat vallen; een unieke-sleutelfout (zelfde voorstel) = dubbel. */
async function invoegen(admin: Admin, rij: Record<string, unknown>): Promise<string> {
  const p = { ...rij }
  for (let i = 0; i < 8; i++) {
    const { data, error } = await admin.from('invoices').insert(p).select('id').single()
    if (!error) return String(data.id)
    if (error.code === '23505' || /duplicate key/i.test(error.message)) return 'dubbel'
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in p) { delete p[col]; continue }
    throw new Error(error.message)
  }
  throw new Error('Opslaan mislukt')
}
