'use client'

import { useState } from 'react'

export type Dag = { dag: string; label: string; slots: { start: string; uur: string }[] }

const knop = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1'

/** Vrije momenten per dag. Enkel begintijden; toont niets wat niet boekbaar is. */
export function Tijdkiezer({ dagen, gekozen, onKies }: { dagen: Dag[]; gekozen: string | null; onKies: (start: string) => void }) {
  const [open, setOpen] = useState<string | null>(() => dagen.find((d) => d.slots.some((s) => s.start === gekozen))?.dag ?? dagen[0]?.dag ?? null)
  if (!dagen.length) return <p className="text-sm text-gray-600">Er zijn de komende weken geen vrije momenten meer. Mail ons gerust op <a className="underline" href="mailto:info@nextgenmedia.be">info@nextgenmedia.be</a>.</p>
  const actief = dagen.find((d) => d.dag === open) ?? dagen[0]
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Kies een dag">
        {dagen.map((d) => {
          const [wd, dd, mm] = d.label.split(' ')
          return (
            <button key={d.dag} type="button" role="tab" aria-selected={d.dag === actief.dag} onClick={() => setOpen(d.dag)}
              className={`shrink-0 rounded-lg border px-3 py-2 text-left ${d.dag === actief.dag ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white hover:border-gray-400'} ${knop}`}>
              <span className="block text-[11px] uppercase tracking-wide opacity-70">{wd?.slice(0, 2)}</span>
              <span className="block text-sm font-semibold whitespace-nowrap">{dd} {mm?.slice(0, 3)}</span>
            </button>
          )
        })}
      </div>
      <div>
        <p className="text-sm font-medium mb-2 first-letter:uppercase">{actief.label}</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {actief.slots.map((s) => (
            <button key={s.start} type="button" onClick={() => onKies(s.start)} aria-pressed={gekozen === s.start}
              className={`rounded-lg border py-2 text-sm font-medium tabular-nums ${gekozen === s.start ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white hover:border-gray-400'} ${knop}`}>
              {s.uur}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
