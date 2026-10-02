'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Save } from 'lucide-react'
import { GetalInvoer } from '@/components/ui/getal-invoer'

/**
 * Gegevens van een lead rechtzetten: bedrijf én contactpersoon.
 *
 * Eén formulier voor twee plekken — het detailpaneel in de pipeline en het
 * belscherm. Precies daar hoort het thuis: aan de telefoon hoor je de juiste
 * naam, het rechtstreekse nummer of "dat is de verkeerde persoon", en dan moet
 * je dat meteen kwijt kunnen in plaats van het achteraf te onthouden.
 *
 * Er gaat alleen op wat je ECHT veranderde. Een veld dat je niet aanraakte
 * wordt niet meegestuurd, dus een leeg gelaten vak kan nooit stilletjes iets
 * wissen dat er wel stond.
 */

export type Bedrijfsvelden = {
  name?: string | null; website?: string | null; sector?: string | null
  city?: string | null; region?: string | null; phone?: string | null
  country?: string | null; linkedin?: string | null
  /** Aantal werknemers (getal) en de ruwe werkklasse uit de import ("10–19"). */
  employees?: number | null; werkklasse?: string | null
  /** De balie of secretaresse die je eerst aan de lijn krijgt. */
  gatekeeper_naam?: string | null
  /** De beslissingnemer: wie er uiteindelijk ja of nee zegt. */
  dmu_naam?: string | null; dmu_functie?: string | null
}
export type Contactvelden = {
  name?: string | null; role?: string | null; email?: string | null
  phone?: string | null; mobile?: string | null; linkedin?: string | null
}

const tekst = (v: string | null | undefined) => v ?? ''

/**
 * Eén invoerveld. Bewust op moduleniveau: een component die binnen de render
 * gedefinieerd wordt, krijgt bij elke toetsaanslag een nieuw type. React hangt
 * dan een nieuw input-element op, en de cursor springt na één letter weg.
 */
function Veld({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void
  type?: string; placeholder?: string
}) {
  return (
    <label className="block text-[11px] font-medium text-gray-500">
      {label}
      <input type={type} className="input-base mt-0.5 text-sm" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

export function LeadGegevens({ leadId, bedrijf, contact, compact = false, onOpgeslagen, onKlaar }: {
  leadId: string
  bedrijf: Bedrijfsvelden | null
  contact: Contactvelden | null
  /** Compacte weergave voor de smalle kolom in het belscherm. */
  compact?: boolean
  onOpgeslagen: () => void
  onKlaar?: () => void
}) {
  const start = useMemo(() => ({
    naam: tekst(bedrijf?.name), website: tekst(bedrijf?.website), sector: tekst(bedrijf?.sector),
    stad: tekst(bedrijf?.city), regio: tekst(bedrijf?.region), bedrijfTel: tekst(bedrijf?.phone),
    land: tekst(bedrijf?.country), bLinkedin: tekst(bedrijf?.linkedin),
    werknemers: bedrijf?.employees && bedrijf.employees > 0 ? String(bedrijf.employees) : '',
    werkklasse: tekst(bedrijf?.werkklasse),
    gate: tekst(bedrijf?.gatekeeper_naam), dmu: tekst(bedrijf?.dmu_naam), dmuFunctie: tekst(bedrijf?.dmu_functie),
    cNaam: tekst(contact?.name), cFunctie: tekst(contact?.role), cMail: tekst(contact?.email),
    cTel: tekst(contact?.phone), cGsm: tekst(contact?.mobile), cLinkedin: tekst(contact?.linkedin),
  }), [bedrijf, contact])

  const [f, setF] = useState(start)
  const [bezig, setBezig] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const gewijzigd = (Object.keys(start) as (keyof typeof f)[]).some((k) => f[k].trim() !== start[k].trim())

  const bewaar = async () => {
    if (!f.naam.trim()) { toast.error('Een bedrijf moet een naam houden.'); return }

    // Enkel de aangeraakte velden meesturen — zo blijft een veld dat je niet
    // gebruikte ongemoeid, ook als er in de database meer in stond dan hier
    // getoond wordt.
    const company: Record<string, string> = {}
    const c: Record<string, string> = {}
    const wijzig = (doel: Record<string, string>, sleutel: string, k: keyof typeof f) => {
      if (f[k].trim() !== start[k].trim()) doel[sleutel] = f[k].trim()
    }
    wijzig(company, 'name', 'naam'); wijzig(company, 'website', 'website')
    wijzig(company, 'sector', 'sector'); wijzig(company, 'city', 'stad')
    wijzig(company, 'region', 'regio'); wijzig(company, 'phone', 'bedrijfTel')
    wijzig(company, 'gatekeeper_naam', 'gate'); wijzig(company, 'dmu_naam', 'dmu')
    wijzig(company, 'dmu_functie', 'dmuFunctie')
    wijzig(company, 'country', 'land'); wijzig(company, 'linkedin', 'bLinkedin')
    wijzig(company, 'werkklasse', 'werkklasse'); wijzig(company, 'employees', 'werknemers')
    wijzig(c, 'name', 'cNaam'); wijzig(c, 'role', 'cFunctie'); wijzig(c, 'email', 'cMail')
    wijzig(c, 'phone', 'cTel'); wijzig(c, 'mobile', 'cGsm'); wijzig(c, 'linkedin', 'cLinkedin')

    if (!Object.keys(company).length && !Object.keys(c).length) { onKlaar?.(); return }

    setBezig(true)
    try {
      const res = await fetch(`/api/admin/sales/leads/${leadId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(Object.keys(company).length ? { company } : {}),
          ...(Object.keys(c).length ? { contact: c } : {}),
        }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Gegevens bijgewerkt.')
      onOpgeslagen()
      onKlaar?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') }
    finally { setBezig(false) }
  }

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'}>
      <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
        <div className={compact ? '' : 'sm:col-span-2'}><Veld label="Bedrijfsnaam" value={f.naam} onChange={(v) => set('naam', v)} /></div>
        <div className={compact ? '' : 'sm:col-span-2'}><Veld label="Website" placeholder="bedrijf.be" value={f.website} onChange={(v) => set('website', v)} /></div>
        <Veld label="Sector" value={f.sector} onChange={(v) => set('sector', v)} />
        <Veld label="Telefoon bedrijf" value={f.bedrijfTel} onChange={(v) => set('bedrijfTel', v)} />
        <Veld label="Stad" value={f.stad} onChange={(v) => set('stad', v)} />
        <Veld label="Regio" value={f.regio} onChange={(v) => set('regio', v)} />
        <Veld label="Land" placeholder="bv. België" value={f.land} onChange={(v) => set('land', v)} />
        <label className="block text-[11px] font-medium text-gray-500">
          Werknemers
          <GetalInvoer className="input-base mt-0.5 text-sm" placeholder="aantal" min={0}
            waarde={f.werknemers ? Number(f.werknemers) : null}
            onWaarde={(n) => set('werknemers', n > 0 ? String(Math.round(n)) : '')} />
        </label>
        <Veld label="Werkklasse" placeholder="bv. 10–19" value={f.werkklasse} onChange={(v) => set('werkklasse', v)} />
        <Veld label="LinkedIn bedrijf" type="url" placeholder="linkedin.com/company/…" value={f.bLinkedin} onChange={(v) => set('bLinkedin', v)} />
      </div>

      {/* Wie je moet passeren, en wie je moet hebben. Twee namen die je aan de
          telefoon leert en die anders in een losse notitie verdwijnen. */}
      <div className={`grid gap-2 border-t border-gray-100 pt-2 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
        <div className={compact ? '' : 'sm:col-span-2'}>
          <Veld label="Gatekeeper" placeholder="balie of secretariaat" value={f.gate} onChange={(v) => set('gate', v)} />
        </div>
        <Veld label="Beslissingnemer" placeholder="wie beslist" value={f.dmu} onChange={(v) => set('dmu', v)} />
        <Veld label="Functie beslissingnemer" placeholder="bv. zaakvoerder" value={f.dmuFunctie} onChange={(v) => set('dmuFunctie', v)} />
      </div>

      <div className={`grid gap-2 border-t border-gray-100 pt-2 ${compact ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'}`}>
        <Veld label="Contactpersoon" value={f.cNaam} onChange={(v) => set('cNaam', v)} />
        <Veld label="Functie" value={f.cFunctie} onChange={(v) => set('cFunctie', v)} />
        <div className={compact ? '' : 'sm:col-span-2'}><Veld label="E-mail" type="email" value={f.cMail} onChange={(v) => set('cMail', v)} /></div>
        <Veld label="Telefoon" value={f.cTel} onChange={(v) => set('cTel', v)} />
        <Veld label="Gsm" value={f.cGsm} onChange={(v) => set('cGsm', v)} />
        <div className={compact ? '' : 'sm:col-span-2'}><Veld label="LinkedIn contactpersoon" type="url" placeholder="linkedin.com/in/…" value={f.cLinkedin} onChange={(v) => set('cLinkedin', v)} /></div>
      </div>

      <p className="text-[10px] text-gray-400 leading-snug">
        Bedrijfsgegevens gelden voor élke lead van dit bedrijf, ook in het andere merk.
      </p>

      <div className="flex gap-2">
        <button onClick={bewaar} disabled={bezig || !gewijzigd} className="btn-primary text-sm flex-1">
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Opslaan
        </button>
        {onKlaar && <button onClick={onKlaar} className="btn-secondary text-sm">Annuleer</button>}
      </div>
    </div>
  )
}
