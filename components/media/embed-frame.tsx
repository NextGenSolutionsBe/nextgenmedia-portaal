'use client'

import { ExternalLink } from 'lucide-react'
import { YoutubeVideo } from '@/components/media/youtube-video'
import { youtubeId } from '@/lib/youtube'
import { embedSrc, embedVerhouding, PROVIDER_LABEL, type EmbedRef } from '@/lib/embeds'

/**
 * Een ingesloten post van Instagram, Facebook of LinkedIn (of een YouTube-video).
 * De iframe-link wordt hier opnieuw opgebouwd uit de nagekeken link; er komt
 * nooit HTML van buitenaf op de pagina.
 */
export function EmbedFrame({ e, titel = 'Ingesloten post', className = '' }: { e: EmbedRef; titel?: string; className?: string }) {
  if (e.provider === 'youtube') {
    const id = youtubeId(e.url)
    return id ? <YoutubeVideo id={id} titel={titel} staand={e.formaat === 'staand'} className={className} /> : null
  }
  const src = embedSrc(e)
  if (!src) return null
  const v = embedVerhouding(e)
  return (
    <figure className={`mx-auto w-full ${className}`} style={{ maxWidth: v.breedteMax }}>
      <div className="relative w-full overflow-hidden rounded-2xl border border-gray-200 bg-white" style={v.hoogte ? { height: v.hoogte } : { aspectRatio: v.aspect }}>
        <iframe src={src} title={`${titel} (${PROVIDER_LABEL[e.provider]})`} loading="lazy" className="absolute inset-0 h-full w-full"
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation" />
      </div>
      <figcaption className="mt-1.5 text-center">
        <a href={e.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-900">Bekijk op {PROVIDER_LABEL[e.provider]}<ExternalLink className="h-3 w-3" /></a>
      </figcaption>
    </figure>
  )
}
