'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Archive, Check, Loader2, X } from 'lucide-react'
import { REDEN_VOORSTEL, VENNOTEN, maandLabel, type Vennoot } from '@/lib/vennoot-uitgaven'
import { PersoonFoto } from '@/components/admin/persoon-foto'

/** Gedeeld door de schermen van Uitgaven vennoten (uitgaven, extra budget, terugkerend). */

export const eur = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })
/** € 200 zonder ,00 als het een rond bedrag is. */
export const eurKort = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })
export const dag = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })
export const maand = (ym: string) => maandLabel(ym)
export const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/15 focus:border-gray-900'
export const lbl = 'block text-xs font-medium text-gray-600 mb-1'
export const bedragTekst = (n: number) => n.toFixed(2).replace('.', ',')

export async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/vennoten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
  return j
}

/** Op de gsm een blad van onderen, op de computer een venster in het midden. */
export function Venster({ titel, onSluit, children }: { titel: string; onSluit: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 sm:p-4" onClick={onSluit}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto overscroll-contain" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titel}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 className="font-semibold">{titel}</h3>
          <button type="button" onClick={onSluit} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] space-y-4">{children}</div>
      </div>
    </div>
  )
}

type Stand = Record<Vennoot, { akkoord_op: string } | null> & { allen: boolean; aangepast: boolean }

/** Wie al akkoord gaf (groen), wie nog niet, en de knop voor jou. */
export function AkkoordChips({ stand, namen, ik, bezig, onAkkoord, klaarTekst = 'akkoord van alle drie' }: {
  stand: Stand; namen: Record<Vennoot, string>; ik: Vennoot | null; bezig: boolean; onAkkoord: () => void; klaarTekst?: string
}) {
  const ikMoet = !!ik && !stand[ik]
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {VENNOTEN.map((k) => {
        const a = stand[k]
        return (
          <span key={k} title={a ? `Akkoord op ${new Date(a.akkoord_op).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels' })}` : 'Nog geen akkoord'}
            className={`inline-flex items-center gap-1 rounded-full pl-0.5 pr-2 py-0.5 text-[11px] ${a ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-white text-gray-500 border border-gray-200'}`}>
            <PersoonFoto naam={namen[k]} maat={16} />{namen[k]}{a ? <Check className="h-3 w-3" /> : null}
          </span>
        )
      })}
      {stand.allen && klaarTekst && <span className="text-[11px] text-green-700 font-medium">{klaarTekst}</span>}
      {!stand.allen && stand.aangepast && <span className="text-[11px] text-amber-700">aangepast na een akkoord</span>}
      {ikMoet && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onAkkoord() }} disabled={bezig} className="ml-1 inline-flex items-center gap-1 rounded-full bg-gray-900 text-white px-3 py-1 text-xs font-semibold hover:bg-black disabled:opacity-50">
          {bezig ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Akkoord
        </button>
      )}
    </div>
  )
}

/** Schrappen of archiveren, altijd met een verantwoording. */
export function SchrapVenster({ titel, regel, uitleg, actie, id, knop, voorstel = REDEN_VOORSTEL, onSluit, onKlaar }: {
  titel: string; regel: React.ReactNode; uitleg: string; actie: string; id: string; knop: string; voorstel?: string | null; onSluit: () => void; onKlaar: () => void
}) {
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  const doe = async () => {
    setBezig(true)
    try { await post({ actie, id, reden }); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); setBezig(false) }
  }
  return (
    <Venster titel={titel} onSluit={onSluit}>
      <p className="text-sm text-gray-700">{regel}</p>
      <p className="text-xs text-gray-500">{uitleg}</p>
      <label className="block"><span className={lbl}>Verantwoording</span><textarea rows={3} className={inp} value={reden} onChange={(e) => setReden(e.target.value)} maxLength={500} placeholder="Waarom?" /></label>
      {voorstel && <button type="button" onClick={() => setReden(voorstel)} className="text-xs px-2.5 py-1 rounded-full border border-gray-200 hover:bg-gray-50 text-left">{voorstel}</button>}
      <button type="button" onClick={doe} disabled={bezig || reden.trim().length < 3} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}{knop}</button>
    </Venster>
  )
}

/** Klein knopje onderaan een kaart (Toon alle, Geschrapt …). */
export function KleinKnopje({ aan, onClick, children }: { aan?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={aan} className={`text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1 ${aan ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50 text-gray-700'}`}>{children}</button>
  )
}
