// Waarom een prospect afhaakt. Pure module.
//
// VASTE CODES, geen vrij veld als standaard. De hele reden dat we dit
// vastleggen is om er later op te kunnen tellen ("hoeveel procent van de
// bouwbedrijven haakt af op prijs?") — en op vrije tekst valt niet te tellen:
// "te duur", "geen budget" en "budget zit er niet in" zijn dan drie redenen.
//
// De CODE is stabiel en wordt opgeslagen in sales_leads.reden_code; het LABEL
// is vrije tekst en mag hernoemd worden zonder dat de tellingen breken. Bij
// "Anders" mag een toelichting, maar de teller blijft op "anders" staan.

export const REDENEN = [
  { code: 'te_duur',           label: 'Te duur' },
  { code: 'intern',            label: 'Doen we intern' },
  { code: 'al_partner',        label: 'Werken al met iemand' },
  { code: 'geen_behoefte',     label: 'Geen behoefte' },
  { code: 'geen_budget',       label: 'Geen budget' },
  { code: 'verkeerde_persoon', label: 'Verkeerde persoon' },
  // Bewust ZONDER de belofte "later opnieuw proberen": deze fase is een
  // eindpunt. Wil de prospect echt later gebeld worden, dan is dat geen
  // afwijzing maar een terugbelafspraak — daar is de terugbelknop voor.
  { code: 'timing',            label: 'Timing — nu niet' },
  { code: 'slechte_ervaring',  label: 'Slechte ervaring met bureaus' },
  { code: 'anders',            label: 'Anders' },
] as const

export type RedenCode = (typeof REDENEN)[number]['code']

export const REDEN_CODES = REDENEN.map((r) => r.code) as RedenCode[]
export const isRedenCode = (v: unknown): v is RedenCode =>
  typeof v === 'string' && (REDEN_CODES as string[]).includes(v)
export const redenLabel = (code: string | null | undefined): string =>
  REDENEN.find((r) => r.code === code)?.label ?? (code ?? '—')

/** Bij welke fases is een reden verplicht? */
export const REDEN_VERPLICHT = new Set(['not_interested'])

/**
 * De leesbare tekst die in lost_reason komt: het label, bij "Anders" met de
 * toelichting erachter zodat er niets verloren gaat.
 */
export function redenTekst(code: string, toelichting?: string | null): string | null {
  if (!isRedenCode(code)) return null
  const label = redenLabel(code)
  const extra = (toelichting ?? '').trim()
  return code === 'anders' && extra ? `${label} — ${extra.slice(0, 300)}` : label
}

/**
 * Een reden die van buiten komt (Harrie stuurt vrije tekst in `detail`) op een
 * code leggen. Herkent hij niets, dan wordt het 'anders' met de tekst erbij —
 * beter een tellende restcategorie dan een reden die verdwijnt.
 */
export function redenUitTekst(tekst: string | null | undefined): { code: RedenCode; tekst: string } | null {
  const s = (tekst ?? '').trim()
  if (!s) return null
  const k = s.toLowerCase()
  const regels: [RegExp, RedenCode][] = [
    [/te duur|prijs|prijzig|budget te|duurder/, 'te_duur'],
    [/intern|zelf doen|doen we zelf|eigen team/, 'intern'],
    [/al (een )?(partner|bureau|agency)|werken al met|hebben al iemand/, 'al_partner'],
    [/geen behoefte|niet nodig|geen interesse in/, 'geen_behoefte'],
    [/geen budget|budget(je)? (is )?op|geen geld/, 'geen_budget'],
    [/verkeerde persoon|niet de juiste|ben ik niet/, 'verkeerde_persoon'],
    [/timing|later|nu niet|geen tijd|volgend jaar/, 'timing'],
    [/slechte ervaring|teleurgesteld/, 'slechte_ervaring'],
  ]
  for (const [re, code] of regels) {
    if (re.test(k)) return { code, tekst: redenTekst(code) ?? s }
  }
  return { code: 'anders', tekst: `Anders — ${s.slice(0, 300)}` }
}

// ── Oude namen, zolang er nog code naar verwijst ─────────────────────────────
/** @deprecated gebruik REDENEN */
export const GEEN_INTERESSE_REDENEN = REDENEN.map((r) => r.label)

/** De code uit een opgeslagen lost_reason halen (voor oude rijen). */
export function redenGroep(lostReason: string | null | undefined): string | null {
  const s = (lostReason ?? '').trim()
  if (!s) return null
  for (const r of REDENEN) {
    if (s === r.label || s.startsWith(`${r.label} —`)) return r.label
  }
  return s.slice(0, 60)
}
