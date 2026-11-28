'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, X } from 'lucide-react'
import { leesGetal } from '@/lib/getal'
import { KlantKiezer, type KlantOptie } from '@/components/admin/klant-kiezer'
import type { ContractWeergave } from '@/lib/vesting-weergave'
import { api, eur } from './delen'

const INP = 'input-base'
const LBL = 'block text-xs font-medium text-gray-600 mb-1'
const VOORBEELD = 'Bv. klant stopte na 4 van de 12 maanden en betaalde 4 × € 500 = € 2.000. Marco zette de afspraak en closete, dus alles telt.'

/**
 * Klant vroeger gestopt: het bedrag dat effectief meetelt, met een beschrijving.
 * Geen rekensom meer; Marco, Bram en Chiara tekenen daarna opnieuw.
 */
export function GestoptBlok({ c, onPatch, bezig }: { c: ContractWeergave; onPatch: (velden: Record<string, unknown>, sleutel: string) => Promise<boolean>; bezig: boolean }) {
  const [open, setOpen] = useState(false)

  if (open) {
    return (
      <div className="rounded-lg border border-gray-200 p-3">
        <BedragForm
          beginBedrag={c.vast ?? (c.status === 'stopgezet' && c.teltMee > 0 ? c.teltMee : null)}
          beginUitleg={c.vastUitleg ?? (c.betaaldBijStop !== null ? `Klant betaalde ${eur(c.betaaldBijStop, true)} voor de stop.` : '')}
          bezig={bezig}
          onAnnuleer={() => setOpen(false)}
          onBewaar={async (bedrag, uitleg) => { if (await onPatch({ meetellend_vast: bedrag, meetellend_uitleg: uitleg }, 'gestopt')) setOpen(false) }}
        />
      </div>
    )
  }

  if (c.vast !== null) {
    return (
      <div className="rounded-lg border border-gray-200 p-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-medium text-gray-900">Klant vroeger gestopt</div>
            {c.vastUitleg && <p className="mt-1 text-xs text-gray-600 whitespace-pre-wrap">{c.vastUitleg}</p>}
          </div>
          <div className="text-right shrink-0">
            <div className="font-semibold tabular-nums">{eur(c.vast, true)}</div>
            <div className="text-[11px] text-gray-500">telt mee</div>
          </div>
        </div>
        <div className="mt-2 flex gap-3 text-xs">
          <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-gray-500 hover:text-black"><Pencil className="h-3 w-3" />Aanpassen</button>
          <button type="button" disabled={bezig} onClick={() => onPatch({ meetellend_vast: null, status: c.betaaldBijStop !== null ? 'stopgezet' : 'actief' }, 'gestopt')} className="text-gray-500 hover:text-red-600">
            {bezig ? 'Even geduld…' : 'Vastgelegd bedrag weghalen'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-gray-300 px-3 py-2.5">
      <p className="text-xs text-gray-600">
        {c.status === 'stopgezet'
          ? <>Vroegtijdig stopgezet{c.betaaldBijStop !== null ? `, de klant betaalde ${eur(c.betaaldBijStop, true)}` : ''}. Liever zelf vastleggen welk bedrag meetelt?</>
          : 'Is deze klant vroeger gestopt? Leg vast welk bedrag effectief meetelt.'}
      </p>
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-xs h-8 shrink-0">Klant is gestopt</button>
    </div>
  )
}

function BedragForm({ beginBedrag, beginUitleg, bezig, onBewaar, onAnnuleer }: {
  beginBedrag: number | null; beginUitleg: string; bezig: boolean
  onBewaar: (bedrag: number, uitleg: string) => void; onAnnuleer: () => void
}) {
  const [bedrag, setBedrag] = useState(beginBedrag !== null ? String(beginBedrag).replace('.', ',') : '')
  const [uitleg, setUitleg] = useState(beginUitleg)
  const b = leesGetal(bedrag)
  const ok = b !== null && b >= 0 && uitleg.trim().length >= 5
  return (
    <div className="space-y-2">
      <div>
        <label className={LBL}>Bedrag dat effectief meetelt voor Marco (excl. btw)</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
          <input className={`${INP} pl-7 text-base font-semibold`} inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="0" autoFocus aria-label="Bedrag dat meetelt" />
        </div>
      </div>
      <div>
        <label className={LBL}>Beschrijving</label>
        <textarea className={`${INP} min-h-[80px]`} value={uitleg} onChange={(e) => setUitleg(e.target.value)} placeholder={VOORBEELD} maxLength={2000} />
      </div>
      <p className="text-[11px] text-gray-500">Dit bedrag telt zo mee, zonder verdere rekensom. Daarna tekenen Marco, Bram en Chiara het.</p>
      <div className="flex gap-2">
        <button type="button" className="btn-primary text-sm" disabled={!ok || bezig} onClick={() => b !== null && onBewaar(b, uitleg.trim())}>{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
        <button type="button" className="btn-secondary text-sm" onClick={onAnnuleer}>Annuleren</button>
      </div>
    </div>
  )
}

/**
 * Een gestopte klant die nog niet in de vesting staat: klant, wanneer het
 * contract getekend werd (bepaalt het jaar), het bedrag dat meetelt en waarom.
 */
export function GestopteKlantToevoegen({ klanten, onClose, onKlaar }: {
  klanten: { id: string; naam: string }[]
  onClose: () => void
  onKlaar: (id: string | null) => void
}) {
  const [opties, setOpties] = useState<KlantOptie[]>(() => klanten.map((k) => ({ id: k.id, company_name: k.naam })))
  const [klantId, setKlantId] = useState('')
  const [naam, setNaam] = useState('')
  const [datum, setDatum] = useState('')
  const [waarde, setWaarde] = useState('')
  const [bedrag, setBedrag] = useState('')
  const [uitleg, setUitleg] = useState('')
  const [bezig, setBezig] = useState(false)

  const b = leesGetal(bedrag)
  const w = waarde.trim() ? leesGetal(waarde) : null
  const fout = !naam.trim() ? 'Kies de klant of typ de naam.'
    : !/^\d{4}-\d{2}-\d{2}$/.test(datum) ? 'Wanneer werd het contract getekend?'
    : b === null || b < 0 ? 'Vul het bedrag in dat meetelt.'
    : waarde.trim() && (w === null || w < 0) ? 'Kijk de contractwaarde na.'
    : uitleg.trim().length < 5 ? 'Schrijf erbij waarom dit bedrag meetelt.'
    : null

  const bewaar = async () => {
    if (fout || b === null) { if (fout) toast.error(fout); return }
    setBezig(true)
    try {
      const j = await api('/api/admin/vesting', {
        method: 'POST',
        body: JSON.stringify({
          resource: 'contract', klant: naam.trim(), client_id: klantId || null, ondertekend_op: datum,
          facturatiemodel: 'eenmalig', handmatige_totaalwaarde: w ?? b, maandbedrag: null, duur_maanden: null,
          appointment_door_marco: false, closed_door_marco: false, betalingen_op_schema: true, uitgesloten_kosten: 0,
          status: 'stopgezet', meetellend_vast: b, meetellend_uitleg: uitleg.trim(),
        }),
      })
      toast.success(`${naam.trim()}: ${eur(b, true)} telt mee. Nu nog tekenen.`)
      onKlaar(typeof j.id === 'string' ? j.id : null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 className="font-semibold">Gestopte klant toevoegen</h3>
          <button type="button" onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-gray-600">Voor een klant die een contract had en vroeger stopte. Je legt het bedrag vast dat effectief meetelt, met een beschrijving. Daarna tekenen Marco, Bram en Chiara.</p>
          <div>
            <label className={LBL}>Klant</label>
            <KlantKiezer id="gestopte-klant" klanten={opties} waarde={klantId} leegLabel="Staat niet (meer) in de app"
              onKies={(k) => { setKlantId(k?.id ?? ''); if (k) setNaam(k.company_name) }}
              onNieuw={(k) => setOpties((l) => [...l, k])} />
            {!klantId && <input className={`${INP} mt-2`} value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Naam van de klant" maxLength={200} />}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LBL}>Contract getekend op</label>
              <input type="date" className={INP} value={datum} onChange={(e) => setDatum(e.target.value)} />
            </div>
            <div>
              <label className={LBL}>Contractwaarde (optioneel)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
                <input className={`${INP} pl-7`} inputMode="decimal" value={waarde} onChange={(e) => setWaarde(e.target.value)} placeholder="0" aria-label="Contractwaarde" />
              </div>
            </div>
          </div>
          <div>
            <label className={LBL}>Bedrag dat effectief meetelt voor Marco (excl. btw)</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
              <input className={`${INP} pl-7 text-base font-semibold`} inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="0" aria-label="Bedrag dat meetelt" />
            </div>
          </div>
          <div>
            <label className={LBL}>Beschrijving</label>
            <textarea className={`${INP} min-h-[90px]`} value={uitleg} onChange={(e) => setUitleg(e.target.value)} placeholder={VOORBEELD} maxLength={2000} />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="btn-secondary text-sm">Annuleren</button>
            <button type="button" onClick={bewaar} disabled={bezig || !!fout} title={fout ?? undefined} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Toevoegen</button>
          </div>
        </div>
      </div>
    </div>
  )
}
