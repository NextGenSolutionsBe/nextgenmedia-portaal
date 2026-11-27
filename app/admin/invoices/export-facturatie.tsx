'use client'

import { useState } from 'react'
import { Download, X } from 'lucide-react'
import { NaarBody } from '@/components/admin/naar-body'

const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const maandStart = (d: string, terug = 0) => { const x = new Date(`${d.slice(0, 7)}-01T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() - terug); return x.toISOString().slice(0, 10) }
const maandEind = (start: string) => { const x = new Date(`${start}T12:00:00Z`); x.setUTCMonth(x.getUTCMonth() + 1, 0); return x.toISOString().slice(0, 10) }

/**
 * Export naar het facturatieprogramma (verbeterplan fase 7, punt 85): een
 * CSV met per factuurregel de handelsnaam, het bedrijf en de dienst.
 */
export function ExportFacturatie() {
  const [open, setOpen] = useState(false)
  const vorige = maandStart(vandaag(), 1)
  const [van, setVan] = useState(vorige)
  const [tot, setTot] = useState(maandEind(vorige))
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-xs"><Download className="h-3.5 w-3.5" />Export boekhouding</button>
      {open && (
        <NaarBody>
          <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
            <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Export boekhouding">
              <div className="flex items-center justify-between"><h3 className="font-semibold">Export voor het facturatieprogramma</h3><button type="button" onClick={() => setOpen(false)} aria-label="Sluiten" className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"><X className="h-4 w-4" /></button></div>
              <div className="flex gap-1.5 flex-wrap">
                {[0, 1, 2].map((t) => { const s = maandStart(vandaag(), t); return <button key={t} type="button" onClick={() => { setVan(s); setTot(maandEind(s)) }} className={`rounded-lg border px-2 py-1 text-xs capitalize ${van === s ? 'border-gray-900' : 'border-gray-200'}`}>{new Date(`${s}T12:00:00Z`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })}</button> })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-gray-600">Van<input type="date" className="input-base mt-1" value={van} onChange={(e) => setVan(e.target.value)} /></label>
                <label className="text-xs text-gray-600">Tot<input type="date" className="input-base mt-1" value={tot} onChange={(e) => setTot(e.target.value)} /></label>
              </div>
              <p className="text-[11px] text-gray-500">Uitgereikte facturen op factuurdatum, één regel per factuurregel, met handelsnaam, bedrijf en dienst. Puntkomma als scheiding.</p>
              <a href={`/api/admin/invoices/export?van=${van}&tot=${tot}`} className={`btn-primary w-full justify-center ${van && tot && van <= tot ? '' : 'pointer-events-none opacity-50'}`} onClick={() => setTimeout(() => setOpen(false), 300)}><Download className="h-4 w-4" />CSV downloaden</a>
            </div>
          </div>
        </NaarBody>
      )}
    </>
  )
}
