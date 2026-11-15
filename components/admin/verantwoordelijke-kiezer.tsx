'use client'

import { CONTRACT_VERANTWOORDELIJKEN, type ContractVerantwoordelijke } from '@/lib/contracten/verantwoordelijke'

/**
 * Wie is verantwoordelijk voor dit contract? Marco, Bram of Gezamenlijke lead.
 * Die persoon volgt het contract op en tekent namens ons tegen.
 */
export function VerantwoordelijkeKiezer({ waarde, onChange, bezig, id = 'verantwoordelijke' }: {
  waarde: ContractVerantwoordelijke | null
  onChange: (v: ContractVerantwoordelijke) => void
  bezig?: boolean
  id?: string
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby={`${id}-label`}>
      {CONTRACT_VERANTWOORDELIJKEN.map((v) => {
        const aan = waarde === v
        return (
          <button key={v} type="button" role="radio" aria-checked={aan} disabled={bezig} onClick={() => onChange(v)}
            className={`text-sm px-3 py-1.5 rounded-full border transition-colors disabled:opacity-60 ${aan ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
            {v}
          </button>
        )
      })}
    </div>
  )
}
