/**
 * Kwartaalcyclus per Media-klant (nieuwe werking fase 7, 28 nov 2026), gerekend
 * vanaf de start van het contract (`clients.media_start`):
 *  1. de maand vóór het kwartaal: strategie, scripts en contentkalender
 *     (management) en de shoot;
 *  2. montage en visuals (uitvoering);
 *  3. de laatste week vóór elke maand: alles klaarzetten ter goedkeuring;
 *  4. in de laatste maand van elk kwartaal: de shoot van het volgende kwartaal
 *     vastleggen. Staat die op de eerste dag van die maand nog niet vast, dan
 *     staat ze in Op te volgen.
 * Pure regels, getest in tests/kwartaalcyclus.test.ts.
 */

export type Maand = string // 'YYYY-MM'

export function maandPlus(m: Maand, n: number): Maand {
  const [j, mm] = m.split('-').map(Number)
  const d = new Date(Date.UTC(j, mm - 1 + n, 1))
  return d.toISOString().slice(0, 7)
}
const maandVan = (dag: string): Maand => dag.slice(0, 7)
/** De startmaand: begint het contract na de eerste van de maand, dan telt de maand erna als eerste maand. */
export function startMaand(mediaStart: string): Maand {
  return Number(mediaStart.slice(8, 10)) > 1 ? maandPlus(maandVan(mediaStart), 1) : maandVan(mediaStart)
}

export type Kwartaal = { nr: number; van: Maand; tot: Maand; maanden: Maand[]; shootMaand: Maand; vastleggenTegen: string }

/**
 * De kwartalen vanaf de start, tot en met het kwartaal waarin `tot` valt (plus het volgende,
 * zodat het vastleggen van de volgende shoot zichtbaar is). Start 1 juni → shoot in mei, de volgende in augustus.
 */
export function kwartalen(mediaStart: string, tot: string, max = 40): Kwartaal[] {
  const eerste = startMaand(mediaStart)
  const uit: Kwartaal[] = []
  for (let k = 0; k < max; k++) {
    const van = maandPlus(eerste, k * 3)
    const maanden = [van, maandPlus(van, 1), maandPlus(van, 2)]
    const shootMaand = maandPlus(van, -1)
    uit.push({ nr: k + 1, van, tot: maanden[2], maanden, shootMaand, vastleggenTegen: `${shootMaand}-01` })
    if (van > maandVan(tot)) break
  }
  return uit
}

export type CyclusTaak = { soort: 'strategie' | 'shoot' | 'montage' | 'goedkeuring' | 'vastleggen'; titel: string; wie: 'management' | 'uitvoering' | 'shoot'; kwartaal: number; maand: Maand }

/** Wat er in een maand te doen is voor één klant (Planning Media). */
export function cyclusVoorMaand(mediaStart: string, maand: Maand): CyclusTaak[] {
  const qs = kwartalen(mediaStart, `${maandPlus(maand, 4)}-01`)
  const uit: CyclusTaak[] = []
  for (const q of qs) {
    if (q.shootMaand === maand) {
      uit.push({ soort: 'strategie', titel: `Strategie, scripts en contentkalender voor kwartaal ${q.nr}`, wie: 'management', kwartaal: q.nr, maand })
      uit.push({ soort: 'shoot', titel: `Shoot voor kwartaal ${q.nr}`, wie: 'shoot', kwartaal: q.nr, maand })
      uit.push({ soort: 'montage', titel: `Montage en visuals voor kwartaal ${q.nr}`, wie: 'uitvoering', kwartaal: q.nr, maand })
    }
    // De shoot van dit kwartaal vastleggen: in de laatste maand van het kwartaal ervoor (= de shootmaand zelf).
    if (q.shootMaand === maand) uit.push({ soort: 'vastleggen', titel: `Shoot van kwartaal ${q.nr} vastleggen`, wie: 'management', kwartaal: q.nr, maand })
    // De laatste week vóór elke contentmaand: alles ter goedkeuring.
    for (const m of q.maanden) if (maandPlus(m, -1) === maand) uit.push({ soort: 'goedkeuring', titel: `Content van ${maandNaam(m)} klaarzetten ter goedkeuring`, wie: 'uitvoering', kwartaal: q.nr, maand })
  }
  return uit
}

/**
 * Welke shoots moeten vastliggen en liggen niet vast? Vanaf de eerste dag van de
 * shootmaand is een niet-vastgelegde shoot te laat. `vastgelegd` = shootmaanden
 * waarvoor er een shoot in de planner staat of die met de hand afgevinkt zijn.
 */
export function shootsTeLaat(mediaStart: string, vandaag: string, vastgelegd: Set<Maand>): Kwartaal[] {
  return kwartalen(mediaStart, vandaag).filter((q) => q.vastleggenTegen <= vandaag && maandPlus(q.shootMaand, 1) > maandVan(vandaag) && !vastgelegd.has(q.shootMaand))
}

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
export const maandNaam = (m: Maand) => MAANDEN[Number(m.slice(5, 7)) - 1] ?? m

// ── Goedkeuring van posts ───────────────────────────────────────────────────

/** De deadline voor de klant: de dag van ter goedkeuring + de termijn (instelling). */
export function goedkeuringDeadline(terGoedkeuringOp: string, dagen: number): string {
  const d = new Date(`${terGoedkeuringOp.slice(0, 10)}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dagen)
  return d.toISOString().slice(0, 10)
}

/** "Keur goed voor do 26 nov. Daarna plannen we in zoals voorgesteld." (enkel met stil akkoord). */
export function deadlineZin(deadline: string, stilAkkoord: boolean): string {
  const dag = new Date(`${deadline}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '')
  return stilAkkoord ? `Keur goed voor ${dag}. Daarna plannen we in zoals voorgesteld.` : `Keur goed voor ${dag}.`
}

/**
 * Mag een post stil goedgekeurd worden? Enkel bij een klant met stil akkoord aan,
 * enkel een post die nog op de klant wacht, en pas na de deadline. Een deadline
 * die er niet is (oude posts) telt nooit.
 */
export function magStilGoedkeuren(p: { status: string; goedkeuring_deadline: string | null }, stilAkkoord: boolean, vandaag: string, wachtStatus: string): boolean {
  return stilAkkoord && p.status === wachtStatus && !!p.goedkeuring_deadline && p.goedkeuring_deadline < vandaag
}

/** Nog een aanpassingsronde? Boven het aantal rondes vraagt het een bevestiging van het team. */
export function rondeStand(rondes: number, max: number): { volgende: number; teamMoetBevestigen: boolean } {
  return { volgende: rondes + 1, teamMoetBevestigen: rondes >= max }
}
