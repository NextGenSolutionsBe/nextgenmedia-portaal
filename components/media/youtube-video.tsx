'use client'

import { useState } from 'react'
import { Play } from 'lucide-react'
import { youtubeEmbedUrl, youtubeThumb } from '@/lib/youtube'

/**
 * YouTube-video die pas laadt als je afspeelt: eerst de miniatuur met een
 * afspeelknop, na een klik de speler. Zo blijft scrollen door een lange feed
 * vlot, en laadt YouTube niets tot de kijker wil kijken.
 */
export function YoutubeVideo({ id, titel, className = '', rond = 'rounded-2xl' }: { id: string; titel: string; className?: string; rond?: string }) {
  const [speelt, setSpeelt] = useState(false)
  return (
    <div className={`relative aspect-video w-full overflow-hidden bg-black ${rond} ${className}`}>
      {speelt ? (
        <iframe src={youtubeEmbedUrl(id, true)} title={titel} className="absolute inset-0 h-full w-full" loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
      ) : (
        <button type="button" onClick={() => setSpeelt(true)} className="group absolute inset-0 h-full w-full focus:outline-none focus-visible:ring-4 focus-visible:ring-white/60" aria-label={`Video afspelen: ${titel}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={youtubeThumb(id)} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
          <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-black/10" />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-16 w-16 rounded-full bg-white/95 text-gray-900 flex items-center justify-center shadow-xl transition group-hover:scale-110">
            <Play className="h-7 w-7 translate-x-0.5" fill="currentColor" />
          </span>
        </button>
      )}
    </div>
  )
}
