'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, X, Loader2 } from 'lucide-react'

export type LeadOption = { id: string; label: string; email: string | null; pipelineId: string | null }

/**
 * Lead zoeken en koppelen aan een afspraak.
 *
 * Dit verving een <select> met álle leads erin. Met 2711 leads betekende dat
 * een fetch van 2,7 MB én 2711 <option>-elementen in de DOM — traag om te
 * laden en onwerkbaar om in te zoeken. Nu vraagt dit veld enkel de treffers op
 * die bij wat je typt horen (hooguit 25).
 */
export function LeadKiezer({ waarde, initialId, onKies }: {
  waarde: LeadOption | null
  /** Lead die al vastligt (deep-link of bestaande afspraak) — wordt zelf opgehaald. */
  initialId?: string | null
  onKies: (lead: LeadOption | null) => void
}) {
  const [term, setTerm] = useState('')
  const [treffers, setTreffers] = useState<LeadOption[]>([])
  const [open, setOpen] = useState(false)
  const [bezig, setBezig] = useState(false)
  const doosRef = useRef<HTMLDivElement>(null)

  // Een vastliggende lead één keer ophalen, zodat je zijn naam ziet in plaats
  // van een leeg veld.
  const gehaald = useRef(false)
  useEffect(() => {
    if (!initialId || waarde || gehaald.current) return
    gehaald.current = true
    fetch(`/api/admin/sales/leads/${initialId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const l = j?.lead
        if (!l) return
        onKies({
          id: l.id,
          label: [l.sales_companies?.name, l.sales_contacts?.name].filter(Boolean).join(' · ') || 'Lead',
          email: l.sales_contacts?.email ?? null,
          pipelineId: l.pipeline_id ?? null,
        })
      })
      .catch(() => { /* stil: je kunt nog altijd zelf zoeken */ })
  }, [initialId, waarde, onKies])

  const zoek = useCallback(async (q: string) => {
    setBezig(true)
    try {
      const res = await fetch(`/api/admin/sales/leads/keuzelijst?q=${encodeURIComponent(q)}`)
      const j = await res.json()
      setTreffers(j.leads ?? [])
    } catch { setTreffers([]) } finally { setBezig(false) }
  }, [])

  // Wachten tot je even stopt met typen — anders vuurt elke toetsaanslag een
  // verzoek af.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => { void zoek(term) }, 200)
    return () => clearTimeout(t)
  }, [term, open, zoek])

  useEffect(() => {
    const buiten = (e: MouseEvent) => {
      if (doosRef.current && !doosRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', buiten)
    return () => document.removeEventListener('mousedown', buiten)
  }, [])

  if (waarde) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <span className="flex-1 min-w-0 truncate text-sm">{waarde.label}</span>
        <button
          type="button"
          onClick={() => { onKies(null); setTerm(''); setTreffers([]) }}
          className="text-gray-400 hover:text-gray-700 shrink-0"
          title="Lead loskoppelen"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative" ref={doosRef}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input
          className="input-base pl-9"
          value={term}
          placeholder="Zoek op bedrijf of contactpersoon…"
          onFocus={() => setOpen(true)}
          onChange={(e) => { setTerm(e.target.value); setOpen(true) }}
        />
        {bezig && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          {treffers.length === 0 ? (
            <p className="px-3 py-2 text-sm text-gray-500">
              {bezig ? 'Zoeken…' : term ? 'Geen lead gevonden.' : 'Typ om te zoeken.'}
            </p>
          ) : treffers.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => { onKies(l); setOpen(false); setTerm('') }}
              className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
            >
              {l.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
