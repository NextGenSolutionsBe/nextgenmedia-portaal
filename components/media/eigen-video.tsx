'use client'

import { useRef, useState } from 'react'
import { ExternalLink, Play } from 'lucide-react'

/**
 * Een video uit onze eigen opslag (bv. een Instagram-reel die we kopieerden),
 * met de miniatuur van Instagram als voorbeeldbeeld. Laadt pas na een klik,
 * speelt in de app met de gewone speler van de browser.
 */
export function EigenVideo({ video, poster, titel, staand = true, bron, className = '' }: {
  video: string | null; poster: string | null; titel: string; staand?: boolean; bron?: { label: string; url: string } | null; className?: string
}) {
  const [speelt, setSpeelt] = useState(false)
  const ref = useRef<HTMLVideoElement>(null)
  return (
    <figure className={`w-full ${staand ? 'max-w-[360px] mx-auto' : ''} ${className}`}>
      <div className={`relative w-full overflow-hidden rounded-2xl bg-black ${staand ? 'aspect-[9/16]' : 'aspect-video'}`}>
        {speelt && video ? (
          <video ref={ref} src={video} poster={poster ?? undefined} controls autoPlay playsInline preload="metadata" className="absolute inset-0 h-full w-full object-contain bg-black" aria-label={titel} />
        ) : (
          <button type="button" onClick={() => video ? setSpeelt(true) : bron && window.open(bron.url, '_blank', 'noopener')} aria-label={video ? `Video afspelen: ${titel}` : `Bekijk op ${bron?.label ?? 'Instagram'}: ${titel}`}
            className="group absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {poster && <img src={poster} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />}
            <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-black/10" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-16 rounded-full bg-white/95 text-gray-900 flex items-center justify-center shadow-xl transition group-hover:scale-110">
              {video ? <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" /> : <ExternalLink className="h-6 w-6" />}
            </span>
          </button>
        )}
      </div>
      {bron && (
        <figcaption className="mt-1.5 text-center">
          <a href={bron.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900">Bekijk op {bron.label}<ExternalLink className="h-3 w-3" /></a>
        </figcaption>
      )}
    </figure>
  )
}
