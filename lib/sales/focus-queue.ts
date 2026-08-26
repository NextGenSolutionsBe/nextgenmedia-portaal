// De belvolgorde in Focus Mode. Pure module — geen server-imports, dezelfde
// logica draait in de browser (de wachtrij herschikt live) en is los testbaar.
//
// HET GEDRAG, afgekeken van hoe een belteam echt werkt:
//   · Zegt iemand "bel over een uur terug", dan verdwijnt die lead uit de rij
//     en KOMT HIJ NA DAT UUR ALS EERSTE terug. Niet ergens achteraan — als
//     eerste, want een afgesproken moment is een belofte.
//   · Leads met een terugbelmoment in de toekomst staan niet in de wachtrij
//     maar in een zijlijst mét aftelling ("over 47 min"), zodat de setter ziet
//     wat eraan komt.
//   · "Niet bellen" komt nooit voorbij. Fases die geen belpoging meer vragen
//     (gewonnen, verloren, afspraak staat al) evenmin.

export type QueueLead = {
  id: string
  stage_key: string
  do_not_call: boolean
  callback_at: string | null
  callback_note?: string | null
}

/** Fases waarvoor bellen geen zin (meer) heeft. "Afspraak ingepland" hoort
 *  daarbij: die mensen bel je via de bevestigingslijst, niet via prospectie. */
const KLAAR = new Set(['appointment', 'won', 'lost', 'not_interested'])

/** Is dit zo'n afgeronde fase? De aanroeper gebruikt dit om te zien of een
 *  bewust gekozen filter de overslaan-regel moet uitschakelen. */
export const isKlaarFase = (stage: string): boolean => KLAAR.has(stage)

export type Wachtrij<L extends QueueLead> = {
  /** Nu te bellen, in volgorde. Vervallen terugbelafspraken staan vooraan. */
  nu: L[]
  /** Terugbellen op een later moment, dichtstbijzijnde eerst. */
  later: L[]
  /** Aantal overgeslagen leads (niet bellen / fase klaar). */
  overgeslagen: number
}

/**
 * De aangeleverde lijst opdelen en ordenen. `volgorde` van de invoer blijft
 * behouden voor gewone leads; alleen terugbelafspraken worden verplaatst.
 *
 * `klaarOverslaan: false` schakelt de fase-filter uit. Nodig wanneer iemand het
 * bord BEWUST op "geen interesse" filtert om die lijst opnieuw te bellen —
 * anders levert precies die keuze een lege belronde op. "Niet bellen" wordt
 * nooit overruled.
 */
export function bouwWachtrij<L extends QueueLead>(
  leads: L[], nu: number, opts?: { klaarOverslaan?: boolean },
): Wachtrij<L> {
  const klaarOverslaan = opts?.klaarOverslaan !== false
  const vervallen: { lead: L; om: number }[] = []
  const gepland: { lead: L; om: number }[] = []
  const gewoon: L[] = []
  let overgeslagen = 0

  for (const l of leads) {
    if (l.do_not_call || (klaarOverslaan && KLAAR.has(l.stage_key))) { overgeslagen++; continue }
    const om = l.callback_at ? new Date(l.callback_at).getTime() : NaN
    if (Number.isFinite(om)) {
      if (om <= nu) vervallen.push({ lead: l, om })
      else gepland.push({ lead: l, om })
    } else {
      gewoon.push(l)
    }
  }

  // Oudste afspraak eerst: wie het langst wacht, is het meest te laat.
  vervallen.sort((a, b) => a.om - b.om)
  gepland.sort((a, b) => a.om - b.om)

  return {
    nu: [...vervallen.map((x) => x.lead), ...gewoon],
    later: gepland.map((x) => x.lead),
    overgeslagen,
  }
}

/** Minuten tot een moment, naar boven afgerond. Verleden → 0. */
export function minutenTot(iso: string, nu: number): number {
  const om = new Date(iso).getTime()
  if (!Number.isFinite(om) || om <= nu) return 0
  return Math.ceil((om - nu) / 60000)
}

/**
 * "over 47 min" / "over 2 u 05" / "NU". Kort, want dit staat in een zijlijst.
 * Boven een etmaal tonen we het moment zelf — "over 1560 min" leest niemand.
 */
export function aftelLabel(iso: string, nu: number): string {
  const min = minutenTot(iso, nu)
  if (min <= 0) return 'NU'
  if (min < 60) return `over ${min} min`
  if (min < 24 * 60) {
    const u = Math.floor(min / 60)
    const rest = min % 60
    return rest === 0 ? `over ${u} u` : `over ${u} u ${String(rest).padStart(2, '0')}`
  }
  return new Date(iso).toLocaleString('nl-BE', {
    weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels',
  })
}

/** De vaste keuzes voor "bel me terug over…". */
export const TERUGBEL_KEUZES: { label: string; minuten: number }[] = [
  { label: '30 min', minuten: 30 },
  { label: '1 uur', minuten: 60 },
  { label: '2 uur', minuten: 120 },
  { label: 'Morgen 9u', minuten: -1 },   // -1 = volgende werkdag 09:00, zie hieronder
]

/**
 * Het moment voor een terugbelkeuze. "Morgen 9u" is de volgende WERKdag om
 * 09:00 Belgische tijd — een vrijdagafspraak hoort op maandag terug te komen,
 * niet op zaterdag wanneer er niemand belt.
 */
export function terugbelMoment(minuten: number, nu: number): number {
  if (minuten > 0) return nu + minuten * 60000

  // Volgende werkdag 09:00 in Brussel. We werken met de Brusselse kalenderdag,
  // niet met die van de server.
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const [j, ma, d] = f.format(new Date(nu)).split('-').map(Number)
  // Kandidaat: morgen; zaterdag/zondag doorschuiven naar maandag.
  let kandidaat = new Date(Date.UTC(j, ma - 1, d + 1))
  while ([0, 6].includes(kandidaat.getUTCDay())) {
    kandidaat = new Date(Date.UTC(kandidaat.getUTCFullYear(), kandidaat.getUTCMonth(), kandidaat.getUTCDate() + 1))
  }
  // 09:00 Brusselse wandkloktijd → echt moment. Offset bepalen via een gok en
  // één correctie, zoals lib/sales/availability.ts dat doet.
  const gok = Date.UTC(kandidaat.getUTCFullYear(), kandidaat.getUTCMonth(), kandidaat.getUTCDate(), 9, 0)
  const offset = (utcMs: number) => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Brussels', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    const p: Record<string, string> = {}
    for (const x of dtf.formatToParts(new Date(utcMs))) p[x.type] = x.value
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)) - utcMs
  }
  let uit = gok - offset(gok)
  const tweede = offset(uit)
  if (tweede !== offset(gok)) uit = gok - tweede
  return uit
}
