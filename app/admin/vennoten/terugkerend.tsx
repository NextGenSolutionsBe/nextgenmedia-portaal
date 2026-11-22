'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Paperclip, Plus, Repeat, RotateCcw, Trash2 } from 'lucide-react'
import { FREQ, betaaldata, isLopend, terugkerendStand, volgendeBetaling, type Terugkerend, type Vennoot } from '@/lib/vennoot-uitgaven'
import type { VennotenData } from '@/lib/vennoot-uitgaven-server'
import { AkkoordChips, KleinKnopje, dag, eur, eurKort, post } from './gedeeld'

/** Korte stand van een terugkerende uitgave: sinds wanneer, volgende betaling of tot wanneer. */
export function looptekst(t: Terugkerend, vandaag: string): string {
  const betaald = betaaldata(t, vandaag)
  const volgende = volgendeBetaling(t, vandaag)
  const delen: string[] = []
  if (!betaald.length) delen.push(`eerste betaling ${dag(t.start_datum)}`)
  else delen.push(`sinds ${dag(t.start_datum)}`)
  if (t.eind_datum && t.eind_datum < vandaag) delen.push(`gestopt op ${dag(t.eind_datum)}`)
  else {
    if (volgende && betaald.length) delen.push(`volgende ${dag(volgende)}`)
    if (t.eind_datum) delen.push(`tot en met ${dag(t.eind_datum)}`)
  }
  if (betaald.length) delen.push(`${betaald.length}× betaald, ${eur(betaald.length * t.bedrag)}`)
  return delen.join(' · ')
}

/**
 * Terugkerende uitgaven (lease, huur, abonnement). De lopende staan altijd
 * open; afgelopen en geschrapte achter een knopje. Tik op een rij om aan te
 * passen, te stoppen of te schrappen.
 */
export function TerugkerendKaart({ data, vandaag, vennoot, onNieuw, onBewerk, onKlaar }: {
  data: VennotenData; vandaag: string; vennoot: Vennoot | null
  onNieuw: () => void; onBewerk: (t: Terugkerend) => void; onKlaar: (m: string) => void
}) {
  const [toon, setToon] = useState<'afgelopen' | 'geschrapt' | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const eigen = useMemo(() => data.terugkerend.filter((t) => !vennoot || t.vennoot === vennoot), [data.terugkerend, vennoot])
  const lopend = eigen.filter((t) => isLopend(t, vandaag))
  const afgelopen = eigen.filter((t) => !t.gearchiveerd_op && !isLopend(t, vandaag))
  const geschrapt = eigen.filter((t) => t.gearchiveerd_op)
  // Wat de lopende samen per maand kosten (een kwartaal = een derde, een jaar = een twaalfde).
  const perMaand = lopend.reduce((s, t) => s + t.bedrag / FREQ[t.frequentie].stap, 0)

  const akkoord = async (t: Terugkerend) => {
    setBezig(t.id)
    try { await post({ actie: 'terugkerend.akkoord', id: t.id }); onKlaar('Akkoord gegeven.') } catch (x) { toast.error(x instanceof Error ? x.message : 'Akkoord mislukt') } finally { setBezig(null) }
  }
  const terug = async (t: Terugkerend) => {
    try { await post({ actie: 'terugkerend.terugzetten', id: t.id }); onKlaar('Teruggezet. De betalingen tellen weer mee.') } catch (x) { toast.error(x instanceof Error ? x.message : 'Mislukt') }
  }

  const rij = (t: Terugkerend) => (
    <li key={t.id} className="px-4 py-3 space-y-2">
      <button type="button" onClick={() => onBewerk(t)} className="w-full text-left flex items-start gap-3 rounded-lg -m-1 p-1 hover:bg-gray-50">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            {!vennoot && <span className="inline-flex text-[11px] font-semibold text-gray-800 rounded-full bg-gray-100 px-2 py-0.5">{data.namen[t.vennoot]}</span>}
            <span className="text-sm font-medium text-gray-900">{t.omschrijving}</span>
            {t.bewijs_pad && <Paperclip className="h-3.5 w-3.5 text-gray-400" aria-label="Contract of factuur" />}
          </span>
          <span className="block text-xs text-gray-500 mt-0.5">{looptekst(t, vandaag)}</span>
        </span>
        <span className="text-right shrink-0">
          <span className="block text-sm font-semibold tabular-nums">{eur(t.bedrag)}</span>
          <span className="block text-[11px] text-gray-500">{FREQ[t.frequentie].per}</span>
        </span>
      </button>
      <AkkoordChips stand={terugkerendStand(t, data.terugkerendAkkoorden)} namen={data.namen} ik={data.ik} bezig={bezig === t.id} onAkkoord={() => akkoord(t)} />
    </li>
  )

  return (
    <section className="card-base !p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <Repeat className="h-4 w-4 text-gray-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-gray-900">Terugkerende uitgaven</h2>
          {lopend.length > 0 && <p className="text-[11px] text-gray-500">{lopend.length} lopend · samen ongeveer {eurKort(Math.round(perMaand))} per maand</p>}
        </div>
        <button type="button" onClick={onNieuw} className="text-xs px-2.5 py-1 rounded-full border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-1"><Plus className="h-3 w-3" />Toevoegen</button>
      </div>
      {lopend.length === 0 ? <p className="px-4 py-4 text-sm text-gray-500">Niets dat nu loopt.</p> : <ul className="divide-y divide-gray-100">{lopend.map(rij)}</ul>}
      {(afgelopen.length > 0 || geschrapt.length > 0) && (
        <div className="px-4 py-2.5 border-t border-gray-100 flex gap-2 flex-wrap">
          {afgelopen.length > 0 && <KleinKnopje aan={toon === 'afgelopen'} onClick={() => setToon((x) => (x === 'afgelopen' ? null : 'afgelopen'))}>Afgelopen ({afgelopen.length})</KleinKnopje>}
          {geschrapt.length > 0 && <KleinKnopje aan={toon === 'geschrapt'} onClick={() => setToon((x) => (x === 'geschrapt' ? null : 'geschrapt'))}><Trash2 className="h-3 w-3" />Geschrapt ({geschrapt.length})</KleinKnopje>}
        </div>
      )}
      {toon === 'afgelopen' && afgelopen.length > 0 && <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/60">{afgelopen.map(rij)}</ul>}
      {toon === 'geschrapt' && geschrapt.length > 0 && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/60">
          {geschrapt.map((t) => (
            <li key={t.id} className="px-4 py-3 flex items-start gap-2">
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-gray-700">{data.namen[t.vennoot]} · {t.omschrijving} · {eur(t.bedrag)} {FREQ[t.frequentie].per}</div>
                <div className="text-xs text-amber-800 mt-0.5">Geschrapt{t.gearchiveerd_door ? ` door ${t.gearchiveerd_door}` : ''}: {t.archief_reden}</div>
              </div>
              <button type="button" onClick={() => terug(t)} className="h-9 w-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 shrink-0" title="Terugzetten" aria-label="Terugzetten"><RotateCcw className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
