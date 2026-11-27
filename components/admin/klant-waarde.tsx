'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import type { KlantWaardeAntwoord } from '@/lib/financieel/fase7-server'

const EUR = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const NAAM: Record<string, string> = { nextgenmedia: 'NextGenMedia', nextgensolutions: 'NextGenSolutions', algemeen: 'Algemeen', onbekend: 'Nog geen bedrijf' }
const datum = (d: string | null) => (d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' }) : null)

/**
 * Klantfiche (verbeterplan fase 7, punten 81 en 84): wat de klant over de
 * hele relatie opbracht, per bedrijf, wat het kostte en de marge, ook per
 * project. Enkel voor wie de financiën mag zien; anders niets.
 */
export function KlantWaarde({ clientId }: { clientId: string }) {
  const [w, setW] = useState<KlantWaardeAntwoord | null>(null)
  const [kanTarief, setKanTarief] = useState(false)
  const [geen, setGeen] = useState(false)
  const [tarief, setTarief] = useState<string | null>(null)
  const laad = useCallback(() => {
    fetch(`/api/admin/clients/waarde?client_id=${clientId}`, { cache: 'no-store' })
      .then(async (r) => { if (r.status === 403) { setGeen(true); return } const j = await r.json(); if (!r.ok) throw new Error(j.error); setW(j.waarde); setKanTarief(!!j.kanTarief) })
      .catch(() => setGeen(true))
  }, [clientId])
  useEffect(() => { laad() }, [laad])
  if (geen) return null
  if (!w) return <div className="card-base py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>
  if (!w.gefactureerd && !w.teFactureren && !w.kosten) return null

  const bewaarTarief = async () => {
    try {
      const r = await fetch('/api/admin/clients/waarde', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uurtarief: tarief }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(j.uurtarief ? `Uurtarief € ${j.uurtarief} bewaard.` : 'Uurtarief weggehaald.'); setTarief(null); laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
  }

  return (
    <details className="card-base group">
      <summary className="cursor-pointer select-none flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-sm flex-1">Klantwaarde en marge</span>
        <span className="text-sm tabular-nums font-semibold">{EUR(w.gefactureerd)}</span>
        <span className="text-xs text-gray-500 tabular-nums">marge {EUR(w.marge)}{w.margePct !== null ? ` (${w.margePct}%)` : ''}</span>
        <ChevronDown className="h-4 w-4 text-gray-400 group-open:rotate-180 transition-transform" />
      </summary>
      <div className="mt-3 space-y-3 text-sm">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[['Gefactureerd', w.gefactureerd], ['Nog te factureren', w.teFactureren], ['Kosten', w.kosten + w.urenKost], ['Marge', w.marge]].map(([l, v]) => (
            <div key={l as string} className="rounded-lg border border-gray-200 p-2"><div className="text-[11px] text-gray-500">{l}</div><div className="text-base sm:text-lg font-semibold tabular-nums">{EUR(v as number)}</div></div>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {w.sinds ? `Klant sinds ${datum(w.sinds)}. ` : ''}Excl. btw. Kosten = kosten en aankopen met deze klant{w.uurtarief ? `, plus ${w.uren.toLocaleString('nl-BE')} uur × € ${w.uurtarief}` : w.uren ? ` (${w.uren.toLocaleString('nl-BE')} uur geregistreerd, nog zonder intern uurtarief)` : ''}.
          {kanTarief && tarief === null && <button type="button" onClick={() => setTarief(w.uurtarief ? String(w.uurtarief) : '')} className="ml-1 inline-flex items-center gap-0.5 underline"><Pencil className="h-3 w-3" />Uurtarief</button>}
        </p>
        {tarief !== null && (
          <div className="flex gap-2 items-center">
            <input className="input-base w-32" inputMode="decimal" value={tarief} onChange={(e) => setTarief(e.target.value)} placeholder="Bv. 65" aria-label="Intern uurtarief" />
            <button type="button" className="btn-primary text-xs" onClick={bewaarTarief}>Bewaren</button>
            <button type="button" className="btn-secondary text-xs" onClick={() => setTarief(null)}>Annuleren</button>
          </div>
        )}
        {w.perBedrijf.length > 1 && (
          <div className="divide-y divide-gray-100 border-y border-gray-100">
            {w.perBedrijf.map((b) => (
              <div key={b.bedrijf} className="flex items-center gap-2 py-1.5 text-xs"><span className="flex-1">{NAAM[b.bedrijf] ?? b.bedrijf}</span><span className="tabular-nums w-24 text-right">{EUR(b.gefactureerd)}</span><span className="tabular-nums w-24 text-right text-gray-500">− {EUR(b.kosten)}</span><span className="tabular-nums w-24 text-right font-semibold">{EUR(b.marge)}</span></div>
            ))}
          </div>
        )}
        {w.projecten.length > 0 && (
          <div>
            <div className="label-mono text-gray-500 mb-1">Per project</div>
            <div className="divide-y divide-gray-100">
              {w.projecten.map((p) => (
                <a key={p.id} href={`/admin/opdrachten?opdracht=${p.id}`} className="flex items-center gap-2 py-1.5 text-xs hover:bg-gray-50"><span className="flex-1 truncate">{p.naam}</span><span className="tabular-nums w-24 text-right">{EUR(p.gefactureerd)}</span><span className="tabular-nums w-24 text-right text-gray-500">− {EUR(p.kosten)}</span><span className="tabular-nums w-24 text-right font-semibold">{EUR(p.marge)}{p.margePct !== null ? ` · ${p.margePct}%` : ''}</span></a>
              ))}
            </div>
          </div>
        )}
      </div>
    </details>
  )
}
