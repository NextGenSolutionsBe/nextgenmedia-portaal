// Kosten "Video editing student" — pure module (client-safe, getest in tests/video-editing-kost.test.ts).
//
// Gebruikt het bestaande personeelskostenmodel (lib/personeel/kost.ts): het
// tarief dat op de prestatiedatum geldt. Twee bedragen, nooit door elkaar:
//  · loon / vergoeding voor de student = uren × uurloon (basis);
//  · totale kost voor het bedrijf = uren × all-in kost per uur, ENKEL als er
//    werkgevers- of payrollkosten in het tarief staan. Anders tonen we
//    "Loonkost op basis van uurloon" en nooit een volledige werkgeverskost.
// Bij opslaan wordt de berekening een momentopname: een latere
// tariefwijziging verandert historische kosten niet.

import { uurOpbouw, type Tarief } from '@/lib/personeel/kost'
import { leesGetal } from '@/lib/getal'

export type VideoTarief = { tarief_id: string; geldig_vanaf: string; basis_label: string; loon_uur: number; totaal_uur: number; lasten_uur: number; btw_pct: number }
export type VideoBerekening = VideoTarief & {
  uren: number
  loon: number
  totaal: number
  heeftBedrijfskost: boolean
  /** Het bedrag dat als kost geboekt wordt. */
  bedrag: number
  soort: 'bedrijfskost' | 'loonkost_uurloon'
}

const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100

export function videoTarief(t: Tarief): VideoTarief {
  const o = uurOpbouw(t)
  return { tarief_id: t.id, geldig_vanaf: t.geldig_vanaf, basis_label: t.basis_label, loon_uur: r2(o.basis), totaal_uur: r2(o.totaal), lasten_uur: r2(o.lasten), btw_pct: t.btw_pct }
}

/** Uren uit invoer: "2,5" of "2.5"; tussen 0 en 24 per prestatie, op het kwartier niet verplicht. */
export function leesUren(v: unknown): number | null {
  const n = leesGetal(v)
  if (n === null || !(n > 0) || n > 24) return null
  return Math.round(n * 100) / 100
}

export function berekenVideoKost(uren: number, t: VideoTarief): VideoBerekening {
  const heeftBedrijfskost = t.lasten_uur > 0.004
  const loon = r2(uren * t.loon_uur)
  const totaal = r2(uren * (heeftBedrijfskost ? t.totaal_uur : t.loon_uur))
  return { ...t, uren, loon, totaal, heeftBedrijfskost, bedrag: heeftBedrijfskost ? totaal : loon, soort: heeftBedrijfskost ? 'bedrijfskost' : 'loonkost_uurloon' }
}

/** Uitleg voor de notities van de kost (leesbaar in Financiën). */
export function berekeningTekst(b: VideoBerekening): string {
  const f = (x: number) => `€ ${x.toFixed(2).replace('.', ',')}`
  return b.heeftBedrijfskost
    ? `${b.uren} u × ${f(b.totaal_uur)} totale kost per uur = ${f(b.totaal)} (waarvan loon ${b.uren} u × ${f(b.loon_uur)} = ${f(b.loon)}) · tarief vanaf ${b.geldig_vanaf}`
    : `Loonkost op basis van uurloon: ${b.uren} u × ${f(b.loon_uur)} = ${f(b.loon)} · geen werkgevers-/payrollkosten in het tarief · tarief vanaf ${b.geldig_vanaf}`
}
