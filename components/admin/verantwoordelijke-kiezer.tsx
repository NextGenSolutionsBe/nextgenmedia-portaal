'use client'

import { CONTRACT_VERANTWOORDELIJKEN, type ContractVerantwoordelijke } from '@/lib/contracten/verantwoordelijke'
import { PersoonKnop } from '@/components/admin/persoon-foto'

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
          <PersoonKnop key={v} naam={v} aan={aan} disabled={bezig} onClick={() => onChange(v)} />
        )
      })}
    </div>
  )
}
