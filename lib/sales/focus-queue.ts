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
const KLAAR = new Set(['appointment', 'won', 'lost', 'not_interested', 'max_pogingen'])

/** Zo vaak vergeefs bellen, dan gaat de lead uit de belronde. */
export const MAX_GEEN_GEHOOR = 6

/** Zo lang wachten voor een lead na "geen gehoor" opnieuw bovenaan komt.
 *  25 uur en niet 24: dan schuift het belmoment elke dag een uur op en bel je
 *  niet zes keer op exact hetzelfde tijdstip naar iemand die dan nooit kan. */
export const GEEN_GEHOOR_UREN = 25

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

/** Snelknoppen voor "bel me terug over…". Naast deze knoppen kan je altijd een
 *  vrij tijdstip opgeven — zie leesTijdstip. */
export const TERUGBEL_KEUZES: { label: string; minuten: number }[] = [
  { label: '15 min', minuten: 15 },
  { label: '30 min', minuten: 30 },
  { label: '1 uur', minuten: 60 },
  { label: '2 uur', minuten: 120 },
  { label: '4 uur', minuten: 240 },
  { label: 'Morgen 9u', minuten: -1 },   // -1 = volgende werkdag 09:00, zie hieronder
]

/**
 * Een vrij ingetypt tijdstip omzetten naar een echt moment.
 *
 * Dit is wat een gesprek écht oplevert: "bel me om twee uur terug" terwijl het
 * elf uur is. Vaste knoppen dekken dat niet — een half uur of een uur is dan
 * te vroeg en twee uur te laat.
 *
 * Aanvaard wordt:
 *   "14:00" · "14u" · "14u30" · "14.30" · "1430" · "2" (→ 14:00 als het al
 *   later dan 2 is, anders 02:00 — zie hieronder) · "+90" (over 90 minuten)
 *
 * IS HET UUR AL VOORBIJ, dan bedoelt de beller morgen. Zegt iemand om 16u
 * "bel me om 9 uur", dan is dat morgenochtend, niet vanochtend.
 *
 * Geeft null bij iets onbegrijpelijks — dan liever niets zetten dan een
 * verkeerd moment.
 */
export function leesTijdstip(invoer: string, nu: number, tz = 'Europe/Brussels'): number | null {
  const ruw = invoer.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!ruw) return null

  // "+90" of "90m" → over zoveel minuten. Staat los van alle datumlogica.
  const kaal = ruw.replace(/\s/g, '')
  const relatief = /^\+?(\d{1,4})m?$/.exec(kaal)
  if (relatief && (kaal.startsWith('+') || kaal.endsWith('m'))) {
    const min = Number(relatief[1])
    return min > 0 && min <= 60 * 24 * 14 ? nu + min * 60000 : null
  }

  // De Brusselse kalenderdag van nu, zodat "vandaag" klopt ongeacht de server.
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const [jNu, maNu, dNu] = f.format(new Date(nu)).split('-').map(Number)

  const datum = leesDatumdeel(ruw, jNu, maNu, dNu, tz)
  if (datum === 'onleesbaar') return null

  const rest = (datum ? datum.rest : ruw).replace(/\s/g, '')

  // Datum zonder uur → 09:00. Wie een dag noemt zonder tijdstip bedoelt
  // 's ochtends, niet middernacht.
  if (!rest) {
    if (!datum) return null
    return zonedNaarUtc(datum.jaar, datum.maand, datum.dag, 9, 0, tz)
  }

  // "14:00" / "14u30" / "14.30" / "14h30" / "1430" / "14u" / "14"
  const m = /^(\d{1,2})(?:[:.uh]?(\d{2}))?u?$/.exec(rest)
  if (!m) return null
  const uur = Number(m[1])
  const minuut = m[2] === undefined ? 0 : Number(m[2])
  if (!Number.isFinite(uur) || uur > 23 || minuut > 59) return null

  // MÉT datum: precies dat moment, ook als het uur vandaag al voorbij zou zijn.
  // Iemand die "vrijdag 9u" zegt bedoelt vrijdag, niet morgen.
  if (datum) return zonedNaarUtc(datum.jaar, datum.maand, datum.dag, uur, minuut, tz)

  let moment = zonedNaarUtc(jNu, maNu, dNu, uur, minuut, tz)
  // Al voorbij (of exact nu)? Dan bedoelt de beller morgen.
  if (moment <= nu) moment = zonedNaarUtc(jNu, maNu, dNu + 1, uur, minuut, tz)
  return moment
}

/** Weekdagen zoals mensen ze aan de telefoon zeggen. 1 = maandag. */
const WEEKDAGEN: Record<string, number> = {
  ma: 1, maa: 1, maandag: 1,
  di: 2, din: 2, dinsdag: 2,
  wo: 3, woe: 3, woensdag: 3,
  do: 4, don: 4, donderdag: 4,
  vr: 5, vrij: 5, vrijdag: 5,
  za: 6, zat: 6, zaterdag: 6,
  zo: 7, zon: 7, zondag: 7,
}

type Datumdeel = { jaar: number; maand: number; dag: number; rest: string }

/**
 * Het datumgedeelte vooraan de invoer lezen. Geeft `null` als er geen datum
 * in staat (dan geldt de oude "vandaag, anders morgen"-regel) en
 * `'onleesbaar'` bij iets wat wél op een datum lijkt maar niet klopt — dan
 * liever niets zetten dan een verkeerde dag.
 *
 * Herkend: morgen · overmorgen · een weekdag · "volgende week [weekdag]" ·
 * 12/9 · 12-9 · 12/9/2026 · +3d
 */
function leesDatumdeel(
  ruw: string, jNu: number, maNu: number, dNu: number, tz: string,
): Datumdeel | null | 'onleesbaar' {
  const vanaf = (dagen: number, rest: string): Datumdeel => {
    // Via UTC-middag rekenen: zo kan zomertijd nooit een dag verschuiven.
    const d = new Date(Date.UTC(jNu, maNu - 1, dNu + dagen, 12))
    return { jaar: d.getUTCFullYear(), maand: d.getUTCMonth() + 1, dag: d.getUTCDate(), rest }
  }

  // Welke weekdag is het vandaag in Brussel? (1 = maandag)
  const vandaagDag = ((new Date(Date.UTC(jNu, maNu - 1, dNu, 12)).getUTCDay() + 6) % 7) + 1

  let m: RegExpExecArray | null

  if ((m = /^overmorgen\b\s*(.*)$/.exec(ruw))) return vanaf(2, m[1])
  if ((m = /^morgen\b\s*(.*)$/.exec(ruw))) return vanaf(1, m[1])
  if ((m = /^vandaag\b\s*(.*)$/.exec(ruw))) return vanaf(0, m[1])

  // "+3d" of "3d" → over zoveel dagen.
  if ((m = /^\+?(\d{1,3})d\b\s*(.*)$/.exec(ruw))) {
    const n = Number(m[1])
    if (n < 1 || n > 365) return 'onleesbaar'
    return vanaf(n, m[2])
  }

  // "volgende week" — met of zonder weekdag erachter. Zonder weekdag: over een
  // week. Mét: die dag in de KALENDERWEEK na deze, want dat is wat mensen
  // bedoelen ("volgende week dinsdag" is nooit over 13 dagen).
  if ((m = /^volgende\s*week\b\s*([a-z]+)?\s*(.*)$/.exec(ruw))) {
    const woord = m[1] ?? ''
    const dag = WEEKDAGEN[woord]
    if (woord && !dag) {
      // Geen weekdag maar wel een woord: dat kan het uur zijn ("volgende week 14u").
      return vanaf(7, `${woord} ${m[2] ?? ''}`.trim())
    }
    if (!dag) return vanaf(7, m[2] ?? '')
    // Maandag van volgende week + de dagafstand binnen die week.
    // 8 - vandaagDag geeft precies het aantal dagen tot díe maandag: op
    // woensdag (3) is dat 5, op maandag (1) een volle week.
    const naarMaandagVolgende = 8 - vandaagDag
    return vanaf(naarMaandagVolgende + (dag - 1), m[2] ?? '')
  }

  // Een losse weekdag: de EERSTVOLGENDE. Valt hij op vandaag, dan bedoelt de
  // beller volgende week — "bel me dinsdag" zeg je niet óp dinsdag over
  // diezelfde dag; dan noem je een uur.
  if ((m = /^([a-z]+)\b\s*(.*)$/.exec(ruw))) {
    const dag = WEEKDAGEN[m[1]]
    if (dag) {
      const verschil = ((dag - vandaagDag) + 7) % 7
      return vanaf(verschil === 0 ? 7 : verschil, m[2] ?? '')
    }
  }

  // "12/9", "12-9", "12/9/2026"
  if ((m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b\s*(.*)$/.exec(ruw))) {
    const dag = Number(m[1]), maand = Number(m[2])
    if (dag < 1 || dag > 31 || maand < 1 || maand > 12) return 'onleesbaar'
    let jaar = m[3] ? Number(m[3]) : jNu
    if (jaar < 100) jaar += 2000
    // Bestaat die dag echt? "31/2" mag geen 3 maart worden.
    const proef = new Date(Date.UTC(jaar, maand - 1, dag, 12))
    if (proef.getUTCMonth() + 1 !== maand || proef.getUTCDate() !== dag) return 'onleesbaar'
    // Zonder jaartal en al voorbij? Dan bedoelt de beller volgend jaar.
    if (!m[3]) {
      const nuDag = Date.UTC(jNu, maNu - 1, dNu, 12)
      if (proef.getTime() < nuDag) jaar += 1
    }
    void tz
    return { jaar, maand, dag, rest: m[4] ?? '' }
  }

  return null
}

/** Lokale wandkloktijd → echt moment, met correctie voor de zomertijdgrens. */
function zonedNaarUtc(jaar: number, maand: number, dag: number, uur: number, minuut: number, tz: string): number {
  const gok = Date.UTC(jaar, maand - 1, dag, uur, minuut)
  const offset = (utcMs: number) => {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
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
  // 09:00 Brusselse wandkloktijd → echt moment.
  return zonedNaarUtc(
    kandidaat.getUTCFullYear(), kandidaat.getUTCMonth() + 1, kandidaat.getUTCDate(),
    9, 0, 'Europe/Brussels',
  )
}
