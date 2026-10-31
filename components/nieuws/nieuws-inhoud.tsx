'use client'

import { ArrowUpRight, Quote } from 'lucide-react'
import { YoutubeVideo } from '@/components/media/youtube-video'
import { publiekeUrl } from '@/lib/marketing-media'
import { leesTekst, type Blok, type Inline } from '@/lib/nieuwsbrieven'

/** De inhoud van een nieuwsbrief: zelfde weergave in de klantapp en in het voorbeeld van de editor. */
export function NieuwsInhoud({ blokken }: { blokken: Blok[] }) {
  return (
    <div className="space-y-6 sm:space-y-8">
      {blokken.map((b) => <BlokWeergave key={b.id} b={b} />)}
    </div>
  )
}

function BlokWeergave({ b }: { b: Blok }) {
  switch (b.type) {
    case 'tekst':
      return (
        <div className="max-w-prose space-y-4 text-[17px] leading-[1.75] text-gray-800">
          {leesTekst(b.tekst).map((a, i) => a.soort === 'lijst'
            ? <ul key={i} className="list-disc pl-6 space-y-1.5">{a.items.map((it, j) => <li key={j}><Delen d={it} /></li>)}</ul>
            : <p key={i} className="whitespace-pre-line"><Delen d={a.delen} /></p>)}
        </div>
      )
    case 'kop':
      return <h2 className="max-w-prose text-2xl sm:text-[28px] font-semibold leading-tight tracking-tight text-gray-900 pt-2">{b.tekst}</h2>
    case 'afbeelding': {
      const url = publiekeUrl(b.pad)
      if (!url) return null
      return (
        <figure className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={b.onderschrift || ''} loading="lazy" className="w-full rounded-2xl object-cover bg-gray-100" />
          {b.onderschrift && <figcaption className="text-sm text-gray-500">{b.onderschrift}</figcaption>}
        </figure>
      )
    }
    case 'galerij':
      return (
        <div className={`grid gap-2 sm:gap-3 ${b.paden.length === 1 ? '' : b.paden.length === 2 || b.paden.length === 4 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3'}`}>
          {b.paden.map((p, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p} src={publiekeUrl(p) ?? ''} alt="" loading="lazy" className={`w-full aspect-square object-cover rounded-xl bg-gray-100 ${b.paden.length === 3 && i === 0 ? 'col-span-2 sm:col-span-1' : ''}`} />
          ))}
        </div>
      )
    case 'video':
      return (
        <figure className="space-y-2">
          <YoutubeVideo id={b.youtube_id} titel={b.onderschrift || 'Video'} />
          {b.onderschrift && <figcaption className="text-sm text-gray-500">{b.onderschrift}</figcaption>}
        </figure>
      )
    case 'citaat':
      return (
        <blockquote className="max-w-prose border-l-4 border-gray-900 pl-5 py-1">
          <Quote className="h-5 w-5 text-gray-300 mb-1" aria-hidden />
          <p className="text-xl sm:text-2xl font-medium leading-snug text-gray-900">{b.tekst}</p>
          {b.wie && <footer className="mt-2 text-sm text-gray-500">— {b.wie}</footer>}
        </blockquote>
      )
    case 'knop':
      return (
        <div><a href={b.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl bg-gray-900 text-white px-5 py-3 text-sm font-semibold hover:bg-gray-800">{b.tekst}<ArrowUpRight className="h-4 w-4" /></a></div>
      )
  }
}

function Delen({ d }: { d: Inline[] }) {
  return <>{d.map((x, i) => x.t === 'vet' ? <strong key={i} className="font-semibold text-gray-900">{x.s}</strong>
    : x.t === 'cursief' ? <em key={i}>{x.s}</em>
    : x.t === 'link' ? <a key={i} href={x.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 decoration-gray-400 hover:decoration-gray-900">{x.s}</a>
    : <span key={i}>{x.s}</span>)}</>
}
