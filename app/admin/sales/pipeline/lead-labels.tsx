'use client'

import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Tag, X } from 'lucide-react'

/**
 * Labels van een lead: tonen als chips, eentje weghalen, eentje toevoegen.
 *
 * Tot nu kwamen labels enkel uit een CSV-import en kon je ze nergens meer
 * rechtzetten. Nieuwe labels zijn vrije tekst; de suggesties zijn de labels die
 * al ergens op het bord voorkomen, zodat "Bouw" en "bouw " geen twee labels
 * worden. De server ontdubbelt en trimt nog een keer.
 */
export function LeadLabels({ labels, suggesties = [], bezig, onOpslaan }: {
  labels: string[]
  suggesties?: string[]
  bezig: boolean
  /** Bewaart de volledige nieuwe lijst; true als het lukte. */
  onOpslaan: (labels: string[], melding: string) => Promise<boolean>
}) {
  const [nieuw, setNieuw] = useState('')
  const lijstId = useId()
  const beschikbaar = suggesties.filter((s) => !labels.some((l) => l.toLowerCase() === s.toLowerCase()))

  const voegToe = async () => {
    const l = nieuw.trim().replace(/\s+/g, ' ').slice(0, 60)
    if (!l) return
    if (labels.some((x) => x.toLowerCase() === l.toLowerCase())) { toast.error('Dit label staat er al.'); return }
    // Bestaat het label al elders met andere hoofdletters, neem dan die schrijfwijze.
    const bestaand = suggesties.find((s) => s.toLowerCase() === l.toLowerCase()) ?? l
    if (await onOpslaan([...labels, bestaand], `Label "${bestaand}" toegevoegd.`)) setNieuw('')
  }

  const haalWeg = async (l: string) => {
    if (!window.confirm(`Label "${l}" weghalen bij deze lead?`)) return
    await onOpslaan(labels.filter((x) => x !== l), `Label "${l}" weggehaald.`)
  }

  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wide text-gray-400 font-bold mb-2 flex items-center gap-1">
        <Tag className="h-3 w-3" />Labels
      </h3>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {labels.length === 0 && <p className="text-xs text-gray-400">Nog geen labels.</p>}
        {labels.map((l) => (
          <span key={l} className="text-xs bg-gray-100 text-gray-800 pl-2 pr-0.5 py-0.5 rounded-full flex items-center gap-1 max-w-full">
            <span className="truncate">{l}</span>
            <button type="button" onClick={() => haalWeg(l)} disabled={bezig}
              className="h-5 w-5 shrink-0 rounded-full text-gray-400 hover:bg-red-100 hover:text-red-600 flex items-center justify-center"
              title={`Label "${l}" weghalen`} aria-label={`Label ${l} weghalen`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <form className="flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void voegToe() }}>
        <input className="input-base text-sm flex-1 min-w-0" list={lijstId} value={nieuw} maxLength={60}
          placeholder="Label toevoegen…" aria-label="Nieuw label" onChange={(e) => setNieuw(e.target.value)} />
        <datalist id={lijstId}>
          {beschikbaar.slice(0, 300).map((s) => <option key={s} value={s} />)}
        </datalist>
        <button type="submit" disabled={bezig || !nieuw.trim()} className="btn-secondary text-sm" title="Label toevoegen">
          <Plus className="h-4 w-4" />
        </button>
      </form>
    </section>
  )
}
