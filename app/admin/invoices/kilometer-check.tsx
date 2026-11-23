'use client'

import { useState } from 'react'
import { Car } from 'lucide-react'
import { KilometerVenster } from './kilometer-venster'

/**
 * Vóór een factuur op gefactureerd of verstuurd gaat: altijd even nakijken of
 * er kilometers op moeten. Zonder vinkje gaat de knop niet. Staan er al
 * kilometers op de factuur, dan zegt het vakje dat erbij. Met `momentId` staat
 * er ook een knop om de kilometers meteen op de factuur te zetten (ritten,
 * afstand vanzelf berekend, tarief per km).
 */
export function KilometerCheck({ aan, onChange, heeftKm, klein, momentId, titel, onKm }: {
  aan: boolean; onChange: (aan: boolean) => void; heeftKm?: boolean; klein?: boolean
  /** Het item in de planner ("inv:<id>" of "rec:<reeks>:<maand>"): toont de knop Kilometers. */
  momentId?: string | null
  titel?: string | null
  /** Na het bewaren; bij een maand van een reeks met de sleutel van de nieuwe factuur. */
  onKm?: (nieuwMomentId?: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className={`rounded-lg border ${aan ? 'border-green-200 bg-green-50 text-green-900' : 'border-sky-300 bg-sky-50 text-sky-950'} ${klein ? 'text-xs' : 'text-sm'}`}>
      <div className="flex items-start gap-2 px-3 py-2 flex-wrap sm:flex-nowrap">
        <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
          <input type="checkbox" className="mt-0.5" checked={aan} onChange={(e) => onChange(e.target.checked)} />
          <span>
            <b className="inline-flex items-center gap-1"><Car className="h-3.5 w-3.5" />Kilometervergoeding?</b>{' '}
            {heeftKm
              ? 'Er staan al kilometers op deze factuur. Ik heb nagekeken dat ze kloppen en dat er niets ontbreekt.'
              : 'Ik heb nagekeken of er kilometers gereden zijn. Als dat zo is, staan ze op de factuur.'}
          </span>
        </label>
        {momentId && (
          <button type="button" onClick={() => setOpen(true)}
            className="shrink-0 inline-flex items-center gap-1 rounded-full bg-white border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-800 hover:border-gray-400">
            <Car className="h-3.5 w-3.5" />{heeftKm ? 'Kilometers aanpassen' : 'Kilometers toevoegen'}
          </button>
        )}
      </div>
      {open && momentId && (
        <KilometerVenster momentId={momentId} titel={titel} onSluit={() => setOpen(false)}
          onKlaar={(nieuw) => { setOpen(false); onChange(true); onKm?.(nieuw) }} />
      )}
    </div>
  )
}
