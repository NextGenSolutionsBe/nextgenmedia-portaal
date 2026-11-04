// Factuurnummers — pure module (client-safe, getest in tests/factuurnummer.test.ts).
//
// Bram maakt de factuur in het externe facturatiesysteem en zet het nummer
// hier op het item ("extern factuurnummer"). De nummers lopen per jaar door:
// 2026-123, 2026-124 … en vanaf 1 januari 2027-001. De app stelt het volgende
// nummer zelf voor (hoogste nummer van dit jaar + 1); een startnummer in de
// instellingen gaat voor als de reeks buiten de app hoger staat.

export const FACTUURNUMMER = /^(\d{4})-(\d{1,6})$/

/** "2026-0074" en "2026-74" zijn hetzelfde nummer; onzin geeft null. */
export function leesFactuurnummer(v: unknown): { jaar: number; volgnr: number } | null {
  const m = String(v ?? '').trim().match(FACTUURNUMMER)
  if (!m) return null
  const jaar = Number(m[1]), volgnr = Number(m[2])
  return jaar >= 2000 && jaar <= 2999 && volgnr >= 1 ? { jaar, volgnr } : null
}

/** Volgnummer altijd minstens drie cijfers: 2027-001, 2026-124, 2026-1000. */
export const maakFactuurnummer = (jaar: number, volgnr: number): string => `${jaar}-${String(volgnr).padStart(3, '0')}`

/** Zelfde nummer, ongeacht voorloopnullen of spaties. */
export function zelfdeFactuurnummer(a: unknown, b: unknown): boolean {
  const x = leesFactuurnummer(a), y = leesFactuurnummer(b)
  if (x && y) return x.jaar === y.jaar && x.volgnr === y.volgnr
  const s = String(a ?? '').trim().toLowerCase()
  return s !== '' && s === String(b ?? '').trim().toLowerCase()
}

/**
 * Het volgende nummer voor `jaar`: het hoogste gebruikte nummer van dat jaar
 * + 1, of het startnummer uit de instellingen als dat hoger ligt (enkel als
 * het voor hetzelfde jaar is). Geen nummers dit jaar = JAAR-001.
 */
export function volgendFactuurnummer(gebruikt: Iterable<unknown>, jaar: number, vanaf?: string | null): string {
  let hoogste = 0
  for (const g of gebruikt) {
    const n = leesFactuurnummer(g)
    if (n && n.jaar === jaar && n.volgnr > hoogste) hoogste = n.volgnr
  }
  let volgnr = hoogste + 1
  const start = leesFactuurnummer(vanaf)
  if (start && start.jaar === jaar && start.volgnr > volgnr) volgnr = start.volgnr
  return maakFactuurnummer(jaar, volgnr)
}

/** Het nummer na dit nummer (in een facturatieronde: na het vorige item). */
export function naFactuurnummer(nummer: string): string | null {
  const n = leesFactuurnummer(nummer)
  return n ? maakFactuurnummer(n.jaar, n.volgnr + 1) : null
}

/** Het hoogste van twee voorstellen (zelfde jaar), bv. server en wat in deze ronde al gebruikt werd. */
export function hoogsteFactuurnummer(a: string | null | undefined, b: string | null | undefined): string | null {
  const x = leesFactuurnummer(a), y = leesFactuurnummer(b)
  if (!x) return y ? maakFactuurnummer(y.jaar, y.volgnr) : null
  if (!y) return maakFactuurnummer(x.jaar, x.volgnr)
  if (x.jaar !== y.jaar) return x.jaar > y.jaar ? maakFactuurnummer(x.jaar, x.volgnr) : maakFactuurnummer(y.jaar, y.volgnr)
  return maakFactuurnummer(x.jaar, Math.max(x.volgnr, y.volgnr))
}
