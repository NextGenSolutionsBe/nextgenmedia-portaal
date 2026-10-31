'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Mail, Plus, Star, Play, ImageIcon } from 'lucide-react'
import { CATEGORIEEN, categorieLabel, type Nieuwsbrief } from '@/lib/nieuwsbrieven'
import { youtubeThumb } from '@/lib/youtube'

type Rij = Nieuwsbrief & { cover_url: string | null; leestijd: number }
const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

export function NieuwsbrievenLijst({ magMaken }: { magMaken: boolean }) {
  const router = useRouter()
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [filter, setFilter] = useState<'alles' | 'concept' | 'gepubliceerd'>('alles')
  const [bezig, setBezig] = useState(false)
  useEffect(() => {
    fetch('/api/admin/nieuwsbrieven', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j.error) throw new Error(j.error); setRijen(j.nieuwsbrieven) })
      .catch((e) => { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setRijen([]) })
  }, [])
  const lijst = useMemo(() => (rijen ?? []).filter((r) => filter === 'alles' || r.status === filter), [rijen, filter])

  const nieuw = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/nieuwsbrieven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categorie: CATEGORIEEN[0].key }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      router.push(`/admin/nieuwsbrieven/${j.nieuwsbrief.id}`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); setBezig(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        {magMaken && <button type="button" onClick={nieuw} disabled={bezig} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Nieuwe nieuwsbrief</button>}
        <div className="flex gap-1">
          {(['alles', 'concept', 'gepubliceerd'] as const).map((f) => <button key={f} type="button" onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-full text-xs font-medium border ${filter === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>{f === 'alles' ? 'Alles' : f === 'concept' ? 'Concepten' : 'Gepubliceerd'}</button>)}
        </div>
      </div>
      {rijen === null ? <div className="card-base flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        : lijst.length === 0 ? <div className="card-base text-sm text-gray-500">{rijen.length ? 'Niets in deze selectie.' : 'Nog geen nieuwsbrieven. Begin met een afgerond project: foto’s, een korte uitleg en eventueel een video.'}</div>
        : (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {lijst.map((r) => {
              const beeld = r.cover_url ?? (r.cover_youtube_id ? youtubeThumb(r.cover_youtube_id) : null)
              return (
                <li key={r.id}>
                  <Link href={`/admin/nieuwsbrieven/${r.id}`} className="card-base !p-0 overflow-hidden flex flex-col h-full hover:ring-2 hover:ring-gray-200 transition">
                    <div className="relative aspect-[16/9] bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {beeld ? <img src={beeld} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : <ImageIcon className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 text-gray-300" />}
                      {r.cover_youtube_id && <span className="absolute left-3 bottom-3 h-8 w-8 rounded-full bg-white/90 flex items-center justify-center"><Play className="h-4 w-4" fill="currentColor" /></span>}
                      <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[11px] font-semibold ${r.status === 'gepubliceerd' ? 'bg-green-600 text-white' : 'bg-white text-gray-700'}`}>{r.status === 'gepubliceerd' ? 'Gepubliceerd' : 'Concept'}</span>
                    </div>
                    <div className="p-4 space-y-1.5 flex-1">
                      <p className="text-xs text-gray-500 flex items-center gap-1.5">{r.uitgelicht && <Star className="h-3.5 w-3.5 text-amber-500" fill="currentColor" />}{categorieLabel(r.categorie, r.categorie_label)} · {r.status === 'gepubliceerd' ? datum(r.gepubliceerd_op) : `bewerkt ${datum(r.updated_at)}`}</p>
                      <p className="font-semibold leading-snug line-clamp-2">{r.titel}</p>
                      {r.samenvatting && <p className="text-sm text-gray-600 line-clamp-2">{r.samenvatting}</p>}
                    </div>
                    {r.mail_verstuurd_op && <p className="px-4 pb-3 text-xs text-gray-500 flex items-center gap-1"><Mail className="h-3.5 w-3.5" />Gemaild naar {r.mail_aantal ?? 0} ontvangers</p>}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
    </div>
  )
}
