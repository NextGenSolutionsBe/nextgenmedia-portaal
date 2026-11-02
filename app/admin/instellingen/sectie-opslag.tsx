'use client'

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Database } from 'lucide-react'
import { grootte, OPSLAG_LIMIET_GB, type Opslag } from '@/lib/opslag'
import { Kop, Laden, datumTijd } from './ui'

const balkKleur = (n: Opslag['niveau']) => (n === 'kritiek' ? 'bg-red-500' : n === 'let_op' ? 'bg-amber-500' : 'bg-gray-900')

export function SectieOpslag() {
  const [data, setData] = useState<{ opslag: Opslag; op: string } | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const laad = useCallback(async () => {
    setFout(null)
    try {
      const r = await fetch('/api/admin/instellingen/opslag', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      setData(j)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])

  if (fout) return <div className="card-base text-sm text-red-700">{fout}</div>
  if (!data) return <Laden />
  const o = data.opslag
  const max = Math.max(1, ...o.delen.map((d) => d.bytes))

  return (
    <div className="card-base space-y-5">
      <Kop titel="Opslag in Supabase"
        tekst={`Wat deze app gebruikt: databank en bestanden samen, tegenover de ${OPSLAG_LIMIET_GB} GB van het abonnement. Die ${OPSLAG_LIMIET_GB} GB delen we met andere projecten; die tellen hier niet mee.`}
        rechts={<button type="button" onClick={laad} className="btn-secondary"><RefreshCw className="h-4 w-4" />Vernieuwen</button>} />

      <div>
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-2xl font-semibold tabular-nums">{grootte(o.totaalBytes)} <span className="text-sm font-normal text-gray-500">van {OPSLAG_LIMIET_GB} GB</span></div>
          <div className={`text-sm font-medium tabular-nums ${o.niveau === 'kritiek' ? 'text-red-700' : o.niveau === 'let_op' ? 'text-amber-700' : 'text-gray-600'}`}>
            {o.procent.toLocaleString('nl-BE', { maximumFractionDigits: o.procent < 10 ? 1 : 0 })}% gebruikt
          </div>
        </div>
        <div className="mt-2 h-2.5 rounded-full bg-gray-100 overflow-hidden">
          <div className={`h-full rounded-full ${balkKleur(o.niveau)}`} style={{ width: `${Math.max(0.5, Math.min(100, o.procent))}%` }} />
        </div>
        <div className="mt-2 text-xs text-gray-500 flex flex-wrap gap-x-4 gap-y-1">
          <span>Bestanden {grootte(o.bestandenBytes)}</span>
          <span>Databank {grootte(o.databankBytes)}</span>
          <span>Bijgewerkt {datumTijd(data.op)}</span>
        </div>
        {o.niveau !== 'ok' && (
          <p className={`mt-3 text-sm rounded-lg px-3 py-2 ${o.niveau === 'kritiek' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
            {o.niveau === 'kritiek' ? 'De opslag zit bijna vol. ' : 'De opslag loopt op. '}
            Kijk welk onderdeel het meeste plaats inneemt; video-opleveringen ruimen zichzelf na 3 dagen op.
          </p>
        )}
      </div>

      <div>
        <div className="text-[11px] font-medium text-gray-400 mb-2">Per onderdeel</div>
        <ul className="divide-y divide-gray-100">
          {o.delen.map((d) => (
            <li key={d.sleutel} className="py-2.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center">
              <div className="min-w-0 text-sm truncate flex items-center gap-1.5">
                {d.sleutel === 'databank' && <Database className="h-3.5 w-3.5 text-gray-400 shrink-0" />}
                {d.label}
                {d.bestanden !== null && <span className="text-[11px] text-gray-400 shrink-0">{d.bestanden} bestand{d.bestanden === 1 ? '' : 'en'}</span>}
              </div>
              <div className="text-sm tabular-nums text-gray-700">{grootte(d.bytes)}</div>
              <div className="col-span-2 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-gray-400" style={{ width: `${Math.max(0.5, (d.bytes / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
