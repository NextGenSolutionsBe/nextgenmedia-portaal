'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronDown, Loader2, Plus, Search, UserPlus, X, Building2 } from 'lucide-react'
import { naamSleutel } from '@/lib/clients/snel'
import { BtwOpzoeken } from '@/components/admin/btw-opzoeken'
import { zoekVeld as zoekVeldProps } from '@/lib/zoekveld'

/**
 * Klant kiezen of meteen een nieuwe toevoegen, zonder het formulier te
 * verlaten (bv. tijdens het opmaken van een contract). Zoeken op naam,
 * contactpersoon of e-mail; onderaan "Nieuwe klant toevoegen" met de
 * zoektekst al ingevuld. Een nieuwe klant krijgt enkel de basis (geen login,
 * geen diensten, geen mail); de rest vul je later aan in de klantfiche.
 */

export type KlantOptie = { id: string; company_name: string; contact_name?: string | null; email?: string | null; archived_at?: string | null }
export { vulOndertekenaar } from '@/lib/clients/snel'

type Bestaand = { id: string; company_name: string; reden: 'btw' | 'naam' | 'email'; gearchiveerd: boolean; mag_toch_nieuw: boolean }

const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15 focus:border-gray-900'
const LBL = 'block text-xs font-medium text-gray-600 mb-1'
const MAX = 50

export function KlantKiezer({ klanten, waarde, onKies, onNieuw, leegLabel, bron = 'contract', id = 'klant-kiezer' }: {
  klanten: KlantOptie[] | null
  waarde: string
  onKies: (klant: KlantOptie | null) => void
  /** Nieuwe klant aangemaakt: voeg ze toe aan je eigen lijst. */
  onNieuw?: (klant: KlantOptie) => void
  /** Optie "geen klant" bovenaan (bv. "Geen klant (los/intern contract)"). Weglaten = klant verplicht. */
  leegLabel?: string
  bron?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)
  const [zoek, setZoek] = useState('')
  const [actief, setActief] = useState(0)
  const [nieuw, setNieuw] = useState<null | { company_name: string; contact_name: string; email: string; telefoon: string; btw_nummer: string; adres_straat: string; adres_postcode: string; adres_gemeente: string }>(null)
  const [meer, setMeer] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [bestaand, setBestaand] = useState<Bestaand | null>(null)
  const doos = useRef<HTMLDivElement>(null)
  const zoekVeld = useRef<HTMLInputElement>(null)

  const gekozen = klanten?.find((k) => k.id === waarde) ?? null
  const treffers = useMemo(() => {
    const q = zoek.trim().toLowerCase(), sleutel = naamSleutel(zoek)
    const lijst = (klanten ?? []).filter((k) => !q || k.company_name.toLowerCase().includes(q) || (sleutel && naamSleutel(k.company_name).includes(sleutel))
      || (k.contact_name ?? '').toLowerCase().includes(q) || (k.email ?? '').toLowerCase().includes(q))
    // Actieve klanten eerst, dan wie met de zoektekst begint, dan alfabetisch.
    return lijst.sort((a, b) => Number(!!a.archived_at) - Number(!!b.archived_at)
      || Number(!a.company_name.toLowerCase().startsWith(q)) - Number(!b.company_name.toLowerCase().startsWith(q))
      || a.company_name.localeCompare(b.company_name, 'nl')).slice(0, MAX)
  }, [klanten, zoek])
  // Rijen in de lijst: [geen klant] + treffers + [nieuwe klant].
  const rijen = useMemo(() => [
    ...(leegLabel ? [{ soort: 'leeg' as const }] : []),
    ...treffers.map((k) => ({ soort: 'klant' as const, k })),
    { soort: 'nieuw' as const },
  ], [treffers, leegLabel])

  useEffect(() => { setActief(0) }, [zoek])
  useEffect(() => {
    if (!open) return
    const weg = (e: MouseEvent) => { if (!doos.current?.contains(e.target as Node)) sluit() }
    document.addEventListener('mousedown', weg)
    return () => document.removeEventListener('mousedown', weg)
  }, [open])

  function sluit() { setOpen(false); setZoek('') }
  function kies(k: KlantOptie | null) { onKies(k); sluit() }
  function startNieuw() {
    setNieuw({ company_name: zoek.trim(), contact_name: '', email: '', telefoon: '', btw_nummer: '', adres_straat: '', adres_postcode: '', adres_gemeente: '' })
    setMeer(false); setFout(null); setBestaand(null); setOpen(false)
  }
  function kiesRij(i: number) {
    const r = rijen[i]
    if (!r) return
    if (r.soort === 'leeg') kies(null)
    else if (r.soort === 'klant') kies(r.k)
    else startNieuw()
  }

  async function maak(tochNieuw = false) {
    if (!nieuw || bezig) return
    if (nieuw.company_name.trim().length < 2) { setFout('Vul de bedrijfsnaam in.'); return }
    setBezig(true); setFout(null)
    try {
      const r = await fetch('/api/admin/clients/snel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...nieuw, toch_nieuw: tochNieuw, bron }) })
      const j = await r.json().catch(() => ({}))
      if (r.status === 409 && j.bestaand) { setBestaand(j.bestaand as Bestaand); setFout(null); return }
      if (!r.ok) throw new Error(j.error || 'Klant aanmaken mislukt')
      const k = j.klant as KlantOptie
      onNieuw?.(k); onKies(k)
      toast.success(`${k.company_name} aangemaakt en gekozen. Aanvullen kan later in de klantfiche.`)
      setNieuw(null); setBestaand(null)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Klant aanmaken mislukt') } finally { setBezig(false) }
  }
  function kiesBestaand() {
    if (!bestaand) return
    const k = klanten?.find((x) => x.id === bestaand.id) ?? { id: bestaand.id, company_name: bestaand.company_name }
    if (!klanten?.some((x) => x.id === k.id)) onNieuw?.(k)
    onKies(k); setNieuw(null); setBestaand(null)
  }

  // Enter in het mini-formulier maakt de klant aan, niet het contract.
  const enterMaakt = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); maak() } if (e.key === 'Escape') { e.preventDefault(); setNieuw(null) } }
  const veld = (k: keyof NonNullable<typeof nieuw>, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div><label className={LBL} htmlFor={`${id}-${k}`}>{label}</label>
      <input id={`${id}-${k}`} className={INP} value={nieuw?.[k] ?? ''} onChange={(e) => setNieuw((n) => (n ? { ...n, [k]: e.target.value } : n))} onKeyDown={enterMaakt} {...props} /></div>
  )

  if (nieuw) {
    return (
      <div className="rounded-xl border border-gray-900 bg-gray-50 p-3 space-y-3" role="group" aria-labelledby={`${id}-nieuw-titel`}>
        <div className="flex items-center justify-between gap-2">
          <p id={`${id}-nieuw-titel`} className="text-sm font-semibold flex items-center gap-1.5"><UserPlus className="h-4 w-4" />Nieuwe klant</p>
          <button type="button" onClick={() => setNieuw(null)} className="h-7 w-7 rounded-lg hover:bg-gray-200 flex items-center justify-center" aria-label="Annuleren"><X className="h-4 w-4" /></button>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {veld('company_name', 'Bedrijfsnaam *', { autoFocus: true, placeholder: 'Bv. Bakkerij Peeters', autoComplete: 'organization' })}
          <div>
            {veld('btw_nummer', 'Btw-nummer', { placeholder: 'BE0123456789' })}
            {/* Naam en adres uit het btw-register: vult enkel wat nog leeg is. */}
            <BtwOpzoeken btw={nieuw.btw_nummer} onNetjes={(x) => setNieuw((n) => (n ? { ...n, btw_nummer: x } : n))} onGevonden={(g) => {
              setNieuw((n) => (n ? { ...n, company_name: n.company_name.trim() || g.naam || '', adres_straat: n.adres_straat || g.straat || '', adres_postcode: n.adres_postcode || g.postcode || '', adres_gemeente: n.adres_gemeente || g.gemeente || '' } : n))
              if (g.straat || g.gemeente) setMeer(true)
            }} />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-2">
          {veld('contact_name', 'Contactpersoon', { placeholder: 'Voor- en achternaam', autoComplete: 'name' })}
          {veld('email', 'E-mail', { type: 'email', placeholder: 'naam@bedrijf.be', autoComplete: 'email' })}
        </div>
        {meer ? (
          <div className="space-y-2">
            {veld('telefoon', 'Telefoon', { type: 'tel', placeholder: '+32 …', autoComplete: 'tel' })}
            {veld('adres_straat', 'Straat en nummer', { autoComplete: 'street-address' })}
            <div className="grid grid-cols-[1fr_2fr] gap-2">
              {veld('adres_postcode', 'Postcode', { autoComplete: 'postal-code' })}
              {veld('adres_gemeente', 'Gemeente', { autoComplete: 'address-level2' })}
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setMeer(true)} className="text-xs text-gray-600 underline underline-offset-2">Telefoon en adres toevoegen</button>
        )}
        {bestaand && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900 space-y-2" role="alert">
            <p>Er bestaat al een klant {bestaand.reden === 'btw' ? 'met dit btw-nummer' : bestaand.reden === 'naam' ? 'met deze naam' : 'met dit e-mailadres'}: <b>{bestaand.company_name}</b>{bestaand.gearchiveerd ? ' (gearchiveerd)' : ''}.</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={kiesBestaand} className="btn-primary !py-1.5 text-xs"><Check className="h-3.5 w-3.5" />Die klant kiezen</button>
              {bestaand.mag_toch_nieuw && <button type="button" onClick={() => maak(true)} disabled={bezig} className="btn-secondary !py-1.5 text-xs">Toch een nieuwe klant</button>}
            </div>
          </div>
        )}
        {fout && <p className="text-sm text-red-700" role="alert">{fout}</p>}
        <p className="text-[11px] text-gray-500">Enkel de basis. De klant krijgt geen mail en nog geen login; diensten en portaaltoegang regel je later in de klantfiche.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => maak()} disabled={bezig} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Klant aanmaken</button>
          <button type="button" onClick={() => setNieuw(null)} className="btn-secondary">Annuleren</button>
        </div>
      </div>
    )
  }

  return (
    <div ref={doos} className="relative">
      {!open ? (
        <button type="button" id={id} onClick={() => { setOpen(true); setTimeout(() => zoekVeld.current?.focus(), 0) }} aria-haspopup="listbox" aria-describedby={`${id}-keuze`}
          className={`${INP} flex items-center gap-2 text-left`}>
          <Building2 className="h-4 w-4 text-gray-400 shrink-0" />
          {gekozen
            ? <span id={`${id}-keuze`} className="min-w-0 flex-1"><span className="block truncate font-medium text-gray-900">{gekozen.company_name}</span>{(gekozen.contact_name || gekozen.email) && <span className="block truncate text-xs text-gray-500">{[gekozen.contact_name, gekozen.email].filter(Boolean).join(' · ')}</span>}</span>
            : <span id={`${id}-keuze`} className="flex-1 text-gray-500">{waarde ? 'Huidige klant' : leegLabel ?? 'Kies of voeg een klant toe…'}</span>}
          <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" />
        </button>
      ) : (
        <div className="relative">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input {...zoekVeldProps('klant')} ref={zoekVeld} id={id} role="combobox" aria-expanded aria-controls={`${id}-lijst`} aria-activedescendant={`${id}-rij-${actief}`} autoComplete="off"
            className={`${INP} pl-9`} placeholder="Zoek op naam, contactpersoon of e-mail…" value={zoek} onChange={(e) => setZoek(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActief((a) => Math.min(a + 1, rijen.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActief((a) => Math.max(a - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); kiesRij(actief) }
              else if (e.key === 'Escape') { e.preventDefault(); sluit() }
            }} />
        </div>
      )}
      {open && (
        // Klapt open onder het zoekveld (geen zwevende lijst): werkt ook in een scrollende dialoog.
        <ul id={`${id}-lijst`} role="listbox" className="mt-1 w-full max-h-72 overflow-auto rounded-xl border border-gray-200 bg-white shadow-sm py-1">
          {klanten === null && <li className="px-3 py-2 text-sm text-gray-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Klanten laden…</li>}
          {rijen.map((r, i) => {
            const basis = `w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${i === actief ? 'bg-gray-100' : 'hover:bg-gray-50'}`
            if (r.soort === 'leeg') return <li key="leeg" id={`${id}-rij-${i}`} role="option" aria-selected={!waarde}><button type="button" onMouseEnter={() => setActief(i)} onClick={() => kies(null)} className={`${basis} text-gray-600`}><X className="h-4 w-4 text-gray-400" />{leegLabel}</button></li>
            if (r.soort === 'nieuw') return (
              <li key="nieuw" id={`${id}-rij-${i}`} role="option" aria-selected={false} className="border-t border-gray-100 mt-1 pt-1">
                <button type="button" onMouseEnter={() => setActief(i)} onClick={startNieuw} className={`${basis} font-medium text-gray-900`}>
                  <UserPlus className="h-4 w-4" />{zoek.trim() ? <>Nieuwe klant toevoegen: <span className="truncate">“{zoek.trim()}”</span></> : 'Nieuwe klant toevoegen'}
                </button>
              </li>
            )
            const k = r.k
            return (
              <li key={k.id} id={`${id}-rij-${i}`} role="option" aria-selected={k.id === waarde}>
                <button type="button" onMouseEnter={() => setActief(i)} onClick={() => kies(k)} className={basis}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-gray-900">{k.company_name}{k.archived_at && <span className="ml-1.5 text-[11px] text-gray-400">gearchiveerd</span>}</span>
                    {(k.contact_name || k.email) && <span className="block truncate text-xs text-gray-500">{[k.contact_name, k.email].filter(Boolean).join(' · ')}</span>}
                  </span>
                  {k.id === waarde && <Check className="h-4 w-4 shrink-0" />}
                </button>
              </li>
            )
          })}
          {klanten !== null && treffers.length === 0 && zoek.trim() && <li className="px-3 pb-1 text-xs text-gray-500">Geen klant gevonden met “{zoek.trim()}”.</li>}
        </ul>
      )}
    </div>
  )
}
