'use client'

import { KANAAL_SLUGS } from '@/lib/social-platforms'
import { TYPES, kanaalKleur, kanaalNaam, typeKleur, typeNaam, type KalenderStijl } from '@/lib/content/kalender-stijl'

type Stijl = Pick<KalenderStijl, 'typeKleuren' | 'typeNamen' | 'kanaalKleuren' | 'kanaalNamen'> | null | undefined

const pil = (aan: boolean) => `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
  aan ? 'border-gray-900 bg-gray-100 text-black' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`

/** Type kiezen bij het inplannen: met de eigen naam en kleur van deze kalender. */
export function TypeKeuze({ waarde, onKies, stijl }: { waarde: string; onKies: (t: string) => void; stijl?: Stijl }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Type">
      {TYPES.map((t) => (
        <button key={t.key} type="button" role="radio" aria-checked={waarde === t.key} onClick={() => onKies(t.key)} className={pil(waarde === t.key)}>
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: typeKleur(t.key, stijl?.typeKleuren ?? {}) }} />{typeNaam(t.key, stijl)}
        </button>
      ))}
    </div>
  )
}

/** Kanalen kiezen bij het inplannen (meerdere mogelijk): met de eigen naam en kleur van deze kalender. */
export function KanaalKeuze({ waarde, onWissel, stijl }: { waarde: string[]; onWissel: (k: string) => void; stijl?: Stijl }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {KANAAL_SLUGS.map((k) => {
        const aan = waarde.includes(k)
        return (
          <button key={k} type="button" aria-pressed={aan} onClick={() => onWissel(k)} className={pil(aan)}>
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: kanaalKleur(k, stijl) }} />{kanaalNaam(k, stijl)}
          </button>
        )
      })}
    </div>
  )
}
