'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, ChevronLeft } from 'lucide-react'
import { ArtikelWeergave, type ArtikelData } from '@/components/nieuws/artikel-weergave'
import { NieuwsKaart, gelezenIds, markeerGelezen, type FeedItem } from '@/components/nieuws/nieuws-kaart'

/** Leespagina: voortgangsbalk bovenaan, het artikel, dan het volgende verhaal en "Lees ook". */
export function ArtikelPagina({ n, verder }: { n: ArtikelData & { id: string }; verder: FeedItem[] }) {
  const [voortgang, setVoortgang] = useState(0)
  const [gelezen, setGelezen] = useState<Set<string>>(new Set())
  useEffect(() => { markeerGelezen(n.id); setGelezen(gelezenIds()); window.scrollTo(0, 0) }, [n.id])
  useEffect(() => {
    const opScroll = () => { const h = document.documentElement; const max = h.scrollHeight - h.clientHeight; setVoortgang(max > 0 ? Math.min(1, h.scrollTop / max) : 0) }
    opScroll(); window.addEventListener('scroll', opScroll, { passive: true }); return () => window.removeEventListener('scroll', opScroll)
  }, [])
  const [volgende, ...andere] = verder

  return (
    <div className="animate-fade-in">
      <div className="fixed left-0 right-0 top-0 z-50 h-1 bg-transparent" aria-hidden><div className="h-full bg-gray-900 transition-[width] duration-150" style={{ width: `${voortgang * 100}%` }} /></div>
      <div className="max-w-3xl mx-auto space-y-8">
        <Link href="/portal/nieuws" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900"><ChevronLeft className="h-4 w-4" />Alle nieuws</Link>
        <ArtikelWeergave a={n} />
        {volgende && (
          <Link href={`/portal/nieuws/${volgende.slug}`} className="group block rounded-3xl bg-gray-950 text-white p-6 sm:p-8">
            <p className="text-xs uppercase tracking-wider text-white/60">Volgend verhaal</p>
            <p className="mt-2 text-xl sm:text-2xl font-semibold leading-snug group-hover:underline underline-offset-4">{volgende.titel}</p>
            {volgende.samenvatting && <p className="mt-2 text-sm text-white/75 line-clamp-2">{volgende.samenvatting}</p>}
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold">Lees verder<ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
          </Link>
        )}
      </div>
      {andere.length > 0 && (
        <section className="mt-12 space-y-5" aria-labelledby="lees-ook">
          <h2 id="lees-ook" className="text-lg font-semibold">Lees ook</h2>
          <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">{andere.map((i) => <NieuwsKaart key={i.id} i={i} ongelezen={!gelezen.has(i.id)} />)}</div>
        </section>
      )}
    </div>
  )
}
