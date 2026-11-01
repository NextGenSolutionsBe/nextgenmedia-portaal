import { safeMessage } from '@/lib/api-error'
import { leesVerantwoordelijken, naamOfNull } from '@/lib/verkoop/verantwoordelijken'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import {
  isStatus, statusInfo, magAutomatischNaar, vandaagISO, waardeVan,
  type OpdrachtStatus, type Koppelingen, type ContractKoppeling, type FactuurKoppeling,
} from '@/lib/opdrachten'
import { canonicalStatus, statusInfo as contractStatusInfo } from '@/lib/contract-status'
import { logAudit, requestMeta } from '@/lib/audit'
import { koppelAanLead } from '@/lib/sales/lead-opdrachten'
import {
  automatischeStatus, facturatieVan, kolomVan, verplaatsTekst, normaliseerDiensten, normaliseerVia, isBron, bronUitLead,
  type Facturatie,
} from '@/lib/opdrachten-kanban'
import { laadAflettering } from '@/lib/contracten/aflettering-server'
import { voegNotitieToe, notitieSamenvatting, type Auteur } from '@/lib/opdrachten-notities'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'

export const dynamic = 'force-dynamic'

const MIST = /relation .*opdrachten|does not exist|schema cache/i
const HINT = 'De tabel voor opdrachten bestaat nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

const KOLOMMEN_BASIS = 'id, client_id, klant_vrij, titel, omschrijving, status, afgerond_op, created_at'
const KOLOMMEN_FLOW = `${KOLOMMEN_BASIS}, contract_id, invoice_id, lead_id, status_bron, auto_status, status_gewijzigd_op, bedrag_excl, verantwoordelijke`
const KOLOMMEN = `${KOLOMMEN_FLOW}, bron, diensten, offerte_via, offerte_op, stop_reden`
/** Kolommen die pas na latere migraties bestaan. */
const NIEUWE_KOLOMMEN = /contract_id|invoice_id|lead_id|status_bron|auto_status|status_gewijzigd_op|bedrag_excl|verantwoordelijke|bron|diensten|offerte_via|offerte_op|stop_reden/i
const KANBAN_VELDEN = ['bron', 'diensten', 'offerte_via', 'offerte_op', 'stop_reden']
const FLOW_VELDEN = ['contract_id', 'invoice_id', 'lead_id', 'status_bron', 'auto_status', 'status_gewijzigd_op', 'bedrag_excl', 'verantwoordelijke']

/** YYYY-MM-DD of null; onzin = undefined. */
const datum = (v: unknown): string | null | undefined => {
  const s = String(v ?? '').trim()
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) ? s : undefined
}

/** Wie schrijft: naam (voornaam) en e-mail van de ingelogde medewerker. */
async function auteurVan(actor: { id: string; email?: string | null }): Promise<Auteur> {
  const ident = await leesAdminIdentiteit().catch(() => null)
  return { id: actor.id, email: actor.email ?? null, naam: ident?.naam || null }
}

/**
 * Hoeveel er al gefactureerd is per opdracht: met contract via de aflettering
 * van dat contract (alle facturen en maandfacturen), anders via de gekoppelde
 * facturen tegenover het bedrag van de opdracht.
 */
async function laadFacturatie(admin: Admin, rijen: Rij[], koppelingen: Map<string, Koppelingen>): Promise<Map<string, Facturatie>> {
  const contractIds = [...new Set(rijen.map((r) => r.contract_id).filter(Boolean))] as string[]
  let afl = new Map<string, { effectiefCent: number | null; gefactureerdCent: number }>()
  if (contractIds.length) {
    try {
      const m = await laadAflettering(admin, contractIds)
      afl = new Map([...m.entries()].map(([id, a]) => [id, { effectiefCent: a.aflettering.effectiefCent, gefactureerdCent: a.aflettering.gefactureerdCent }]))
    } catch (e) { console.warn('[opdrachten] aflettering laden mislukt:', e instanceof Error ? e.message : e) }
  }
  const uit = new Map<string, Facturatie>()
  for (const r of rijen) {
    const bedragExcl = r.bedrag_excl === null || r.bedrag_excl === undefined ? null : Number(r.bedrag_excl)
    uit.set(r.id, facturatieVan({
      contractId: r.contract_id ?? null,
      aflettering: r.contract_id ? afl.get(r.contract_id) ?? null : null,
      facturen: koppelingen.get(r.id)?.facturen ?? [],
      bedragExcl,
    }))
  }
  return uit
}

/** Waarom schoof de kaart vanzelf? Voor de systeemnotitie. */
const AUTO_REDEN: Record<string, string> = {
  contract_verstuurd: 'contract verstuurd', getekend: 'contract ondertekend', afgerond: 'volledige waarde gefactureerd',
}

const geldigeStatus = (v: unknown): OpdrachtStatus | null => (isStatus(v) ? v : null)

const tekst = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

/** Bedrag in euro (komma of punt), >= 0. Leeg = null; onzin = undefined (weigeren). */
const bedrag = (v: unknown): number | null | undefined => {
  if (v === null || v === undefined) return null
  let t = String(v).trim().replace(/\s|€/g, '')
  if (!t) return null
  // Belgische notatie: "4.950,50" → punten zijn duizendtallen, de komma is het decimaalteken.
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d+)?$/.test(t)) return undefined
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? Math.round(n * 100) / 100 : undefined
}

const uuid = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  return /^[0-9a-f-]{36}$/i.test(s) ? s : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
type Rij = Record<string, unknown> & { id: string; status: OpdrachtStatus; contract_id?: string | null; invoice_id?: string | null; auto_status?: string | null; bedrag_excl?: unknown; lead_id?: string | null }

/**
 * Wat contract en facturen over de opdrachten zeggen — in drie queries voor
 * de hele lijst, niet één per rij.
 *
 * Facturen tellen mee via het gekoppelde contract (alle facturen van dat
 * contract) én via een rechtstreeks gekoppelde factuur (voor werk zonder
 * contract). Een open facturatieopdracht van het contract waarvan de datum
 * bereikt is, betekent "te factureren".
 */
async function laadKoppelingen(admin: Admin, rijen: Rij[]): Promise<Map<string, Koppelingen>> {
  const contractIds = [...new Set(rijen.map((r) => r.contract_id).filter(Boolean))] as string[]
  const invoiceIds = [...new Set(rijen.map((r) => r.invoice_id).filter(Boolean))] as string[]
  const uit = new Map<string, Koppelingen>()
  if (contractIds.length === 0 && invoiceIds.length === 0) return uit

  const [{ data: contracten }, { data: perContract }, { data: los }, { data: opdrachtRijen }] = await Promise.all([
    contractIds.length ? admin.from('contracts').select('id, title, status').in('id', contractIds) : { data: [] },
    contractIds.length ? admin.from('invoices').select('id, status, invoice_date, amount_incl, amount_excl, description, contract_id').in('contract_id', contractIds) : { data: [] },
    invoiceIds.length ? admin.from('invoices').select('id, status, invoice_date, amount_incl, amount_excl, description, contract_id').in('id', invoiceIds) : { data: [] },
    contractIds.length ? admin.from('contract_facturatie_opdrachten').select('contract_id, status, factuurdatum').in('contract_id', contractIds).in('status', ['open', 'controle_vereist']) : { data: [] },
  ])
  const contractVan = new Map<string, ContractKoppeling>()
  for (const c of (contracten ?? []) as { id: string; title: string | null; status: string | null }[]) {
    const key = canonicalStatus(c.status)
    contractVan.set(c.id, { id: c.id, title: c.title, status: key, label: contractStatusInfo(c.status).label })
  }
  type F = FactuurKoppeling & { contract_id: string | null }
  const facturenPerContract = new Map<string, F[]>()
  for (const f of (perContract ?? []) as F[]) {
    if (!f.contract_id) continue
    facturenPerContract.set(f.contract_id, [...(facturenPerContract.get(f.contract_id) ?? []), f])
  }
  const losVan = new Map(((los ?? []) as F[]).map((f) => [f.id, f]))
  const vandaag = vandaagISO()
  const facturatieOpen = new Set<string>()
  for (const o of (opdrachtRijen ?? []) as { contract_id: string; factuurdatum: string | null }[]) {
    if (o.factuurdatum && String(o.factuurdatum).slice(0, 10) <= vandaag) facturatieOpen.add(o.contract_id)
  }

  const kaal = (f: F): FactuurKoppeling => ({ id: f.id, status: f.status, invoice_date: f.invoice_date, amount_incl: f.amount_incl, amount_excl: f.amount_excl ?? null, description: f.description })
  for (const r of rijen) {
    if (!r.contract_id && !r.invoice_id) continue
    const contract = r.contract_id ? contractVan.get(r.contract_id) ?? null : null
    const facturen = new Map<string, FactuurKoppeling>()
    for (const f of r.contract_id ? facturenPerContract.get(r.contract_id) ?? [] : []) facturen.set(f.id, kaal(f))
    const l = r.invoice_id ? losVan.get(r.invoice_id) : null
    if (l) facturen.set(l.id, kaal(l))
    uit.set(r.id, {
      contract,
      facturen: [...facturen.values()].sort((a, b) => (b.invoice_date ?? '').localeCompare(a.invoice_date ?? '')),
      facturatieOpen: !!r.contract_id && facturatieOpen.has(r.contract_id),
    })
  }
  return uit
}

// GET — alle opdrachten met klantnaam, koppelingen en (automatisch bijgewerkte) status.
export async function GET() {
  try {
    const ik = await requireStaff()
    if (!ik) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()

    // Vóór de statusflow-migratie bestaan de koppelkolommen niet: dan valt de
    // selectie terug op de basiskolommen, zodat het scherm blijft werken.
    let nieuweKolommen = true
    let data: unknown = null
    let error: { message: string } | null = null
    for (const [i, kolommen] of [KOLOMMEN, KOLOMMEN_FLOW, KOLOMMEN_BASIS].entries()) {
      const r = await admin.from('opdrachten').select(kolommen).limit(1000)
      data = r.data; error = r.error
      nieuweKolommen = i < 2
      if (!error || !NIEUWE_KOLOMMEN.test(error.message)) break
    }
    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ opdrachten: [], klanten: [], contracten: [], facturen: [], hint: HINT })
      throw new Error(error.message)
    }
    const rijen = (data ?? []) as Rij[]

    const leadIds = [...new Set(rijen.map((r) => r.lead_id).filter(Boolean))] as string[]
    const [{ data: klantRijen }, { data: contractRijen }, { data: factuurRijen }, koppelingen, notities, { data: leadRijen }] = await Promise.all([
      admin.from('clients').select('id, company_name, contact_name, email, sales_verantwoordelijke').is('archived_at', null).order('company_name'),
      // Keuzelijsten voor het koppelen: recente contracten en facturen.
      admin.from('contracts').select('id, title, status, client_id, created_at').neq('status', 'template').order('created_at', { ascending: false }).limit(400),
      admin.from('invoices').select('id, description, status, invoice_date, client_id, contract_id, amount_incl').order('invoice_date', { ascending: false }).limit(400),
      nieuweKolommen ? laadKoppelingen(admin, rijen) : Promise.resolve(new Map<string, Koppelingen>()),
      notitieSamenvatting(admin, rijen.map((r) => r.id)).catch(() => new Map()),
      leadIds.length ? admin.from('sales_leads').select('id, leadbron').in('id', leadIds) : Promise.resolve({ data: [] }),
    ])
    const facturatie = nieuweKolommen ? await laadFacturatie(admin, rijen, koppelingen) : new Map<string, Facturatie>()
    const leadbronVan = new Map(((leadRijen ?? []) as { id: string; leadbron: string | null }[]).map((l) => [l.id, l.leadbron]))

    const klanten = ((klantRijen ?? []) as { id: string; company_name: string | null; contact_name?: string | null; email?: string | null; sales_verantwoordelijke?: string | null }[])
      .map((c) => ({ id: c.id, naam: c.company_name ?? '(zonder naam)', contact_name: c.contact_name ?? null, email: c.email ?? null, verantwoordelijke: c.sales_verantwoordelijke ?? null }))
    const naamVan = new Map(klanten.map((c) => [c.id, c.naam]))

    // Kaart automatisch vooruit zetten: contract verstuurd → Contract,
    // ondertekend → Getekend contract, volledige waarde gefactureerd →
    // Afgerond. Enkel vooruit, nooit weg van een eindpunt, en een al
    // doorgevoerde (of bewust overschreven) stap niet nog eens.
    const nu = new Date().toISOString()
    const opdrachten = await Promise.all(rijen.map(async (o) => {
      const k = koppelingen.get(o.id) ?? null
      const f = facturatie.get(o.id) ?? null
      const afgeleid = automatischeStatus(k, f)
      let status = o.status
      if (nieuweKolommen && magAutomatischNaar(o.status, afgeleid, o.auto_status)) {
        const patch: Record<string, unknown> = { status: afgeleid, status_bron: 'automatisch', auto_status: afgeleid, status_gewijzigd_op: nu, updated_at: nu }
        if (afgeleid === 'afgerond') patch.afgerond_op = nu
        // Voorwaardelijk op de status die we lazen: twee schermen tegelijk
        // open zetten zo geen dubbele systeemnotitie.
        const { data: gelukt, error: e } = await admin.from('opdrachten').update(patch).eq('id', o.id).eq('status', o.status).select('id')
        if (!e && (gelukt ?? []).length) {
          const tekstNotitie = verplaatsTekst(o.status, afgeleid as OpdrachtStatus, { automatisch: AUTO_REDEN[afgeleid as string] ?? 'gekoppelde gegevens' })
          if (tekstNotitie) await voegNotitieToe(admin, o.id, tekstNotitie, 'systeem', null)
          status = afgeleid as OpdrachtStatus; o.status_bron = 'automatisch'; o.status_gewijzigd_op = nu
        }
      }
      const bedragExcl = o.bedrag_excl === null || o.bedrag_excl === undefined ? null : Number(o.bedrag_excl)
      const w = waardeVan({ bedrag_excl: bedragExcl, facturen: k?.facturen ?? [] })
      return {
        ...o,
        status,
        bedrag_excl: bedragExcl,
        klant_naam: o.client_id ? naamVan.get(String(o.client_id)) ?? null : (o.klant_vrij ?? null),
        contract: k?.contract ?? null,
        facturen: k?.facturen ?? [],
        afgeleid,
        waarde: w.waarde,
        waarde_bron: w.bron,
        kolom: kolomVan(status),
        diensten: Array.isArray(o.diensten) ? o.diensten : [],
        facturatie: f,
        notities_aantal: notities.get(o.id)?.aantal ?? 0,
        laatste_notitie: notities.get(o.id)?.laatste ?? null,
        bron_voorstel: o.lead_id ? bronUitLead(leadbronVan.get(String(o.lead_id)) ?? null) : null,
      }
    }))

    const contracten = ((contractRijen ?? []) as { id: string; title: string | null; status: string | null; client_id: string | null }[])
      .map((c) => ({ id: c.id, titel: c.title ?? '(zonder titel)', status: canonicalStatus(c.status), label: contractStatusInfo(c.status).label, client_id: c.client_id }))
    const facturen = ((factuurRijen ?? []) as { id: string; description: string | null; status: string; invoice_date: string | null; client_id: string | null; contract_id: string | null; amount_incl: number | null }[])
      .map((f) => ({ ...f, klant_naam: f.client_id ? naamVan.get(f.client_id) ?? null : null }))

    return NextResponse.json({ opdrachten, klanten, contracten, facturen, verantwoordelijken: await leesVerantwoordelijken(), ik: ik.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** Koppelingen uit het verzoek lezen en controleren dat ze bestaan. */
async function leesKoppelingen(admin: Admin, b: Record<string, unknown>, patch: Record<string, unknown>): Promise<string | null> {
  if ('contract_id' in b) {
    const id = uuid(b.contract_id)
    if (b.contract_id && !id) return 'Dat contract begrijpen we niet.'
    if (id) {
      const { data } = await admin.from('contracts').select('id').eq('id', id).maybeSingle()
      if (!data) return 'Dat contract bestaat niet.'
    }
    patch.contract_id = id
  }
  if ('invoice_id' in b) {
    const id = uuid(b.invoice_id)
    if (b.invoice_id && !id) return 'Die factuur begrijpen we niet.'
    if (id) {
      const { data } = await admin.from('invoices').select('id').eq('id', id).maybeSingle()
      if (!data) return 'Die factuur bestaat niet.'
    }
    patch.invoice_id = id
  }
  if ('lead_id' in b) {
    const id = uuid(b.lead_id)
    if (b.lead_id && !id) return 'Die lead begrijpen we niet.'
    patch.lead_id = id
  }
  return null
}

/** Velden van het bord: bron, diensten, offertekanaal en -datum, reden van stoppen. */
function leesKanban(b: Record<string, unknown>, patch: Record<string, unknown>): string | null {
  if ('bron' in b) {
    if (b.bron && !isBron(b.bron)) return 'Kies inbound of outbound.'
    patch.bron = b.bron || null
  }
  if ('diensten' in b) patch.diensten = normaliseerDiensten(b.diensten)
  if ('offerte_via' in b) patch.offerte_via = normaliseerVia(b.offerte_via)
  if ('offerte_op' in b) {
    const d = datum(b.offerte_op)
    if (d === undefined) return 'Die datum begrijpen we niet.'
    patch.offerte_op = d
  }
  if ('stop_reden' in b) patch.stop_reden = tekst(b.stop_reden, 500)
  return null
}

/** Schrijven met terugval: zonder de nieuwe kolommen (migratie nog niet gedraaid) gaat de rest gewoon door. */
async function schrijf(doe: (patch: Record<string, unknown>) => PromiseLike<{ data?: unknown; error: { message: string } | null }>, patch: Record<string, unknown>) {
  let r = await doe(patch)
  if (r.error && NIEUWE_KOLOMMEN.test(r.error.message)) {
    const zonderKanban = { ...patch }
    for (const k of KANBAN_VELDEN) delete zonderKanban[k]
    r = await doe(zonderKanban)
    if (r.error && NIEUWE_KOLOMMEN.test(r.error.message)) {
      for (const k of FLOW_VELDEN) delete zonderKanban[k]
      r = await doe(zonderKanban)
    }
  }
  return r
}

// POST — nieuwe opdracht.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))

    const titel = tekst(b.titel, 200)
    if (!titel) return NextResponse.json({ error: 'Geef de opdracht een titel.' }, { status: 400 })

    // Klant: ofwel een bestaand dossier, ofwel een vrije naam. Een client_id
    // van buiten controleren we — anders hangt de opdracht aan niets.
    const admin = createAdminSupabaseClient()
    let clientId: string | null = null
    if (b.client_id) {
      const { data: k } = await admin.from('clients').select('id').eq('id', String(b.client_id)).maybeSingle()
      if (!k) return NextResponse.json({ error: 'Die klant bestaat niet.' }, { status: 400 })
      clientId = String(b.client_id)
    }

    const status = geldigeStatus(b.status) ?? 'open'
    const bedragExcl = bedrag(b.bedrag_excl)
    if (bedragExcl === undefined) return NextResponse.json({ error: 'Dat bedrag begrijpen we niet.' }, { status: 400 })
    const rij: Record<string, unknown> = {
      bedrag_excl: bedragExcl,
      client_id: clientId,
      klant_vrij: clientId ? null : tekst(b.klant_vrij, 120),
      titel,
      omschrijving: tekst(b.omschrijving, 4000),
      status,
      verantwoordelijke: naamOfNull(b.verantwoordelijke),
      aangemaakt_door_email: actor.email ?? null,
      status_bron: 'handmatig',
      status_gewijzigd_op: new Date().toISOString(),
    }
    const fout = (await leesKoppelingen(admin, b, rij)) ?? leesKanban(b, rij)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })
    if (rij.offerte_via && !rij.offerte_op && kolomVan(status) === 'offerte') rij.offerte_op = vandaagISO()
    // Geen verantwoordelijke gekozen? Dan die van de klant ("klant van").
    if (!rij.verantwoordelijke && clientId) {
      const { data: k } = await admin.from('clients').select('sales_verantwoordelijke').eq('id', clientId).maybeSingle()
      rij.verantwoordelijke = (k as { sales_verantwoordelijke?: string | null } | null)?.sales_verantwoordelijke ?? null
    }

    const { data, error } = await schrijf((p) => admin.from('opdrachten').insert(p).select('id').single(), rij)
    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }

    // Meteen in de pipeline: aan de lead van dezelfde klant, of een nieuwe lead.
    if (!rij.lead_id) await koppelAanLead(admin, String((data as { id: string }).id), { id: actor.id, email: actor.email ?? null })
    const auteur = await auteurVan(actor)
    const eerste = tekst(b.notitie, 4000)
    if (eerste) await voegNotitieToe(admin, String((data as { id: string }).id), eerste, 'notitie', auteur)
    const meta = requestMeta(req)
    await logAudit({
      action: 'opdracht.create', entityType: 'opdracht', entityId: String((data as { id: string }).id),
      summary: `Opdracht toegevoegd: ${titel} (${statusInfo(status).label})`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id: (data as { id: string }).id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — bijwerken. Enkel de meegestuurde velden veranderen.
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '')
    if (!id) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if ('titel' in b) {
      const t = tekst(b.titel, 200)
      if (!t) return NextResponse.json({ error: 'De titel mag niet leeg zijn.' }, { status: 400 })
      patch.titel = t
    }
    if ('omschrijving' in b) patch.omschrijving = tekst(b.omschrijving, 4000)
    if ('verantwoordelijke' in b) patch.verantwoordelijke = naamOfNull(b.verantwoordelijke)
    if ('client_id' in b) {
      if (b.client_id) {
        const { data: k } = await admin.from('clients').select('id').eq('id', String(b.client_id)).maybeSingle()
        if (!k) return NextResponse.json({ error: 'Die klant bestaat niet.' }, { status: 400 })
        patch.client_id = String(b.client_id)
        patch.klant_vrij = null
      } else {
        patch.client_id = null
      }
    }
    if ('klant_vrij' in b && !patch.client_id) patch.klant_vrij = tekst(b.klant_vrij, 120)
    if ('bedrag_excl' in b) {
      const w = bedrag(b.bedrag_excl)
      if (w === undefined) return NextResponse.json({ error: 'Dat bedrag begrijpen we niet.' }, { status: 400 })
      patch.bedrag_excl = w
    }

    const fout = (await leesKoppelingen(admin, b, patch)) ?? leesKanban(b, patch)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })

    let oud: { status?: string; titel?: string } | null = null
    const { data: voorKlant } = await admin.from('opdrachten').select('client_id, klant_vrij').eq('id', id).maybeSingle()
    const oudKlant = (voorKlant as { client_id?: string | null; klant_vrij?: string | null } | null) ?? null
    if ('status' in b) {
      const s = geldigeStatus(b.status)
      if (!s) return NextResponse.json({ error: 'Onbekende status.' }, { status: 400 })
      const { data } = await admin.from('opdrachten').select('status, titel').eq('id', id).maybeSingle()
      oud = (data as { status?: string; titel?: string } | null) ?? null
      patch.status = s
      patch.status_bron = 'handmatig'
      patch.status_gewijzigd_op = new Date().toISOString()
      // Afrondmoment automatisch zetten en weer wissen: zo klopt "wanneer was
      // dit klaar" altijd, ook als iemand een opdracht heropent.
      patch.afgerond_op = statusInfo(s).eind && s !== 'geannuleerd' && s !== 'geen_interesse' ? new Date().toISOString() : null
      // Naar Offerte gestuurd met een kanaal maar zonder datum: vandaag.
      if (kolomVan(s) === 'offerte' && patch.offerte_via && !('offerte_op' in b)) patch.offerte_op = vandaagISO()
    }

    const { error } = await schrijf((p) => admin.from('opdrachten').update(p).eq('id', id), patch)
    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }
    // Klant gewijzigd of nog niet gekoppeld: koppel aan de juiste lead in de pipeline.
    if (('client_id' in b || 'klant_vrij' in b) && !('lead_id' in b)) {
      const { data: huidig } = await admin.from('opdrachten').select('lead_id, client_id, klant_vrij').eq('id', id).maybeSingle()
      if (huidig && oudKlant && (String(oudKlant.client_id ?? '') !== String(huidig.client_id ?? '') || String(oudKlant.klant_vrij ?? '') !== String(huidig.klant_vrij ?? ''))) {
        await admin.from('opdrachten').update({ lead_id: null }).eq('id', id)
      }
    }
    await koppelAanLead(admin, id, { id: actor.id, email: actor.email ?? null })

    // Na een handmatige statuskeuze de huidige afleiding als "al toegepast"
    // vastleggen: anders zet de volgende lijstlading de correctie meteen weer
    // terug naar wat contract of factuur zeggen.
    if ('status' in b) {
      try {
        const { data: rij } = await admin.from('opdrachten').select(KOLOMMEN_FLOW).eq('id', id).maybeSingle()
        if (rij) {
          const k = await laadKoppelingen(admin, [rij as Rij])
          const f = await laadFacturatie(admin, [rij as Rij], k)
          const afgeleid = automatischeStatus(k.get(id) ?? null, f.get(id) ?? null)
          await admin.from('opdrachten').update({ auto_status: afgeleid }).eq('id', id)
        }
      } catch { /* enkel vóór de migratie; dan is er ook geen automatiek */ }
      if (oud && oud.status !== patch.status) {
        // Tijdlijn van de kaart: waar ging ze heen, en eventueel hoe/waarom.
        const regel = verplaatsTekst(oud.status as OpdrachtStatus, patch.status as OpdrachtStatus, {
          via: (patch.offerte_via as string | null | undefined) ?? null, reden: (patch.stop_reden as string | null | undefined) ?? null,
        })
        if (regel) await voegNotitieToe(admin, id, regel, 'systeem', await auteurVan(actor))
        const meta = requestMeta(req)
        await logAudit({
          action: 'opdracht.status', entityType: 'opdracht', entityId: id,
          summary: `Opdracht "${oud.titel ?? ''}": ${statusInfo(oud.status).label} → ${statusInfo(String(patch.status)).label}`,
          actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
          ip: meta.ip, userAgent: meta.userAgent,
        })
      }
    }
    const extra = tekst(b.notitie, 4000)
    if (extra) await voegNotitieToe(admin, id, extra, 'notitie', await auteurVan(actor))
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id= — echt weg. Afgehandelde opdrachten hoor je af te ronden, niet
// te verwijderen; dit is voor wat er per ongeluk bij kwam.
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!id) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('opdrachten').delete().eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'opdracht.delete', entityType: 'opdracht', entityId: id,
      summary: 'Opdracht verwijderd',
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
