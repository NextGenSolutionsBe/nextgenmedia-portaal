'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  X, Loader2, Check, Trash2, Euro, FileSignature, Receipt, Send, MessageSquare, Sparkles, Plus, ExternalLink, Building2, Lock,
} from 'lucide-react'
import {
  KOLOMMEN, kolomInfo, kolomVan, stapLabel, kaartKleur, DIENSTEN, dienstInfo, BRONNEN, OFFERTE_VIA, raadDiensten, normaliseerDiensten,
  type KolomKey, type Bron,
} from '@/lib/opdrachten-kanban'
import type { OpdrachtStatus } from '@/lib/opdrachten'
import { formatEuro } from '@/lib/utils'
import { KlantKiezer, type KlantOptie } from '@/components/admin/klant-kiezer'
import {
  FACTUUR_LABEL, datumKort, hoeLangGeleden,
  type KaartOpdracht, type Klant, type ContractOptie, type FactuurOptie, type Notitie,
} from './types'

type Concept = {
  titel: string
  omschrijving: string
  client_id: string
  klant_vrij: string
  verantwoordelijke: string
  bedrag_excl: string
  bron: Bron | ''
  diensten: string[]
  offerte_via: string
  offerte_op: string
  contract_id: string
  invoice_id: string
}
type Veld = keyof Concept

const uit = (o: KaartOpdracht | null): Concept => ({
  titel: o?.titel ?? '',
  omschrijving: o?.omschrijving ?? '',
  client_id: o?.client_id ?? '',
  klant_vrij: o?.klant_vrij ?? '',
  verantwoordelijke: o?.verantwoordelijke ?? '',
  bedrag_excl: o?.bedrag_excl !== null && o?.bedrag_excl !== undefined ? String(o.bedrag_excl) : '',
  bron: o?.bron ?? '',
  diensten: o?.diensten ?? [],
  offerte_via: o?.offerte_via ?? '',
  offerte_op: o?.offerte_op ?? '',
  contract_id: o?.contract_id ?? '',
  invoice_id: o?.invoice_id ?? '',
})

const gelijk = (a: Concept[Veld], b: Concept[Veld]) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Het venster van één kaart: alle gegevens, de koppelingen en de interne
 * tijdlijn. De gegevens zijn een concept met één knop Bewaren (of Cmd/Ctrl+S);
 * de fase wijzigen en notities plaatsen gebeurt meteen.
 */
export function OpdrachtVenster({ o, nieuwKolom, klanten, contracten, facturen, namen, ik, onClose, onOpgeslagen, onVerplaats, onStap, onVerwijder, onKlantNieuw }: {
  o: KaartOpdracht | null
  nieuwKolom: KolomKey
  klanten: Klant[]
  contracten: ContractOptie[]
  facturen: FactuurOptie[]
  namen: string[]
  ik: string | null
  onClose: () => void
  onOpgeslagen: (id: string) => void
  onVerplaats: (o: KaartOpdracht, doel: KolomKey) => void
  onStap: (o: KaartOpdracht, status: OpdrachtStatus) => void
  onVerwijder: (o: KaartOpdracht) => void
  onKlantNieuw: (k: Klant) => void
}) {
  const [c, setC] = useState<Concept>(() => uit(o))
  const aangeraakt = useRef(new Set<Veld>())
  const [bezig, setBezig] = useState(false)
  const [eigenDienst, setEigenDienst] = useState('')
  const [eersteNotitie, setEersteNotitie] = useState('')

  // Na een verplaatsing of herladen: velden die je niet aanraakte volgen de
  // nieuwe gegevens (bv. het offertekanaal uit de verplaatsvraag).
  useEffect(() => {
    if (!o) return
    const vers = uit(o)
    setC((huidig) => {
      const nieuw = { ...huidig }
      for (const k of Object.keys(vers) as Veld[]) if (!aangeraakt.current.has(k)) (nieuw as Record<Veld, unknown>)[k] = vers[k]
      return nieuw
    })
  }, [o])

  const zet = <K extends Veld>(k: K, v: Concept[K]) => { aangeraakt.current.add(k); setC((p) => ({ ...p, [k]: v })) }
  const basis = useMemo(() => uit(o), [o])
  const gewijzigd = (Object.keys(c) as Veld[]).filter((k) => aangeraakt.current.has(k) && !gelijk(c[k], basis[k]))
  const vuil = !o ? !!c.titel.trim() : gewijzigd.length > 0

  const kleur = kaartKleur(c.diensten)
  const status: OpdrachtStatus = o?.status ?? kolomInfo(nieuwKolom).standaard
  const kolom = kolomVan(status)
  const kol = kolomInfo(kolom)
  const voorstel = c.diensten.length === 0 ? raadDiensten(c.titel) : []

  const klantOpties: KlantOptie[] = useMemo(() => klanten.map((k) => ({ id: k.id, company_name: k.naam, contact_name: k.contact_name ?? null, email: k.email ?? null })), [klanten])
  const contractOpties = useMemo(() => ({
    eigen: contracten.filter((x) => c.client_id && x.client_id === c.client_id),
    rest: contracten.filter((x) => !c.client_id || x.client_id !== c.client_id),
  }), [contracten, c.client_id])
  const factuurOpties = useMemo(() => {
    const bij = (f: FactuurOptie) => (c.contract_id && f.contract_id === c.contract_id) || (c.client_id && f.client_id === c.client_id)
    return { eigen: facturen.filter(bij), rest: facturen.filter((f) => !bij(f)) }
  }, [facturen, c.client_id, c.contract_id])
  const factuurTekst = (f: FactuurOptie) => `${datumKort(f.invoice_date)} · ${formatEuro(Number(f.amount_incl) || 0)} · ${FACTUUR_LABEL[f.status] ?? f.status}${f.description ? ` · ${f.description}` : ''}${!c.client_id && f.klant_naam ? ` · ${f.klant_naam}` : ''}`

  const sluit = useCallback(() => {
    if (vuil && !confirm('Je wijzigingen zijn nog niet bewaard. Toch sluiten?')) return
    onClose()
  }, [vuil, onClose])

  const bewaar = useCallback(async () => {
    if (!c.titel.trim()) { toast.error('Geef de opdracht een titel.'); return }
    if (o && !gewijzigd.length) { toast.message('Niets gewijzigd.'); return }
    setBezig(true)
    try {
      const velden = o ? gewijzigd : (Object.keys(c) as Veld[])
      const body: Record<string, unknown> = o ? { id: o.id } : { status }
      for (const k of velden) {
        const v = c[k]
        if (k === 'client_id') { body.client_id = v || null; if (!v) body.klant_vrij = c.klant_vrij }
        else if (k === 'diensten') body.diensten = v
        else body[k] = typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v
      }
      if (body.client_id) delete body.klant_vrij
      if (!o && eersteNotitie.trim()) body.notitie = eersteNotitie.trim()
      const res = await fetch('/api/admin/opdrachten', { method: o ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      aangeraakt.current.clear()
      toast.success(o ? 'Bewaard.' : 'Kaart toegevoegd.')
      onOpgeslagen(o?.id ?? j.id)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }, [c, o, gewijzigd, status, eersteNotitie, onOpgeslagen])

  useEffect(() => {
    const toets = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void bewaar() }
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-label]:not([data-venster])')) sluit()
    }
    window.addEventListener('keydown', toets)
    return () => window.removeEventListener('keydown', toets)
  }, [bewaar, sluit])

  const wisselDienst = (d: string) => zet('diensten', c.diensten.includes(d) ? c.diensten.filter((x) => x !== d) : normaliseerDiensten([...c.diensten, d]))
  const voegEigenDienstToe = () => { if (!eigenDienst.trim()) return; zet('diensten', normaliseerDiensten([...c.diensten, eigenDienst])); setEigenDienst('') }
  const viaVast = OFFERTE_VIA.some((v) => v.key === c.offerte_via)
  const [viaAnders, setViaAnders] = useState(!!c.offerte_via && !viaVast)

  const keuze = (actief: boolean) => `text-sm px-3 py-1.5 rounded-xl border transition-colors ${actief ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:border-gray-400'}`
  const LBL = 'block text-xs font-semibold text-gray-700 mb-1.5'

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={sluit}>
      <aside data-venster role="dialog" aria-modal="true" aria-label={o ? o.titel : 'Nieuwe opdracht'}
        className="w-full sm:max-w-2xl h-full bg-white shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Kop in de kleur van de dienst: zo zie je meteen hoe de kaart eruitziet. */}
        <header className="px-5 pt-4 pb-4 border-b-2 transition-colors" style={{ background: kleur.achtergrond, borderColor: kleur.rand, color: kleur.tekst }}>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${kol.label_kleur}`}>{o ? kol.label : `Nieuw · ${kol.label}`}</span>
            <button type="button" onClick={sluit} aria-label="Sluiten" className={`h-9 w-9 rounded-lg flex items-center justify-center ${kleur.donker ? 'hover:bg-white/15' : 'hover:bg-black/5'}`}><X className="h-5 w-5" /></button>
          </div>
          <input value={c.titel} onChange={(e) => zet('titel', e.target.value)} maxLength={200} autoFocus={!o}
            placeholder="Wat is het project? Bv. Bestickering camionette"
            className={`mt-2 w-full bg-transparent text-xl sm:text-2xl font-semibold leading-tight outline-none rounded-lg px-1 -mx-1 focus:ring-2 ${kleur.donker ? 'placeholder:text-white/50 focus:ring-white/40' : 'placeholder:text-black/30 focus:ring-black/20'}`} aria-label="Titel" />
          <p className={`mt-1 text-sm flex items-center gap-1.5 ${kleur.donker ? 'text-white/80' : 'text-gray-700'}`}>
            <Building2 className="h-4 w-4" />{(c.client_id ? klanten.find((k) => k.id === c.client_id)?.naam ?? (c.client_id === o?.client_id ? o?.klant_naam : null) : c.klant_vrij) || 'Nog geen klant'}
            {o?.created_at && <span className="opacity-70">· sinds {datumKort(o.created_at.slice(0, 10))}</span>}
          </p>
        </header>

        <div className="flex-1 overflow-y-auto">
          {/* Fase: meteen verplaatsen, zoals slepen op het bord. */}
          {o && (
            <section className="px-5 py-4 border-b border-gray-100">
              <p className={LBL}>Fase</p>
              <div className="flex gap-1.5 flex-wrap">
                {KOLOMMEN.map((k) => (
                  <button key={k.key} type="button" onClick={() => k.key !== kolom && onVerplaats(o, k.key)}
                    className={`shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors ${k.key === kolom ? `${k.label_kleur} border-transparent` : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>
                    {k.label}
                  </button>
                ))}
              </div>
              {kol.stappen.length > 1 && (
                <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">Stap:</span>
                  {kol.stappen.map((s) => (
                    <button key={s} type="button" onClick={() => s !== status && onStap(o, s)} className={keuze(s === status)}>{stapLabel(s)}</button>
                  ))}
                </div>
              )}
              {o.status_bron === 'automatisch' && <p className="mt-2 text-[11px] text-gray-500">Deze fase volgde automatisch uit het gekoppelde contract of de facturen.</p>}
            </section>
          )}

          <section className="px-5 py-4 space-y-4 border-b border-gray-100">
            <div>
              <p className={LBL}>Klant</p>
              <KlantKiezer id="opdracht-klant" klanten={klantOpties} waarde={c.client_id} leegLabel="Geen klant uit de lijst (prospect)"
                onKies={(k) => {
                  zet('client_id', k?.id ?? '')
                  const kl = klanten.find((x) => x.id === k?.id)
                  if (kl?.verantwoordelijke && !c.verantwoordelijke) zet('verantwoordelijke', kl.verantwoordelijke)
                }}
                onNieuw={(k) => onKlantNieuw({ id: k.id, naam: k.company_name, contact_name: k.contact_name ?? null, email: k.email ?? null })} bron="opdracht" />
              {!c.client_id && (
                <input className="input-base mt-2" value={c.klant_vrij} onChange={(e) => zet('klant_vrij', e.target.value)} maxLength={120}
                  placeholder="Of typ de naam van een prospect" aria-label="Naam van de prospect" />
              )}
            </div>

            <div>
              <p className={LBL}>Diensten <span className="font-normal text-gray-400">· de eerste bepaalt de kleur van de kaart</span></p>
              <div className="flex flex-wrap gap-1.5">
                {DIENSTEN.map((d) => {
                  const aan = c.diensten.includes(d.key as string)
                  return (
                    <button key={d.key} type="button" onClick={() => wisselDienst(d.key as string)} aria-pressed={aan}
                      style={aan ? { background: d.achtergrond, borderColor: d.donker ? d.achtergrond : d.rand, color: d.tekst } : undefined}
                      className={`text-sm px-3 py-1.5 rounded-xl border-2 flex items-center gap-1.5 transition-colors ${aan ? 'font-semibold' : 'bg-white border-gray-200 hover:border-gray-400'}`}>
                      <span className="h-3 w-3 rounded-full border border-black/10" style={{ background: d.achtergrond }} />
                      {d.label}{aan && <Check className="h-3.5 w-3.5" />}
                    </button>
                  )
                })}
                {c.diensten.filter((d) => !dienstInfo(d).key).map((d) => (
                  <button key={d} type="button" onClick={() => wisselDienst(d)} className="text-sm px-3 py-1.5 rounded-xl border-2 border-gray-900 bg-gray-50 flex items-center gap-1.5 font-semibold">
                    {d}<X className="h-3.5 w-3.5" />
                  </button>
                ))}
              </div>
              <div className="mt-2 flex gap-1.5">
                <input className="input-base flex-1" value={eigenDienst} onChange={(e) => setEigenDienst(e.target.value)} maxLength={40}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); voegEigenDienstToe() } }} placeholder="Andere dienst, bv. Bestickering" aria-label="Andere dienst" />
                <button type="button" onClick={voegEigenDienstToe} className="btn-secondary text-sm" disabled={!eigenDienst.trim()}><Plus className="h-4 w-4" />Toevoegen</button>
              </div>
              {voorstel.length > 0 && (
                <button type="button" onClick={() => zet('diensten', voorstel)} className="mt-2 text-xs text-gray-700 inline-flex items-center gap-1 rounded-lg bg-gray-100 hover:bg-gray-200 px-2.5 py-1.5">
                  <Sparkles className="h-3.5 w-3.5" />Voorstel uit de titel: <b>{voorstel.map((d) => dienstInfo(d).label).join(', ')}</b> · overnemen
                </button>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className={LBL}>Hoe kwam het binnen?</p>
                <div className="flex gap-1.5">
                  {BRONNEN.map((b) => (
                    <button key={b.key} type="button" title={b.uitleg} onClick={() => zet('bron', c.bron === b.key ? '' : b.key)} className={keuze(c.bron === b.key)}>{b.label}</button>
                  ))}
                </div>
                {!c.bron && o?.bron_voorstel && (
                  <button type="button" onClick={() => zet('bron', o.bron_voorstel!)} className="mt-1.5 text-[11px] text-gray-600 underline">
                    Volgens de pipeline: {o.bron_voorstel === 'inbound' ? 'Inbound' : 'Outbound'} · overnemen
                  </button>
                )}
              </div>
              <div>
                <label className={LBL} htmlFor="opdracht-verantw">Verantwoordelijke</label>
                <select id="opdracht-verantw" className="input-base" value={c.verantwoordelijke} onChange={(e) => zet('verantwoordelijke', e.target.value)}>
                  <option value="">Nog niet gekozen</option>
                  {[...namen, ...(c.verantwoordelijke && !namen.includes(c.verantwoordelijke) ? [c.verantwoordelijke] : [])].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className={LBL} htmlFor="opdracht-bedrag">Waarde excl. btw</label>
              <div className="relative max-w-xs">
                <Euro className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input id="opdracht-bedrag" inputMode="decimal" className="input-base pl-8" value={c.bedrag_excl} onChange={(e) => zet('bedrag_excl', e.target.value)} placeholder="4950" />
              </div>
              {o?.waarde_bron === 'facturen' && !c.bedrag_excl && <p className="text-[11px] text-gray-500 mt-1">Nu telt de som van de gekoppelde facturen: {formatEuro(o.waarde ?? 0)}.</p>}
            </div>

            <div>
              <label className={LBL} htmlFor="opdracht-omschrijving">Omschrijving</label>
              <textarea id="opdracht-omschrijving" rows={3} className="input-base" value={c.omschrijving} onChange={(e) => zet('omschrijving', e.target.value)} maxLength={4000}
                placeholder="Wat houdt het project in? Afspraken, planning, wensen van de klant." />
            </div>
          </section>

          {/* Offerte: hoe en wanneer de prijs gedeeld werd. */}
          <section className={`px-5 py-4 space-y-3 border-b border-gray-100 ${kolom === 'offerte' && !c.offerte_via ? 'bg-amber-50/60' : ''}`}>
            <p className="text-sm font-semibold flex items-center gap-2"><Send className="h-4 w-4" />Offerte</p>
            <div className="flex flex-wrap gap-1.5">
              {OFFERTE_VIA.map((v) => (
                <button key={v.key} type="button" onClick={() => { setViaAnders(false); zet('offerte_via', c.offerte_via === v.key ? '' : v.key) }} className={keuze(c.offerte_via === v.key && !viaAnders)}>{v.label}</button>
              ))}
              <button type="button" onClick={() => { setViaAnders(true); if (viaVast) zet('offerte_via', '') }} className={keuze(viaAnders)}>Anders…</button>
            </div>
            {viaAnders && <input className="input-base" value={viaVast ? '' : c.offerte_via} onChange={(e) => zet('offerte_via', e.target.value)} maxLength={60} placeholder="Bv. op de beurs, via LinkedIn" aria-label="Ander kanaal" />}
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600" htmlFor="opdracht-offerte-op">Gedeeld op</label>
              <input id="opdracht-offerte-op" type="date" className="input-base !w-auto" value={c.offerte_op} onChange={(e) => zet('offerte_op', e.target.value)} />
            </div>
          </section>

          {/* Contract en facturen. */}
          <section className="px-5 py-4 space-y-3 border-b border-gray-100">
            <p className="text-sm font-semibold flex items-center gap-2"><FileSignature className="h-4 w-4" />Contract en facturen</p>
            <p className="text-[11px] text-gray-500 -mt-1">Gekoppeld contract verstuurd → Contract. Getekend → Getekend contract. Alles gefactureerd (ook voorschotten en maandfacturen) → Afgerond.</p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="opdracht-contract">Contract</label>
              <select id="opdracht-contract" className="input-base" value={c.contract_id} onChange={(e) => zet('contract_id', e.target.value)}>
                <option value="">Geen contract gekoppeld</option>
                {contractOpties.eigen.length > 0 && <optgroup label="Van deze klant">{contractOpties.eigen.map((x) => <option key={x.id} value={x.id}>{x.titel} · {x.label}</option>)}</optgroup>}
                <optgroup label={contractOpties.eigen.length ? 'Andere contracten' : 'Contracten'}>{contractOpties.rest.map((x) => <option key={x.id} value={x.id}>{x.titel} · {x.label}</option>)}</optgroup>
              </select>
              <div className="mt-1.5 flex gap-3 text-xs">
                {c.contract_id && <Link href={`/admin/contracts/${c.contract_id}`} className="text-blue-700 underline inline-flex items-center gap-1">Contract openen<ExternalLink className="h-3 w-3" /></Link>}
                <Link href={`/admin/contracts/new${c.client_id ? `?client=${c.client_id}` : ''}`} target="_blank" className="text-gray-600 underline">Nieuw contract maken</Link>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1" htmlFor="opdracht-factuur">Losse factuur <span className="text-gray-400">· voor werk zonder contract</span></label>
              <select id="opdracht-factuur" className="input-base" value={c.invoice_id} onChange={(e) => zet('invoice_id', e.target.value)}>
                <option value="">Geen losse factuur gekoppeld</option>
                {factuurOpties.eigen.length > 0 && <optgroup label="Van deze klant of dit contract">{factuurOpties.eigen.map((f) => <option key={f.id} value={f.id}>{factuurTekst(f)}</option>)}</optgroup>}
                <optgroup label={factuurOpties.eigen.length ? 'Andere facturen' : 'Facturen'}>{factuurOpties.rest.slice(0, 150).map((f) => <option key={f.id} value={f.id}>{factuurTekst(f)}</option>)}</optgroup>
              </select>
            </div>
            {o?.facturatie?.bron && (
              <div className="rounded-xl border border-gray-200 p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5"><Receipt className="h-4 w-4" />{o.facturatie.volledig ? 'Volledig gefactureerd' : 'Gefactureerd'}</span>
                  <span className="font-semibold tabular-nums">{formatEuro(o.facturatie.gefactureerd)}{o.facturatie.totaal ? ` van ${formatEuro(o.facturatie.totaal)}` : ''}</span>
                </div>
                {o.facturatie.totaal ? (
                  <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className={`h-full rounded-full ${o.facturatie.volledig ? 'bg-green-600' : 'bg-gray-900'}`} style={{ width: `${Math.min(100, Math.round((o.facturatie.gefactureerd / o.facturatie.totaal) * 100))}%` }} />
                  </div>
                ) : o.facturatie.bron === 'contract' && <p className="text-[11px] text-amber-700 mt-1">Het contract heeft nog geen waarde. Vul die in op het contract, anders kan de kaart niet vanzelf afronden.</p>}
                {(o.facturen ?? []).length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-gray-600">
                    {(o.facturen ?? []).slice(0, 8).map((f) => <li key={f.id}>{datumKort(f.invoice_date)} · {formatEuro(Number(f.amount_excl ?? 0))} excl. · {FACTUUR_LABEL[f.status] ?? f.status}</li>)}
                  </ul>
                )}
              </div>
            )}
            {o?.lead_id && <Link href={`/admin/sales/pipeline?lead=${o.lead_id}`} className="text-xs text-gray-600 underline inline-block">Open in de pipeline</Link>}
          </section>

          {/* Interne communicatie. */}
          <section className="px-5 py-4">
            <p className="text-sm font-semibold flex items-center gap-2"><MessageSquare className="h-4 w-4" />Notities <span className="text-[11px] font-normal text-gray-500 flex items-center gap-1"><Lock className="h-3 w-3" />enkel intern</span></p>
            {o ? <Notities opdrachtId={o.id} ik={ik} /> : (
              <textarea rows={3} className="input-base mt-2" value={eersteNotitie} onChange={(e) => setEersteNotitie(e.target.value)} maxLength={4000}
                placeholder="Bv. afspraak gehad om dit te bespreken, klant wil starten in januari" aria-label="Eerste notitie" />
            )}
          </section>
        </div>

        <footer className="p-3 sm:p-4 border-t border-gray-200 flex items-center gap-2 bg-white">
          <button type="button" onClick={bewaar} disabled={bezig || (!!o && !vuil)} className="btn-primary flex-1 sm:flex-none sm:min-w-[10rem]">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{o ? 'Bewaren' : 'Kaart toevoegen'}
          </button>
          {vuil && o && <span className="text-xs text-amber-700 hidden sm:inline">Niet bewaard · Cmd/Ctrl+S</span>}
          <button type="button" onClick={sluit} className="btn-secondary ml-auto">Sluiten</button>
          {o && (
            <button type="button" onClick={() => onVerwijder(o)} title="Kaart verwijderen" aria-label="Kaart verwijderen"
              className="h-10 w-10 rounded-xl flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
          )}
        </footer>
      </aside>
    </div>
  )
}

/** Tijdlijn van de kaart: notities van het team en wat er automatisch gebeurde. */
function Notities({ opdrachtId, ik }: { opdrachtId: string; ik: string | null }) {
  const [lijst, setLijst] = useState<Notitie[] | null>(null)
  const [tekst, setTekst] = useState('')
  const [bezig, setBezig] = useState(false)
  const [toonSysteem, setToonSysteem] = useState(true)

  const laad = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/opdrachten/${opdrachtId}/notities`, { cache: 'no-store' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setLijst(j.notities ?? [])
    } catch (e) { setLijst([]); toast.error(e instanceof Error ? e.message : 'Notities laden mislukt') }
  }, [opdrachtId])
  useEffect(() => { void laad() }, [laad])

  const plaats = async () => {
    const t = tekst.trim()
    if (!t) return
    setBezig(true)
    try {
      const res = await fetch(`/api/admin/opdrachten/${opdrachtId}/notities`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tekst: t }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setLijst((p) => [j.notitie, ...(p ?? [])])
      setTekst('')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Plaatsen mislukt') } finally { setBezig(false) }
  }
  const weg = async (n: Notitie) => {
    if (!confirm('Deze notitie verwijderen?')) return
    const res = await fetch(`/api/admin/opdrachten/${opdrachtId}/notities?notitie=${n.id}`, { method: 'DELETE' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { toast.error(j.error ?? 'Verwijderen mislukt'); return }
    setLijst((p) => (p ?? []).filter((x) => x.id !== n.id))
  }

  const zichtbaar = (lijst ?? []).filter((n) => toonSysteem || n.soort === 'notitie')
  return (
    <div className="mt-2">
      <div className="rounded-xl border border-gray-200 focus-within:ring-2 focus-within:ring-gray-900/15">
        <textarea rows={2} className="w-full px-3 pt-2.5 text-sm outline-none resize-none rounded-t-xl" value={tekst} onChange={(e) => setTekst(e.target.value)} maxLength={4000}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void plaats() } }}
          placeholder="Schrijf een notitie voor het team… (Cmd/Ctrl+Enter)" aria-label="Nieuwe notitie" />
        <div className="flex items-center justify-between px-2 pb-2">
          <label className="text-[11px] text-gray-500 flex items-center gap-1.5 cursor-pointer px-1">
            <input type="checkbox" className="h-3.5 w-3.5 accent-gray-900" checked={toonSysteem} onChange={(e) => setToonSysteem(e.target.checked)} />Toon verplaatsingen
          </label>
          <button type="button" onClick={plaats} disabled={bezig || !tekst.trim()} className="btn-primary text-xs px-3 py-1.5">
            {bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Plaatsen
          </button>
        </div>
      </div>
      {lijst === null ? (
        <div className="py-6 text-center text-gray-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
      ) : zichtbaar.length === 0 ? (
        <p className="text-xs text-gray-400 py-4 text-center">Nog geen notities.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {zichtbaar.map((n) => n.soort === 'systeem' ? (
            <li key={n.id} className="text-[12px] text-gray-500 flex items-center gap-2 pl-1">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-300 shrink-0" />
              <span className="flex-1">{n.tekst}</span>
              <span className="shrink-0 text-gray-400">{n.auteur_naam ? `${n.auteur_naam} · ` : ''}{hoeLangGeleden(n.created_at)}</span>
            </li>
          ) : (
            <li key={n.id} className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2.5 group">
              <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500">
                <span className="font-semibold text-gray-800">{n.auteur_naam || n.auteur_email?.split('@')[0] || 'Team'}</span>
                <span className="flex items-center gap-2">
                  <span title={new Date(n.created_at).toLocaleString('nl-BE')}>{hoeLangGeleden(n.created_at)}</span>
                  {ik && n.auteur_user_id === ik && (
                    <button type="button" onClick={() => weg(n)} className="text-gray-400 hover:text-red-600" aria-label="Notitie verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                  )}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-800 whitespace-pre-line break-words">{n.tekst}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
