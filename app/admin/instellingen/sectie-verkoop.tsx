'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, ArrowUp } from 'lucide-react'
import type { VerkoopInstellingen } from '@/lib/instellingen/model'
import type { Ctx } from './instellingen-client'
import { Kop, OpslaanBalk, INP } from './ui'

/**
 * Verkoop: wie kan verantwoordelijke zijn? Deze namen verschijnen als keuzelijst
 * bij klanten ("Klant van", "Appointment gezet door") en bij opdrachten
 * ("Verantwoordelijke"). Komt er interne sales bij, dan voeg je de naam hier toe.
 */
export function SectieVerkoop({ ctx }: { ctx: Ctx }) {
  const bron = ctx.inst.verkoop
  const [v, setV] = useState<VerkoopInstellingen>(bron)
  const [nieuw, setNieuw] = useState('')
  useEffect(() => { setV(bron) }, [bron])
  const vuil = JSON.stringify(v) !== JSON.stringify(bron)
  const { zetVuil } = ctx
  useEffect(() => { zetVuil(vuil) }, [vuil, zetVuil])

  const namen = v.verantwoordelijken
  const zet = (lijst: string[]) => setV({ verantwoordelijken: lijst })
  const voegToe = () => {
    const n = nieuw.trim().replace(/\s+/g, ' ')
    if (!n || namen.some((x) => x.toLowerCase() === n.toLowerCase())) { setNieuw(''); return }
    zet([...namen, n]); setNieuw('')
  }

  return (
    <div className="card-base">
      <Kop titel="Verkoop" tekst="Wie kan verantwoordelijke zijn? Deze namen staan in de keuzelijsten bij klanten (klant van · appointment gezet door) en bij opdrachten (verantwoordelijke)." />
      <div className="space-y-2 max-w-md">
        {namen.map((n, i) => (
          <div key={i} className="flex items-center gap-2">
            <input className={INP} value={n} maxLength={60} onChange={(e) => zet(namen.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Naam ${i + 1}`} />
            {i > 0 && (
              <button type="button" title="Hoger zetten" aria-label="Hoger zetten" className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"
                onClick={() => { const l = [...namen]; [l[i - 1], l[i]] = [l[i], l[i - 1]]; zet(l) }}><ArrowUp className="h-4 w-4" /></button>
            )}
            <button type="button" title="Verwijderen" aria-label={`${n} verwijderen`} disabled={namen.length <= 1}
              className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg border border-gray-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
              onClick={() => zet(namen.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <form className="flex items-center gap-2 pt-1" onSubmit={(e) => { e.preventDefault(); voegToe() }}>
          <input className={INP} value={nieuw} maxLength={60} onChange={(e) => setNieuw(e.target.value)} placeholder="Nieuwe naam, bv. een nieuwe salescollega" />
          <button type="submit" className="btn-secondary shrink-0" disabled={!nieuw.trim()}><Plus className="h-4 w-4" />Toevoegen</button>
        </form>
        <p className="text-[11px] text-gray-500">Een naam wijzigen of verwijderen verandert niets aan klanten en opdrachten die die naam al hebben; die blijft daar staan tot je ze aanpast.</p>
      </div>
      <OpslaanBalk vuil={vuil} bezig={ctx.bezig} onOpslaan={() => ctx.opslaan('verkoop', { verantwoordelijken: namen.map((x) => x.trim()).filter(Boolean) }, [])} onAnnuleer={() => setV(bron)} bijgewerkt={ctx.bijgewerkt.verkoop} />
    </div>
  )
}
