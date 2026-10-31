'use client'

import Link from 'next/link'
import { ArrowRight, Clock, Play, Newspaper, Instagram, Facebook, Linkedin } from 'lucide-react'
import { categorieLabel } from '@/lib/nieuwsbrieven'
import { YoutubeThumb } from '@/components/media/youtube-video'
import { EmbedFrame } from '@/components/media/embed-frame'
import { youtubeId } from '@/lib/youtube'
import { PROVIDER_LABEL, type EmbedRef } from '@/lib/embeds'

export type FeedItem = {
  id: string; titel: string; slug: string; categorie: string; categorie_label?: string | null; samenvatting: string | null
  cover_url: string | null; cover_youtube_id: string | null; cover_formaat?: 'liggend' | 'staand' | null; cover_embed?: EmbedRef | null
  gepubliceerd_op: string | null; leestijd: number; uitgelicht: boolean
}

const GELEZEN = 'nieuws-gelezen'
export function gelezenIds(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem(GELEZEN) ?? '[]')) } catch { return new Set() } }
export function markeerGelezen(id: string) { try { const s = gelezenIds(); s.add(id); localStorage.setItem(GELEZEN, JSON.stringify([...s].slice(-500))) } catch { /* privémodus */ } }
const isNieuw = (iso: string | null) => !!iso && Date.now() - Date.parse(iso) < 14 * 86400000
export const datumKort = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) : '')

/** YouTube-id van de cover: een covervideo of een ingesloten YouTube-post. */
const coverYt = (i: FeedItem) => i.cover_youtube_id ?? (i.cover_embed?.provider === 'youtube' ? youtubeId(i.cover_embed.url) : null)
/** Staand beeld (Short, reel of ingesloten reel)? */
export const isStaand = (i: FeedItem) => (i.cover_embed ? i.cover_embed.formaat === 'staand' : !!i.cover_youtube_id && i.cover_formaat === 'staand')
const PROVIDER_ICOON = { instagram: Instagram, facebook: Facebook, linkedin: Linkedin, youtube: Play } as const

/**
 * Het beeld van een kaart. Een foto vult het kader. Een staande video krijgt
 * een vervaagde achtergrond met het staande beeld scherp in het midden, zodat
 * er geen zwarte balken te zien zijn. Een ingesloten post zonder foto toont
 * het platform.
 */
function Beeld({ i, className }: { i: FeedItem; className: string }) {
  const yt = coverYt(i)
  const staand = isStaand(i)
  return (
    <div className={`relative overflow-hidden bg-gray-900 ${className}`}>
      {i.cover_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={i.cover_url} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" />
      ) : yt && staand ? (
        <>
          <YoutubeThumb id={yt} className="absolute inset-0 h-full w-full scale-125 blur-2xl opacity-60" />
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 aspect-[9/16] overflow-hidden shadow-2xl">
            <YoutubeThumb id={yt} className="h-full w-full transition duration-500 group-hover:scale-[1.04]" />
          </div>
        </>
      ) : yt ? (
        <YoutubeThumb id={yt} className="absolute inset-0 h-full w-full transition duration-500 group-hover:scale-[1.04]" />
      ) : i.cover_embed ? (
        <EmbedPlaatshouder e={i.cover_embed} />
      ) : (
        <Newspaper className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-10 w-10 text-gray-500" />
      )}
      {(yt || i.cover_embed) && !i.cover_url && <span className="absolute left-3 bottom-3 h-10 w-10 rounded-full bg-white/95 text-gray-900 flex items-center justify-center shadow"><Play className="h-4 w-4 translate-x-px" fill="currentColor" /></span>}
    </div>
  )
}

function EmbedPlaatshouder({ e }: { e: EmbedRef }) {
  const I = PROVIDER_ICOON[e.provider]
  const kleur = e.provider === 'instagram' ? 'from-fuchsia-600 via-rose-500 to-amber-400' : e.provider === 'facebook' ? 'from-blue-700 to-blue-500' : 'from-sky-800 to-sky-600'
  return (
    <div className={`absolute inset-0 bg-gradient-to-br ${kleur} flex flex-col items-center justify-center gap-2 text-white`}>
      <I className="h-10 w-10" strokeWidth={1.5} />
      <span className="text-xs font-semibold uppercase tracking-wide">{PROVIDER_LABEL[e.provider]}{e.formaat === 'staand' ? ' reel' : ' post'}</span>
    </div>
  )
}

function Labels({ i, ongelezen, licht }: { i: FeedItem; ongelezen: boolean; licht?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-white text-gray-900 px-2.5 py-0.5 font-semibold">{categorieLabel(i.categorie, i.categorie_label)}</span>
      {ongelezen && isNieuw(i.gepubliceerd_op) && <span className="rounded-full bg-white/20 text-white px-2.5 py-0.5 font-semibold backdrop-blur">Nieuw</span>}
      <span className={licht ? 'text-white/80' : 'text-gray-300'}>{datumKort(i.gepubliceerd_op)} · {i.leestijd} min</span>
    </div>
  )
}

/**
 * Groot verhaal bovenaan de feed (en op het dashboard). Liggend beeld: tekst
 * over het beeld. Staand beeld (reel, Short, ingesloten post): tekst links,
 * het staande beeld rechts; een ingesloten Instagram-reel speelt meteen af.
 */
export function HeroKaart({ i, ongelezen, metKnop = false }: { i: FeedItem; ongelezen: boolean; metKnop?: boolean }) {
  const href = `/portal/nieuws/${i.slug}`
  const staand = isStaand(i) || (!!i.cover_embed && i.cover_embed.provider !== 'youtube')
  const yt = coverYt(i)

  if (staand) {
    return (
      <div className="relative overflow-hidden rounded-3xl bg-gray-950 text-white">
        {yt && <YoutubeThumb id={yt} className="absolute inset-0 h-full w-full scale-125 blur-3xl opacity-40" />}
        {!yt && i.cover_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={i.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover scale-125 blur-3xl opacity-40" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-black/20" />
        <div className="relative grid gap-6 p-5 sm:p-8 md:grid-cols-[1fr_auto] md:items-center">
          <Link href={href} className="group block space-y-3 sm:space-y-4 min-w-0">
            <Labels i={i} ongelezen={ongelezen} licht />
            <h2 className="text-2xl sm:text-4xl font-semibold leading-tight text-white max-w-2xl">{i.titel}</h2>
            {i.samenvatting && <p className="text-sm sm:text-lg text-white/85 max-w-xl line-clamp-3">{i.samenvatting}</p>}
            <span className="inline-flex items-center gap-2 rounded-xl bg-white text-gray-900 px-4 py-2.5 text-sm font-semibold group-hover:gap-3 transition-all">Lees het verhaal<ArrowRight className="h-4 w-4" /></span>
          </Link>
          <div className="w-full max-w-[230px] sm:max-w-[280px] mx-auto md:mx-0 md:w-[280px] lg:w-[320px] md:max-w-none">
            {i.cover_embed && i.cover_embed.provider !== 'youtube' ? (
              <EmbedFrame e={i.cover_embed} titel={i.titel} />
            ) : yt ? (
              <Link href={href} className="group relative block aspect-[9/16] overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/10" aria-label={i.titel}>
                <YoutubeThumb id={yt} className="absolute inset-0 h-full w-full transition duration-500 group-hover:scale-[1.04]" />
                <span className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-14 w-14 rounded-full bg-white/95 text-gray-900 flex items-center justify-center shadow-xl"><Play className="h-6 w-6 translate-x-0.5" fill="currentColor" /></span>
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  return (
    <Link href={href} className="group relative block overflow-hidden rounded-3xl bg-gray-950 text-white">
      <Beeld i={i} className="aspect-[4/5] sm:aspect-[16/9] lg:aspect-[21/9]" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/5" />
      <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8 space-y-2 sm:space-y-3">
        <Labels i={i} ongelezen={ongelezen} licht />
        <h2 className="text-2xl sm:text-4xl font-semibold leading-tight max-w-3xl text-white drop-shadow-sm">{i.titel}</h2>
        {i.samenvatting && <p className="text-sm sm:text-lg text-white/85 max-w-2xl line-clamp-2 sm:line-clamp-3">{i.samenvatting}</p>}
        {metKnop && <span className="inline-flex items-center gap-2 rounded-xl bg-white text-gray-900 px-4 py-2.5 text-sm font-semibold mt-1 group-hover:gap-3 transition-all">Lees het verhaal<ArrowRight className="h-4 w-4" /></span>}
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
          <p className="text-xs text-gray-500 flex flex-wrap items-center gap-x-2"><span className="font-semibold text-gray-700">{categorieLabel(i.categorie, i.categorie_label)}</span><span>{datumKort(i.gepubliceerd_op)}</span><span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{i.leestijd} min</span></p>
          <h3 className="text-lg font-semibold leading-snug text-gray-900 group-hover:underline decoration-2 underline-offset-4">{i.titel}</h3>
          {i.samenvatting && <p className="text-sm text-gray-600 line-clamp-2">{i.samenvatting}</p>}
        </div>
      </article>
    </Link>
  )
}
