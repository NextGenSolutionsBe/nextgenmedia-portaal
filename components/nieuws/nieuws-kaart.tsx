'use client'

import Link from 'next/link'
import { Clock, Play, Newspaper } from 'lucide-react'
import { categorieLabel } from '@/lib/nieuwsbrieven'
import { youtubeThumb } from '@/lib/youtube'

export type FeedItem = { id: string; titel: string; slug: string; categorie: string; samenvatting: string | null; cover_url: string | null; cover_youtube_id: string | null; gepubliceerd_op: string | null; leestijd: number; uitgelicht: boolean }

const GELEZEN = 'nieuws-gelezen'
export function gelezenIds(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(GELEZEN) ?? '[]')) } catch { return new Set() } }
export function markeerGelezen(id: string) { try { const s = gelezenIds(); s.add(id); localStorage.setItem(GELEZEN, JSON.stringify([...s].slice(-500))) } catch { /* privémodus */ } }
const isNieuw = (iso: string | null) => !!iso && Date.now() - Date.parse(iso) < 14 * 86400000
export const datumKort = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) : '')

function Beeld({ i, className }: { i: FeedItem; className: string }) {
  const src = i.cover_url ?? (i.cover_youtube_id ? youtubeThumb(i.cover_youtube_id) : null)
  return (
    <div className={`relative overflow-hidden bg-gray-100 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
        : <Newspaper className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-10 text-gray-300" />}
      {i.cover_youtube_id && <span className="absolute left-3 bottom-3 h-10 w-10 rounded-full bg-white/95 flex items-center justify-center shadow"><Play className="h-4 w-4 translate-x-px" fill="currentColor" /></span>}
    </div>
  )
}

/** Groot verhaal bovenaan de feed. */
export function HeroKaart({ i, ongelezen }: { i: FeedItem; ongelezen: boolean }) {
  return (
    <Link href={`/portal/nieuws/${i.slug}`} className="group relative block overflow-hidden rounded-3xl bg-gray-900 text-white">
      <Beeld i={i} className="aspect-[4/5] sm:aspect-[16/9] lg:aspect-[21/9] opacity-90" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8 space-y-2 sm:space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-white text-gray-900 px-2.5 py-0.5 font-semibold">{categorieLabel(i.categorie)}</span>
          {ongelezen && isNieuw(i.gepubliceerd_op) && <span className="rounded-full bg-white/20 px-2.5 py-0.5 font-semibold backdrop-blur">Nieuw</span>}
          <span className="text-white/80">{datumKort(i.gepubliceerd_op)} · {i.leestijd} min</span>
        </div>
        <h2 className="text-2xl sm:text-4xl font-semibold leading-tight max-w-3xl">{i.titel}</h2>
        {i.samenvatting && <p className="text-sm sm:text-lg text-white/85 max-w-2xl line-clamp-2 sm:line-clamp-3">{i.samenvatting}</p>}
      </div>
    </Link>
  )
}

export function NieuwsKaart({ i, ongelezen }: { i: FeedItem; ongelezen: boolean }) {
  return (
    <Link href={`/portal/nieuws/${i.slug}`} className="group block">
      <article className="space-y-3">
        <div className="relative">
          <Beeld i={i} className="aspect-[16/10] rounded-2xl" />
          {ongelezen && isNieuw(i.gepubliceerd_op) && <span className="absolute right-3 top-3 rounded-full bg-gray-900 text-white px-2.5 py-0.5 text-[11px] font-semibold shadow">Nieuw</span>}
        </div>
        <div className="space-y-1.5 px-0.5">
          <p className="text-xs text-gray-500 flex flex-wrap items-center gap-x-2"><span className="font-semibold text-gray-700">{categorieLabel(i.categorie)}</span><span>{datumKort(i.gepubliceerd_op)}</span><span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{i.leestijd} min</span></p>
          <h3 className="text-lg font-semibold leading-snug text-gray-900 group-hover:underline decoration-2 underline-offset-4">{i.titel}</h3>
          {i.samenvatting && <p className="text-sm text-gray-600 line-clamp-2">{i.samenvatting}</p>}
        </div>
      </article>
    </Link>
  )
}
