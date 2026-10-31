'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Megaphone } from 'lucide-react'
import { CATEGORIEEN } from '@/lib/nieuwsbrieven'
import { HeroKaart, NieuwsKaart, gelezenIds, type FeedItem } from '@/components/nieuws/nieuws-kaart'

/** De nieuwsfeed: uitgelicht verhaal bovenaan, filter per categorie, en vanzelf meer laden onderaan. */
export function NieuwsFeed({ begin, meer: beginMeer }: { begin: FeedItem[]; meer: boolean }) {
  const [cat, setCat] = useState<string>('')
  const [items, setItems] = useState<FeedItem[]>(begin)
  const [meer, setMeer] = useState(beginMeer)
  const [laden, setLaden] = useState(false)
  const [gelezen, setGelezen] = useState<Set<string>>(new Set())
  const einde = useRef<HTMLDivElement>(null)
  useEffect(() => { setGelezen(gelezenIds()) }, [])

  const haal = useCallback(async (categorie: string, voor: string | null) => {
    setLaden(true)
    try {
      const qs = new URLSearchParams(); if (categorie) qs.set('categorie', categorie); if (voor) qs.set('voor', voor)
      const r = await fetch(`/api/portal/nieuws?${qs}`, { cache: 'no-store' }); const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setItems((l) => (voor ? [...l, ...j.items] : j.items)); setMeer(j.meer)
    } catch { setMeer(false) } finally { setLaden(false) }
  }, [])

  const kiesCat = (k: string) => { if (k === cat) return; setCat(k); setItems([]); setMeer(false); void haal(k, null) }

  // Vanzelf meer laden zodra je onderaan komt.
  useEffect(() => {
    const el = einde.current
    if (!el || !meer || laden) return
    const io = new IntersectionObserver((e) => { if (e[0].isIntersecting) void haal(cat, items[items.length - 1]?.gepubliceerd_op ?? null) }, { rootMargin: '600px' })
    io.observe(el); return () => io.disconnect()
  }, [meer, laden, items, cat, haal])

  const hero = !cat ? (items.find((i) => i.uitgelicht) ?? items[0]) : items[0]
  const rest = items.filter((i) => i !== hero)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Megaphone className="h-6 w-6" />Nieuws</h1>
        <p className="text-sm text-gray-500 mt-0.5">Projecten die we afrondden, klanten in de kijker, tips en wat er beweegt in marketing.</p>
      </div>
      <div className="sticky top-0 z-20 -mx-4 px-4 py-2 bg-white/90 backdrop-blur md:static md:mx-0 md:px-0 md:bg-transparent md:backdrop-blur-0">
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar" role="tablist" aria-label="Categorie">
          {[{ key: '', label: 'Alles' }, ...CATEGORIEEN].map((c) => (
            <button key={c.key || 'alles'} type="button" role="tab" aria-selected={cat === c.key} onClick={() => kiesCat(c.key)}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium border transition ${cat === c.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>{c.label}</button>
          ))}
        </div>
      </div>
      {items.length === 0 && !laden ? (
        <div className="card-base text-sm text-gray-500">{cat ? 'Nog niets in deze categorie.' : 'Binnenkort vind je hier ons nieuws.'}</div>
      ) : (
        <>
          {hero && <HeroKaart i={hero} ongelezen={!gelezen.has(hero.id)} />}
          {rest.length > 0 && <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 xl:grid-cols-3">{rest.map((i) => <NieuwsKaart key={i.id} i={i} ongelezen={!gelezen.has(i.id)} />)}</div>}
        </>
      )}
      <div ref={einde} className="flex justify-center py-4">{laden && <Loader2 className="h-5 w-5 animate-spin text-gray-400" />}</div>
    </div>
  )
}
