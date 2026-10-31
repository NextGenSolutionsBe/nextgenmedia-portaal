import { youtubeId } from '@/lib/youtube'
import { geldigPad } from '@/lib/marketing-media'
import { herkenEmbed, valideerEmbed, type EmbedRef, type Formaat } from '@/lib/embeds'

/**
 * Nieuwsbrieven: verhalen voor klanten in de klantapp (en per mail). Een
 * nieuwsbrief is een reeks blokken: tekst, kop, foto, galerij, YouTube-video,
 * social post (Instagram, Facebook, LinkedIn), citaat en knop. Video's altijd
 * via YouTube of een ingesloten post, nooit opgeladen. Pure module.
 */

export type Categorie = 'projecten' | 'klant_in_de_kijker' | 'tips' | 'nieuws' | 'team' | 'andere'
/** De vaste categorieën; met 'andere' typ je zelf een label (categorie_label). */
export const CATEGORIEEN: { key: Exclude<Categorie, 'andere'>; label: string }[] = [
  { key: 'projecten', label: 'Afgeronde projecten' },
  { key: 'klant_in_de_kijker', label: 'Klant in de kijker' },
  { key: 'tips', label: 'Tips & tricks' },
  { key: 'nieuws', label: 'Marketingnieuws' },
  { key: 'team', label: 'Uit ons team' },
]
export const categorieLabel = (k: string, eigen?: string | null): string =>
  (k === 'andere' && eigen?.trim()) ? eigen.trim() : CATEGORIEEN.find((c) => c.key === k)?.label ?? (eigen?.trim() || 'Nieuws')

export type Blok =
  | { id: string; type: 'tekst'; tekst: string }
  | { id: string; type: 'kop'; tekst: string }
  | { id: string; type: 'afbeelding'; pad: string; onderschrift: string }
  | { id: string; type: 'galerij'; paden: string[] }
  | { id: string; type: 'video'; youtube_id: string; onderschrift: string; formaat?: 'liggend' | 'staand' }
  | { id: string; type: 'embed'; embed: EmbedRef | null; onderschrift: string }
  | { id: string; type: 'citaat'; tekst: string; wie: string }
  | { id: string; type: 'knop'; tekst: string; url: string }
export type BlokType = Blok['type']

export const BLOK_TYPES: { type: BlokType; label: string }[] = [
  { type: 'tekst', label: 'Tekst' }, { type: 'kop', label: 'Tussenkop' }, { type: 'afbeelding', label: 'Foto' }, { type: 'galerij', label: 'Galerij' },
  { type: 'video', label: 'YouTube-video' }, { type: 'embed', label: 'Social post' }, { type: 'citaat', label: 'Citaat' }, { type: 'knop', label: 'Knop' },
]

export type Nieuwsbrief = {
  id: string; titel: string; slug: string; categorie: Categorie; categorie_label: string | null; samenvatting: string | null
  cover_pad: string | null; cover_youtube_id: string | null; cover_formaat: 'liggend' | 'staand' | null; cover_embed: EmbedRef | null
  blokken: Blok[]; status: 'concept' | 'gepubliceerd'
  uitgelicht: boolean; gepubliceerd_op: string | null; auteur_naam: string | null; mail_verstuurd_op: string | null; mail_aantal: number | null
  created_at: string; updated_at: string
}

const MAX_BLOKKEN = 60
const kort = (v: unknown, max: number) => String(v ?? '').replace(/[ \t]+/g, ' ').trim().slice(0, max)
const veiligeUrl = (v: unknown): string | null => {
  const s = String(v ?? '').trim()
  if (!s) return null
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`); return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null } catch { return null }
}

export function nieuwBlok(type: BlokType, id: string): Blok {
  switch (type) {
    case 'tekst': return { id, type, tekst: '' }
    case 'kop': return { id, type, tekst: '' }
    case 'afbeelding': return { id, type, pad: '', onderschrift: '' }
    case 'galerij': return { id, type, paden: [] }
    case 'video': return { id, type, youtube_id: '', onderschrift: '', formaat: 'liggend' }
    case 'embed': return { id, type, embed: null, onderschrift: '' }
    case 'citaat': return { id, type, tekst: '', wie: '' }
    case 'knop': return { id, type, tekst: '', url: '' }
  }
}

/** Blokken nakijken en opschonen; lege blokken vallen weg. `id` blijft (voor de editor). */
export function valideerBlokken(invoer: unknown): { ok: true; blokken: Blok[] } | { ok: false; fout: string } {
  if (!Array.isArray(invoer)) return { ok: true, blokken: [] }
  if (invoer.length > MAX_BLOKKEN) return { ok: false, fout: `Hoogstens ${MAX_BLOKKEN} blokken per nieuwsbrief.` }
  const uit: Blok[] = []
  for (const r of invoer as Record<string, unknown>[]) {
    const id = /^[A-Za-z0-9_-]{4,40}$/.test(String(r?.id ?? '')) ? String(r.id) : Math.random().toString(36).slice(2, 10)
    switch (r?.type) {
      case 'tekst': { const t = String(r.tekst ?? '').trim().slice(0, 20000); if (t) uit.push({ id, type: 'tekst', tekst: t }); break }
      case 'kop': { const t = kort(r.tekst, 160); if (t) uit.push({ id, type: 'kop', tekst: t }); break }
      case 'afbeelding': {
        if (!r.pad) break
        if (!geldigPad(r.pad, 'nieuws')) return { ok: false, fout: 'Een foto hoort niet bij deze nieuwsbrief. Laad ze opnieuw op.' }
        uit.push({ id, type: 'afbeelding', pad: r.pad as string, onderschrift: kort(r.onderschrift, 300) }); break
      }
      case 'galerij': {
        const paden = (Array.isArray(r.paden) ? r.paden : []).filter((p): p is string => geldigPad(p, 'nieuws')).slice(0, 12)
        if (paden.length) uit.push({ id, type: 'galerij', paden }); break
      }
      case 'video': {
        if (!r.youtube_id && !r.youtube) break
        const ruw = String(r.youtube_id ?? r.youtube ?? '')
        const yid = youtubeId(ruw)
        if (!yid) return { ok: false, fout: 'Een video-blok heeft geen geldige YouTube-link.' }
        // Een Shorts-link is staand; anders wat de editor koos.
        const formaat = r.formaat === 'staand' || /\/shorts\//.test(ruw) ? 'staand' : 'liggend'
        uit.push({ id, type: 'video', youtube_id: yid, onderschrift: kort(r.onderschrift, 300), formaat }); break
      }
      case 'embed': {
        const bron = (r.embed && typeof r.embed === 'object' ? (r.embed as { url?: unknown }).url : null) ?? r.invoer ?? r.url
        if (!bron) break
        const e = herkenEmbed(bron, r.formaat ?? (r.embed as { formaat?: unknown } | null)?.formaat)
        if (!e.ok) return { ok: false, fout: `Social post: ${e.fout}` }
        const hoogte = (r.embed as { hoogte?: unknown } | null)?.hoogte
        uit.push({ id, type: 'embed', embed: valideerEmbed({ ...e.embed, hoogte }) ?? e.embed, onderschrift: kort(r.onderschrift, 300) }); break
      }
      case 'citaat': { const t = kort(r.tekst, 1000); if (t) uit.push({ id, type: 'citaat', tekst: t, wie: kort(r.wie, 160) }); break }
      case 'knop': {
        const t = kort(r.tekst, 60), url = veiligeUrl(r.url)
        if (!t && !r.url) break
        if (!t || !url) return { ok: false, fout: 'Een knop heeft een tekst en een geldige link nodig.' }
        uit.push({ id, type: 'knop', tekst: t, url }); break
      }
      default: break
    }
  }
  return { ok: true, blokken: uit }
}

export type NieuwsbriefInvoer = {
  titel: string; categorie: Categorie; categorie_label: string | null; samenvatting: string | null
  cover_pad: string | null; cover_youtube_id: string | null; cover_formaat: 'liggend' | 'staand'; cover_embed: EmbedRef | null
  blokken: Blok[]; uitgelicht: boolean; auteur_naam: string | null
}

export function valideerNieuwsbrief(b: Record<string, unknown>): { ok: true; waarde: NieuwsbriefInvoer } | { ok: false; fout: string } {
  const titel = kort(b.titel, 160)
  if (titel.length < 3) return { ok: false, fout: 'Geef de nieuwsbrief een titel.' }
  const categorie = b.categorie === 'andere' || CATEGORIEEN.some((c) => c.key === b.categorie) ? b.categorie as Categorie : null
  if (!categorie) return { ok: false, fout: 'Kies een categorie.' }
  const categorie_label = categorie === 'andere' ? kort(b.categorie_label, 40) : null
  if (categorie === 'andere' && (categorie_label ?? '').length < 2) return { ok: false, fout: 'Typ de naam van je eigen categorie.' }
  const cover = b.cover_pad == null || b.cover_pad === '' ? null : geldigPad(b.cover_pad, 'nieuws') ? b.cover_pad : undefined
  if (cover === undefined) return { ok: false, fout: 'Laad de coverfoto opnieuw op.' }
  const coverVideo = b.cover_youtube_id ? youtubeId(String(b.cover_youtube_id)) : null
  if (b.cover_youtube_id && !coverVideo) return { ok: false, fout: 'De covervideo is geen geldige YouTube-link.' }
  const cover_formaat: Formaat = b.cover_formaat === 'staand' || /\/shorts\//.test(String(b.cover_youtube_id ?? '')) ? 'staand' : 'liggend'
  let cover_embed: EmbedRef | null = null
  const embedBron = b.cover_embed && typeof b.cover_embed === 'object' ? (b.cover_embed as { url?: unknown }).url : b.cover_embed
  if (embedBron) {
    const e = herkenEmbed(embedBron, (b.cover_embed as { formaat?: unknown } | null)?.formaat)
    if (!e.ok) return { ok: false, fout: `Uitgelichte post: ${e.fout}` }
    cover_embed = e.embed
  }
  const bl = valideerBlokken(b.blokken)
  if (!bl.ok) return bl
  return {
    ok: true,
    waarde: {
      titel, categorie, categorie_label, samenvatting: kort(b.samenvatting, 400) || null, cover_pad: cover, cover_youtube_id: coverVideo,
      cover_formaat: cover_formaat === 'staand' ? 'staand' : 'liggend', cover_embed, blokken: bl.blokken, uitgelicht: b.uitgelicht === true, auteur_naam: kort(b.auteur_naam, 80) || null,
    },
  }
}

/** Klaar om te publiceren? Een verhaal zonder inhoud zetten we niet online. */
export function klaarVoorPublicatie(n: Pick<NieuwsbriefInvoer, 'titel' | 'blokken' | 'samenvatting'>): string | null {
  if (!n.blokken.length && !n.samenvatting) return 'Voeg eerst inhoud toe: minstens een samenvatting of één blok.'
  return null
}

export function maakSlug(titel: string): string {
  return titel.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'nieuwsbrief'
}

/** Leestijd in minuten (200 woorden per minuut, video telt 2 minuten). */
export function leestijd(n: Pick<NieuwsbriefInvoer, 'blokken' | 'samenvatting'>): number {
  let woorden = (n.samenvatting ?? '').split(/\s+/).filter(Boolean).length, extra = 0
  for (const b of n.blokken) {
    if (b.type === 'tekst' || b.type === 'kop' || b.type === 'citaat') woorden += b.tekst.split(/\s+/).filter(Boolean).length
    if (b.type === 'video') extra += 2
    if (b.type === 'embed') extra += 1
  }
  return Math.max(1, Math.round(woorden / 200) + extra)
}

// ── Tekstopmaak ──────────────────────────────────────────────────────────────
// Klein en veilig: **vet**, *cursief*, [link](https://…), lijstjes met "- ".
// Wordt nooit als HTML ingevoegd: de weergave bouwt elementen, de mail escapet.

export type Inline = { t: 'tekst' | 'vet' | 'cursief'; s: string } | { t: 'link'; s: string; url: string }
export type Alinea = { soort: 'p'; delen: Inline[] } | { soort: 'lijst'; items: Inline[][] }

export function leesInline(s: string): Inline[] {
  const uit: Inline[] = []
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let i = 0, m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > i) uit.push({ t: 'tekst', s: s.slice(i, m.index) })
    if (m[1]) uit.push({ t: 'vet', s: m[1] })
    else if (m[2]) uit.push({ t: 'cursief', s: m[2] })
    else uit.push({ t: 'link', s: m[3], url: m[4] })
    i = m.index + m[0].length
  }
  if (i < s.length) uit.push({ t: 'tekst', s: s.slice(i) })
  return uit
}

export function leesTekst(tekst: string): Alinea[] {
  const uit: Alinea[] = []
  for (const blok of tekst.replace(/\r/g, '').split(/\n{2,}/)) {
    const regels = blok.split('\n').filter((r) => r.trim())
    if (!regels.length) continue
    if (regels.every((r) => /^\s*[-•*]\s+/.test(r))) uit.push({ soort: 'lijst', items: regels.map((r) => leesInline(r.replace(/^\s*[-•*]\s+/, ''))) })
    else uit.push({ soort: 'p', delen: leesInline(regels.join('\n')) })
  }
  return uit
}
