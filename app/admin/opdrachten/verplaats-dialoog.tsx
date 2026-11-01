'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, X, Send, FileSignature, Ban, CheckCircle2, Euro } from 'lucide-react'
import { OFFERTE_VIA, kolomInfo, statusVoorKolom, type KolomKey } from '@/lib/opdrachten-kanban'
import { formatEuro } from '@/lib/utils'
import { vandaagISO, type OpdrachtStatus } from '@/lib/opdrachten'
import type { ContractOptie, KaartOpdracht, VerplaatsExtra } from './types'

export type VerplaatsSoort = 'offerte' | 'contract' | 'stop' | 'afronden'

/** Welke vraag hoort bij een verplaatsing? Null = meteen verplaatsen. */
export function vraagBijVerplaatsen(o: KaartOpdracht, doel: KolomKey): VerplaatsSoort | null {
  if (doel === 'offerte') return 'offerte'
  if (doel === 'contract' && !o.contract_id) return 'contract'
  if (doel === 'stopgezet') return 'stop'
  if (doel === 'afgerond' && !o.facturatie?.volledig) return 'afronden'
  return null
}

/**
 * De korte vraag bij een verplaatsing: via welke weg ging de offerte, welk
 * contract hoort erbij, waarom stopt het, of toch afronden zonder dat alles
 * gefactureerd is.
 */
export function VerplaatsDialoog({ o, soort, contracten, onClose, onBevestig }: {
  o: KaartOpdracht
  soort: VerplaatsSoort
  contracten: ContractOptie[]
  onClose: () => void
  onBevestig: (status: OpdrachtStatus, extra: VerplaatsExtra) => Promise<boolean>
}) {
  const [via, setVia] = useState<string>(o.offerte_via && OFFERTE_VIA.some((v) => v.key === o.offerte_via) ? o.offerte_via : o.offerte_via ? 'andere' : '')
  const [viaEigen, setViaEigen] = useState(o.offerte_via && !OFFERTE_VIA.some((v) => v.key === o.offerte_via) ? o.offerte_via : '')
  const [op, setOp] = useState(o.offerte_op ?? vandaagISO())
  const [bedrag, setBedrag] = useState(o.bedrag_excl !== null && o.bedrag_excl !== undefined ? String(o.bedrag_excl) : '')
  const [contractId, setContractId] = useState('')
  const [stopStatus, setStopStatus] = useState<OpdrachtStatus>(statusVoorKolom(o.status, 'stopgezet'))
  const [reden, setReden] = useState('')
  const [notitie, setNotitie] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  const opties = useMemo(() => ({
    eigen: contracten.filter((c) => o.client_id && c.client_id === o.client_id),
    rest: contracten.filter((c) => !o.client_id || c.client_id !== o.client_id),
  }), [contracten, o.client_id])

  const bevestig = async (zonder?: boolean) => {
    setFout(null)
    const extra: VerplaatsExtra = {}
    let status: OpdrachtStatus = statusVoorKolom(o.status, soort === 'offerte' ? 'offerte' : soort === 'contract' ? 'contract' : soort === 'stop' ? 'stopgezet' : 'afgerond')
    if (soort === 'offerte') {
      const gekozen = via === 'andere' ? viaEigen.trim() : via
      if (!gekozen) { setFout('Kies hoe je de prijs of offerte gedeeld hebt.'); return }
      extra.offerte_via = gekozen
      extra.offerte_op = op || null
      if (bedrag.trim() !== String(o.bedrag_excl ?? '')) extra.bedrag_excl = bedrag.trim() || null
    }
    if (soort === 'contract' && !zonder) {
      if (!contractId) { setFout('Kies het contract, of ga verder zonder.'); return }
      extra.contract_id = contractId
    }
    if (soort === 'stop') { status = stopStatus; extra.stop_reden = reden.trim() || null }
    if (notitie.trim()) extra.notitie = notitie.trim()
    setBezig(true)
    const ok = await onBevestig(status, extra)
    setBezig(false)
    if (ok) onClose()
  }

  const titel = soort === 'offerte' ? 'Offerte gestuurd' : soort === 'contract' ? 'Contract koppelen' : soort === 'stop' ? 'Stopzetten of geen akkoord' : 'Afronden'
  const Ikoon = soort === 'offerte' ? Send : soort === 'contract' ? FileSignature : soort === 'stop' ? Ban : CheckCircle2
  const keuze = (actief: boolean) => `text-sm px-3 py-2 rounded-xl border transition-colors ${actief ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:border-gray-400'}`

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] flex flex-col" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-modal="true" aria-label={titel}>
        <div className="flex items-start justify-between gap-3 p-5 pb-3">
          <div>
            <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{o.titel}</p>
            <h3 className="text-lg font-semibold flex items-center gap-2 mt-0.5"><Ikoon className="h-5 w-5" />{titel}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Sluiten" className="h-9 w-9 rounded-lg flex items-center justify-center hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 pb-2 space-y-4 overflow-y-auto">
          {soort === 'offerte' && (
            <>
              <div>
                <p className="text-sm font-medium mb-2">Hoe heb je de prijs gedeeld?</p>
                <div className="flex flex-wrap gap-1.5">
                  {OFFERTE_VIA.map((v) => <button key={v.key} type="button" onClick={() => setVia(v.key)} className={keuze(via === v.key)}>{v.label}</button>)}
                  <button type="button" onClick={() => setVia('andere')} className={keuze(via === 'andere')}>Anders…</button>
                </div>
                {via === 'andere' && (
                  <input className="input-base mt-2" autoFocus value={viaEigen} onChange={(e) => setViaEigen(e.target.value)} maxLength={60} placeholder="Bv. op de beurs, via LinkedIn" />
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="vd-op">Wanneer?</label>
                  <input id="vd-op" type="date" className="input-base" value={op} onChange={(e) => setOp(e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="vd-bedrag">Prijs excl. btw</label>
                  <div className="relative">
                    <Euro className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input id="vd-bedrag" inputMode="decimal" className="input-base pl-8" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="4950" />
                  </div>
                </div>
              </div>
            </>
          )}

          {soort === 'contract' && (
            <div>
              <p className="text-sm text-gray-600 mb-2">
                Koppel het contract dat je verstuurde. Tekent de klant in de app, dan schuift de kaart vanzelf naar Getekend contract.
              </p>
              <select className="input-base" value={contractId} onChange={(e) => setContractId(e.target.value)} aria-label="Contract">
                <option value="">Kies een contract…</option>
                {opties.eigen.length > 0 && (
                  <optgroup label="Van deze klant">{opties.eigen.map((c) => <option key={c.id} value={c.id}>{c.titel} · {c.label}</option>)}</optgroup>
                )}
                <optgroup label={opties.eigen.length ? 'Andere contracten' : 'Contracten'}>
                  {opties.rest.map((c) => <option key={c.id} value={c.id}>{c.titel} · {c.label}</option>)}
                </optgroup>
              </select>
              <Link href={`/admin/contracts/new${o.client_id ? `?client=${o.client_id}` : ''}`} className="text-xs text-blue-700 underline mt-2 inline-block" target="_blank">
                Nog geen contract? Maak er een (nieuw tabblad)
              </Link>
            </div>
          )}

          {soort === 'stop' && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setStopStatus('geen_interesse')} className={keuze(stopStatus === 'geen_interesse')}>Geen akkoord</button>
                <button type="button" onClick={() => setStopStatus('geannuleerd')} className={keuze(stopStatus === 'geannuleerd')}>Vroegtijdig stopgezet</button>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="vd-reden">Waarom? <span className="text-gray-400">optioneel</span></label>
                <input id="vd-reden" className="input-base" value={reden} onChange={(e) => setReden(e.target.value)} maxLength={500} placeholder="Bv. te duur, kiest voor een andere partij, budget bevroren" />
              </div>
            </>
          )}

          {soort === 'afronden' && (
            <p className="text-sm text-gray-700 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
              {o.facturatie?.totaal
                ? <>Er is pas <b>{formatEuro(o.facturatie.gefactureerd)}</b> van <b>{formatEuro(o.facturatie.totaal)}</b> gefactureerd. </>
                : <>We zien nog geen volledige facturatie voor deze opdracht. </>}
              Normaal schuift een kaart vanzelf naar Afgerond zodra alles gefactureerd is. Toch nu afronden?
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="vd-notitie">Interne notitie <span className="text-gray-400">optioneel</span></label>
            <textarea id="vd-notitie" rows={2} className="input-base" value={notitie} onChange={(e) => setNotitie(e.target.value)} maxLength={4000}
              placeholder={soort === 'offerte' ? 'Bv. klant laat iets weten na de vakantie' : 'Wat moet het team weten?'} />
          </div>
          {fout && <p className="text-sm text-red-700">{fout}</p>}
        </div>

        <div className="p-4 border-t border-gray-100 flex flex-wrap gap-2 justify-end">
          {soort === 'contract' && (
            <button type="button" onClick={() => bevestig(true)} disabled={bezig} className="btn-secondary text-sm mr-auto">Later koppelen</button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Annuleer</button>
          <button type="button" onClick={() => bevestig()} disabled={bezig} className="btn-primary text-sm">
            {bezig && <Loader2 className="h-4 w-4 animate-spin" />}
            {soort === 'afronden' ? 'Toch afronden' : `Naar ${kolomInfo(soort === 'offerte' ? 'offerte' : soort === 'contract' ? 'contract' : 'stopgezet').label}`}
          </button>
        </div>
      </div>
    </div>
  )
}
