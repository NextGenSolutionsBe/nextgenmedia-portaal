'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'
import { youtubeEmbedUrl } from '@/lib/youtube'

// Van scherp naar minder scherp. maxresdefault (1280×720) bestaat niet voor
// elke video; dan geeft YouTube een grijs plaatje van 120×90 terug.
const VARIANTEN = ['maxresdefault', 'sddefault', 'hqdefault'] as const
const thumbUrl = (id: string, i: number) => `https://i.ytimg.com/vi/${id}/${VARIANTEN[Math.min(i, VARIANTEN.length - 1)]}.jpg`

/**
 * Miniatuur van een YouTube-video in de beste beschikbare kwaliteit. Bij een
 * staande video (Short of reel) zit het beeld met zwarte balken in een liggend
 * plaatje; `object-cover` in een staand kader snijdt die balken precies weg.
 */
export function YoutubeThumb({ id, className = '', alt = '' }: { id: string; className?: string; alt?: string }) {
  const [i, setI] = useState(0)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={thumbUrl(id, i)} alt={alt} loading="lazy" decoding="async" className={`object-cover ${className}`}
      onError={() => setI((x) => (x < VARIANTEN.length - 1 ? x + 1 : x))}
      onLoad={(e) => { if (e.currentTarget.naturalWidth <= 120 && i < VARIANTEN.length - 1) setI(i + 1) }} />
  )
}

/**
 * YouTube-video die pas laadt als je afspeelt: eerst de miniatuur met een
 * afspeelknop, na een klik de speler. Zo blijft scrollen door een lange feed
 * vlot, en laadt YouTube niets tot de kijker wil kijken. `staand` = Short of
 * reel: een staand kader van maximaal 360 px breed, gecentreerd.
 */
export function YoutubeVideo({ id, titel, className = '', rond = 'rounded-2xl', staand = false }: { id: string; titel: string; className?: string; rond?: string; staand?: boolean }) {
  const [speelt, setSpeelt] = useState(false)
  return (
    <div className={`relative w-full overflow-hidden bg-black ${staand ? 'aspect-[9/16] max-w-[360px] mx-auto' : 'aspect-video'} ${rond} ${className}`}>
      {speelt ? (
        <iframe src={youtubeEmbedUrl(id, true)} title={titel} className="absolute inset-0 h-full w-full" loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      ) : (
        <button type="button" onClick={() => setSpeelt(true)} className="group absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60" aria-label={`Video afspelen: ${titel}`}>
          <YoutubeThumb id={id} className="absolute inset-0 h-full w-full transition duration-300 group-hover:scale-[1.03]" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-black/10" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-16 rounded-full bg-white/95 text-gray-900 flex items-center justify-center shadow-xl transition group-hover:scale-110">
            <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />
          </span>
        </button>
      )}
    </div>
  )
}
