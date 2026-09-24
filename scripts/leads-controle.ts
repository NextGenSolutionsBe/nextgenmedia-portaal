// Outbound-leads controleren en opschonen ("nog te contacteren" = stage 'outbound').
//
//   npx tsx scripts/leads-controle.ts               → proefronde, wijzigt niets, schrijft een rapport
//   npx tsx scripts/leads-controle.ts --toepassen=<rapport.json>
//                                                   → voert een eerder nagekeken rapport uit (geen nieuwe controle)
//
// Regels (lib/sales/lead-kwaliteit.ts): een lead blijft enkel met een geldig
// telefoonnummer én bewijs dat nummer, naam en website bij elkaar horen (het
// nummer staat op de eigen website), of als hij uit de aangeleverde, goedgekeurde
// lijst komt (label "Limburg operationeel"). Dubbels: de beste versie blijft.
// Uitsluiten = archiveren met reden (herstelbaar), nooit wissen, nooit iets verzinnen.
// Vóór elke wijziging gaat de oude waarde naar sales_opschoning_backup.

import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { telefoonBE, websiteNorm, beoordeel, besteVanGroep, type Telefoon, type Oordeel } from '../lib/sales/lead-kwaliteit'
import { controleerSite, type SiteResultaat as Site } from '../lib/sales/site-controle'

const TOEPASSEN = process.argv.find((a) => a.startsWith('--toepassen='))?.slice(12) ?? null
const RAPPORT = process.argv.find((a) => a.startsWith('--rapport='))?.slice(10) ?? 'leads-controle-rapport.json'
const VERTROUWD_LABEL = 'Limburg operationeel'
const RUN = new Date().toISOString().slice(0, 10)

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((r) => r.includes('=') && !r.startsWith('#')).map((r) => {
  const i = r.indexOf('='); return [r.slice(0, i).trim(), r.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
}))
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

type Bedrijf = { id: string; name: string; website: string | null; phone: string | null }
type Contact = { id: string; phone: string | null; mobile: string | null }
type Lead = {
  id: string; pipeline_id: string | null; stage_key: string; labels: string[] | null; created_at: string
  company_id: string | null; contact_id: string | null
  sales_companies: Bedrijf | null; sales_contacts: Contact | null
}

async function alles<T>(bouw: (van: number, tot: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const uit: T[] = []
  for (let van = 0; ; van += 1000) {
    const { data, error } = await bouw(van, van + 999)
    if (error) throw error
    uit.push(...(data ?? []))
    if (!data || data.length < 1000) return uit
  }
}

async function inParallel<T>(items: T[], n: number, fn: (x: T, i: number) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k) } }))
}

// ── Hoofdprogramma ──────────────────────────────────────────────────────────

async function main() {
  if (TOEPASSEN) {
    const r = JSON.parse(readFileSync(TOEPASSEN, "utf8")) as { rapport: RapportRij[] }
    console.log(`MODUS: toepassen van ${TOEPASSEN} (${r.rapport.length} leads)`)
    return toepassen(r.rapport)
  }
  console.log('MODUS: proefronde (er wordt niets gewijzigd)')
  const leads = await alles<Lead>((a, b) => db.from('sales_leads')
    .select('id,pipeline_id,stage_key,labels,created_at,company_id,contact_id,sales_companies(id,name,website,phone),sales_contacts(id,phone,mobile)')
    .is('archived_at', null).order('created_at').range(a, b) as never)
  console.log(`${leads.length} actieve leads geladen`)

  // Historiek: leads waarop al gebeld of genoteerd werd.
  const events = await alles<{ lead_id: string }>((a, b) => db.from('sales_lead_events').select('lead_id').in('kind', ['call', 'note']).order('id').range(a, b) as never)
  const historiek = new Set(events.map((e) => e.lead_id))

  // Per lead: het telefoonnummer (bedrijf → contact vast → contact gsm) en de website.
  type Rij = { lead: Lead; telefoon: Telefoon; bron: 'bedrijf' | 'contact' | 'gsm' | null; kandidaten: string[]; website: ReturnType<typeof websiteNorm>; vertrouwd: boolean; dubbelVan: string | null; site: Site | null; oordeel?: Oordeel }
  const rijen: Rij[] = leads.map((l) => {
    const co = l.sales_companies, ct = l.sales_contacts
    const bronnen: [Rij['bron'], string | null | undefined][] = [['bedrijf', co?.phone], ['contact', ct?.phone], ['gsm', ct?.mobile]]
    let telefoon: Telefoon = telefoonBE('')
    let bron: Rij['bron'] = null
    const kandidaten: string[] = []
    for (const [b, v] of bronnen) {
      if (!v || !String(v).trim()) continue
      const t = telefoonBE(v)
      if (t.geldig) { kandidaten.push(t.nsn); if (!bron) { telefoon = t; bron = b } }
      else if (!bron && telefoon.geldig === false && telefoon.reden === 'geen telefoonnummer') telefoon = t
    }
    return { lead: l, telefoon, bron, kandidaten, website: websiteNorm(co?.website), vertrouwd: (l.labels ?? []).includes(VERTROUWD_LABEL), dubbelVan: null, site: null }
  })

  // Duplicaten (één lead per bedrijf, over beide pijplijnen heen — zoals createLead):
  // zelfde telefoonnummer of zelfde websitedomein. Bewust níet op naam: "Janssens" of
  // "De Cock" met elk een eigen nummer zijn verschillende bedrijven.
  const ouder = new Map<string, string>()
  const vind = (x: string): string => { let p = ouder.get(x) ?? x; while (p !== (ouder.get(p) ?? p)) p = ouder.get(p) ?? p; ouder.set(x, p); return p }
  const verenig = (a: string, b: string) => { const ra = vind(a), rb = vind(b); if (ra !== rb) ouder.set(rb, ra) }
  const sleutelEerste = new Map<string, string>()
  for (const r of rijen) {
    const sleutels = [
      ...r.kandidaten.map((n) => `tel:${n}`),
      r.website.geldig ? `dom:${r.website.domein}` : null,
    ].filter(Boolean) as string[]
    for (const s of sleutels) {
      const eerste = sleutelEerste.get(s)
      if (eerste) verenig(eerste, r.lead.id); else sleutelEerste.set(s, r.lead.id)
    }
  }
  const groepen = new Map<string, Rij[]>()
  for (const r of rijen) { const g = vind(r.lead.id); groepen.set(g, [...(groepen.get(g) ?? []), r]) }
  const perId = new Map(rijen.map((r) => [r.lead.id, r]))
  for (const g of groepen.values()) {
    if (g.length < 2) continue
    const kandidaten = g.map((r) => ({
      id: r.lead.id, stage_key: r.lead.stage_key, heeftHistoriek: historiek.has(r.lead.id),
      geverifieerd: r.vertrouwd || r.telefoon.geldig,
      volledigheid: [r.telefoon.geldig, r.website.geldig, r.lead.sales_companies?.name, r.lead.contact_id].filter(Boolean).length,
      created_at: r.lead.created_at,
    }))
    const beste = besteVanGroep(kandidaten)
    const naam = perId.get(beste.id)?.lead.sales_companies?.name ?? beste.id
    for (const r of g) if (r.lead.id !== beste.id) r.dubbelVan = `${naam} (${beste.id.slice(0, 8)})`
  }

  // Enkel "nog te contacteren" wordt beoordeeld; andere fases blijven onaangeroerd.
  const scope = rijen.filter((r) => r.lead.stage_key === 'outbound')
  const teControleren = scope.filter((r) => r.telefoon.geldig && !r.dubbelVan && !r.vertrouwd && r.website.geldig)
  console.log(`${scope.length} leads "nog te contacteren", ${teControleren.length} websites te controleren…`)
  let klaar = 0
  await inParallel(teControleren, 24, async (r) => {
    if (!r.website.geldig) return
    r.site = await controleerSite(r.website.url, r.lead.sales_companies?.name ?? '', r.website.domein, r.kandidaten)
    // Staat een ánder bekend nummer van de lead op de site, dan is dát het bewezen nummer.
    if (r.site.telefoonOpSite && r.telefoon.geldig && !r.site.nummers.has(r.telefoon.nsn)) {
      const alt = r.kandidaten.find((n) => r.site!.nummers.has(n))
      if (alt) r.telefoon = telefoonBE(`0${alt}`)
    }
    if (++klaar % 100 === 0) console.log(`  ${klaar}/${teControleren.length}`)
  })

  for (const r of scope) r.oordeel = beoordeel({ telefoon: r.telefoon, website: r.website, site: r.site, dubbelVan: r.dubbelVan, vertrouwd: r.vertrouwd })

  // ── Rapport ──
  const telling: Record<string, number> = {}
  for (const r of scope) telling[r.oordeel!.status] = (telling[r.oordeel!.status] ?? 0) + 1
  const rapport = scope.map((r) => ({
    lead_id: r.lead.id, company_id: r.lead.company_id, pipeline_id: r.lead.pipeline_id, naam: r.lead.sales_companies?.name ?? null,
    telefoon_oud: r.lead.sales_companies?.phone ?? null, telefoon_bron: r.bron, telefoon_norm: r.telefoon.geldig ? r.telefoon.weergave : null,
    website_oud: r.lead.sales_companies?.website ?? null, website_norm: r.website.geldig ? r.website.url : null,
    site_bereikbaar: r.site?.bereikbaar ?? null, telefoon_op_site: r.site?.telefoonOpSite ?? null, naam_op_site: r.site?.naamOpSite ?? null,
    status: r.oordeel!.status, reden: r.oordeel!.reden, behouden: r.oordeel!.behouden, vertrouwd: r.vertrouwd,
  }))
  writeFileSync(RAPPORT, JSON.stringify({ run: RUN, telling, rapport }, null, 1))
  console.log('\nResultaat per status:')
  for (const [k, v] of Object.entries(telling).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(22)} ${v}`)
  console.log(`  ${'behouden'.padEnd(22)} ${rapport.filter((r) => r.behouden).length}`)
  console.log(`  ${'uit te sluiten'.padEnd(22)} ${rapport.filter((r) => !r.behouden).length}`)
  console.log(`Rapport: ${RAPPORT}`)
}

// ── Toepassen (enkel met --toepassen=<rapport>) ─────────────────────────────
//
//   --uitsluiten=geen_telefoon,ongeldig_telefoon,dubbel   welke statussen gearchiveerd worden
//                                                         (standaard: alle niet-behouden)
//   --ook-vertrouwd                                       ook leads uit de aangeleverde lijst uitsluiten
//
// Wat niet wordt uitgesloten krijgt enkel zijn controlestatus (zichtbaar in de lead).

type RapportRij = { lead_id: string; company_id: string | null; naam?: string | null; telefoon_oud: string | null; telefoon_bron: string | null; telefoon_norm: string | null; website_oud: string | null; website_norm: string | null; site_bereikbaar: boolean | null; telefoon_op_site: boolean | null; naam_op_site: boolean | null; status: string; reden: string; behouden: boolean; vertrouwd?: boolean }

async function toepassen(rapport: RapportRij[]) {
  const nu = new Date().toISOString()
  const arg = process.argv.find((a) => a.startsWith('--uitsluiten='))?.slice(13)
  const uitsluitSet = arg ? new Set(arg.split(',').map((s) => s.trim()).filter(Boolean)) : null
  const ookVertrouwd = process.argv.includes('--ook-vertrouwd')

  // Nummers opnieuw lezen met de huidige regels (bv. Nederlandse nummers zonder +).
  for (const r of rapport) {
    if (r.status !== 'ongeldig_telefoon' || r.telefoon_bron) continue
    const t = telefoonBE(r.telefoon_oud)
    if (t.geldig) Object.assign(r, { telefoon_bron: 'bedrijf', telefoon_norm: t.weergave, status: 'niet_verifieerbaar', reden: 'buitenlands nummer — nog niet op de website nagekeken' })
  }
  const weg = (r: RapportRij) => !r.behouden && (uitsluitSet ? uitsluitSet.has(r.status) : true) && (ookVertrouwd || !r.vertrouwd)
  const uit = rapport.filter(weg)
  const blijft = rapport.filter((r) => !weg(r))
  console.log(`Uit te sluiten: ${uit.length} · blijven staan: ${blijft.length}`)

  // 1. Back-up van alles wat we aanraken.
  const ids = rapport.map((r) => r.lead_id)
  const oudeLeads: { id: string; archived_at: string | null; labels: string[] | null; lost_reason: string | null; reden_code: string | null }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('sales_leads').select('id,archived_at,labels,lost_reason,reden_code').in('id', ids.slice(i, i + 200))
    if (error) throw error
    oudeLeads.push(...(data ?? []))
  }
  const bedrijfIds = [...new Set(blijft.filter((r) => r.company_id).map((r) => r.company_id!))]
  const oudeBedrijven: { id: string; phone: string | null; website: string | null }[] = []
  for (let i = 0; i < bedrijfIds.length; i += 200) {
    const { data, error } = await db.from('sales_companies').select('id,phone,website').in('id', bedrijfIds.slice(i, i + 200))
    if (error) throw error
    oudeBedrijven.push(...(data ?? []))
  }
  const backup = [
    ...oudeLeads.map((l) => ({ run: RUN, tabel: 'sales_leads', rij_id: l.id, oud: l })),
    ...oudeBedrijven.map((b) => ({ run: RUN, tabel: 'sales_companies', rij_id: b.id, oud: b })),
  ]
  for (let i = 0; i < backup.length; i += 500) {
    const { error } = await db.from('sales_opschoning_backup').insert(backup.slice(i, i + 500))
    if (error) throw error
  }
  console.log(`Back-up: ${backup.length} rijen (run ${RUN})`)

  // 2. Controleresultaat per lead bewaren (zichtbaar in de lead).
  const controle = rapport.map((r) => ({
    lead_id: r.lead_id, status: r.status, reden: r.reden, telefoon_norm: r.telefoon_norm, website_norm: r.website_norm,
    site_bereikbaar: r.site_bereikbaar, telefoon_op_site: r.telefoon_op_site, naam_op_site: r.naam_op_site, gecontroleerd_op: nu, bron: `opschoning ${RUN}`,
  }))
  for (let i = 0; i < controle.length; i += 500) {
    const { error } = await db.from('sales_lead_controle').upsert(controle.slice(i, i + 500), { onConflict: 'lead_id' })
    if (error) throw error
  }

  // 3. Uitsluiten = archiveren met reden (herstelbaar), niet wissen.
  const oudPerId = new Map(oudeLeads.map((l) => [l.id, l]))
  let gearchiveerd = 0
  const events: { lead_id: string; kind: string; body: string }[] = []
  for (const r of uit) {
    const oud = oudPerId.get(r.lead_id)
    if (!oud || oud.archived_at) continue
    const labels = [...new Set([...(oud.labels ?? []), 'Opschoning uitgesloten'])]
    const { error } = await db.from('sales_leads').update({ archived_at: nu, lost_reason: `Opschoning ${RUN}: ${r.reden}`, reden_code: 'opschoning', labels }).eq('id', r.lead_id).is('archived_at', null)
    if (error) throw error
    events.push({ lead_id: r.lead_id, kind: 'system', body: `Uitgesloten bij opschoning outbound (${RUN}): ${r.reden}. Herstelbaar.` })
    gearchiveerd++
  }
  for (let i = 0; i < events.length; i += 500) await db.from('sales_lead_events').insert(events.slice(i, i + 500))

  // 4. Wat blijft: telefoon (enkel als het bedrijfsnummer de bron was) en website in één notatie.
  const bedrijfOud = new Map(oudeBedrijven.map((b) => [b.id, b]))
  let genormaliseerd = 0
  const gedaan = new Set<string>()
  for (const r of blijft) {
    if (!r.company_id || gedaan.has(r.company_id)) continue
    gedaan.add(r.company_id)
    const oud = bedrijfOud.get(r.company_id)
    if (!oud) continue
    const patch: Record<string, string> = {}
    if (r.telefoon_bron === 'bedrijf' && r.telefoon_norm && oud.phone && oud.phone !== r.telefoon_norm) patch.phone = r.telefoon_norm
    if (r.website_norm && oud.website && oud.website !== r.website_norm) patch.website = r.website_norm
    if (!Object.keys(patch).length) continue
    const { error } = await db.from('sales_companies').update(patch).eq('id', r.company_id)
    if (error) throw error
    genormaliseerd++
  }
  console.log(`Gearchiveerd: ${gearchiveerd} · bedrijven genormaliseerd: ${genormaliseerd}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
