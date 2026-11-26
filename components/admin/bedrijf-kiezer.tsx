'use client'

import { MEDIA, SOLUTIONS, ALGEMEEN } from '@/lib/bedrijven/model'
import { cn } from '@/lib/utils'

const OPTIES = [
  { key: MEDIA, label: 'NextGen Media', uitleg: 'Marketing' },
  { key: SOLUTIONS, label: 'NextGen Solutions', uitleg: 'Automatisatie en software' },
  { key: ALGEMEEN, label: 'Algemeen', uitleg: 'NextGen Agency BV' },
]

/**
 * Voor welk bedrijf is dit? Twee (of drie) grote knoppen. Gebruikt bij een
 * nieuw contract en overal waar het bedrijf gekozen moet worden.
 */
export function BedrijfKiezer({ waarde, onChange, metAlgemeen = false, id, disabled }: {
  waarde: string | null
  onChange: (v: string) => void
  metAlgemeen?: boolean
  id?: string
  disabled?: boolean
}) {
  const opties = OPTIES.filter((o) => metAlgemeen || o.key !== ALGEMEEN)
  return (
    <div id={id} role="radiogroup" className={cn('grid gap-2', opties.length === 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2')}>
      {opties.map((o) => {
        const aan = waarde === o.key
        return (
          <button key={o.key} type="button" role="radio" aria-checked={aan} disabled={disabled} onClick={() => onChange(o.key)}
            className={cn('text-left px-3 py-2 rounded-xl border transition-colors disabled:opacity-50',
              aan ? (o.key === SOLUTIONS ? 'bg-blue-600 border-blue-600 text-white' : 'bg-black border-black text-white') : 'bg-white border-gray-200 hover:bg-gray-50 text-gray-900')}>
            <div className="text-sm font-medium">{o.label}</div>
            <div className={cn('text-[11px]', aan ? 'text-white/70' : 'text-gray-500')}>{o.uitleg}</div>
          </button>
        )
      })}
    </div>
  )
}

/** Klein label: "Media", "Solutions" of "Algemeen", in de kleur van het bedrijf. */
export function BedrijfLabel({ bedrijf, groot }: { bedrijf: string | null | undefined; groot?: boolean }) {
  if (!bedrijf) return <span className={cn('status-badge bg-amber-50 text-amber-800', groot && 'text-xs')}>Bedrijf?</span>
  const label = bedrijf === SOLUTIONS ? 'Solutions' : bedrijf === MEDIA ? 'Media' : 'Algemeen'
  const kleur = bedrijf === SOLUTIONS ? 'bg-blue-50 text-blue-700' : bedrijf === MEDIA ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
  return <span className={cn('status-badge', kleur, groot && 'text-xs px-2.5 py-1')}>{label}</span>
}
