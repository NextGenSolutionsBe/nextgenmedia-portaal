/**
 * Standaard-deliverables per dienst (verbeterplan fase 6, punt 65): wat een
 * klant normaal krijgt, bv. "12 posts per maand" of "4 reels per maand".
 * Staat op de dienst in de catalogus (`diensten_catalogus.deliverables`) en
 * voedt de contentkalender: daar zie je per maand wat afgesproken is tegenover
 * wat er al gepland staat. Enkel een richtlijn: er wordt niets vanzelf
 * aangemaakt. Getest in tests/sales-fase6.test.ts.
 */
export type Periode = 'maand' | 'kwartaal' | 'jaar' | 'project'
export type Deliverable = { aantal: number; wat: string; per: Periode }

const PER: { re: RegExp; per: Periode }[] = [
  { re: /(?:\b(?:per|elke|iedere)|\/)\s*maand\b|\bmaandelijks\b|\bp\/m\b/i, per: 'maand' },
  { re: /(?:\b(?:per|elk|ieder)|\/)\s*kwartaal\b/i, per: 'kwartaal' },
  { re: /(?:\b(?:per|elk|ieder)|\/)\s*jaar\b|\bjaarlijks\b/i, per: 'jaar' },
]

/** Eén regel lezen: "12 posts per maand", "4 reels / maand", "1 shoot per kwartaal", "3 ontwerpen". */
export function leesDeliverable(regel: string): Deliverable | null {
  const r = regel.replace(/^[\s\-*•]+/, '').trim()
  const m = r.match(/^(\d{1,3})\s*x?\s+(.+)$/i)
  if (!m) return null
  const aantal = Number(m[1])
  if (!aantal) return null
  let wat = m[2]
  let per: Periode = 'project'
  for (const p of PER) if (p.re.test(wat)) { per = p.per; wat = wat.replace(p.re, ''); break }
  wat = wat.replace(/\s+/g, ' ').replace(/[\s,.;:]+$/, '').trim()
  if (!wat) return null
  return { aantal, wat: wat.slice(0, 60), per }
}

/** Een tekstvak (één per regel) naar een lijst. Regels zonder getal vallen weg. */
export const leesDeliverables = (tekst: string): Deliverable[] =>
  String(tekst ?? '').split(/\r?\n/).map(leesDeliverable).filter((d): d is Deliverable => !!d).slice(0, 20)

export const PERIODE_TEKST: Record<Periode, string> = { maand: 'per maand', kwartaal: 'per kwartaal', jaar: 'per jaar', project: '' }
export const deliverableTekst = (d: Deliverable) => `${d.aantal} ${d.wat}${d.per === 'project' ? '' : ` ${PERIODE_TEKST[d.per]}`}`
export const deliverablesTekst = (l: Deliverable[]) => l.map(deliverableTekst).join('\n')

/** Wat uit de databank komt nakijken (jsonb kan van alles zijn). */
export function netteDeliverables(v: unknown): Deliverable[] {
  if (!Array.isArray(v)) return []
  return v.flatMap((x) => {
    if (!x || typeof x !== 'object') return []
    const o = x as Record<string, unknown>
    const aantal = Math.round(Number(o.aantal))
    const wat = String(o.wat ?? '').trim()
    const per = (['maand', 'kwartaal', 'jaar', 'project'] as const).find((p) => p === o.per) ?? 'project'
    return aantal > 0 && wat ? [{ aantal, wat: wat.slice(0, 60), per }] : []
  }).slice(0, 20)
}

/** Over welk soort content gaat het? Enkel als het duidelijk is. */
export function contentTypeVan(wat: string): 'post' | 'reel' | 'story' | 'carousel' | null {
  const w = wat.toLowerCase()
  if (/\breels?\b|\bvideo'?s?\b|\bshorts?\b|\btiktoks?\b/.test(w)) return 'reel'
  if (/\bstor(y|ies|ys)\b/.test(w)) return 'story'
  if (/\bcarrou?sels?\b|\bcarousels?\b/.test(w)) return 'carousel'
  if (/\bposts?\b|\bberichten\b/.test(w)) return 'post'
  return null
}

export type MaandStand = { wat: string; afgesproken: number; gepland: number; type: string | null }

/**
 * Voor de contentkalender: de deliverables per maand tegenover wat in die
 * maand gepland staat. Een deliverable zonder herkenbaar type telt alles.
 */
export function maandStand(deliverables: Deliverable[], items: { content_type?: string | null; planned_date?: string | null }[], maand: string): MaandStand[] {
  const inMaand = items.filter((i) => (i.planned_date ?? '').slice(0, 7) === maand)
  return deliverables.filter((d) => d.per === 'maand').map((d) => {
    const type = contentTypeVan(d.wat)
    const gepland = type ? inMaand.filter((i) => (i.content_type ?? 'post') === type || (type === 'carousel' && i.content_type === 'carrousel')).length : inMaand.length
    return { wat: d.wat, afgesproken: d.aantal, gepland, type }
  })
}
