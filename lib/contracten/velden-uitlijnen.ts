/**
 * Invulvelden van een contract exact op de pdf zetten (27 nov 2026).
 *
 * De AI zegt welke velden er zijn en ongeveer waar; de exacte plaats halen we uit
 * de pdf zelf: de invullijnen, de vakjes en de kaders (zie velden-uitlijnen-server.ts).
 * - Een tekstveld (naam, e-mail, datum, btw …) komt op de lijn naast of onder zijn
 *   label, met de onderkant net op de lijn.
 * - Een vinkje komt precies op het vakje bij de zin die erbij hoort.
 * - De handtekening komt in het kader onder "Handtekening".
 * Vinden we niets in de buurt, dan blijft de plek van de AI staan.
 * Pure regels (getest in tests/contract-velden-uitlijnen.test.ts).
 *
 * Coördinaten: zoals de velden in de app, in punten vanaf linksboven van de pagina
 * (x en y van een veld daarna in % van de pagina, breedte en hoogte in punten).
 */

/** Een rechthoek in punten, vanaf linksboven. */
export type Vorm = { x: number; y: number; w: number; h: number }
/** Een stukje tekst: y = bovenkant, y + h = de basislijn. */
export type Tekst = { str: string; x: number; y: number; w: number; h: number }
export type PaginaVormen = { nr: number; W: number; H: number; lijnen: Vorm[]; vakjes: Vorm[]; kaders: Vorm[]; teksten: Tekst[] }

export type VeldIn = { label: string; type: string; page_number: number; x: number; y: number; width: number; height: number; confidence?: number } & Record<string, unknown>
export type ZoneIn = { page: number; x: number; y: number; width: number; height: number }

/**
 * Invullijnen die als tekst getypt zijn ("Naam: ________" of "Naam: ............"):
 * het stuk met de streepjes of puntjes wordt een lijn op de basislijn, de rest blijft
 * tekst (zodat "Naam:" als label naast die lijn gevonden wordt). De breedte per teken
 * schatten we evenredig; een underscore is ongeveer even breed als een gewone letter.
 */
export function splitsInvulTekst(t: Tekst): { teksten: Tekst[]; lijnen: Vorm[] } {
  const re = /_{4,}|(?:\.\s?){6,}|…{2,}/g
  const str = t.str
  if (!str || !re.test(str)) return { teksten: [t], lijnen: [] }
  re.lastIndex = 0
  const perTeken = str.length ? t.w / str.length : 0
  const basis = t.y + t.h
  const teksten: Tekst[] = [], lijnen: Vorm[] = []
  let vorig = 0
  for (const m of Array.from(str.matchAll(re))) {
    const van = m.index ?? 0, tot = van + m[0].length
    const voor = str.slice(vorig, van)
    if (voor.trim()) teksten.push({ str: voor.trim(), x: t.x + vorig * perTeken, y: t.y, w: voor.trimEnd().length * perTeken, h: t.h })
    const w = (tot - van) * perTeken
    if (w >= 25) lijnen.push({ x: t.x + van * perTeken, y: basis + 1, w, h: 0 })
    vorig = tot
  }
  const na = str.slice(vorig)
  if (na.trim()) teksten.push({ str: na.trim(), x: t.x + (vorig + (na.length - na.trimStart().length)) * perTeken, y: t.y, w: na.trim().length * perTeken, h: t.h })
  return { teksten, lijnen }
}

const STOP = new Set(['de', 'het', 'een', 'van', 'en', 'voor', 'met', 'ik', 'ga', 'je', 'u', 'uw', 'the', 'of', 'to', 'klant', 'opdrachtgever'])

/** "Naam (klant)" → ["naam"], "Btw-nummer" → ["btw", "nummer"]. */
export function woorden(s: string): string[] {
  return String(s ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
}

/** Hoe goed een tekst bij een veldnaam past: 1 = alle woorden van het veld staan erin. */
export function past(veld: string, tekst: string): number {
  const v = woorden(veld), t = new Set(woorden(tekst))
  if (!v.length || !t.size) return 0
  return v.filter((w) => t.has(w) || Array.from(t).some((x) => x.startsWith(w) || w.startsWith(x))).length / v.length
}

const midden = (v: Vorm) => ({ x: v.x + v.w / 2, y: v.y + v.h / 2 })
const afstand = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
/** Afstand tussen twee intervallen (0 als ze overlappen). */
const kloof = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.max(a1, b1) - Math.min(a2, b2))
const binnen = (o: Vorm, i: Vorm, marge = 1) => i.x >= o.x - marge && i.y >= o.y - marge && i.x + i.w <= o.x + o.w + marge && i.y + i.h <= o.y + o.h + marge

/** Kaders waar niets anders in staat (geen kaart rond een hele kolom). Enkel die zijn een invulvak. */
export function bladKaders(p: PaginaVormen): Vorm[] {
  return p.kaders.filter((k) => k.w < p.W * 0.9 && k.h < p.H * 0.6
    && !p.lijnen.some((l) => binnen(k, l, 0) && !(l.y <= k.y + 1 || l.y >= k.y + k.h - 1))
    && !p.kaders.some((x) => x !== k && binnen(k, x) && (x.w < k.w - 2 || x.h < k.h - 2))
    && !p.vakjes.some((v) => binnen(k, v)))
}

/** Het label links van (of net boven) een lijn. */
function labelBijLijn(l: Vorm, teksten: Tekst[]): Tekst[] {
  return teksten.filter((t) => {
    const basis = t.y + t.h
    const links = basis >= l.y - 14 && basis <= l.y + 3 && t.x + t.w <= l.x + 6 && t.x + t.w >= l.x - 160
    const erboven = basis >= l.y - 30 && basis < l.y - 6 && t.x >= l.x - 6 && t.x <= l.x + 60
    const opDeLijn = basis >= l.y - 14 && basis <= l.y + 3 && t.x >= l.x - 2 && t.x < l.x + l.w * 0.6
    return links || erboven || opDeLijn
  })
}

type Plek = { x: number; y: number; w: number; h: number }

/** Een tekstveld op een lijn: onderkant net op de lijn, start na het label als dat op de lijn zelf staat. */
function opLijn(l: Vorm, veld: VeldIn, label: Tekst | null): Plek {
  const h = Math.max(12, Math.min(18, veld.height || 14))
  let x = l.x + 2
  if (label && label.x >= l.x - 2 && label.x < l.x + l.w * 0.6 && label.y + label.h >= l.y - 14) x = label.x + label.w + 6
  const w = Math.max(30, l.x + l.w - x - 2)
  return { x, y: l.y - h - 1, w, h }
}

const tekstType = (t: string) => !['checkbox', 'signature'].includes(t)

/**
 * Zet elk veld op de juiste plek van de pdf. Elke lijn, elk vakje en elk kader
 * wordt hoogstens aan één veld gegeven; wie het dichtst bij zijn label staat, gaat voor.
 */
export function lijnVeldenUit<V extends VeldIn>(velden: V[], paginas: PaginaVormen[]): V[] {
  const uit = velden.map((v) => ({ ...v }))
  for (const p of paginas) {
    const hier = uit.map((v, i) => ({ v, i })).filter(({ v }) => v.page_number === p.nr)
    if (!hier.length) continue
    const kaders = bladKaders(p)
    type Kans = { i: number; soort: 'lijn' | 'vakje' | 'kader'; k: number; score: number; plek: Plek }
    const kansen: Kans[] = []
    for (const { v, i } of hier) {
      const ai: Plek = { x: (v.x / 100) * p.W, y: (v.y / 100) * p.H, w: v.width || 120, h: v.height || 14 }
      if (tekstType(v.type)) {
        p.lijnen.forEach((l, k) => {
          if (l.w < 30) return
          const labels = labelBijLijn(l, p.teksten)
          const besteLabel = labels.map((t) => ({ t, s: past(v.label, t.str) })).sort((a, b) => b.s - a.s)[0]
          const metLabel = besteLabel && besteLabel.s >= 0.99 ? besteLabel.t : null
          const d = Math.abs(l.y - (ai.y + ai.h)) + kloof(ai.x, ai.x + ai.w, l.x, l.x + l.w)
          if (!metLabel && d > 60) return
          kansen.push({ i, soort: 'lijn', k, score: d - (metLabel ? 1000 : 0), plek: opLijn(l, v, metLabel ?? besteLabel?.t ?? null) })
        })
      } else if (v.type === 'checkbox') {
        p.vakjes.forEach((b, k) => {
          const zin = p.teksten.filter((t) => t.x >= b.x + b.w - 2 && t.x <= b.x + b.w + 30 && Math.abs((t.y + t.h / 2) - (b.y + b.h / 2)) <= 8).map((t) => t.str).join(' ')
          const s = past(v.label, zin)
          const d = afstand(midden(ai), midden(b))
          if (s < 0.6 && d > 90) return
          kansen.push({ i, soort: 'vakje', k, score: d - (s >= 0.6 ? 500 * s : 0), plek: { ...b } })
        })
      } else {
        kaders.forEach((b, k) => {
          if (b.w < 80 || b.h < 28) return
          const d = afstand(midden(ai), midden(b))
          if (d > 160) return
          kansen.push({ i, soort: 'kader', k, score: d, plek: inKader(b) })
        })
      }
    }
    kansen.sort((a, b) => a.score - b.score)
    const klaar = new Set<number>(), bezet = new Set<string>()
    for (const k of kansen) {
      if (klaar.has(k.i) || bezet.has(`${k.soort}:${k.k}`)) continue
      klaar.add(k.i); bezet.add(`${k.soort}:${k.k}`)
      const v = uit[k.i]
      Object.assign(v, { x: r((k.plek.x / p.W) * 100), y: r((k.plek.y / p.H) * 100), width: Math.round(k.plek.w), height: Math.round(k.plek.h), confidence: Math.max(Number(v.confidence ?? 0), 0.95) })
    }
  }
  return uit
}

const r = (n: number) => Math.round(n * 100) / 100

/** Een handtekening in een kader: met wat ruimte rond, niet groter dan nodig, in het midden. */
function inKader(b: Vorm): Plek {
  const w = Math.min(b.w - 8, 260), h = Math.min(b.h - 8, 110)
  return { x: b.x + (b.w - w) / 2, y: b.y + (b.h - h) / 2, w, h }
}

/** De handtekeningzone van de klant in het dichtste kader (bij voorkeur onder "Handtekening"). */
export function lijnZoneUit(zone: ZoneIn | null, paginas: PaginaVormen[]): ZoneIn | null {
  if (!zone) return null
  const p = paginas.find((x) => x.nr === zone.page)
  if (!p) return zone
  const ai = { x: (zone.x / 100) * p.W, y: (zone.y / 100) * p.H, w: zone.width, h: zone.height }
  const kandidaten = bladKaders(p).filter((b) => b.w >= 80 && b.h >= 28).map((b) => {
    const label = p.teksten.some((t) => /handteken|signature|handtekening/i.test(t.str) && t.y + t.h <= b.y + 4 && t.y + t.h >= b.y - 24 && t.x >= b.x - 10 && t.x <= b.x + b.w)
    return { b, score: afstand(midden(ai), midden(b)) - (label ? 40 : 0) }
  }).filter((x) => x.score <= 200).sort((a, b) => a.score - b.score)
  if (!kandidaten.length) return zone
  const plek = inKader(kandidaten[0].b)
  return { page: zone.page, x: r((plek.x / p.W) * 100), y: r((plek.y / p.H) * 100), width: Math.round(plek.w), height: Math.round(plek.h) }
}

/**
 * Onze handtekening (tegentekenen): het andere kader op dezelfde hoogte als dat van de
 * klant (de kolom van NextGen Agency BV). Geen tweede kader = null (dan blijft de standaard).
 */
export function onsZoneUit(klant: ZoneIn | null, paginas: PaginaVormen[]): ZoneIn | null {
  if (!klant) return null
  const p = paginas.find((x) => x.nr === klant.page)
  if (!p) return null
  const k = { x: (klant.x / 100) * p.W, y: (klant.y / 100) * p.H, w: klant.width, h: klant.height }
  const ander = bladKaders(p)
    .filter((b) => b.w >= 80 && b.h >= 28 && Math.abs(midden(b).y - midden(k).y) <= 40 && kloof(b.x, b.x + b.w, k.x, k.x + k.w) > 4)
    .sort((a, b) => Math.abs(midden(a).y - midden(k).y) - Math.abs(midden(b).y - midden(k).y))[0]
  if (!ander) return null
  const plek = inKader(ander)
  return { page: klant.page, x: r((plek.x / p.W) * 100), y: r((plek.y / p.H) * 100), width: Math.round(plek.w), height: Math.round(plek.h) }
}
