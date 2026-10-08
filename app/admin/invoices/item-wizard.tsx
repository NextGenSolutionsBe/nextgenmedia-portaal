'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  X, Plus, Trash2, Copy, ArrowUp, ArrowDown, Loader2, Check, ChevronLeft, ChevronRight, Search, UserPlus, Pencil, Car,
  Bookmark, Paperclip, AlertTriangle, Building2, Settings2,
} from 'lucide-react'
import { GetalInvoer } from '@/components/ui/getal-invoer'
import { INP } from '@/app/admin/instellingen/ui'
import { formatEuro } from '@/lib/utils'
import { berekenRegel, berekenTotalen, hernummer, kmRegel, nieuweRegel, verplaatsRegel, dupliceerRegel, verwijderRegel, EENHEDEN, EENHEID_LABEL, type FactuurRegel } from '@/lib/facturen/regels'
import { FACTUUR_TYPES, adresRegels, ontbrekendeGegevens, type FactuurType, type KlantInfo } from '@/lib/facturatie/item-model'
import { factuurdagVan } from '@/lib/facturatie/reeks'
import { MaandKiezer } from '@/components/ui/maand-kiezer'

/**
 * Een facturatie-item toevoegen of aanpassen, in vier duidelijke stappen:
 * Klantinformatie → Basisinformatie → Artikelen → Mededeling & controle.
 *
 * Het item is een opdracht voor Bram: hij neemt het later over in het externe
 * facturatiesysteem. Er wordt hier dus GEEN officieel factuurnummer gemaakt.
 * Alles gaat via de bestaande factuurroutes (één bron voor planner, contract en
 * Financiën); een terugkerend item wordt een maandelijkse reeks, en een maand
 * van een reeks kan eigen artikelen krijgen (dan wordt die maand een eigen item).
 */

type KlantOptie = { id: string; naam: string; btw: string | null }
type ContractOptie = { id: string; titel: string; label: string; client_id: string | null }
type Instellingen = { standaard_btw_pct: number; betalingstermijn_dagen: number; km_tarief_excl: number; km_btw_pct: number }
type Artikel = { id: string; naam: string; beschrijving: string | null; eenheid: string; prijs_excl: number | null; btw_pct: number; soort: 'dienst' | 'doorgerekende_kost' }
type InterneKost = { omschrijving: string; bedrag: number | null; leverancier: string }

export type WizardProps = {
  /** Bestaand item (invoice) aanpassen. */
  invoiceId?: string | null
  /** Eén maand van een terugkerende facturatie eigen artikelen geven. */
  recurringMaand?: { recurring_id: string; maand: string; momentId: string } | null
  standaardDatum?: string
  onClose: () => void
  onSaved?: (id: string | null) => void
}

const STAPPEN = ['Klantinformatie', 'Basisinformatie', 'Artikelen', 'Mededeling & controle'] as const
const vandaagIso = () => new Date().toISOString().slice(0, 10)
const lbl = 'block text-xs font-medium text-gray-700 mb-1'
const hint = 'text-[11px] text-gray-500 mt-1'

export function FacturatieItemWizard({ invoiceId = null, recurringMaand = null, standaardDatum, onClose, onSaved }: WizardProps) {
  const bewerken = !!invoiceId
  const [stap, setStap] = useState(0)
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState(false)
  const [klanten, setKlanten] = useState<KlantOptie[]>([])
  const [contracten, setContracten] = useState<ContractOptie[]>([])
  const [inst, setInst] = useState<Instellingen>({ standaard_btw_pct: 21, betalingstermijn_dagen: 30, km_tarief_excl: 0, km_btw_pct: 21 })
  const [artikelen, setArtikelen] = useState<Artikel[]>([])

  // ── Het item ──
  const [klant, setKlant] = useState<KlantInfo | null>(null)
  const [basis, setBasis] = useState({
    datum: standaardDatum ?? vandaagIso(), contract_id: '', titel: '', type: 'eenmalig' as FactuurType,
    prestatie_van: '', prestatie_tot: '', termijn: '30', klant_referentie: '', eind_maand: '',
    /** null = volgt het type (terugkerend = ja); true/false = uitdrukkelijk gekozen. */
    terugkerende_omzet: null as boolean | null,
  })
  const [regels, setRegels] = useState<FactuurRegel[]>([])
  const [kosten, setKosten] = useState<InterneKost[]>([])
  const [mededeling, setMededeling] = useState('')
  const [notitie, setNotitie] = useState('')
  const [bijlagen, setBijlagen] = useState<File[]>([])
  const btw = inst.standaard_btw_pct

  // ── Laden: keuzes, artikelen en (bij aanpassen) het bestaande item ──
  useEffect(() => {
    let weg = false
    ;(async () => {
      try {
        const [k, a] = await Promise.all([
          fetch('/api/admin/invoices/keuzes', { cache: 'no-store' }).then((r) => r.json()),
          fetch('/api/admin/invoices/artikelen', { cache: 'no-store' }).then((r) => r.json()),
        ])
        if (weg) return
        setKlanten(k.klanten ?? []); setContracten(k.contracten ?? []); setArtikelen(a.artikelen ?? [])
        const i: Instellingen = k.instellingen ?? inst
        setInst(i)
        if (invoiceId) {
          const r = await fetch(`/api/admin/invoices/${invoiceId}`, { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error)
          const f = j.factuur
          if (f.client_id) await kiesKlant(f.client_id, true)
          setBasis({
            datum: String(f.invoice_date).slice(0, 10), contract_id: f.contract_id ?? '', titel: f.description ?? '', type: (f.factuur_type ?? 'eenmalig') as FactuurType,
            prestatie_van: f.prestatie_van ? String(f.prestatie_van).slice(0, 10) : '', prestatie_tot: f.prestatie_tot ? String(f.prestatie_tot).slice(0, 10) : '',
            termijn: f.payment_term_days === null || f.payment_term_days === undefined ? String(i.betalingstermijn_dagen) : String(f.payment_term_days),
            klant_referentie: f.klant_referentie ?? '', eind_maand: '',
            terugkerende_omzet: typeof f.terugkerende_omzet === 'boolean' ? f.terugkerende_omzet : null,
          })
          setRegels(j.regels ?? []); setMededeling(f.mededeling ?? ''); setNotitie(f.note ?? '')
        } else if (recurringMaand) {
          const r = await fetch(`/api/admin/invoices/item?id=${encodeURIComponent(recurringMaand.momentId)}`, { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error)
          const d = j.detail
          if (d.klant) setKlant(d.klant)
          setBasis((b) => ({ ...b, datum: d.datum, contract_id: j.contract_id ?? '', titel: d.titel ?? '', type: 'terugkerend', termijn: String(d.betaaltermijn ?? i.betalingstermijn_dagen) }))
          setRegels(hernummer((d.regels ?? []).map((x: FactuurRegel) => ({ ...x, id: null })))); setMededeling(d.mededeling ?? ''); setNotitie(d.notitie ?? '')
        } else {
          setBasis((b) => ({ ...b, termijn: String(i.betalingstermijn_dagen) }))
          setRegels([nieuweRegel({}, i.standaard_btw_pct)])
        }
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { if (!weg) setLaden(false) }
    })()
    return () => { weg = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId, recurringMaand?.momentId])

  const kiesKlant = useCallback(async (id: string, stil = false) => {
    try {
      const r = await fetch(`/api/admin/invoices/klant?id=${id}`, { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setKlant(j.klant)
      // Een contract van een andere klant past niet meer.
      setBasis((b) => (b.contract_id && !contracten.some((c) => c.id === b.contract_id && (!c.client_id || c.client_id === id)) ? { ...b, contract_id: '' } : b))
      if (!stil) toast.success(`${j.klant.naam} geselecteerd.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Klant laden mislukt') }
  }, [contracten])

  const totalen = useMemo(() => berekenTotalen(regels), [regels])
  const ontbrekend = useMemo(() => ontbrekendeGegevens({ klant, regels, datum: basis.datum }), [klant, regels, basis.datum])
  const stapFout = (i: number): string | null => {
    if (i === 0 && !klant) return 'Kies een klant of maak een nieuwe aan.'
    if (i === 1 && !basis.datum) return 'Vul de geplande facturatiedatum in.'
    if (i === 1 && basis.prestatie_van && basis.prestatie_tot && basis.prestatie_tot < basis.prestatie_van) return 'De prestatieperiode eindigt vóór ze begint.'
    if (i === 2 && regels.length === 0) return 'Voeg minstens één artikel toe.'
    return null
  }
  const volgende = () => { const f = stapFout(stap); if (f) { toast.error(f); return } setStap((s) => Math.min(STAPPEN.length - 1, s + 1)) }

  // ── Opslaan ──
  const opslaan = async () => {
    for (let i = 0; i < 3; i++) { const f = stapFout(i); if (f) { setStap(i); toast.error(f); return } }
    setBezig(true)
    try {
      const termijn = basis.termijn === '' ? inst.betalingstermijn_dagen : Math.max(0, Math.round(Number(basis.termijn) || 0))
      const kop = {
        client_id: klant!.id, contract_id: basis.contract_id || null, description: basis.titel || null, invoice_date: basis.datum,
        payment_term_days: termijn, factuur_type: basis.type, klant_referentie: basis.klant_referentie || null,
        prestatie_van: basis.prestatie_van || null, prestatie_tot: basis.prestatie_tot || null,
        periode: basis.prestatie_van ? basis.prestatie_van.slice(0, 7) : basis.datum.slice(0, 7),
        mededeling: mededeling || null, note: notitie || null, regels,
        terugkerende_omzet: basis.terugkerende_omzet ?? (basis.type === 'terugkerend' || !!recurringMaand),
      }
      let id: string | null = null
      if (bewerken) {
        const r = await fetch(`/api/admin/invoices/${invoiceId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(kop) })
        const j = await r.json(); if (!r.ok) throw new Error(j.error)
        id = invoiceId
      } else if (basis.type === 'terugkerend' && !recurringMaand) {
        // Een maandelijkse reeks: elke maand verschijnt apart, met haar eigen status.
        const r = await fetch('/api/admin/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          action: 'recurring', client_id: klant!.id, contract_id: kop.contract_id, start_month: basis.datum.slice(0, 7), end_month: basis.eind_maand || null,
          description: kop.description, amount_excl: totalen.excl, vat_pct: totalen.perBtw.length === 1 ? totalen.perBtw[0].pct : btw,
          invoice_day: factuurdagVan(basis.datum), payment_term_days: termijn, mededeling: kop.mededeling,
          lines: regels.map((x) => ({ artikel: x.artikel, omschrijving: x.omschrijving || x.artikel, aantal: x.aantal, eenheid: x.eenheid, prijs_excl: x.prijs_excl, btw_pct: x.btw_pct, korting_pct: x.korting_pct, korting_eur: x.korting_eur, is_extra: x.is_extra, classificatie: x.classificatie })),
        }) })
        const j = await r.json(); if (!r.ok) throw new Error(j.error)
        toast.success('Terugkerende facturatie opgeslagen — elke maand verschijnt apart in “Te factureren”.')
        onSaved?.(null); onClose(); return
      } else {
        const r = await fetch('/api/admin/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'aanmaken', ...kop, ...(recurringMaand ? { recurring_maand: { recurring_id: recurringMaand.recurring_id, maand: recurringMaand.maand } } : {}) }) })
        const j = await r.json(); if (!r.ok) throw new Error(j.error)
        id = String(j.id)
      }
      // Interne kosten (niet op de factuur) en bijlagen hangen aan het item.
      const fouten: string[] = []
      for (const k of kosten.filter((x) => x.omschrijving.trim())) {
        const r = await fetch('/api/admin/invoices/kosten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'kost_toevoegen', invoice_id: id, omschrijving: k.omschrijving, kostprijs_excl: k.bedrag, leverancier: k.leverancier || null, datum: basis.datum }) })
        if (!r.ok) fouten.push(`kost “${k.omschrijving}”`)
      }
      for (const f of bijlagen) {
        const fd = new FormData(); fd.append('file', f); fd.append('invoice_id', id!)
        const r = await fetch('/api/admin/invoices/bijlagen', { method: 'POST', body: fd })
        if (!r.ok) fouten.push(`bijlage “${f.name}”`)
      }
      if (fouten.length) toast.warning(`Item opgeslagen, maar niet gelukt: ${fouten.join(', ')}.`)
      else toast.success(bewerken ? 'Item opgeslagen.' : 'Opgeslagen als te factureren.')
      onSaved?.(id); onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  const titel = bewerken ? 'Facturatie-item aanpassen' : recurringMaand ? `Eigen artikelen voor ${recurringMaand.maand}` : 'Nieuw facturatie-item'

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-6 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-[#f7f7f5] sm:rounded-2xl shadow-xl w-full max-w-4xl h-dvh sm:h-auto sm:max-h-[94dvh] flex flex-col overflow-hidden">
        {/* Kop + stappen */}
        <div className="bg-white border-b border-gray-200 px-4 sm:px-6 pt-4 pb-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-semibold text-gray-900 truncate">{titel}</h3>
            <button type="button" onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
          </div>
          <ol className="mt-3 grid grid-cols-4 gap-1.5">
            {STAPPEN.map((s, i) => {
              const klaar = i < stap && !stapFout(i)
              return (
                <li key={s}>
                  <button type="button" onClick={() => setStap(i)} aria-current={stap === i ? 'step' : undefined}
                    className={`w-full text-left rounded-lg px-2 py-1.5 border transition-colors ${stap === i ? 'border-black bg-[#fff848]' : 'border-gray-200 bg-white hover:border-gray-400'}`}>
                    <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
                      <span className={`h-4 w-4 rounded-full inline-flex items-center justify-center text-[10px] font-bold ${klaar ? 'bg-black text-white' : stap === i ? 'bg-black text-[#fff848]' : 'bg-gray-200 text-gray-700'}`}>{klaar ? <Check className="h-2.5 w-2.5" /> : i + 1}</span>
                      <span className="hidden sm:inline">Stap {i + 1}</span>
                    </span>
                    <span className="block text-xs font-semibold text-gray-900 truncate">{s}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5">
          {laden ? <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : (
            <div className="bg-white rounded-2xl border border-gray-200 p-4 sm:p-6 space-y-5">
              {stap === 0 && <StapKlant klant={klant} klanten={klanten} onKies={kiesKlant} onKlant={(k) => { setKlant(k); setKlanten((l) => (l.some((x) => x.id === k.id) ? l.map((x) => (x.id === k.id ? { id: k.id, naam: k.naam, btw: k.btw } : x)) : [...l, { id: k.id, naam: k.naam, btw: k.btw }].sort((a, b) => a.naam.localeCompare(b.naam, 'nl')))) }} vastgezet={!!recurringMaand} />}
              {stap === 1 && <StapBasis basis={basis} setBasis={setBasis} contracten={contracten.filter((c) => !klant || !c.client_id || c.client_id === klant.id)} nieuw={!bewerken && !recurringMaand} />}
              {stap === 2 && <StapArtikelen regels={regels} setRegels={setRegels} btw={btw} inst={inst} artikelen={artikelen} setArtikelen={setArtikelen} kosten={kosten} setKosten={setKosten} datum={basis.datum} />}
              {stap === 3 && (
                <StapControle klant={klant} basis={basis} regels={regels} totalen={totalen} kosten={kosten} ontbrekend={ontbrekend}
                  mededeling={mededeling} setMededeling={setMededeling} notitie={notitie} setNotitie={setNotitie} bijlagen={bijlagen} setBijlagen={setBijlagen} gaNaar={setStap} />
              )}
            </div>
          )}
        </div>

        <div className="bg-white border-t border-gray-200 px-4 sm:px-6 py-3 flex items-center gap-2 flex-wrap">
          <div className="text-xs text-gray-600 tabular-nums mr-auto">
            Totaal <b className="text-gray-900">{formatEuro(totalen.excl)}</b> excl. · <b className="text-gray-900">{formatEuro(totalen.incl)}</b> incl. btw
          </div>
          <button type="button" onClick={() => setStap((s) => Math.max(0, s - 1))} disabled={stap === 0} className="btn-secondary text-sm"><ChevronLeft className="h-4 w-4" />Vorige</button>
          {stap < STAPPEN.length - 1
            ? <button type="button" onClick={volgende} className="btn-primary text-sm">Volgende<ChevronRight className="h-4 w-4" /></button>
            : <button type="button" onClick={opslaan} disabled={bezig || laden} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{bewerken ? 'Opslaan' : basis.type === 'terugkerend' && !recurringMaand ? 'Terugkerend opslaan' : 'Opslaan als te factureren'}</button>}
        </div>
      </div>
    </div>
  )
}

// ── Stap 1: klant ───────────────────────────────────────────────────────────
function StapKlant({ klant, klanten, onKies, onKlant, vastgezet }: { klant: KlantInfo | null; klanten: KlantOptie[]; onKies: (id: string) => void; onKlant: (k: KlantInfo) => void; vastgezet: boolean }) {
  const [zoek, setZoek] = useState('')
  const [nieuw, setNieuw] = useState(false)
  const [aanpassen, setAanpassen] = useState(false)
  const lijst = useMemo(() => {
    const q = zoek.trim().toLowerCase().replace(/[\s.]/g, '')
    return (q ? klanten.filter((k) => k.naam.toLowerCase().replace(/[\s.]/g, '').includes(q) || (k.btw ?? '').toLowerCase().replace(/[\s.]/g, '').includes(q)) : klanten).slice(0, 8)
  }, [zoek, klanten])

  if (nieuw) return <NieuweKlant voorstel={zoek} onKlaar={(k) => { onKlant(k); setNieuw(false); setZoek('') }} onKiesBestaand={(id) => { onKies(id); setNieuw(false) }} onAnnuleer={() => setNieuw(false)} />

  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-gray-900">Voor welke klant?</h4>
        <p className="text-sm text-gray-500">Zoek een bestaande klant. De facturatiegegevens komen uit de centrale klantenlijst; je hoeft niets opnieuw in te vullen.</p>
      </div>
      {klant && !aanpassen && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 flex items-start gap-3">
          <Building2 className="h-5 w-5 text-gray-500 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-semibold text-gray-900">{klant.naam}</div>
            <div className="text-gray-600">{klant.btw ? `Btw ${klant.btw}` : <span className="text-amber-700">Geen btw-nummer</span>}</div>
            <div className="text-gray-600">{adresRegels(klant).join(', ') || <span className="text-gray-400">Geen facturatieadres</span>}</div>
            <div className="text-gray-500 text-xs mt-0.5">{[klant.contact, klant.facturatie_email || klant.email, klant.telefoon].filter(Boolean).join(' · ') || 'Geen contactgegevens'}</div>
          </div>
          <button type="button" onClick={() => setAanpassen(true)} className="btn-secondary text-xs shrink-0"><Pencil className="h-3.5 w-3.5" />Bekijken / aanpassen</button>
        </div>
      )}
      {klant && aanpassen && <KlantAanpassen klant={klant} onKlaar={(k) => { onKlant(k); setAanpassen(false) }} onAnnuleer={() => setAanpassen(false)} />}
      {!vastgezet && !aanpassen && (
        <div className="space-y-2">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input className={`${INP} pl-9`} placeholder={klant ? 'Andere klant zoeken op naam of btw-nummer…' : 'Zoek op naam of btw-nummer…'} value={zoek} onChange={(e) => setZoek(e.target.value)} autoFocus={!klant} />
            </div>
            <button type="button" onClick={() => setNieuw(true)} className="btn-secondary text-sm"><UserPlus className="h-4 w-4" />Nieuwe klant aanmaken</button>
          </div>
          {(zoek || !klant) && (
            <ul className="rounded-xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
              {lijst.length === 0 && <li className="px-3 py-3 text-sm text-gray-500">Geen klant gevonden. <button type="button" onClick={() => setNieuw(true)} className="underline">Nieuwe klant aanmaken</button></li>}
              {lijst.map((k) => (
                <li key={k.id}>
                  <button type="button" onClick={() => { onKies(k.id); setZoek('') }} className={`w-full text-left px-3 py-2 text-sm hover:bg-[#fff848]/30 flex items-center justify-between gap-2 ${klant?.id === k.id ? 'bg-[#fff848]/40' : ''}`}>
                    <span className="font-medium truncate">{k.naam}</span><span className="text-xs text-gray-500 shrink-0">{k.btw ?? ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

type KlantVelden = { naam: string; btw: string; contact: string; email: string; facturatie_email: string; telefoon: string; straat: string; postcode: string; gemeente: string; land: string }
function KlantFormulier({ v, set, metNaam }: { v: KlantVelden; set: (k: keyof KlantVelden, w: string) => void; metNaam: boolean }) {
  const veld = (k: keyof KlantVelden, label: string, extra?: { verplicht?: boolean; type?: string; ph?: string; breed?: boolean }) => (
    <div className={extra?.breed ? 'sm:col-span-2' : ''}>
      <label className={lbl}>{label}{extra?.verplicht ? ' *' : <span className="text-gray-400 font-normal"> — optioneel</span>}</label>
      <input className={INP} type={extra?.type ?? 'text'} value={v[k]} placeholder={extra?.ph} onChange={(e) => set(k, e.target.value)} />
    </div>
  )
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {metNaam && veld('naam', 'Naam of bedrijfsnaam', { verplicht: true, breed: true })}
      {veld('btw', 'Btw-nummer', { verplicht: metNaam, ph: 'BE0123456789' })}
      {veld('contact', 'Contactpersoon')}
      {veld('email', 'E-mailadres', { type: 'email' })}
      {veld('facturatie_email', 'E-mailadres voor facturen', { type: 'email', ph: 'als het anders is' })}
      {veld('telefoon', 'Telefoonnummer')}
      {veld('straat', 'Straat en nummer')}
      {veld('postcode', 'Postcode')}
      {veld('gemeente', 'Gemeente')}
      {veld('land', 'Land', { ph: 'België' })}
    </div>
  )
}

/** Nieuwe klant binnen de huidige opdracht: enkel naam + btw-nummer verplicht; dubbels via het btw-nummer. */
function NieuweKlant({ voorstel, onKlaar, onKiesBestaand, onAnnuleer }: { voorstel: string; onKlaar: (k: KlantInfo) => void; onKiesBestaand: (id: string) => void; onAnnuleer: () => void }) {
  const [v, setV] = useState<KlantVelden>({ naam: /\d{6,}/.test(voorstel) ? '' : voorstel, btw: /\d{6,}/.test(voorstel) ? voorstel : '', contact: '', email: '', facturatie_email: '', telefoon: '', straat: '', postcode: '', gemeente: '', land: '' })
  const [bestaand, setBestaand] = useState<{ id: string; naam: string } | null>(null)
  const [bezig, setBezig] = useState(false)
  const set = (k: keyof KlantVelden, w: string) => setV((p) => ({ ...p, [k]: w }))
  // Dubbele klant? Meteen nakijken zodra er een btw-nummer staat.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const btw = v.btw.replace(/[^0-9A-Za-z]/g, '')
    if (btw.length < 8) { setBestaand(null); return }
    timer.current = setTimeout(async () => {
      try { const r = await fetch(`/api/admin/invoices/klant?btw=${encodeURIComponent(v.btw)}`); const j = await r.json(); setBestaand(j.bestaand ?? null) } catch { /* */ }
    }, 350)
  }, [v.btw])
  const opslaan = async () => {
    if (!v.naam.trim()) { toast.error('De naam of bedrijfsnaam is verplicht.'); return }
    if (!v.btw.trim()) { toast.error('Het btw-nummer is verplicht.'); return }
    if (bestaand) { toast.error(`Deze klant bestaat al: ${bestaand.naam}.`); return }
    setBezig(true)
    try {
      const r = await fetch('/api/admin/invoices/klant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) })
      const j = await r.json()
      if (r.status === 409 && j.bestaand) { setBestaand(j.bestaand); throw new Error(j.error) }
      if (!r.ok) throw new Error(j.error)
      toast.success(`${j.klant.naam} toegevoegd aan de klantenlijst en geselecteerd.`)
      onKlaar(j.klant)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-gray-900">Nieuwe klant aanmaken</h4>
        <p className="text-sm text-gray-500">Enkel naam en btw-nummer zijn verplicht. De rest mag leeg blijven en later aangevuld worden. Wat je bij dit item al invulde, blijft bewaard.</p>
      </div>
      {bestaand && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 shrink-0" />Er bestaat al een klant met dit btw-nummer: <b>{bestaand.naam}</b>.
          <button type="button" onClick={() => onKiesBestaand(bestaand.id)} className="btn-primary text-xs ml-auto">Deze klant gebruiken</button>
        </div>
      )}
      <KlantFormulier v={v} set={set} metNaam />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onAnnuleer} className="btn-secondary text-sm">Annuleren</button>
        <button type="button" onClick={opslaan} disabled={bezig || !!bestaand} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Klant opslaan en gebruiken</button>
      </div>
    </div>
  )
}

/** Facturatiegegevens van een bestaande klant aanvullen — rechtstreeks in de centrale klantenlijst. */
function KlantAanpassen({ klant, onKlaar, onAnnuleer }: { klant: KlantInfo; onKlaar: (k: KlantInfo) => void; onAnnuleer: () => void }) {
  const [v, setV] = useState<KlantVelden>({ naam: klant.naam, btw: klant.btw ?? '', contact: klant.contact ?? '', email: klant.email ?? '', facturatie_email: klant.facturatie_email ?? '', telefoon: klant.telefoon ?? '', straat: klant.straat ?? '', postcode: klant.postcode ?? '', gemeente: klant.gemeente ?? '', land: klant.land ?? '' })
  const [bezig, setBezig] = useState(false)
  const opslaan = async () => {
    setBezig(true)
    try {
      const { naam: _n, ...rest } = v; void _n
      const r = await fetch('/api/admin/invoices/klant', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: klant.id, ...rest }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Klantgegevens bijgewerkt in de klantenlijst.'); onKlaar(j.klant)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="rounded-xl border border-gray-200 p-4 space-y-3">
      <div className="text-sm"><b>{klant.naam}</b> <span className="text-gray-500">— wijzigingen gelden voor de klant zelf (klanthub), niet enkel voor dit item.</span></div>
      <KlantFormulier v={v} set={(k, w) => setV((p) => ({ ...p, [k]: w }))} metNaam={false} />
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onAnnuleer} className="btn-secondary text-sm">Annuleren</button>
        <button type="button" onClick={opslaan} disabled={bezig} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Gegevens opslaan</button>
      </div>
    </div>
  )
}

// ── Stap 2: basis ───────────────────────────────────────────────────────────
type Basis = { datum: string; contract_id: string; titel: string; type: FactuurType; prestatie_van: string; prestatie_tot: string; termijn: string; klant_referentie: string; eind_maand: string; terugkerende_omzet: boolean | null }
function StapBasis({ basis, setBasis, contracten, nieuw }: { basis: Basis; setBasis: React.Dispatch<React.SetStateAction<Basis>>; contracten: ContractOptie[]; nieuw: boolean }) {
  const zet = <K extends keyof Basis>(k: K, w: Basis[K]) => setBasis((b) => ({ ...b, [k]: w }))
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-gray-900">Basisinformatie</h4>
        <p className="text-sm text-gray-500">Wanneer moet dit gefactureerd worden, en waarvoor?</p>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Geplande facturatiedatum *</label>
          <input type="date" className={INP} value={basis.datum} onChange={(e) => zet('datum', e.target.value)} />
          <p className={hint}>Wanneer het gefactureerd moet worden — niet de dag waarop Bram de factuur effectief verstuurt.</p>
        </div>
        <div>
          <label className={lbl}>Type</label>
          <div className="grid grid-cols-4 gap-1 rounded-lg border border-gray-200 p-0.5 bg-gray-50">
            {FACTUUR_TYPES.map((t) => (
              <button key={t.key} type="button" disabled={!nieuw && t.key === 'terugkerend' && basis.type !== 'terugkerend'} onClick={() => zet('type', t.key)}
                className={`rounded-md px-1.5 py-1.5 text-xs font-medium disabled:opacity-40 ${basis.type === t.key ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'}`}>{t.label}</button>
            ))}
          </div>
          {basis.type === 'terugkerend' && nieuw && <p className={hint}>Er komt een maandelijkse reeks vanaf deze datum. Elke maand verschijnt apart, met eigen status; extra kosten voeg je later per maand toe.</p>}
        </div>
        {basis.type === 'terugkerend' && nieuw && (
          <div>
            <label className={lbl}>Laatste maand <span className="text-gray-400 font-normal">— leeg = doorlopend</span></label>
            <MaandKiezer className={INP} waarde={basis.eind_maand || null} vanaf={(basis.datum || new Date().toISOString()).slice(0, 7)} leeg="— Doorlopend —" onWaarde={(ym) => zet('eind_maand', ym ?? '')} />
          </div>
        )}
        {!(basis.type === 'terugkerend' && nieuw) && (
          <div className="sm:col-span-2">
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={basis.terugkerende_omzet ?? basis.type === 'terugkerend'} onChange={(e) => zet('terugkerende_omzet', e.target.checked)} />
              <span><b className="font-medium">Terugkerende omzet</b> <span className="text-gray-500">— kenmerk voor terugkerende opdrachten (bv. maandelijks beheer). Het maanddoel telt altijd alle omzet mee.</span></span>
            </label>
          </div>
        )}
        <div className="sm:col-span-2">
          <label className={lbl}>Titel of omschrijving</label>
          <input className={INP} value={basis.titel} onChange={(e) => zet('titel', e.target.value)} placeholder="bv. Shoot nieuwe collectie — oktober" />
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Project of dienst <span className="text-gray-400 font-normal">— optioneel, koppelen aan een contract</span></label>
          <select className={INP} value={basis.contract_id} onChange={(e) => zet('contract_id', e.target.value)}>
            <option value="">— Geen contract —</option>
            {contracten.map((c) => <option key={c.id} value={c.id}>{c.titel} · {c.label}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Prestatieperiode <span className="text-gray-400 font-normal">— indien relevant</span></label>
          <div className="flex items-center gap-2">
            <input type="date" className={INP} value={basis.prestatie_van} onChange={(e) => zet('prestatie_van', e.target.value)} aria-label="Prestatieperiode van" />
            <span className="text-gray-400">–</span>
            <input type="date" className={INP} value={basis.prestatie_tot} onChange={(e) => zet('prestatie_tot', e.target.value)} aria-label="Prestatieperiode tot" />
          </div>
        </div>
        <div>
          <label className={lbl}>Betaaltermijn</label>
          <div className="flex items-center gap-2"><input className={INP} inputMode="numeric" value={basis.termijn} onChange={(e) => zet('termijn', e.target.value.replace(/[^0-9]/g, ''))} /><span className="text-sm text-gray-500">dagen</span></div>
        </div>
        <div className="sm:col-span-2">
          <label className={lbl}>Klantreferentie of bestelbonnummer <span className="text-gray-400 font-normal">— optioneel</span></label>
          <input className={INP} value={basis.klant_referentie} onChange={(e) => zet('klant_referentie', e.target.value)} placeholder="bv. PO-2026-0815" />
          <p className={hint}>Er wordt geen officieel factuurnummer aangemaakt; Bram kan het externe factuurnummer achteraf registreren.</p>
        </div>
      </div>
    </div>
  )
}

// ── Stap 3: artikelen ───────────────────────────────────────────────────────
function StapArtikelen({ regels, setRegels, btw, inst, artikelen, setArtikelen, kosten, setKosten, datum }: {
  regels: FactuurRegel[]; setRegels: (r: FactuurRegel[]) => void; btw: number; inst: Instellingen; artikelen: Artikel[]; setArtikelen: (a: Artikel[]) => void
  kosten: InterneKost[]; setKosten: (k: InterneKost[]) => void; datum: string
}) {
  const [km, setKm] = useState(false)
  const [kiezer, setKiezer] = useState(false)
  const [beheer, setBeheer] = useState(false)
  const t = berekenTotalen(regels)
  const zet = (i: number, deel: Partial<FactuurRegel>) => setRegels(regels.map((r, j) => (j === i ? { ...r, ...deel } : r)))
  const uitArtikel = (a: Artikel) => {
    setRegels(hernummer([...regels.filter((r) => r.artikel || r.omschrijving || r.prijs_excl), nieuweRegel({ artikel: a.naam, omschrijving: a.beschrijving ?? '', eenheid: a.eenheid, prijs_excl: a.prijs_excl ?? 0, btw_pct: a.btw_pct, is_extra: a.soort === 'doorgerekende_kost', classificatie: a.soort === 'doorgerekende_kost' ? 'doorgerekende_kost' : 'dienst' }, btw)]))
    setKiezer(false)
    if (!a.prijs_excl) toast.info(`Vul de afgesproken prijs voor “${a.naam}” in.`)
  }
  const bewaarAlsArtikel = async (r: FactuurRegel) => {
    if (!r.artikel.trim()) { toast.error('Geef het artikel eerst een naam.'); return }
    try {
      const res = await fetch('/api/admin/invoices/artikelen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam: r.artikel, beschrijving: r.omschrijving || null, eenheid: r.eenheid, prijs_excl: r.prijs_excl || null, btw_pct: r.btw_pct, soort: r.is_extra ? 'doorgerekende_kost' : 'dienst' }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setArtikelen([...artikelen, j.artikel]); toast.success(`“${r.artikel}” bewaard als herbruikbaar artikel.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
  }
  return (
    <div className="space-y-4">
      <div>
        <h4 className="font-semibold text-gray-900">Artikelen</h4>
        <p className="text-sm text-gray-500">Alles wat aan de klant wordt aangerekend: diensten, kilometers, parking, extra uren, materiaal… Elke regel komt zo op de factuur.</p>
      </div>
      <div className="flex gap-2 flex-wrap">
        <button type="button" onClick={() => setRegels(hernummer([...regels, nieuweRegel({}, btw)]))} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Artikel toevoegen</button>
        <div className="relative">
          <button type="button" onClick={() => setKiezer((x) => !x)} className="btn-secondary text-sm"><Bookmark className="h-4 w-4" />Opgeslagen artikel</button>
          {kiezer && (
            <div className="absolute z-20 mt-1 w-72 rounded-xl border border-gray-200 bg-white shadow-lg p-1 max-h-72 overflow-y-auto">
              {artikelen.length === 0 && <div className="px-3 py-2 text-xs text-gray-500">Nog geen opgeslagen artikelen.</div>}
              {artikelen.map((a) => (
                <button key={a.id} type="button" onClick={() => uitArtikel(a)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-sm flex items-center justify-between gap-2">
                  <span className="truncate">{a.naam}</span><span className="text-xs text-gray-500 shrink-0">{a.prijs_excl ? `${formatEuro(a.prijs_excl)}/${a.eenheid}` : 'prijs invullen'}</span>
                </button>
              ))}
              <button type="button" onClick={() => { setBeheer(true); setKiezer(false) }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 text-xs text-gray-600 border-t border-gray-100 mt-1 flex items-center gap-1.5"><Settings2 className="h-3.5 w-3.5" />Opgeslagen artikelen beheren</button>
            </div>
          )}
        </div>
        <button type="button" onClick={() => setKm(true)} className="btn-secondary text-sm border-black"><Car className="h-4 w-4" />Kilometers toevoegen</button>
      </div>

      <div className="space-y-3">
        {regels.length === 0 && <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">Nog geen artikelen. Voeg er een toe.</div>}
        {regels.map((r, i) => {
          const b = berekenRegel(r)
          const vrijeEenheid = !(EENHEDEN as readonly string[]).includes(r.eenheid)
          return (
            <div key={`${r.id ?? 'n'}-${i}`} className="rounded-xl border border-gray-200 p-3 sm:p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-gray-500">Artikel {i + 1}{r.is_extra && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700">doorgerekende kost</span>}</span>
                <div className="flex items-center gap-0.5">
                  <IconKnop titel="Omhoog" disabled={i === 0} onClick={() => setRegels(verplaatsRegel(regels, i, i - 1))}><ArrowUp className="h-3.5 w-3.5" /></IconKnop>
                  <IconKnop titel="Omlaag" disabled={i === regels.length - 1} onClick={() => setRegels(verplaatsRegel(regels, i, i + 1))}><ArrowDown className="h-3.5 w-3.5" /></IconKnop>
                  <IconKnop titel="Bewaren als herbruikbaar artikel" onClick={() => bewaarAlsArtikel(r)}><Bookmark className="h-3.5 w-3.5" /></IconKnop>
                  <IconKnop titel="Dupliceren" onClick={() => setRegels(dupliceerRegel(regels, i))}><Copy className="h-3.5 w-3.5" /></IconKnop>
                  <IconKnop titel="Verwijderen" rood onClick={() => setRegels(verwijderRegel(regels, i))}><Trash2 className="h-3.5 w-3.5" /></IconKnop>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div><label className={lbl}>Naam</label><input className={INP} value={r.artikel} onChange={(e) => zet(i, { artikel: e.target.value })} placeholder="bv. Shoot" /></div>
                <div className="sm:row-span-2"><label className={lbl}>Beschrijving <span className="text-gray-400 font-normal">— zo neemt Bram ze over op de factuur</span></label><textarea rows={3} className={INP} value={r.omschrijving} onChange={(e) => zet(i, { omschrijving: e.target.value })} placeholder="bv. Productshoot op locatie, 4 uur, inclusief nabewerking" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={lbl}>Aantal</label><GetalInvoer className={INP} waarde={r.aantal} min={0} onWaarde={(n) => zet(i, { aantal: n ?? 0 })} /></div>
                  <div>
                    <label className={lbl}>Eenheid</label>
                    <select className={INP} value={vrijeEenheid ? '__vrij' : r.eenheid} onChange={(e) => zet(i, { eenheid: e.target.value === '__vrij' ? '' : e.target.value })}>
                      {EENHEDEN.map((u) => <option key={u} value={u}>{EENHEID_LABEL[u]?.meer ?? u}</option>)}
                      <option value="__vrij">Andere…</option>
                    </select>
                    {vrijeEenheid && <input className={`${INP} mt-1`} value={r.eenheid} onChange={(e) => zet(i, { eenheid: e.target.value.slice(0, 20) })} placeholder="bv. pagina" />}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
                <div><label className={lbl}>Eenheidsprijs excl. btw</label><GetalInvoer className={INP} waarde={r.prijs_excl} min={0} onWaarde={(n) => zet(i, { prijs_excl: n ?? 0 })} /></div>
                <div><label className={lbl}>Btw %</label><GetalInvoer className={INP} waarde={r.btw_pct} leeg={btw} min={0} max={100} onWaarde={(n) => zet(i, { btw_pct: n ?? btw })} /></div>
                <Korting r={r} onZet={(deel) => zet(i, deel)} />
                <div className="text-right">
                  <div className="text-[11px] text-gray-500">Regeltotaal</div>
                  <div className="font-semibold tabular-nums">{formatEuro(b.excl)} <span className="text-xs font-normal text-gray-500">excl.</span></div>
                  <div className="text-[11px] text-gray-500 tabular-nums">{formatEuro(b.incl)} incl.</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 text-sm tabular-nums space-y-1 ml-auto max-w-sm">
        <div className="flex justify-between"><span>Subtotaal excl. btw</span><b>{formatEuro(t.excl)}</b></div>
        {t.perBtw.map((p) => <div key={p.pct} className="flex justify-between text-gray-600"><span>Btw {p.pct.toLocaleString('nl-BE')} %</span><span>{formatEuro(p.btw)}</span></div>)}
        <div className="flex justify-between border-t border-gray-200 pt-1 text-base"><span>Totaal incl. btw</span><b>{formatEuro(t.incl)}</b></div>
      </div>

      {/* Interne kosten: NIET op de factuur */}
      <div className="rounded-xl border border-dashed border-gray-300 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <div className="text-sm font-semibold text-gray-900">Interne bedrijfskosten <span className="text-gray-500 font-normal">— niet op de factuur</span></div>
            <p className="text-[11px] text-gray-500">Wat het ons kost (freelancer, huur, parking die we zelf dragen…). Verhoogt het factuurtotaal niet; komt in Kosten en winst.</p>
          </div>
          <button type="button" onClick={() => setKosten([...kosten, { omschrijving: '', bedrag: null, leverancier: '' }])} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Interne kost</button>
        </div>
        {kosten.map((k, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_140px_1fr_auto] gap-2 items-end">
            <div><label className={lbl}>Omschrijving</label><input className={INP} value={k.omschrijving} onChange={(e) => setKosten(kosten.map((x, j) => (j === i ? { ...x, omschrijving: e.target.value } : x)))} /></div>
            <div><label className={lbl}>Bedrag excl. btw</label><GetalInvoer className={INP} waarde={k.bedrag} min={0} onWaarde={(n) => setKosten(kosten.map((x, j) => (j === i ? { ...x, bedrag: n } : x)))} /></div>
            <div><label className={lbl}>Leverancier <span className="text-gray-400 font-normal">— optioneel</span></label><input className={INP} value={k.leverancier} onChange={(e) => setKosten(kosten.map((x, j) => (j === i ? { ...x, leverancier: e.target.value } : x)))} /></div>
            <IconKnop titel="Verwijderen" rood onClick={() => setKosten(kosten.filter((_, j) => j !== i))}><Trash2 className="h-3.5 w-3.5" /></IconKnop>
          </div>
        ))}
      </div>

      {km && <KilometerDialoog inst={inst} datum={datum} onClose={() => setKm(false)} onToevoegen={(r) => { setRegels(hernummer([...regels.filter((x) => x.artikel || x.omschrijving || x.prijs_excl), r])); setKm(false) }} />}
      {beheer && <ArtikelBeheer artikelen={artikelen} setArtikelen={setArtikelen} onClose={() => setBeheer(false)} />}
    </div>
  )
}

/** Korting per regel: in euro of in procent. */
function Korting({ r, onZet }: { r: FactuurRegel; onZet: (d: Partial<FactuurRegel>) => void }) {
  const [euro, setEuro] = useState<boolean>((r.korting_eur ?? 0) > 0)
  return (
    <div>
      <label className={lbl}>Korting <span className="text-gray-400 font-normal">— optioneel</span></label>
      <div className="flex">
        <GetalInvoer className={`${INP} rounded-r-none`} waarde={euro ? (r.korting_eur ?? 0) : r.korting_pct} min={0} max={euro ? undefined : 100}
          onWaarde={(n) => onZet(euro ? { korting_eur: n ?? 0, korting_pct: 0 } : { korting_pct: n ?? 0, korting_eur: 0 })} />
        <button type="button" onClick={() => { setEuro((x) => !x); onZet({ korting_pct: 0, korting_eur: 0 }) }} className="px-2 border border-l-0 border-gray-200 rounded-r-lg text-xs font-medium bg-gray-50 hover:bg-gray-100" title="Wisselen tussen euro en procent">{euro ? '€' : '%'}</button>
      </div>
    </div>
  )
}

function IconKnop({ titel, onClick, disabled, rood, children }: { titel: string; onClick: () => void; disabled?: boolean; rood?: boolean; children: React.ReactNode }) {
  return <button type="button" title={titel} aria-label={titel} onClick={onClick} disabled={disabled} className={`h-7 w-7 rounded-lg flex items-center justify-center disabled:opacity-30 ${rood ? 'text-red-600 hover:bg-red-50' : 'text-gray-600 hover:bg-gray-100'}`}>{children}</button>
}

/** Kilometervergoeding: totaal gereden km × afgesproken tarief → gewone factuurregel. */
function KilometerDialoog({ inst, datum, onClose, onToevoegen }: { inst: Instellingen; datum: string; onClose: () => void; onToevoegen: (r: FactuurRegel) => void }) {
  const [v, setV] = useState({ datum, traject: '', km: null as number | null, tarief: (inst.km_tarief_excl || null) as number | null, btw: inst.km_btw_pct as number | null })
  const regel = v.km && v.tarief ? kmRegel({ datum: v.datum, traject: v.traject, km: v.km, tarief: v.tarief, btw: v.btw ?? 21 }) : null
  const b = regel ? berekenRegel(regel) : null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between"><h4 className="font-semibold flex items-center gap-2"><Car className="h-4 w-4" />Kilometers toevoegen</h4><button type="button" onClick={onClose} className="h-7 w-7 rounded-lg hover:bg-gray-100 flex items-center justify-center" aria-label="Sluiten"><X className="h-4 w-4" /></button></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Datum van de verplaatsing</label><input type="date" className={INP} value={v.datum} onChange={(e) => setV({ ...v, datum: e.target.value })} /></div>
          <div><label className={lbl}>Totaal gereden km</label><GetalInvoer className={INP} waarde={v.km} min={0} onWaarde={(n) => setV({ ...v, km: n })} /></div>
          <div className="col-span-2"><label className={lbl}>Omschrijving of traject</label><input className={INP} value={v.traject} onChange={(e) => setV({ ...v, traject: e.target.value })} placeholder="bv. shoot bij klant, Hasselt – Antwerpen" /></div>
          <div><label className={lbl}>Tarief per km (excl. btw)</label><GetalInvoer className={INP} waarde={v.tarief} min={0} onWaarde={(n) => setV({ ...v, tarief: n })} /></div>
          <div><label className={lbl}>Btw %</label><GetalInvoer className={INP} waarde={v.btw} min={0} max={100} onWaarde={(n) => setV({ ...v, btw: n })} /></div>
        </div>
        <p className="text-[11px] text-gray-500">Vul het <b>totaal</b> aantal gereden kilometers in — een retourrit wordt niet automatisch verdubbeld. Het tarief is jullie afgesproken commerciële tarief{inst.km_tarief_excl ? ` (standaard ${formatEuro(inst.km_tarief_excl)}/km, instelbaar in Instellingen → Facturatie)` : ' (stel een standaard in via Instellingen → Facturatie)'}.</p>
        {regel && b && (
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm">
            <div className="text-gray-800">{regel.omschrijving}</div>
            <div className="font-semibold tabular-nums mt-1">{formatEuro(b.excl)} excl. btw · {formatEuro(b.incl)} incl.</div>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Annuleren</button>
          <button type="button" disabled={!regel} onClick={() => regel && onToevoegen(regel)} className="btn-primary text-sm"><Plus className="h-4 w-4" />Als factuurregel toevoegen</button>
        </div>
      </div>
    </div>
  )
}

/** Herbruikbare artikelen beheren: aanpassen en verwijderen. */
function ArtikelBeheer({ artikelen, setArtikelen, onClose }: { artikelen: Artikel[]; setArtikelen: (a: Artikel[]) => void; onClose: () => void }) {
  const [bewerk, setBewerk] = useState<Artikel | null>(null)
  const [bezig, setBezig] = useState(false)
  const bewaar = async () => {
    if (!bewerk) return
    setBezig(true)
    try {
      const nieuw = !bewerk.id
      const r = await fetch('/api/admin/invoices/artikelen', { method: nieuw ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bewerk) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setArtikelen(nieuw ? [...artikelen, j.artikel] : artikelen.map((a) => (a.id === j.artikel.id ? j.artikel : a))); setBewerk(null); toast.success('Artikel bewaard.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const verwijder = async (a: Artikel) => {
    if (!confirm(`“${a.naam}” verwijderen uit de opgeslagen artikelen? Bestaande facturatie-items veranderen niet.`)) return
    try {
      const r = await fetch(`/api/admin/invoices/artikelen?id=${a.id}`, { method: 'DELETE' }); const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setArtikelen(artikelen.filter((x) => x.id !== a.id)); toast.success('Verwijderd.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between"><h4 className="font-semibold">Opgeslagen artikelen</h4><button type="button" onClick={onClose} className="h-7 w-7 rounded-lg hover:bg-gray-100 flex items-center justify-center" aria-label="Sluiten"><X className="h-4 w-4" /></button></div>
        {bewerk ? (
          <div className="space-y-3">
            <div><label className={lbl}>Naam *</label><input className={INP} value={bewerk.naam} onChange={(e) => setBewerk({ ...bewerk, naam: e.target.value })} /></div>
            <div><label className={lbl}>Beschrijving</label><textarea rows={2} className={INP} value={bewerk.beschrijving ?? ''} onChange={(e) => setBewerk({ ...bewerk, beschrijving: e.target.value })} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div><label className={lbl}>Eenheid</label><input className={INP} list="ngm-eenheden" value={bewerk.eenheid} onChange={(e) => setBewerk({ ...bewerk, eenheid: e.target.value })} /><datalist id="ngm-eenheden">{EENHEDEN.map((u) => <option key={u} value={u} />)}</datalist></div>
              <div><label className={lbl}>Prijs excl.</label><GetalInvoer className={INP} waarde={bewerk.prijs_excl} min={0} onWaarde={(n) => setBewerk({ ...bewerk, prijs_excl: n })} /></div>
              <div><label className={lbl}>Btw %</label><GetalInvoer className={INP} waarde={bewerk.btw_pct} min={0} max={100} onWaarde={(n) => setBewerk({ ...bewerk, btw_pct: n ?? 21 })} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bewerk.soort === 'doorgerekende_kost'} onChange={(e) => setBewerk({ ...bewerk, soort: e.target.checked ? 'doorgerekende_kost' : 'dienst' })} />Doorgerekende kost (bv. parking, huur, kilometers)</label>
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setBewerk(null)} className="btn-secondary text-sm">Terug</button><button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Opslaan</button></div>
          </div>
        ) : (
          <>
            <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
              {artikelen.length === 0 && <li className="px-3 py-3 text-sm text-gray-500">Nog geen artikelen.</li>}
              {artikelen.map((a) => (
                <li key={a.id} className="px-3 py-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{a.naam}</div><div className="text-[11px] text-gray-500">{a.prijs_excl ? `${formatEuro(a.prijs_excl)} per ${a.eenheid}` : `per ${a.eenheid} · prijs per item invullen`}{a.soort === 'doorgerekende_kost' ? ' · doorgerekende kost' : ''}</div></div>
                  <IconKnop titel="Aanpassen" onClick={() => setBewerk(a)}><Pencil className="h-3.5 w-3.5" /></IconKnop>
                  <IconKnop titel="Verwijderen" rood onClick={() => verwijder(a)}><Trash2 className="h-3.5 w-3.5" /></IconKnop>
                </li>
              ))}
            </ul>
            <button type="button" onClick={() => setBewerk({ id: '', naam: '', beschrijving: '', eenheid: 'stuk', prijs_excl: null, btw_pct: 21, soort: 'dienst' })} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Nieuw artikel</button>
          </>
        )}
      </div>
    </div>
  )
}

// ── Stap 4: mededeling & controle ───────────────────────────────────────────
function StapControle({ klant, basis, regels, totalen, kosten, ontbrekend, mededeling, setMededeling, notitie, setNotitie, bijlagen, setBijlagen, gaNaar }: {
  klant: KlantInfo | null; basis: Basis; regels: FactuurRegel[]; totalen: ReturnType<typeof berekenTotalen>; kosten: InterneKost[]; ontbrekend: string[]
  mededeling: string; setMededeling: (s: string) => void; notitie: string; setNotitie: (s: string) => void; bijlagen: File[]; setBijlagen: (f: File[]) => void; gaNaar: (i: number) => void
}) {
  const type = FACTUUR_TYPES.find((t) => t.key === basis.type)?.label
  return (
    <div className="space-y-5">
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className={lbl}>Mededeling voor op de factuur</label>
          <textarea rows={4} className={INP} value={mededeling} onChange={(e) => setMededeling(e.target.value)} placeholder="Tekst die Bram op de factuur mag overnemen." />
        </div>
        <div>
          <label className={lbl}>Interne notitie voor Bram <span className="text-gray-400 font-normal">— komt niet op de factuur</span></label>
          <textarea rows={4} className={`${INP} bg-amber-50/50`} value={notitie} onChange={(e) => setNotitie(e.target.value)} placeholder="Info voor het team, bv. ‘klant vroeg om aparte factuur voor de kilometers’." />
        </div>
      </div>
      <div>
        <label className={lbl}>Bijlage <span className="text-gray-400 font-normal">— optioneel, bv. bestelbon of bewijs van een extra kost</span></label>
        <label className="btn-secondary text-sm cursor-pointer w-fit"><Paperclip className="h-4 w-4" />Bestand kiezen<input type="file" className="hidden" multiple onChange={(e) => { setBijlagen([...bijlagen, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} /></label>
        {bijlagen.length > 0 && (
          <ul className="mt-2 space-y-1">{bijlagen.map((f, i) => <li key={i} className="flex items-center gap-2 text-sm"><Paperclip className="h-3.5 w-3.5 text-gray-400" />{f.name}<button type="button" onClick={() => setBijlagen(bijlagen.filter((_, j) => j !== i))} className="text-red-600 text-xs underline">weg</button></li>)}</ul>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wide">Overzicht</div>
        <div className="p-4 space-y-3 text-sm">
          {ontbrekend.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
              <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Gegevens ontbreken</div>
              <ul className="list-disc pl-5 mt-1">{ontbrekend.map((o) => <li key={o}>{o}</li>)}</ul>
              <p className="text-xs mt-1">Je kunt het item toch opslaan; Bram ziet dan dat er iets ontbreekt.</p>
            </div>
          )}
          <Rij label="Klant" onWijzig={() => gaNaar(0)}>{klant ? <>{klant.naam}{klant.btw ? ` · ${klant.btw}` : ''}</> : <span className="text-red-600">nog geen klant</span>}</Rij>
          <Rij label="Geplande facturatiedatum" onWijzig={() => gaNaar(1)}>{basis.datum ? basis.datum.split('-').reverse().join('/') : '—'}{type ? ` · ${type}` : ''}{basis.titel ? ` · ${basis.titel}` : ''}</Rij>
          <Rij label="Artikelen" onWijzig={() => gaNaar(2)}>
            <ul className="space-y-0.5">{regels.map((r, i) => { const b = berekenRegel(r); return <li key={i} className="flex justify-between gap-3"><span className="truncate">{r.artikel || r.omschrijving || '(zonder naam)'} · {r.aantal.toLocaleString('nl-BE')} {r.eenheid}</span><span className="tabular-nums shrink-0">{formatEuro(b.excl)}</span></li> })}</ul>
          </Rij>
          <div className="border-t border-gray-100 pt-2 tabular-nums space-y-0.5 max-w-xs ml-auto">
            <div className="flex justify-between"><span>Subtotaal excl. btw</span><b>{formatEuro(totalen.excl)}</b></div>
            {totalen.perBtw.map((p) => <div key={p.pct} className="flex justify-between text-gray-600"><span>Btw {p.pct.toLocaleString('nl-BE')} %</span><span>{formatEuro(p.btw)}</span></div>)}
            <div className="flex justify-between text-base"><span>Totaal incl. btw</span><b>{formatEuro(totalen.incl)}</b></div>
          </div>
          {kosten.filter((k) => k.omschrijving.trim()).length > 0 && <p className="text-xs text-gray-500">+ {kosten.filter((k) => k.omschrijving.trim()).length} interne kost(en) — niet op de factuur, wel in Kosten en winst.</p>}
        </div>
      </div>
    </div>
  )
}

function Rij({ label, children, onWijzig }: { label: string; children: React.ReactNode; onWijzig: () => void }) {
  return (
    <div className="grid grid-cols-[150px_1fr_auto] gap-2 items-start">
      <span className="text-gray-500">{label}</span><div className="min-w-0">{children}</div>
      <button type="button" onClick={onWijzig} className="text-xs underline text-gray-600">wijzigen</button>
    </div>
  )
}
