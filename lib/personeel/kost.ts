// Personeel — kostprijs berekenen. Puur en controleerbaar.
//
// Uitgangspunten:
//  · Geen vaste percentages. Elke medewerker heeft eigen tarieven met eigen
//    lijnen; alles is door een admin in te vullen (standaard staat alles op 0).
//  · Tarieven zijn historisch: een wijziging = een NIEUWE tariefversie met een
//    eigen geldigheidsdatum. Een bestaande versie wordt nooit herschreven,
//    enkel afgesloten. Een goedgekeurde sessie bewaart bovendien haar eigen
//    kostprijs (snapshot), dus een latere tariefwijziging verandert eerdere
//    berekeningen niet.
//  · Alle bedragen excl. btw. Btw (freelancer/onderaannemer) staat apart.
//  · Afronden pas op het einde; onderweg met volle precisie.

export type KostSoort = 'pct' | 'per_uur' | 'per_dag' | 'per_maand' | 'eenmalig'
export const KOST_SOORTEN: { key: KostSoort; label: string; eenheid: string }[] = [
  { key: 'pct', label: '% op het uurloon', eenheid: '%' },
  { key: 'per_uur', label: 'Bedrag per gewerkt uur', eenheid: '€/u' },
  { key: 'per_dag', label: 'Bedrag per gewerkte dag', eenheid: '€/dag' },
  { key: 'per_maand', label: 'Bedrag per maand (met prestaties)', eenheid: '€/maand' },
  { key: 'eenmalig', label: 'Eenmalige kost (op datum)', eenheid: '€' },
]
export const isKostSoort = (s: unknown): s is KostSoort => KOST_SOORTEN.some((k) => k.key === s)

export type KostLijn = { id: string; label: string; soort: KostSoort; waarde: number; datum?: string | null }

/** Suggesties om snel lijnen toe te voegen — altijd met waarde 0, de admin vult in. */
export const LIJN_SUGGESTIES: { label: string; soort: KostSoort }[] = [
  { label: 'Werkgeversbijdragen', soort: 'pct' },
  { label: 'Belastingen / sociale lasten', soort: 'pct' },
  { label: 'Vakantiegeld', soort: 'pct' },
  { label: 'Payroll- of administratiekosten', soort: 'per_maand' },
  { label: 'Verzekeringen', soort: 'per_maand' },
  { label: 'Maaltijdcheques', soort: 'per_dag' },
  { label: 'Verplaatsingskosten', soort: 'per_dag' },
  { label: 'Materiaal- of softwarekosten', soort: 'per_maand' },
  { label: 'Andere kost', soort: 'per_uur' },
]

export type Tarief = {
  id: string
  geldig_vanaf: string
  geldig_tot: string | null
  basis_label: string
  /** Brutouurloon of afgesproken uurprijs (excl. btw). */
  basis_uur: number
  lijnen: KostLijn[]
  /** Btw die een freelancer/onderaannemer aanrekent (informatief; recupereerbaar). */
  btw_pct: number
  /** Referentie om dag- en maandbedragen naar een uurprijs om te rekenen. */
  uren_per_dag: number
  uren_per_maand: number
}

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
export const rond2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100

/** Een tarief uit de databank (jsonb, numeric als string) netjes maken. */
export function normaliseerTarief(r: Record<string, unknown>): Tarief {
  const lijnen = Array.isArray(r.lijnen) ? (r.lijnen as Record<string, unknown>[]) : []
  return {
    id: String(r.id ?? ''),
    geldig_vanaf: String(r.geldig_vanaf ?? '').slice(0, 10),
    geldig_tot: r.geldig_tot ? String(r.geldig_tot).slice(0, 10) : null,
    basis_label: String(r.basis_label ?? 'Brutouurloon'),
    basis_uur: n(r.basis_uur),
    lijnen: lijnen.filter((l) => isKostSoort(l.soort)).map((l, i) => ({
      id: String(l.id ?? `l${i}`), label: String(l.label ?? '').slice(0, 120) || 'Kost', soort: l.soort as KostSoort, waarde: n(l.waarde),
      datum: l.datum ? String(l.datum).slice(0, 10) : null,
    })),
    btw_pct: n(r.btw_pct),
    uren_per_dag: n(r.uren_per_dag) > 0 ? n(r.uren_per_dag) : 8,
    uren_per_maand: n(r.uren_per_maand) > 0 ? n(r.uren_per_maand) : 160,
  }
}

/** Het tarief dat op die dag geldt (de meest recente versie die dan loopt). */
export function tariefOp(tarieven: Tarief[], dag: string): Tarief | null {
  const lopend = tarieven.filter((t) => t.geldig_vanaf <= dag && (!t.geldig_tot || dag <= t.geldig_tot))
  lopend.sort((a, b) => b.geldig_vanaf.localeCompare(a.geldig_vanaf))
  return lopend[0] ?? null
}

/** Kost per gewerkt uur die meteen met de uren meeschaalt: basis + % + €/u. */
export function variabelPerUur(t: Tarief): number {
  let x = t.basis_uur
  for (const l of t.lijnen) {
    if (l.soort === 'pct') x += (t.basis_uur * l.waarde) / 100
    if (l.soort === 'per_uur') x += l.waarde
  }
  return x
}

/** Opsplitsing van één uur: basis, lasten, en de totale all-in kostprijs per uur. */
export function uurOpbouw(t: Tarief): { basis: number; lasten: number; variabel: number; perDagOmgerekend: number; perMaandOmgerekend: number; totaal: number } {
  const variabel = variabelPerUur(t)
  const perDag = t.lijnen.filter((l) => l.soort === 'per_dag').reduce((s, l) => s + l.waarde, 0)
  const perMaand = t.lijnen.filter((l) => l.soort === 'per_maand').reduce((s, l) => s + l.waarde, 0)
  const perDagOmgerekend = perDag / t.uren_per_dag
  const perMaandOmgerekend = perMaand / t.uren_per_maand
  const totaal = variabel + perDagOmgerekend + perMaandOmgerekend
  return { basis: t.basis_uur, lasten: totaal - t.basis_uur, variabel, perDagOmgerekend, perMaandOmgerekend, totaal }
}

/** Kostprijs per uur, dag, week en maand (op basis van de referentie-uren). */
export function kostPer(t: Tarief, dagenPerWeek = 5): { uur: number; dag: number; week: number; maand: number } {
  const uur = uurOpbouw(t).totaal
  return { uur: rond2(uur), dag: rond2(uur * t.uren_per_dag), week: rond2(uur * t.uren_per_dag * dagenPerWeek), maand: rond2(uur * t.uren_per_maand) }
}

/** Snapshot die een sessie bij goedkeuring meekrijgt. */
export type SessieKost = { tarief_id: string | null; kost_per_uur: number; kost_bedrag: number; uren: number; zonder_tarief: boolean }
export function sessieKost(tarief: Tarief | null, minuten: number): SessieKost {
  const uren = minuten / 60
  if (!tarief) return { tarief_id: null, kost_per_uur: 0, kost_bedrag: 0, uren: rond2(uren), zonder_tarief: true }
  const perUur = variabelPerUur(tarief)
  return { tarief_id: tarief.id, kost_per_uur: rond2(perUur), kost_bedrag: rond2(perUur * uren), uren: rond2(uren), zonder_tarief: false }
}

// ── Periodekost ──────────────────────────────────────────────────────────────

export type Werkstuk = {
  dag: string
  minuten: number
  /** Vaste kost uit een snapshot (goedgekeurde sessie); anders rekenen we met het tarief van die dag. */
  vasteKost?: number | null
  ref?: string
  client_id?: string | null
  project?: string | null
}

export type KostRegel = { label: string; soort: KostSoort | 'basis' | 'snapshot'; bedrag: number; toelichting: string }
export type PeriodeKost = {
  uren: number
  dagen: number
  basis: number
  lasten: number
  totaal: number
  btw: number
  regels: KostRegel[]
  /** Uren waarvoor geen tarief bestond (kost 0, maar wel gemeld). */
  urenZonderTarief: number
}

/**
 * De kost van een reeks prestaties in een periode:
 *  · uren × (basis + % + €/u) — of de vaste snapshotkost van een goedgekeurde sessie;
 *  · €/dag één keer per gewerkte dag;
 *  · €/maand één keer per maand waarin gewerkt werd;
 *  · eenmalige kosten waarvan de datum in de periode valt.
 * Elke regel draagt een toelichting, zodat de berekening controleerbaar is.
 */
export function periodeKost(tarieven: Tarief[], werk: Werkstuk[], periode: { van: string; tot: string }): PeriodeKost {
  const regels = new Map<string, KostRegel>()
  const tel = (sleutel: string, label: string, soort: KostRegel['soort'], bedrag: number, toelichting: string) => {
    const r = regels.get(sleutel)
    if (r) { r.bedrag += bedrag; r.toelichting = toelichting } else regels.set(sleutel, { label, soort, bedrag, toelichting })
  }
  let minuten = 0, basis = 0, urenZonderTarief = 0, btw = 0
  const dagen = new Map<string, Tarief | null>()
  const maanden = new Map<string, Tarief | null>()
  const telling = { basisUren: 0, snapshotUren: 0 }

  for (const w of werk) {
    if (w.dag < periode.van || w.dag > periode.tot || w.minuten <= 0) continue
    minuten += w.minuten
    const t = tariefOp(tarieven, w.dag)
    if (!dagen.has(w.dag)) dagen.set(w.dag, t)
    const ym = w.dag.slice(0, 7)
    if (!maanden.has(ym)) maanden.set(ym, t)
    const uren = w.minuten / 60
    if (w.vasteKost !== null && w.vasteKost !== undefined) {
      telling.snapshotUren += uren
      tel('snapshot', 'Goedgekeurde uren (vastgelegde kostprijs)', 'snapshot', w.vasteKost, `${rond2(telling.snapshotUren)} u tegen de kostprijs die bij goedkeuring gold`)
      // Het basisdeel van een snapshot kennen we via het tarief van toen (onveranderd).
      if (t) basis += t.basis_uur * uren
      if (t) btw += (w.vasteKost * t.btw_pct) / 100
      continue
    }
    if (!t) { urenZonderTarief += uren; continue }
    telling.basisUren += uren
    basis += t.basis_uur * uren
    tel('basis', t.basis_label || 'Uurloon', 'basis', t.basis_uur * uren, `${rond2(telling.basisUren)} u × tarief van de dag`)
    for (const l of t.lijnen) {
      if (l.soort === 'pct') tel(`pct:${l.label}`, l.label, 'pct', (t.basis_uur * l.waarde / 100) * uren, `${l.waarde}% op het uurloon`)
      if (l.soort === 'per_uur') tel(`uur:${l.label}`, l.label, 'per_uur', l.waarde * uren, `€ ${l.waarde} per uur`)
    }
    btw += (variabelPerUur(t) * uren * t.btw_pct) / 100
  }

  for (const [dag, t] of dagen) {
    if (!t) continue
    for (const l of t.lijnen) if (l.soort === 'per_dag') tel(`dag:${l.label}`, l.label, 'per_dag', l.waarde, `€ ${l.waarde} per gewerkte dag`)
    void dag
  }
  for (const [, t] of maanden) {
    if (!t) continue
    for (const l of t.lijnen) if (l.soort === 'per_maand') tel(`maand:${l.label}`, l.label, 'per_maand', l.waarde, `€ ${l.waarde} per maand met prestaties`)
  }
  // Eenmalige kosten: uit elke tariefversie, enkel als de datum in de periode valt.
  const gezien = new Set<string>()
  for (const t of tarieven) {
    for (const l of t.lijnen) {
      if (l.soort !== 'eenmalig' || !l.datum) continue
      if (l.datum < periode.van || l.datum > periode.tot) continue
      const k = `${l.label}|${l.datum}|${l.waarde}`
      if (gezien.has(k)) continue
      gezien.add(k)
      tel(`een:${k}`, l.label, 'eenmalig', l.waarde, `eenmalig op ${l.datum}`)
    }
  }

  const lijst = [...regels.values()].map((r) => ({ ...r, bedrag: rond2(r.bedrag) }))
  const totaal = lijst.reduce((s, r) => s + r.bedrag, 0)
  return {
    uren: rond2(minuten / 60), dagen: dagen.size, basis: rond2(basis), lasten: rond2(totaal - basis), totaal: rond2(totaal), btw: rond2(btw),
    regels: lijst, urenZonderTarief: rond2(urenZonderTarief),
  }
}

/**
 * Een nieuwe tariefversie toevoegen zonder de geschiedenis te herschrijven:
 * de vorige lopende versie wordt afgesloten op de dag vóór de nieuwe start.
 * Een nieuwe versie mag niet vóór of op de start van een bestaande versie liggen
 * (anders zou ze een reeds gebruikte berekening overschrijven).
 */
export function planTariefwijziging(bestaand: Tarief[], nieuwVanaf: string): { ok: true; afsluiten: { id: string; geldig_tot: string }[] } | { ok: false; fout: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nieuwVanaf)) return { ok: false, fout: 'Geef een geldige startdatum.' }
  if (bestaand.some((t) => t.geldig_vanaf >= nieuwVanaf)) return { ok: false, fout: 'Er bestaat al een tarief dat op of na deze datum begint. Kies een latere datum; eerdere berekeningen blijven zo ongewijzigd.' }
  const dagErvoor = (() => { const x = new Date(`${nieuwVanaf}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10) })()
  const afsluiten = bestaand.filter((t) => !t.geldig_tot || t.geldig_tot >= nieuwVanaf).map((t) => ({ id: t.id, geldig_tot: dagErvoor }))
  return { ok: true, afsluiten }
}

/** Controle van een tarief dat een admin invult. */
export function controleerTarief(t: Partial<Tarief>): string | null {
  if (!t.geldig_vanaf || !/^\d{4}-\d{2}-\d{2}$/.test(t.geldig_vanaf)) return 'Geef een geldige startdatum.'
  if (n(t.basis_uur) < 0) return 'Het uurloon kan niet negatief zijn.'
  for (const l of t.lijnen ?? []) {
    if (!isKostSoort(l.soort)) return `Onbekende soort bij "${l.label}".`
    if (n(l.waarde) < 0) return `"${l.label}" kan niet negatief zijn.`
    if (l.soort === 'pct' && n(l.waarde) > 500) return `"${l.label}": een percentage boven 500% klopt niet.`
    if (l.soort === 'eenmalig' && (!l.datum || !/^\d{4}-\d{2}-\d{2}$/.test(l.datum))) return `"${l.label}": een eenmalige kost heeft een datum nodig.`
  }
  if (n(t.btw_pct) < 0 || n(t.btw_pct) > 100) return 'Btw-percentage ligt tussen 0 en 100.'
  return null
}
