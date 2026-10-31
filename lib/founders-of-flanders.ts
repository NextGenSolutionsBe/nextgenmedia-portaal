import { youtubeId } from '@/lib/youtube'

/**
 * Founders of Flanders: voorbeeldvideo's (YouTube) die klanten in hun klantapp
 * zien, met de knop om zelf een founder video aan te vragen. De aanvraag loopt
 * via Aanvragen (soort "founders"). Pure module.
 */

export type FoundersVideo = { id: string; titel: string; ondernemer: string | null; bedrijf: string | null; beschrijving: string | null; youtube_id: string; volgorde: number; zichtbaar: boolean }

export function valideerFoundersVideo(b: Record<string, unknown>): { ok: true; waarde: Omit<FoundersVideo, 'id' | 'volgorde'> } | { ok: false; fout: string } {
  const youtube_id = youtubeId(String(b.youtube ?? b.youtube_id ?? ''))
  if (!youtube_id) return { ok: false, fout: 'Plak een YouTube-link (of de embedcode van de video).' }
  const kort = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null
  const titel = kort(b.titel, 140)
  if (!titel) return { ok: false, fout: 'Geef de video een titel.' }
  return {
    ok: true,
    waarde: { titel, ondernemer: kort(b.ondernemer, 120), bedrijf: kort(b.bedrijf, 120), beschrijving: String(b.beschrijving ?? '').trim().slice(0, 800) || null, youtube_id, zichtbaar: b.zichtbaar !== false },
  }
}
