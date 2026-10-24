// Klantboeking — pure regels (client-safe, testbaar).
//
// Een klant boekt zelf een gratis meeting van 30 minuten:
//   · minstens 72 uur vooraf ("Boek minstens 3 dagen vooraf.")
//   · enkel tussen 11:00 en 17:00 Belgische tijd, de volledige meeting erbinnen
//     (laatste startuur 16:30)
//   · enkel op een moment dat vrij is: binnen de werkuren van de agenda en
//     niet bezet in Google, ClickUp of de app zelf
// De server rekent de vrije momenten uit en controleert bij het boeken opnieuw.

import { STANDAARD_TIJDZONE, zoneNaarIso, dag, uur, datumLang, datumKort, isEmail, tijdzoneLabel } from '@/lib/meetings/model'

export const KB_DUUR_MIN = 30
export const KB_STAP_MIN = 30
export const KB_MIN_VOORAF_UUR = 72
export const KB_VENSTER = { van: '11:00', tot: '17:00' } as const
export const KB_HORIZON_DAGEN = 28
export const KB_MIN_VOORAF_TEKST = 'Boek minstens 3 dagen vooraf.'
export const KB_TITEL = 'Gratis kennismaking met NextGenMedia'

export type Interval = { start: number; end: number }

const minVan = (u: string) => { const [h, m] = u.split(':').map(Number); return h * 60 + m }
const uurVan = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
const plusDag = (d: string, n: number) => { const [j, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(j, m - 1, dd + n)).toISOString().slice(0, 10) }

/** Startuurtjes binnen het venster, zo dat de meeting er volledig in past: 11:00 … 16:30. */
export function startUren(duur = KB_DUUR_MIN): string[] {
  const uit: string[] = []
  for (let t = minVan(KB_VENSTER.van); t + duur <= minVan(KB_VENSTER.tot); t += KB_STAP_MIN) uit.push(uurVan(t))
  return uit
}

/** Vroegst boekbare moment: nu + 72 uur. */
export const vroegste = (nu: Date): number => nu.getTime() + KB_MIN_VOORAF_UUR * 3600_000

/** Alle kandidaat-momenten (ISO, UTC) in de horizon die aan de tijdsregels voldoen. Werkuren en bezet komen later. */
export function kandidaatSlots(nu: Date, horizonDagen = KB_HORIZON_DAGEN): string[] {
  const grens = vroegste(nu)
  const eerste = dag(new Date(grens).toISOString())
  const uit: string[] = []
  for (let i = 0; i <= horizonDagen; i++) {
    const d = plusDag(eerste, i)
    for (const u of startUren()) {
      const iso = zoneNaarIso(d, u, STANDAARD_TIJDZONE)
      // Bestaat het uur (zomertijd) en ligt het ver genoeg vooruit?
      if (uur(iso) !== u) continue
      if (new Date(iso).getTime() < grens) continue
      uit.push(iso)
    }
  }
  return uit
}

/** Voldoet dit startmoment aan de tijdsregels voor klanten? null = ja, anders de reden. */
export function redenNietBoekbaar(startIso: string, nu: Date, horizonDagen = KB_HORIZON_DAGEN): string | null {
  const t = new Date(startIso).getTime()
  if (!Number.isFinite(t)) return 'Ongeldig tijdstip.'
  if (t < vroegste(nu)) return KB_MIN_VOORAF_TEKST
  if (t > nu.getTime() + (horizonDagen + 4) * 86400_000) return 'Dit moment ligt te ver in de toekomst.'
  const u = uur(startIso)
  if (!startUren().includes(u)) return `Je kan enkel een meeting boeken tussen ${KB_VENSTER.van} en ${KB_VENSTER.tot} (Belgische tijd).`
  if (zoneNaarIso(dag(startIso), u) !== new Date(t).toISOString()) return 'Ongeldig tijdstip.'
  return null
}

const overlapt = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end

/**
 * Vrije momenten: volledig binnen een werkuren-segment en nergens bezet.
 * `werkuren` = de witte segmenten van de agenda (regels, uitzonderingen,
 * bestaande verkoopafspraken); `bezet` = Google, ClickUp en meetings.
 */
export function vrijeSlots(kandidaten: string[], opts: { werkuren: Interval[]; bezet: Interval[]; duur?: number }): string[] {
  const duur = (opts.duur ?? KB_DUUR_MIN) * 60000
  return kandidaten.filter((iso) => {
    const s = { start: new Date(iso).getTime(), end: new Date(iso).getTime() + duur }
    if (!opts.werkuren.some((w) => w.start <= s.start && s.end <= w.end)) return false
    return !opts.bezet.some((b) => overlapt(s, b))
  })
}

/** Per dag gegroepeerd voor het scherm: [{ dag, label, slots: [{ start, uur }] }]. */
export function perDag(slots: string[]): { dag: string; label: string; slots: { start: string; uur: string }[] }[] {
  const uit = new Map<string, { dag: string; label: string; slots: { start: string; uur: string }[] }>()
  for (const s of slots) {
    const d = dag(s)
    if (!uit.has(d)) uit.set(d, { dag: d, label: datumLang(s), slots: [] })
    uit.get(d)!.slots.push({ start: s, uur: uur(s) })
  }
  return [...uit.values()]
}

/**
 * ClickUp-taken als bezet, zoals de agendasync ze in Google zet: een taak met
 * uur loopt van start tot deadline (zonder start een half uur vóór de
 * deadline); een taak zonder uur (ClickUp zet die op 04:00) blokkeert niets.
 */
export function clickupBezet(taken: { startMs: number | null; dueMs: number }[]): Interval[] {
  const uit: Interval[] = []
  for (const t of taken) {
    const zonderUur = t.startMs === null && uur(new Date(t.dueMs).toISOString()) === '04:00'
    if (zonderUur) continue
    let start = t.startMs ?? t.dueMs - 30 * 60000
    if (start >= t.dueMs) start = t.dueMs - 30 * 60000
    uit.push({ start, end: t.dueMs })
  }
  return uit
}

export type BoekingInvoer = { naam?: unknown; email?: unknown; bedrijf?: unknown; reden?: unknown; start?: unknown }
export type GeldigeBoeking = { naam: string; email: string; bedrijf: string | null; reden: string | null; startsAt: string; endsAt: string }

export function valideerBoeking(b: BoekingInvoer, nu: Date): { ok: true; waarde: GeldigeBoeking } | { ok: false; fout: string } {
  const naam = String(b.naam ?? '').trim().slice(0, 120)
  if (naam.length < 2) return { ok: false, fout: 'Vul je naam in.' }
  const email = String(b.email ?? '').trim().toLowerCase()
  if (!isEmail(email)) return { ok: false, fout: 'Vul een geldig e-mailadres in.' }
  const start = String(b.start ?? '')
  const reden = redenNietBoekbaar(start, nu)
  if (reden) return { ok: false, fout: reden }
  const startsAt = new Date(start).toISOString()
  const bedrijf = String(b.bedrijf ?? '').trim().slice(0, 160) || null
  const waarom = String(b.reden ?? '').trim().slice(0, 1000) || null
  return { ok: true, waarde: { naam, email, bedrijf, reden: waarom, startsAt, endsAt: new Date(new Date(startsAt).getTime() + KB_DUUR_MIN * 60000).toISOString() } }
}

/** Titel van de agenda-uitnodiging: herkenbaar voor beide kanten. */
export const kbTitel = (b: { naam: string; bedrijf: string | null }) => `${KB_TITEL} (${b.bedrijf || b.naam})`

/** Bevestigingsmail na boeken of verplaatsen. Enkel gegevens van deze boeking. */
export function bevestigingsMail(b: { naam: string; startsAt: string; meetUrl: string | null; beheerUrl: string; verplaatst?: boolean }): { onderwerp: string; tekst: string; ctaTekst: string; ctaLink: string } {
  const delen = [
    `Beste ${b.naam},`,
    b.verplaatst
      ? `Je meeting met NextGenMedia is verplaatst naar ${datumLang(b.startsAt)} om ${uur(b.startsAt)} (${tijdzoneLabel(STANDAARD_TIJDZONE)}). Ze duurt ${KB_DUUR_MIN} minuten.`
      : `Bedankt voor je boeking. Je gratis meeting met NextGenMedia staat vast op ${datumLang(b.startsAt)} om ${uur(b.startsAt)} (${tijdzoneLabel(STANDAARD_TIJDZONE)}). Ze duurt ${KB_DUUR_MIN} minuten.`,
    b.meetUrl ? `Je neemt deel via Google Meet:\n${b.meetUrl}` : 'De Google Meet-link volgt in de agenda-uitnodiging.',
    'Je krijgt ook een uitnodiging van Google Agenda. De dag ervoor sturen we je nog een korte herinnering.',
    `Past het toch niet? Verplaats of annuleer je meeting via deze persoonlijke link:\n${b.beheerUrl}`,
    'Tot dan,\nNextGenMedia',
  ]
  return {
    onderwerp: `${b.verplaatst ? 'Verplaatst' : 'Bevestigd'}: meeting met NextGenMedia op ${datumKort(b.startsAt)} om ${uur(b.startsAt)}`,
    tekst: delen.join('\n\n'),
    ctaTekst: 'Verplaatsen of annuleren',
    ctaLink: b.beheerUrl,
  }
}
