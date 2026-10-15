'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Plus, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  isOverig, maakOverigType, splitsOverig, normaliseerType, gelijkType, MAX_TYPE_LENGTE,
} from '@/lib/contracten/types'
import { ContracttypesBeheer } from './contracttypes-beheer'

/** Namen van de contracttypes uit de API; null bij een fout (dan blijft het veld gewoon vrij). */
const haalLijst = (): Promise<string[] | null> => fetch('/api/admin/contracts/types', { cache: 'no-store' })
  .then((r) => r.json())
  .then((j) => (Array.isArray(j.types) ? (j.types as Array<{ naam: string }>).map((t) => t.naam) : null))
  .catch(() => null)

/**
 * Contracttype-combobox: kies een bestaand type óf tik een nieuw type in.
 * De lijst komt uit `contract_types` (API), maar het veld is open: elke naam die
 * je intikt wordt gewoon op het contract bewaard. Met "+ Nieuw type" bewaar je
 * de naam ook in de lijst, zodat een collega hem de volgende keer kan kiezen.
 *
 * Kies je "Overige", dan verschijnt een vrij veld voor de eigen omschrijving;
 * die wordt als één waarde bewaard: "Overige — Sponsoring".
 */
export function ContracttypeKiezer({
  waarde, onWijzig, types, disabled, verplicht, id, placeholder = 'Kies of tik een contracttype…',
}: {
  waarde: string
  onWijzig: (nieuw: string) => void
  types?: string[]
  disabled?: boolean
  verplicht?: boolean
  id?: string
  placeholder?: string
}) {
  const uitElkaar = (v: string) => {
    const g = splitsOverig(v)
    return isOverig(v) ? { basis: g.basis, toelichting: g.omschrijving } : { basis: normaliseerType(v), toelichting: '' }
  }

  const [tekst, setTekst] = useState(() => uitElkaar(waarde).basis)
  const [toelichting, setToelichting] = useState(() => uitElkaar(waarde).toelichting)
  const [open, setOpen] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [lijst, setLijst] = useState<string[]>(types ?? [])
  const [beheer, setBeheer] = useState(false)
  const doos = useRef<HTMLDivElement>(null)
  // Wat wij zelf naar buiten stuurden — zo overschrijft de prop het tikken niet
  // (normaliseren haalt anders de spatie weg die je net typte).
  const laatstGestuurd = useRef<string | null>(null)

  // Types ophalen wanneer de pagina ze niet meelevert (bv. het detailscherm).
  useEffect(() => {
    if (types) { setLijst(types); return }
    let levend = true
    void haalLijst().then((l) => { if (levend && l) setLijst(l) })
    return () => { levend = false }
  }, [types])

  // Wijzigt de waarde van buitenaf (bv. na opslaan), dan het veld meenemen.
  useEffect(() => {
    if (waarde === laatstGestuurd.current) return
    const g = uitElkaar(waarde)
    setTekst(g.basis)
    setToelichting(g.toelichting)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waarde])

  // Buiten de combobox klikken sluit de lijst.
  useEffect(() => {
    const opKlik = (e: MouseEvent) => { if (doos.current && !doos.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', opKlik)
    return () => document.removeEventListener('mousedown', opKlik)
  }, [])

  const stuur = (basis: string, toel: string) => {
    const schoon = normaliseerType(basis)
    const uit = isOverig(schoon) ? maakOverigType(schoon, toel) : schoon
    laatstGestuurd.current = uit
    onWijzig(uit)
  }

  const suggesties = useMemo(() => {
    const q = tekst.trim().toLowerCase()
    const gefilterd = q ? lijst.filter((t) => t.toLowerCase().includes(q)) : lijst
    return gefilterd.slice(0, 10)
  }, [lijst, tekst])

  const exactAanwezig = lijst.some((t) => gelijkType(t, tekst))
  const kanToevoegen = !!normaliseerType(tekst) && !exactAanwezig

  const kies = (naam: string) => {
    setTekst(naam)
    setOpen(false)
    if (!isOverig(naam)) { setToelichting(''); stuur(naam, '') } else stuur(naam, toelichting)
  }

  const nieuwBewaren = async () => {
    const naam = normaliseerType(tekst)
    if (!naam || bezig) return
    setBezig(true)
    try {
      const res = await fetch('/api/admin/contracts/types', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Toevoegen mislukt')
      const bewaard = j.naam as string
      setLijst((p) => (p.some((t) => gelijkType(t, bewaard)) ? p : [...p, bewaard]))
      kies(bewaard)
      toast.success(j.bewaard === false ? `"${bewaard}" wordt gebruikt (de lijst bewaren kan pas na de databasemigratie).` : `Contracttype "${bewaard}" toegevoegd.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt')
    } finally { setBezig(false) }
  }

  return (
    <div className="space-y-2">
      <div className="relative" ref={doos}>
        <input
          id={id}
          type="text"
          className="input-base pr-9"
          value={tekst}
          disabled={disabled}
          required={verplicht}
          maxLength={MAX_TYPE_LENGTE}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setTekst(e.target.value); setOpen(true); stuur(e.target.value, toelichting) }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); return }
            if (e.key === 'Enter' && open) {
              e.preventDefault()
              if (suggesties.length === 1) kies(suggesties[0])
              else if (kanToevoegen) void nieuwBewaren()
              else setOpen(false)
            }
          }}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={() => setOpen((p) => !p)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
          aria-label="Contracttypes tonen"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && !disabled && (
          <div className="absolute z-30 mt-1 w-full max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg py-1">
            {suggesties.map((t) => (
              <button
                key={t}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => kies(t)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 flex items-center justify-between gap-2"
              >
                <span className="truncate">{t}</span>
                {gelijkType(t, tekst) && <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />}
              </button>
            ))}
            {suggesties.length === 0 && !kanToevoegen && (
              <div className="px-3 py-2 text-sm text-gray-400">Geen contracttypes gevonden</div>
            )}
            {kanToevoegen && (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void nieuwBewaren()}
                disabled={bezig}
                className="w-full text-left px-3 py-2 text-sm border-t border-gray-100 text-gray-900 hover:bg-[#fff848]/30 flex items-center gap-2"
              >
                {bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                <span className="truncate">Nieuw type: <strong>{normaliseerType(tekst)}</strong></span>
              </button>
            )}
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { setOpen(false); setBeheer(true) }}
              className="w-full text-left px-3 py-2 text-xs border-t border-gray-100 text-gray-500 hover:bg-gray-50 hover:text-gray-900 flex items-center gap-2"
            >
              <Settings2 className="h-3.5 w-3.5" />Types beheren (hernoemen / verwijderen)…
            </button>
          </div>
        )}
      </div>

      {beheer && (
        <ContracttypesBeheer
          onSluit={() => setBeheer(false)}
          onGewijzigd={() => { void haalLijst().then((l) => { if (l) setLijst(l) }) }}
          onHernoemd={(van, naar) => { if (gelijkType(tekst, van)) kies(naar) }}
        />
      )}

      {isOverig(tekst) && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">Eigen omschrijving (optioneel)</label>
          <input
            type="text"
            className="input-base"
            value={toelichting}
            disabled={disabled}
            maxLength={MAX_TYPE_LENGTE}
            placeholder="bv. Sponsoring"
            onChange={(e) => { setToelichting(e.target.value); stuur(tekst, e.target.value) }}
          />
          <p className="text-xs text-gray-400 mt-1">Wordt bewaard als één type: <span className="font-medium">{maakOverigType(tekst, toelichting) || '—'}</span></p>
        </div>
      )}
    </div>
  )
}
