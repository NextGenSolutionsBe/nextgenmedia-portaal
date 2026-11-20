'use client'

import { Car } from 'lucide-react'

/**
 * Vóór een factuur op gefactureerd of verstuurd gaat: altijd even nakijken of
 * er kilometers op moeten. Zonder vinkje gaat de knop niet. Staan er al
 * kilometers op de factuur, dan zegt het vakje dat erbij.
 */
export function KilometerCheck({ aan, onChange, heeftKm, klein }: { aan: boolean; onChange: (aan: boolean) => void; heeftKm?: boolean; klein?: boolean }) {
  return (
    <label className={`flex items-start gap-2 rounded-lg border px-3 py-2 cursor-pointer ${aan ? 'border-green-200 bg-green-50 text-green-900' : 'border-sky-300 bg-sky-50 text-sky-950'} ${klein ? 'text-xs' : 'text-sm'}`}>
      <input type="checkbox" className="mt-0.5" checked={aan} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <b className="inline-flex items-center gap-1"><Car className="h-3.5 w-3.5" />Kilometervergoeding?</b>{' '}
        {heeftKm
          ? 'Er staan al kilometers op deze factuur. Ik heb nagekeken dat ze kloppen en dat er niets ontbreekt.'
          : 'Ik heb nagekeken of er kilometers gereden zijn. Als dat zo is, staan ze op de factuur.'}
      </span>
    </label>
  )
}
