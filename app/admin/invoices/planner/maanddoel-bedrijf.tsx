'use client'

import { useEffect, useState } from 'react'
import { Pencil, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { maandVoortgang, STANDAARD_DOELEN, type Maanddoelen } from '@/lib/financieel/fase7'
import { euro } from '@/lib/facturatie/planner-model'
import { NaarBody } from '@/components/admin/naar-body'

const NAAM: Record<string, string> = { nextgenmedia: 'NextGenMedia', nextgensolutions: 'NextGenSolutions' }

/** De doelen één keer per pagina. */
export function useMaanddoelen(): { doelen: Maanddoelen; zet: (d: Maanddoelen) => void; kanAanpassen: boolean } {
  const [d, setD] = useState<Maanddoelen>(STANDAARD_DOELEN)
  const [kan, setKan] = useState(false)
  useEffect(() => { fetch('/api/admin/invoices/maanddoel', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.doelen) setD(j.doelen); setKan(!!j?.kanAanpassen) }).catch(() => null) }, [])
  return { doelen: d, zet: setD, kanAanpassen: kan }
}

/**
 * Onder de omzetmeter (verbeterplan fase 7, punt 79): per bedrijf wat
 * gefactureerd en gepland is deze maand, tegenover het doel van dat bedrijf,
 * en hoe ver we staan tegenover de ambitie van € 100.000 per maand.
 */
export function MaanddoelPerBedrijf({ rijen, doelen, kanAanpassen, onDoelen }: {
  rijen: { bedrijf: string | null; bedrag: number; gefactureerd: boolean }[]; doelen: Maanddoelen; kanAanpassen: boolean; onDoelen: (d: Maanddoelen) => void
}) {
  const [open, setOpen] = useState(false)
  const v = maandVoortgang(rijen, doelen)
  const totaal = v[0]
  const ambitiePct = doelen.ambitie ? Math.round(((totaal.gefactureerd + totaal.gepland) / doelen.ambitie) * 100) : null
  return (
    <div className="mt-3 border-t border-gray-100 pt-2.5 space-y-1.5">
      {v.slice(1).map((r) => {
        const verwacht = r.gefactureerd + r.gepland
        if (!verwacht && !r.doel) return null
        const vulG = r.doel ? Math.min(100, (r.gefactureerd / r.doel) * 100) : 0
        const vulO = r.doel ? Math.min(100 - vulG, (r.gepland / r.doel) * 100) : 0
        return (
          <div key={r.sleutel} className="text-xs">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="font-semibold text-gray-900 w-36 shrink-0">{NAAM[r.sleutel]}</span>
              <span className="tabular-nums text-gray-700">{euro(verwacht)}{r.doel ? <span className="text-gray-500"> / {euro(r.doel)} · {Math.round((verwacht / r.doel) * 100)}%</span> : null}</span>
              <span className="text-gray-500 tabular-nums">({euro(r.gefactureerd)} gefactureerd)</span>
            </div>
            {r.doel ? <div className="mt-1 h-1.5 rounded-full bg-gray-200 overflow-hidden flex"><div className="h-full bg-[#166534]" style={{ width: `${vulG}%` }} /><div className="h-full bg-gray-300" style={{ width: `${vulO}%` }} /></div> : null}
          </div>
        )
      })}
      <div className="flex items-center gap-2 text-xs text-gray-500">
        {ambitiePct !== null && <span>Op weg naar {euro(doelen.ambitie)} per maand: <b className="text-gray-900 tabular-nums">{ambitiePct}%</b></span>}
        {kanAanpassen && <button type="button" onClick={() => setOpen(true)} className="ml-auto inline-flex items-center gap-1 hover:text-gray-900"><Pencil className="h-3.5 w-3.5" />Doelen</button>}
      </div>
      {open && <DoelenVenster doelen={doelen} onSluit={() => setOpen(false)} onBewaard={(d) => { onDoelen(d); setOpen(false) }} />}
    </div>
  )
}

function DoelenVenster({ doelen, onSluit, onBewaard }: { doelen: Maanddoelen; onSluit: () => void; onBewaard: (d: Maanddoelen) => void }) {
  const [v, setV] = useState({ totaal: String(doelen.totaal), ambitie: String(doelen.ambitie), nextgenmedia: doelen.nextgenmedia ? String(doelen.nextgenmedia) : '', nextgensolutions: doelen.nextgensolutions ? String(doelen.nextgensolutions) : '' })
  const [bezig, setBezig] = useState(false)
  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/invoices/maanddoel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      toast.success('Maanddoelen bewaard.'); onBewaard(j.doelen)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const veld = (k: keyof typeof v, label: string, hint?: string) => (
    <label className="block">
      <span className="text-xs font-medium text-gray-700">{label}</span>
      <input className="input-base mt-1" inputMode="numeric" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^0-9]/g, '') })} placeholder="Geen doel" />
      {hint && <span className="text-[11px] text-gray-500">{hint}</span>}
    </label>
  )
  return (
    <NaarBody>
      <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !bezig && onSluit()}>
        <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Maanddoelen">
          <div className="flex items-center justify-between"><h3 className="font-semibold">Maanddoelen (excl. btw)</h3><button type="button" onClick={onSluit} aria-label="Sluiten" className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center"><X className="h-4 w-4" /></button></div>
          {veld('totaal', 'Doel van deze periode')}
          {veld('ambitie', 'Ambitie per maand', 'Waar we naartoe groeien.')}
          {veld('nextgenmedia', 'Doel NextGenMedia')}
          {veld('nextgensolutions', 'Doel NextGenSolutions')}
          <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary w-full justify-center">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
        </div>
      </div>
    </NaarBody>
  )
}
