/**
 * Inzoomen op de gsm (27 nov 2026): in de week en de werkweek met twee vingers knijpen
 * toont minder dagen (5, 4, 3, 2 of 1), uit elkaar = meer, tot de hele week. Ingezoomd
 * schuift opzij vegen dag per dag; aan de rand van de week gaat het naar de vorige of
 * volgende week (veeg.ts). Pure regels, getest in tests/agenda-zoom.test.ts.
 *
 * Schaal `s` = hoe breed de strook met alle dagen is tegenover wat je ziet (1 = de hele
 * week past). Begin `o` = waar wat je ziet begint, als deel van de strook (0 = maandag).
 */

/** Hoeveel dagen je kunt zien: de hele periode, of 5, 4, 3, 2 of 1. */
export const zichtStappen = (n: number): number[] => [n, ...[5, 4, 3, 2, 1].filter((k) => k < n)]

/** De schaal waarbij precies k van de n dagen in beeld zijn. */
export const schaalVoor = (n: number, k: number) => n / Math.max(1, Math.min(n, k))

/** Zaterdag en zondag zijn smaller zolang de hele week past; zodra je inzoomt even breed als de rest. */
export const WEEKEND_SMAL = 0.55
export function weekendGewicht(s: number): number {
  if (s <= 1) return WEEKEND_SMAL
  if (s >= 1.4) return 1
  return WEEKEND_SMAL + ((s - 1) / 0.4) * (1 - WEEKEND_SMAL)
}

/** Verder dan dit kan je niet: de laatste dag staat dan rechts. */
export const maxBegin = (s: number) => Math.max(0, 1 - 1 / s)
export const klem = (o: number, s: number) => Math.max(0, Math.min(maxBegin(s), o))

/** Over de rand vegen gaat met weerstand (verend), zoals op een iPhone. */
export function verend(o: number, s: number, f = 0.35): number {
  const max = maxBegin(s)
  if (o < 0) return o * f
  if (o > max) return max + (o - max) * f
  return o
}

const dichtste = (stappen: number[], zicht: number) => stappen.reduce((best, k) => (Math.abs(k - zicht) < Math.abs(best - zicht) ? k : best), stappen[0])

/**
 * Na het knijpen: het aantal dagen dat het dichtst ligt bij wat je ziet. Knijp je duidelijk
 * (meer dan ~13%), dan gaat het minstens één stap in die richting, ook als je net niet ver genoeg kwam.
 */
export function naarStap(n: number, s: number, sBegin?: number): number {
  const stappen = zichtStappen(n)
  let k = dichtste(stappen, n / s)
  if (sBegin) {
    const r = Math.log(s / sBegin)
    if (k === dichtste(stappen, n / sBegin) && Math.abs(r) > 0.12) {
      const i = stappen.indexOf(k)
      k = stappen[Math.max(0, Math.min(stappen.length - 1, i + (r > 0 ? 1 : -1)))]
    }
  }
  return k
}

/** Een opgeslagen keuze (of iets vreemds) naar een geldig aantal dagen voor deze periode. */
export function zichtVoor(n: number, zicht: number | null | undefined): number {
  if (!zicht || !Number.isFinite(zicht) || zicht >= n) return n
  return dichtste(zichtStappen(n), zicht)
}

/**
 * Na het knijpen: de eerste dag die je ziet (een hele dag), zo dat wat onder je vingers
 * lag (`u`, deel van de strook) daar blijft. `fxDeel` = waar de vingers staan (deel van het scherm).
 */
export function beginNaKnijpen(u: number, fxDeel: number, n: number, k: number): number {
  if (k >= n) return 0
  const o = u - fxDeel / schaalVoor(n, k)
  return Math.max(0, Math.min(n - k, Math.round(o * n)))
}

/** Vanaf deze snelheid (px per ms) schuift een korte veeg toch één dag. */
export const SNEL = 0.3
/** Hoe ver de vaart nog doorloopt (ms). */
export const NALOOP_MS = 200

/**
 * Na het vegen: met de vaart verder (hoogstens één scherm) en altijd op een hele dag. `v` = snelheid in px per ms
 * (positief = naar latere dagen, de vinger gaat naar links), `strook` = breedte van alle dagen in px.
 */
export function beginNaVegen(o: number, v: number, strook: number, n: number, k: number, beginStart: number): number {
  if (k >= n || strook <= 0) return 0
  let dag = Math.round((o + (v * NALOOP_MS) / strook) * n)
  if (dag === beginStart && Math.abs(v) >= SNEL) dag += v > 0 ? 1 : -1
  // Hoogstens één scherm per veeg: zo weet je altijd waar je uitkomt.
  dag = Math.max(beginStart - k, Math.min(beginStart + k, dag))
  return Math.max(0, Math.min(n - k, dag))
}

/** Waar de vinger de laatste ~100 ms naartoe ging (px per ms; positief = naar rechts). */
export function snelheid(sporen: { x: number; t: number }[]): number {
  if (sporen.length < 2) return 0
  const laatste = sporen[sporen.length - 1]
  const eerste = sporen.find((p) => laatste.t - p.t <= 100) ?? sporen[0]
  const dt = laatste.t - eerste.t
  return dt > 0 ? (laatste.x - eerste.x) / dt : 0
}

/** Vanaf zo weinig dagen tonen de blokken meer (uur, klant, foto's): er is plaats. */
export const RUIM_TOT = 3

/**
 * Van een plek op de strook (deel 0..1) naar een dag (0 = begin maandag, 4,5 = midden vrijdag)
 * en terug, met de breedte per dag (het weekend kan smaller zijn).
 */
export function dagVanDeel(deel: number, g: number[]): number {
  const tot = g.reduce((a, b) => a + b, 0)
  let rest = deel * tot
  for (let i = 0; i < g.length; i++) {
    if (rest <= g[i]) return i + rest / g[i]
    rest -= g[i]
  }
  return g.length + rest / (g[g.length - 1] || 1)
}
export function deelVanDag(dag: number, g: number[]): number {
  const tot = g.reduce((a, b) => a + b, 0)
  let som = 0
  for (let i = 0; i < g.length; i++) {
    if (dag <= i + 1) return (som + (dag - i) * g[i]) / tot
    som += g[i]
  }
  return (som + (dag - g.length) * (g[g.length - 1] || 1)) / tot
}
