import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit } from '@/lib/audit'
import {
  STANDAARD_CATALOGUS, KLASSIFICATIE_TABELLEN, controleerDienst, controleerKeuze, controleerBedrijf, vindBedrijf, vindDienst, type BedrijfInvoer,
  type Catalogus, type BedrijfRij, type DienstRij, type DienstInvoer, type KlassificatieRij, type KlassificatieVeld,
} from './model'
import { leesDeliverables, netteDeliverables, type Deliverable } from './deliverables'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type Actor = { userId: string; email: string | null; naam: string | null; ip?: string | null; userAgent?: string | null }

// ── Catalogus: per serverinstantie 5 minuten onthouden (voor iedereen gelijk) ──

let cache: { op: number; waarde: Catalogus } | null = null
const CACHE_MS = 5 * 60_000

export function vergeetCatalogus(): void { cache = null }

export async function laadCatalogus(admin: Admin = createAdminSupabaseClient()): Promise<Catalogus> {
  if (cache && Date.now() - cache.op < CACHE_MS) return cache.waarde
  try {
    const [b, d] = await Promise.all([
      admin.from('bedrijven').select('*').order('volgorde'),
      admin.from('diensten_catalogus').select('slug, naam, bedrijf, parent_slug, omschrijving, inbegrepen, niet_inbegrepen, eenheid, terugkerend, actief, volgorde, kleur, min_prijs, min_marge_pct').order('volgorde'),
    ])
    if (b.error || d.error || !b.data?.length) return STANDAARD_CATALOGUS
    const waarde: Catalogus = {
      bedrijven: b.data as BedrijfRij[],
      diensten: ((d.data ?? []) as DienstRij[]).map((x) => ({
        ...x,
        inbegrepen: x.inbegrepen ?? [], niet_inbegrepen: x.niet_inbegrepen ?? [],
        min_prijs: x.min_prijs === null ? null : Number(x.min_prijs),
        min_marge_pct: x.min_marge_pct === null ? null : Number(x.min_marge_pct),
      })),
    }
    cache = { op: Date.now(), waarde }
    return waarde
  } catch {
    return STANDAARD_CATALOGUS
  }
}

export async function bewaarDienst(admin: Admin, invoer: DienstInvoer, bestaand: string | null, actor: Actor): Promise<{ ok: true; dienst: DienstRij } | { ok: false; fout: string }> {
  vergeetCatalogus()
  const cat = await laadCatalogus(admin)
  if (bestaand && !vindDienst(cat, bestaand)) return { ok: false, fout: 'Die dienst bestaat niet meer.' }
  const c = controleerDienst(invoer, cat, bestaand)
  if (!c.ok) return c
  const oud = bestaand ? vindDienst(cat, bestaand) : null
  const rij = { ...c.waarde, updated_at: new Date().toISOString() }
  const { error } = bestaand
    ? await admin.from('diensten_catalogus').update(rij).eq('slug', bestaand)
    : await admin.from('diensten_catalogus').insert(rij)
  if (error) return { ok: false, fout: error.message }
  vergeetCatalogus()
  await logAudit({
    action: bestaand ? 'dienst.wijzig' : 'dienst.nieuw', entityType: 'dienst', entityId: c.waarde.slug,
    summary: `${bestaand ? 'Dienst aangepast' : 'Dienst toegevoegd'}: ${c.waarde.naam}`,
    actorUserId: actor.userId, actorEmail: actor.email, ip: actor.ip, userAgent: actor.userAgent,
    metadata: { oud: oud ? { naam: oud.naam, bedrijf: oud.bedrijf, actief: oud.actief, eenheid: oud.eenheid } : null, nieuw: { naam: c.waarde.naam, bedrijf: c.waarde.bedrijf, actief: c.waarde.actief, eenheid: c.waarde.eenheid } },
  })
  return { ok: true, dienst: c.waarde }
}

/** Merkgegevens van één bedrijf bewaren (Instellingen → Diensten → Bedrijven). */
export async function bewaarBedrijf(admin: Admin, slug: string, invoer: BedrijfInvoer, actor: Actor): Promise<{ ok: true } | { ok: false; fout: string }> {
  vergeetCatalogus()
  const cat = await laadCatalogus(admin)
  const oud = vindBedrijf(cat, slug)
  if (!oud) return { ok: false, fout: 'Dat bedrijf bestaat niet.' }
  const c = controleerBedrijf(invoer)
  if (!c.ok) return c
  const { error } = await admin.from('bedrijven').update({ ...c.waarde, updated_at: new Date().toISOString() }).eq('slug', slug)
  if (error) return { ok: false, fout: error.message }
  vergeetCatalogus()
  await logAudit({
    action: 'bedrijf.merk', entityType: 'bedrijf', entityId: slug, summary: `Merkgegevens aangepast: ${c.waarde.naam}`,
    actorUserId: actor.userId, actorEmail: actor.email, ip: actor.ip, userAgent: actor.userAgent,
    metadata: { oud: { naam: oud.naam, handelsnaam: oud.handelsnaam, website: oud.website ?? null, email: oud.email ?? null, antwoord_email: oud.antwoord_email ?? null }, nieuw: c.waarde },
  })
  return { ok: true }
}

// ── Te classificeren ────────────────────────────────────────────────────────

type Ruw = { id: string; tabel: string; rij_id: string; veld: KlassificatieVeld; voorstel: string | null; reden: string | null; aangemaakt_op: string }

/** De open vragen met wat er op het scherm moet staan (titel, klant, datum). */
export async function klassificatieLijst(admin: Admin = createAdminSupabaseClient()): Promise<KlassificatieRij[]> {
  const { data, error } = await admin.from('te_classificeren')
    .select('id, tabel, rij_id, veld, voorstel, reden, aangemaakt_op')
    .is('opgelost_op', null).order('aangemaakt_op', { ascending: true }).limit(500)
  if (error || !data?.length) return []
  const rijen = (data as Ruw[]).filter((r) => r.tabel in KLASSIFICATIE_TABELLEN)

  const perTabel = new Map<string, string[]>()
  for (const r of rijen) perTabel.set(r.tabel, [...(perTabel.get(r.tabel) ?? []), r.rij_id])

  const SELECT: Record<string, { kolommen: string; titel: (x: Record<string, unknown>) => string; datum: (x: Record<string, unknown>) => string | null }> = {
    opdrachten: { kolommen: 'id, titel, client_id, datum, created_at', titel: (x) => String(x.titel ?? 'Projectkaart'), datum: (x) => (x.datum as string) ?? (x.created_at as string) },
    contracts: { kolommen: 'id, title, client_id, created_at', titel: (x) => String(x.title ?? 'Contract'), datum: (x) => x.created_at as string },
    invoices: { kolommen: 'id, description, client_id, invoice_month, amount_excl', titel: (x) => String(x.description || `Factuur ${String(x.invoice_month ?? '').slice(0, 7)}`), datum: (x) => x.invoice_month as string },
    recurring_invoices: { kolommen: 'id, description, client_id, created_at', titel: (x) => String(x.description || 'Maandreeks'), datum: (x) => x.created_at as string },
    klant_meetings: { kolommen: 'id, titel, klant_naam, client_id, starts_at', titel: (x) => String(x.titel ?? 'Meeting'), datum: (x) => x.starts_at as string },
    purchases: { kolommen: 'id, title, created_at', titel: (x) => String(x.title ?? 'Aankoop'), datum: (x) => x.created_at as string },
    cost_entries: { kolommen: 'id, type, client_id, created_at, amount_excl', titel: (x) => `Kost${x.type ? ` (${x.type})` : ''}`, datum: (x) => x.created_at as string },
    klant_aanvragen: { kolommen: 'id, soort, type, wat, client_id, created_at', titel: (x) => String(x.wat || `${x.soort}: ${x.type}`).slice(0, 90), datum: (x) => x.created_at as string },
    opleveringen: { kolommen: 'id, titel, client_id, created_at', titel: (x) => String(x.titel ?? 'Oplevering'), datum: (x) => x.created_at as string },
  }

  const info = new Map<string, Record<string, unknown>>()
  await Promise.all([...perTabel.entries()].map(async ([tabel, ids]) => {
    const s = SELECT[tabel]
    if (!s) return
    const { data: d } = await admin.from(tabel).select(s.kolommen).in('id', ids)
    for (const x of (d ?? []) as Record<string, unknown>[]) info.set(`${tabel}:${x.id}`, x)
  }))

  const klantIds = [...new Set([...info.values()].map((x) => x.client_id).filter((v): v is string => typeof v === 'string'))]
  const klanten = new Map<string, string>()
  if (klantIds.length) {
    const { data: k } = await admin.from('clients').select('id, company_name').in('id', klantIds)
    for (const x of (k ?? []) as { id: string; company_name: string | null }[]) klanten.set(x.id, x.company_name ?? '')
  }

  return rijen
    .filter((r) => info.has(`${r.tabel}:${r.rij_id}`))
    .map((r) => {
      const x = info.get(`${r.tabel}:${r.rij_id}`)!
      const s = SELECT[r.tabel]
      return {
        ...r,
        titel: s.titel(x),
        klant: (typeof x.client_id === 'string' ? klanten.get(x.client_id) : null) || (x.klant_naam as string | null) || null,
        datum: s.datum(x) ?? null,
        link: KLASSIFICATIE_TABELLEN[r.tabel].link(r.rij_id),
      }
    })
}

/** Aantal open vragen (voor het Command Center, zonder de hele lijst te laden). */
export async function aantalTeClassificeren(admin: Admin = createAdminSupabaseClient()): Promise<number> {
  try {
    const { count } = await admin.from('te_classificeren').select('id', { count: 'exact', head: true }).is('opgelost_op', null)
    return count ?? 0
  } catch { return 0 }
}

/**
 * Een bedrijf of dienst zetten op een record, met wat ervan afhangt:
 * - een contract geeft zijn bedrijf door aan zijn facturen en maandreeksen die nog geen hebben;
 * - een factuur aan zijn regels en kosten die nog geen hebben;
 * - bij een projectkaart komt een gekozen dienst bij de catalogusdiensten (de oude waarden blijven).
 * Overschrijft nooit iets in een ander record dat al een bedrijf heeft.
 */
export async function zetBedrijfOfDienst(admin: Admin, tabel: string, id: string, veld: KlassificatieVeld, keuze: string, actor: Actor, bron = 'classificatie'): Promise<{ ok: true } | { ok: false; fout: string }> {
  if (!(tabel in KLASSIFICATIE_TABELLEN)) return { ok: false, fout: 'Onbekend soort record.' }
  const cat = await laadCatalogus(admin)
  const fout = controleerKeuze(cat, veld, keuze)
  if (fout) return { ok: false, fout }
  if (veld === 'dienst' && !KLASSIFICATIE_TABELLEN[tabel].metDienst) return { ok: false, fout: 'Hier hoort geen dienst bij.' }

  const kolommen = tabel === 'opdrachten' ? 'id, bedrijf, dienst_slugs' : veld === 'dienst' ? 'id, bedrijf, dienst' : 'id, bedrijf'
  const { data: oud, error: leesFout } = await admin.from(tabel).select(kolommen).eq('id', id).maybeSingle()
  if (leesFout) return { ok: false, fout: leesFout.message }
  if (!oud) return { ok: false, fout: 'Dat record bestaat niet meer.' }

  const wijziging: Record<string, unknown> = {}
  if (veld === 'bedrijf') wijziging.bedrijf = keuze
  else if (tabel === 'opdrachten') {
    const huidige: string[] = Array.isArray(oud.dienst_slugs) ? oud.dienst_slugs : []
    wijziging.dienst_slugs = [...new Set([...huidige, keuze])].sort()
    if (!oud.bedrijf) wijziging.bedrijf = vindDienst(cat, keuze)?.bedrijf ?? null
  } else {
    wijziging.dienst = keuze
    if (!oud.bedrijf) wijziging.bedrijf = vindDienst(cat, keuze)?.bedrijf ?? null
  }
  const { error } = await admin.from(tabel).update(wijziging).eq('id', id)
  if (error) return { ok: false, fout: error.message }

  const nieuwBedrijf = (wijziging.bedrijf as string | undefined) ?? null
  if (nieuwBedrijf) {
    if (tabel === 'contracts') {
      await admin.from('invoices').update({ bedrijf: nieuwBedrijf }).eq('contract_id', id).is('bedrijf', null)
      await admin.from('recurring_invoices').update({ bedrijf: nieuwBedrijf }).eq('contract_id', id).is('bedrijf', null)
      await admin.from('invoice_lines').update({ bedrijf: nieuwBedrijf }).eq('contract_id', id).is('bedrijf', null)
    }
    if (tabel === 'invoices') {
      await admin.from('invoice_lines').update({ bedrijf: nieuwBedrijf }).eq('invoice_id', id).is('bedrijf', null)
      await admin.from('invoice_costs').update({ bedrijf: nieuwBedrijf }).eq('invoice_id', id).is('bedrijf', null)
    }
  }

  // De open vraag zelf afsluiten (de trigger doet dat ook voor bedrijf en enkelvoudige dienst).
  const nu = new Date().toISOString()
  await admin.from('te_classificeren')
    .update({ opgelost_op: nu, opgelost_door: actor.userId, opgelost_door_naam: actor.naam ?? actor.email, keuze })
    .eq('tabel', tabel).eq('rij_id', id).eq('veld', veld).is('opgelost_op', null)
  // Wie de trigger afsloot, krijgt hier nog de naam erbij.
  await admin.from('te_classificeren')
    .update({ opgelost_door: actor.userId, opgelost_door_naam: actor.naam ?? actor.email })
    .eq('tabel', tabel).eq('rij_id', id).is('opgelost_door', null).not('opgelost_op', 'is', null)

  const label = veld === 'bedrijf' ? (vindBedrijf(cat, keuze)?.naam ?? keuze) : (vindDienst(cat, keuze)?.naam ?? keuze)
  await logAudit({
    action: veld === 'bedrijf' ? 'bedrijf.zet' : 'dienst.zet', entityType: tabel, entityId: id,
    summary: `${KLASSIFICATIE_TABELLEN[tabel].label}: ${veld} = ${label}`,
    actorUserId: actor.userId, actorEmail: actor.email, ip: actor.ip, userAgent: actor.userAgent,
    metadata: { veld, oud: veld === 'bedrijf' ? oud.bedrijf ?? null : (tabel === 'opdrachten' ? oud.dienst_slugs ?? null : oud.dienst ?? null), nieuw: keuze, bron },
  })
  return { ok: true }
}

/** Eén vraag uit de wachtrij beantwoorden. */
export async function klassificeer(admin: Admin, vraagId: string, keuze: string, actor: Actor): Promise<{ ok: true } | { ok: false; fout: string }> {
  const { data: v } = await admin.from('te_classificeren').select('id, tabel, rij_id, veld, opgelost_op').eq('id', vraagId).maybeSingle()
  if (!v) return { ok: false, fout: 'Die vraag bestaat niet meer.' }
  if (v.opgelost_op) return { ok: true }
  return zetBedrijfOfDienst(admin, v.tabel, v.rij_id, v.veld, keuze, actor)
}

/** Alle open voorstellen van één soort in één keer bevestigen. */
export async function bevestigVoorstellen(admin: Admin, tabel: string, veld: KlassificatieVeld, actor: Actor): Promise<{ ok: true; aantal: number; mislukt: number }> {
  const { data } = await admin.from('te_classificeren').select('id, voorstel')
    .eq('tabel', tabel).eq('veld', veld).is('opgelost_op', null).not('voorstel', 'is', null).limit(500)
  let aantal = 0
  let mislukt = 0
  for (const v of (data ?? []) as { id: string; voorstel: string }[]) {
    const r = await klassificeer(admin, v.id, v.voorstel, actor)
    if (r.ok) aantal++; else mislukt++
  }
  return { ok: true, aantal, mislukt }
}

// ── Standaard-deliverables per dienst (fase 6, punt 65) ─────────────────────
// Aparte vraag, zodat de catalogus blijft werken vóór de migratie.

/** Per dienst de standaard-deliverables. Kolom ontbreekt of fout = leeg. */
export async function laadDeliverables(admin: Admin = createAdminSupabaseClient()): Promise<Record<string, Deliverable[]>> {
  try {
    const { data, error } = await admin.from('diensten_catalogus').select('slug, deliverables')
    if (error || !data) return {}
    const uit: Record<string, Deliverable[]> = {}
    for (const r of data as { slug: string; deliverables: unknown }[]) {
      const l = netteDeliverables(r.deliverables)
      if (l.length) uit[r.slug] = l
    }
    return uit
  } catch { return {} }
}

export async function bewaarDeliverables(admin: Admin, slug: string, tekst: string, actor: Actor): Promise<{ ok: true; deliverables: Deliverable[] } | { ok: false; fout: string }> {
  const cat = await laadCatalogus(admin)
  const dienst = vindDienst(cat, slug)
  if (!dienst) return { ok: false, fout: 'Die dienst bestaat niet meer.' }
  const lijst = leesDeliverables(tekst)
  const { error } = await admin.from('diensten_catalogus').update({ deliverables: lijst, updated_at: new Date().toISOString() }).eq('slug', slug)
  if (error) return { ok: false, fout: /deliverables/.test(error.message) ? 'De databank kent de deliverables nog niet (migratie).' : error.message }
  await logAudit({
    action: 'dienst.deliverables', entityType: 'dienst', entityId: slug, summary: `Deliverables aangepast: ${dienst.naam}`,
    actorUserId: actor.userId, actorEmail: actor.email, ip: actor.ip, userAgent: actor.userAgent,
    metadata: { deliverables: lijst },
  })
  return { ok: true, deliverables: lijst }
}
