'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X, Sparkles, Check } from 'lucide-react'
import { DIENSTEN, BRONNEN, raadDiensten, kaartKleur, kolomInfo, kolomVan, type Bron } from '@/lib/opdrachten-kanban'
import type { KaartOpdracht } from './types'

type Rij = { id: string; diensten: string[]; bron: Bron | '' }

/**
 * Kaarten zonder dienst of bron in één keer aanvullen. Per kaart staat een
 * voorstel klaar (dienst uit de titel, bron uit de pipeline); je past aan wat
 * niet klopt en bewaart. Niets wordt zonder deze knop gewijzigd.
 */
export function AanvullenDialoog({ kaarten, onClose, onKlaar }: { kaarten: KaartOpdracht[]; onClose: () => void; onKlaar: () => void }) {
  const teDoen = useMemo(() => kaarten.filter((o) => o.diensten.length === 0 || !o.bron), [kaarten])
  const [rijen, setRijen] = useState<Record<string, Rij>>(() => Object.fromEntries(teDoen.map((o) => [o.id, {
    id: o.id,
    diensten: o.diensten.length ? o.diensten : raadDiensten(o.titel),
    bron: o.bron ?? o.bron_voorstel ?? '',
  }])))
  const [bezig, setBezig] = useState(false)

  const zet = (id: string, p: Partial<Rij>) => setRijen((r) => ({ ...r, [id]: { ...r[id], ...p } }))
  const wissel = (id: string, d: string) => {
    const huidig = rijen[id].diensten
    zet(id, { diensten: huidig.includes(d) ? huidig.filter((x) => x !== d) : [...huidig, d].slice(0, 6) })
  }

  const bewaar = async () => {
    const items = teDoen.map((o) => {
      const r = rijen[o.id]
      const it: Record<string, unknown> = { id: o.id }
      if (o.diensten.length === 0 && r.diensten.length) it.diensten = r.diensten
      if (!o.bron && r.bron) it.bron = r.bron
      return it
    }).filter((it) => Object.keys(it).length > 1)
    if (!items.length) { toast.message('Niets ingevuld om te bewaren.'); return }
    setBezig(true)
    try {
      const res = await fetch('/api/admin/opdrachten/aanvullen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(`${j.gelukt} kaart${j.gelukt === 1 ? '' : 'en'} aangevuld.`)
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Kaarten aanvullen">
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2"><Sparkles className="h-5 w-5" />Kaarten aanvullen</h3>
            <p className="text-sm text-gray-600 mt-0.5">{teDoen.length} kaart{teDoen.length === 1 ? '' : 'en'} zonder dienst of bron. Het voorstel komt uit de titel en de pipeline: klopt het niet, klik het weg.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Sluiten" className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <ul className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {teDoen.map((o) => {
            const r = rijen[o.id]
            const kleur = kaartKleur(r.diensten)
            return (
              <li key={o.id} className="p-4 flex gap-3">
                <span className="mt-1 h-10 w-2 rounded-full shrink-0 border" style={{ background: kleur.achtergrond, borderColor: kleur.rand }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{o.titel}</p>
                    <span className="text-xs text-gray-500">{o.klant_naam}</span>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${kolomInfo(kolomVan(o.status)).label_kleur}`}>{kolomInfo(kolomVan(o.status)).label}</span>
                  </div>
                  {o.diensten.length === 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {DIENSTEN.map((d) => {
                        const aan = r.diensten.includes(d.key as string)
                        return (
                          <button key={d.key} type="button" onClick={() => wissel(o.id, d.key as string)} aria-pressed={aan}
                            style={aan ? { background: d.achtergrond, borderColor: d.donker ? d.achtergrond : d.rand, color: d.tekst } : undefined}
                            className={`text-xs px-2 py-1 rounded-lg border flex items-center gap-1 ${aan ? 'font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                            {aan && <Check className="h-3 w-3" />}{d.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {!o.bron && (
                    <div className="mt-2 flex gap-1 items-center">
                      <span className="text-[11px] text-gray-500 mr-1">Bron:</span>
                      {BRONNEN.map((b) => (
                        <button key={b.key} type="button" onClick={() => zet(o.id, { bron: r.bron === b.key ? '' : b.key })}
                          className={`text-xs px-2 py-1 rounded-lg border ${r.bron === b.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`}>{b.label}</button>
                      ))}
                      {!r.bron && <span className="text-[11px] text-gray-400 ml-1">onbekend</span>}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
        <div className="p-4 border-t border-gray-100 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Annuleer</button>
          <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
        </div>
      </div>
    </div>
  )
}
