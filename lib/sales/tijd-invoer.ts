/**
 * Handmatig gewerkte tijd invoeren: van–tot in plaats van de timer.
 *
 * De timer is de gewone weg, maar niet de enige. Wie vergeet te starten, wie
 * belt terwijl de app dicht staat, of wie achteraf een uur wil rechtzetten,
 * moet dat kunnen zonder dat er iemand in de database gaat prutsen.
 *
 * Daar hangt wel een prijskaartje aan: deze uren worden UITBETAALD. Dus
 * gelden dezelfde controles als bij de timer, en enkele die de timer van
 * nature al had:
 *
 *   - een eindtijd na de starttijd, allebei geldige momenten;
 *   - geen tijd in de toekomst — je kunt niet loggen wat nog moet gebeuren;
 *   - een blok van hoogstens MAX_UREN, want een vergeten "tot" wordt anders
 *     stil een dag loon;
 *   - GEEN OVERLAP met een blok dat er al staat. Dat is de belangrijkste:
 *     twee overlappende blokken betekenen twee keer betalen voor hetzelfde
 *     uur, en dat zie je op een maandoverzicht niet terug.
 *
 * Pure module — geen database, geen imports uit Next. Zo draait exact
 * dezelfde controle in het scherm (meteen feedback) en op de server (de
 * echte poortwachter), en is ze te testen.
 */

/** Langste blok dat je in één keer kunt loggen. */
export const MAX_UREN = 16

/** Speling op "in de toekomst": klokken lopen nooit precies gelijk. */
const TOEKOMST_SPELING_MS = 2 * 60_000

export type Blok = { started_at: string; ended_at: string | null }

export type Uitslag =
  | { ok: true; startMs: number; eindMs: number }
  | { ok: false; fout: string }

const tijdje = (ms: number) =>
  new Date(ms).toLocaleString('nl-BE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

/**
 * Overlappen twee periodes? Een blok is half open [start, eind): wie om 10:00
 * stopt en om 10:00 opnieuw begint, overlapt niet — dat is gewoon doorwerken.
 *
 * Een blok zonder eindtijd is een LOPENDE timer. Dat blok loopt tot nu, en
 * verder: je kunt geen tijd bijboeken die de lopende sessie straks zelf nog
 * gaat opeisen. Vandaar oneindig als eind.
 */
export function overlapt(a: { van: number; tot: number }, b: { van: number; tot: number }): boolean {
  return a.van < b.tot && b.van < a.tot
}

/** Een opgeslagen blok als tijdvenster; een lopende timer loopt door tot ∞. */
export function venster(b: Blok): { van: number; tot: number } {
  const van = new Date(b.started_at).getTime()
  const tot = b.ended_at ? new Date(b.ended_at).getTime() : Number.POSITIVE_INFINITY
  return { van, tot }
}

/**
 * Controleert een handmatige invoer. `bestaande` zijn de blokken van DEZELFDE
 * setter; blokken van een collega mogen uiteraard wel overlappen.
 */
export function valideerPeriode(
  startIso: string,
  eindIso: string,
  bestaande: Blok[] = [],
  nu: number = Date.now(),
): Uitslag {
  const startMs = new Date(startIso).getTime()
  const eindMs = new Date(eindIso).getTime()

  if (!Number.isFinite(startMs)) return { ok: false, fout: 'De starttijd is geen geldig moment.' }
  if (!Number.isFinite(eindMs)) return { ok: false, fout: 'De eindtijd is geen geldig moment.' }
  if (eindMs <= startMs) return { ok: false, fout: 'De eindtijd moet ná de starttijd liggen.' }

  if (eindMs > nu + TOEKOMST_SPELING_MS) {
    return { ok: false, fout: 'Je kunt geen tijd loggen die nog moet komen.' }
  }

  const uren = (eindMs - startMs) / 3_600_000
  if (uren > MAX_UREN) {
    return { ok: false, fout: `Dat is ${Math.round(uren)} uur in één blok. Boven ${MAX_UREN} uur klopt er meestal iets niet — splits het op.` }
  }

  const nieuw = { van: startMs, tot: eindMs }
  for (const b of bestaande) {
    const v = venster(b)
    if (!Number.isFinite(v.van)) continue
    if (overlapt(nieuw, v)) {
      return {
        ok: false,
        fout: b.ended_at
          ? `Dit overlapt met een periode die er al staat (${tijdje(v.van)}–${tijdje(v.tot)}).`
          : `Je timer loopt nog, sinds ${tijdje(v.van)}. Stop die eerst, of kies een periode ervóór.`,
      }
    }
  }

  return { ok: true, startMs, eindMs }
}

/**
 * Bouwt de twee momenten uit wat er in het formulier staat: één datum en twee
 * klokuren. Draait de invoer om middernacht, dan hoort "22:00–01:00" bij de
 * volgende dag — anders zou zo'n avondblok als negatief eindigen.
 */
export function uitFormulier(datum: string, van: string, tot: string): { startIso: string; eindIso: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) return null
  if (!/^\d{2}:\d{2}$/.test(van) || !/^\d{2}:\d{2}$/.test(tot)) return null

  const start = new Date(`${datum}T${van}:00`)
  const eind = new Date(`${datum}T${tot}:00`)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(eind.getTime())) return null
  if (eind.getTime() <= start.getTime()) eind.setDate(eind.getDate() + 1)

  return { startIso: start.toISOString(), eindIso: eind.toISOString() }
}
