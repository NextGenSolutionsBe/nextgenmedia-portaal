'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowRight, ChevronDown, Loader2 } from 'lucide-react'
import { faseLabel } from '@/lib/ngs/model'
import type { SolutionsKaart } from '@/lib/sales/solutions-kaarten'

/**
 * Nieuwe werking (28 nov 2026): Solutions staat enkel nog in de Pipeline. De
 * kaarten die hier nog stonden, kiest een zaakvoerder per stuk: verhuizen (een
 * deal in de passende fase, de kaart blijft bewaard) of laten staan.
 */
export function SolutionsKaarten() {
  const [kaarten, setKaarten] = useState<SolutionsKaart[] | null>(null)
  const [open, setOpen] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)
  const laad = useCallback(() => {
    fetch('/api/admin/opdrachten/solutions', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => setKaarten(j?.kaarten ?? [])).catch(() => setKaarten([]))
  }, [])
  useEffect(() => { laad() }, [laad])
  const doe = async (k: SolutionsKaart, actie: 'verhuis' | 'laten' | 'terug') => {
    setBezig(k.id)
    try {
      const r = await fetch('/api/admin/opdrachten/solutions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie, id: k.id }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Mislukt')
      toast.success(actie === 'verhuis' ? `${k.klant ?? k.titel} staat nu in de Pipeline (${faseLabel(k.fase)}). Herlaad het bord.` : actie === 'laten' ? 'De kaart blijft op Projecten.' : 'Weer op de lijst.')
      laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  if (!kaarten) return null
  const open_ = kaarten.filter((k) => !k.keuze)
  if (!kaarten.length) return null
  return (
    <section className="card-base !p-0 overflow-hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-gray-50">
        <span className="h-2 w-2 rounded-full bg-blue-700" aria-hidden />
        <span className="text-sm font-semibold flex-1">Solutions-kaarten op Projecten{open_.length ? `: ${open_.length} te beslissen` : ''}</span>
        <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="border-t border-gray-100">
          <p className="px-4 pt-3 text-xs text-gray-500">Solutions staat enkel nog in de Pipeline. Verhuizen maakt een deal in de passende fase met de notities; de kaart blijft bewaard.</p>
          <ul className="divide-y divide-gray-100">
            {kaarten.map((k) => (
              <li key={k.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">{k.klant ?? k.titel}</div>
                  <div className="text-[11px] text-gray-500 truncate">{k.titel}{k.verantwoordelijke ? ` · ${k.verantwoordelijke}` : ''} · wordt {faseLabel(k.fase)}</div>
                </div>
                {k.keuze === 'verhuisd' && k.deal_id ? (
                  <Link href={`/admin/nextgensolutions?deal=${k.deal_id}`} className="text-xs underline inline-flex items-center gap-1">Verhuisd · deal openen<ArrowRight className="h-3 w-3" /></Link>
                ) : k.keuze === 'laten' ? (
                  <span className="text-xs text-gray-500 inline-flex items-center gap-2">Blijft op Projecten<button type="button" disabled={bezig === k.id} onClick={() => doe(k, 'terug')} className="underline">Terugzetten</button></span>
                ) : (
                  <span className="flex gap-1.5">
                    <button type="button" disabled={bezig === k.id} onClick={() => doe(k, 'verhuis')} className="btn-primary !py-1 text-xs">{bezig === k.id && <Loader2 className="h-3 w-3 animate-spin" />}Verhuizen naar de Pipeline</button>
                    <button type="button" disabled={bezig === k.id} onClick={() => doe(k, 'laten')} className="btn-secondary !py-1 text-xs">Laten staan</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
