'use client'

import { Clock } from 'lucide-react'
import { YoutubeVideo } from '@/components/media/youtube-video'
import { EmbedFrame } from '@/components/media/embed-frame'
import type { EmbedRef } from '@/lib/embeds'
import { NieuwsInhoud } from '@/components/nieuws/nieuws-inhoud'
import { categorieLabel, type Blok } from '@/lib/nieuwsbrieven'

export type ArtikelData = {
  titel: string; categorie: string; categorie_label?: string | null; samenvatting: string | null; cover_url: string | null; cover_youtube_id: string | null
  cover_formaat?: 'liggend' | 'staand' | null; cover_embed?: EmbedRef | null
  blokken: Blok[]; gepubliceerd_op: string | null; leestijd: number; auteur_naam: string | null
}

export const datumLang = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Nog niet gepubliceerd')

/** Een nieuwsbrief als leesbaar artikel: zelfde weergave in de klantapp en in het voorbeeld van de editor. */
export function ArtikelWeergave({ a }: { a: ArtikelData }) {
  return (
    <article className="space-y-6 sm:space-y-8">
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
          <span className="rounded-full bg-gray-900 text-white px-2.5 py-0.5 text-xs font-medium">{categorieLabel(a.categorie, a.categorie_label)}</span>
          <span>{datumLang(a.gepubliceerd_op)}</span>
          <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{a.leestijd} min</span>
        </div>
        <h1 className="text-3xl sm:text-[42px] font-semibold leading-[1.1] tracking-tight text-gray-900">{a.titel || 'Zonder titel'}</h1>
        {a.samenvatting && <p className="text-lg sm:text-xl leading-relaxed text-gray-600 max-w-prose">{a.samenvatting}</p>}
        {a.auteur_naam && <p className="text-sm text-gray-500">Door {a.auteur_naam}</p>}
      </header>
      {a.cover_embed ? <EmbedFrame e={a.cover_embed} titel={a.titel} />
        : a.cover_youtube_id ? <YoutubeVideo id={a.cover_youtube_id} titel={a.titel} staand={a.cover_formaat === 'staand'} />
        // eslint-disable-next-line @next/next/no-img-element
        : a.cover_url ? <img src={a.cover_url} alt="" className="w-full rounded-3xl object-cover bg-gray-100 max-h-[560px]" /> : null}
      <NieuwsInhoud blokken={a.blokken} />
    </article>
  )
}
