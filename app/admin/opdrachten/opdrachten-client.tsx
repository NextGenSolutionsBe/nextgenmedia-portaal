'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Loader2, Plus, X, Trash2, Check, AlertTriangle, CalendarClock, Search, ClipboardList,
  FileSignature, Receipt, ArrowRight, Link2, Euro,
} from 'lucide-react'
import {
  STATUSSEN, FASEN, statusInfo, faseInfo, statussenPerFase, sorteer, isTeLaat, isVandaag, deadlineTekst,
  OPEN_STATUSSEN, volgendeStatus, pastInFilter, verslag, waardeVan,
  type Opdracht, type OpdrachtStatus, type Fase, type VerslagRegel,
} from '@/lib/opdrachten'
import { formatEuro } from '@/lib/utils'

type Klant = { id: string; naam: string }
type ContractOptie = { id: string; titel: string; status: string; label: string; client_id: string | null }
type FactuurOptie = { id: string; description: string | null; status: string; invoice_date: string | null; client_id: string | null; contract_id: string | null; amount_incl: number | null; klant_naam: string | null }

const FACTUUR_LABEL: Record<string, string> = { te_versturen: 'te versturen', verstuurd: 'verstuurd', gefactureerd: 'verstuurd', betaald: 'betaald', geannuleerd: 'geannuleerd' }
const datumKort = (s: string | null | undefined) => (s ? new Date(s + (s.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }) : '')

/**
 * Opdrachten: van de vraag om een projectvoorstel tot de factuur die de deur
 * uit is. Eén lijst zonder tabbladen; wat aandacht vraagt staat bovenaan.
 * Filteren kan op fase (chips) of op één precieze status.
 */
export function OpdrachtenClient() {
  const [rijen, setRijen] = useState<Opdracht[]>([])
  const [klanten, setKlanten] = useState<Klant[]>([])
  const [contracten, setContracten] = useState<ContractOptie[]>([])
  const [facturen, setFacturen] = useState<FactuurOptie[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const [laden, setLaden] = useState(true)
  const [q, setQ] = useState('')
  const [fase, setFase] = useState<Fase | 'open' | 'alle'>('open')
  const [status, setStatus] = useState<OpdrachtStatus | ''>('')
  const [toonAfgesloten, setToonAfgesloten] = useState(false)
  const [nieuw, setNieuw] = useState(false)
  const [bewerken, setBewerken] = useState<Opdracht | null>(null)

  const laad = useCallback(async () => {
    setLaden(true)
    try {
      const res = await fetch('/api/admin/opdrachten', { cache: 'no-store' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setRijen(j.opdrachten ?? [])
      setKlanten(j.klanten ?? [])
      setContracten(j.contracten ?? [])
      setFacturen(j.facturen ?? [])
      setHint(j.hint ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const zichtbaar = useMemo(() => {
    const naald = q.trim().toLowerCase()
    return rijen
      .filter((o) => pastInFilter(o, { fase, status, toonAfgesloten }))
      .filter((o) => !naald || [o.titel, o.omschrijving, o.klant_naam, o.wie, o.contract?.title]
        .some((v) => (v ?? '').toLowerCase().includes(naald)))
      .sort(sorteer)
  }, [rijen, q, fase, status, toonAfgesloten])

  const teLaat = rijen.filter((o) => isTeLaat(o)).length
  const vandaag = rijen.filter((o) => isVandaag(o)).length
  const open = rijen.filter((o) => OPEN_STATUSSEN.includes(o.status)).length
  const perFase = useMemo(() => {
    const m = new Map<Fase, number>()
    for (const o of rijen) { const f = statusInfo(o.status).fase; m.set(f, (m.get(f) ?? 0) + 1) }
    return m
  }, [rijen])
  const cijfers = useMemo(() => verslag(rijen), [rijen])
  const selectieWaarde = useMemo(() => zichtbaar.reduce((t, o) => t + (o.waarde ?? waardeVan(o).waarde ?? 0), 0), [zichtbaar])

  const zetStatus = async (o: Opdracht, s: OpdrachtStatus) => {
    // Meteen tonen; bij een fout draaien we terug. Statussen wisselen doe je
    // vaak achter elkaar, en dan is wachten op de server hinderlijk.
    const vorige = rijen
    setRijen((p) => p.map((x) => (x.id === o.id ? { ...x, status: s, status_bron: 'handmatig' } : x)))
    try {
      const res = await fetch('/api/admin/opdrachten', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: o.id, status: s }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
    } catch (e) {
      setRijen(vorige)
      toast.error(e instanceof Error ? e.message : 'Bijwerken mislukt')
    }
  }

  const verwijder = async (o: Opdracht) => {
    if (!confirm(`"${o.titel}" verwijderen?\n\nIs de opdracht gewoon klaar, zet hem dan op Afgerond — dan blijft hij terugvindbaar.`)) return
    try {
      const res = await fetch(`/api/admin/opdrachten?id=${o.id}`, { method: 'DELETE' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setRijen((p) => p.filter((x) => x.id !== o.id))
      toast.success('Verwijderd.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }

  const chip = (actief: boolean, extra = '') =>
    `text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors ${actief ? 'bg-black text-white border-black' : `border-gray-200 hover:bg-gray-50 ${extra}`}`

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />Opdrachten
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Van projectvoorstel tot factuur: elke opdracht volgt dezelfde weg. Koppel een contract of factuur en de
            status schuift vanzelf mee.
          </p>
        </div>
        <button onClick={() => setNieuw(true)} className="btn-primary text-sm">
          <Plus className="h-4 w-4" />Nieuwe opdracht
        </button>
      </div>

      {hint && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{hint}</p>
      )}

      {/* Wat vraagt aandacht? Eén regel, geen dashboard. */}
      {(teLaat > 0 || vandaag > 0) && (
        <div className="flex gap-2 flex-wrap">
          {teLaat > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-700">
              <AlertTriangle className="h-4 w-4" />
              {teLaat} {teLaat === 1 ? 'opdracht is' : 'opdrachten zijn'} te laat
            </span>
          )}
          {vandaag > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800">
              <CalendarClock className="h-4 w-4" />{vandaag} vandaag af te ronden
            </span>
          )}
        </div>
      )}

      {/* Het verslag: hoeveel werk staat er open en wat is het waard. Elke
          kaart is meteen een filter. */}
      <div className="grid gap-2 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
        <VerslagKaart titel="Openstaand" regel={cijfers.open} accent="border-gray-900" actief={fase === 'open' && !status} onClick={() => { setFase('open'); setStatus(''); setToonAfgesloten(false) }} hint="Alle opdrachten die nog niet afgesloten zijn." />
        <VerslagKaart titel="Projectvoorstel" regel={cijfers.voorstel} accent="border-purple-300" actief={fase === 'voorstel' && !status} onClick={() => { setFase('voorstel'); setStatus('') }} hint="Nieuw, gevraagd, in opmaak, klaar, voorgelegd of interesse." />
        <VerslagKaart titel="Contract" regel={cijfers.contract} accent="border-blue-300" actief={fase === 'contract' && !status} onClick={() => { setFase('contract'); setStatus('') }} hint="Contract verstuurd of getekend." />
        <VerslagKaart titel="Uitvoering" regel={cijfers.uitvoering} accent="border-amber-300" actief={fase === 'uitvoering' && !status} onClick={() => { setFase('uitvoering'); setStatus('') }} hint="In uitvoering, wacht op klant of opgeleverd." />
        <VerslagKaart titel="Te factureren / verstuurd" regel={cijfers.facturatie} accent="border-emerald-300" actief={fase === 'facturatie' && !status} onClick={() => { setFase('facturatie'); setStatus('') }} hint="Geld dat onderweg is: te factureren of factuur verstuurd." />
        <VerslagKaart titel="Betaald" regel={cijfers.betaald} accent="border-green-400" actief={status === 'betaald'} onClick={() => { setStatus('betaald') }} hint="Betaalde opdrachten." />
        <VerslagKaart titel="Verloren" regel={cijfers.verloren} accent="border-gray-300" actief={status === 'geen_interesse' || status === 'geannuleerd'} onClick={() => { setStatus('geen_interesse') }} hint="Geen interesse na het voorstel, of geannuleerd." gedempt />
      </div>
      {(cijfers.open.zonderWaarde > 0 || cijfers.teLaat.aantal > 0) && (
        <p className="text-[11px] text-gray-500 -mt-3">
          {cijfers.open.zonderWaarde > 0 && <>{cijfers.open.zonderWaarde} open {cijfers.open.zonderWaarde === 1 ? 'opdracht heeft' : 'opdrachten hebben'} nog geen waarde — vul ze in via de opdracht, dan klopt het verslag. </>}
          {cijfers.teLaat.aantal > 0 && <>Te laat: {cijfers.teLaat.aantal} ({formatEuro(cijfers.teLaat.waarde)}).</>}
        </p>
      )}

      {/* Filters: fase-chips, precieze status, zoeken. */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => { setFase('open'); setStatus('') }} className={chip(fase === 'open' && !status)}>Alles open ({open})</button>
          {FASEN.map((f) => (
            <button key={f.key} onClick={() => { setFase(f.key); setStatus('') }} className={chip(fase === f.key && !status)}>
              {f.label} ({perFase.get(f.key) ?? 0})
            </button>
          ))}
          <button onClick={() => { setFase('alle'); setStatus('') }} className={chip(fase === 'alle' && !status)}>Alles ({rijen.length})</button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input className="input-base pl-8 w-64" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Titel, klant, contract of wie…" />
          </div>
          <select className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white" value={status}
            onChange={(e) => setStatus(e.target.value as OpdrachtStatus | '')} title="Filter op één status">
            <option value="">Alle statussen</option>
            {FASEN.map((f) => (
              <optgroup key={f.key} label={f.label}>
                {statussenPerFase(f.key).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </optgroup>
            ))}
          </select>
          {fase === 'open' && !status && (
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 rounded border-gray-300 accent-[#fff848]"
                checked={toonAfgesloten} onChange={(e) => setToonAfgesloten(e.target.checked)} />
              Toon afgesloten
            </label>
          )}
          <span className="text-sm text-gray-500 ml-auto">{zichtbaar.length} van {rijen.length}{selectieWaarde > 0 && <> · {formatEuro(selectieWaarde)} excl. btw</>}</span>
        </div>
      </div>

      {laden ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : zichtbaar.length === 0 ? (
        <div className="card-base text-center py-12 text-gray-500">
          <ClipboardList className="h-8 w-8 mx-auto text-gray-300 mb-2" />
          <p className="text-sm">
            {rijen.length === 0
              ? 'Nog geen opdrachten. Voeg er een toe zodra er werk of een vraag om een voorstel binnenkomt.'
              : 'Niets gevonden met deze filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {zichtbaar.map((o) => (
            <OpdrachtRij key={o.id} o={o} onStatus={zetStatus}
              onOpen={() => setBewerken(o)} onVerwijder={() => verwijder(o)} />
          ))}
        </div>
      )}

      {(nieuw || bewerken) && (
        <OpdrachtDialoog
          bestaand={bewerken}
          klanten={klanten} contracten={contracten} facturen={facturen}
          onClose={() => { setNieuw(false); setBewerken(null) }}
          onOpgeslagen={() => { setNieuw(false); setBewerken(null); laad() }}
        />
      )}
    </div>
  )
}

function VerslagKaart({ titel, regel, accent, actief, onClick, hint, gedempt }: {
  titel: string; regel: VerslagRegel; accent: string; actief: boolean; onClick: () => void; hint: string; gedempt?: boolean
}) {
  return (
    <button type="button" onClick={onClick} title={hint}
      className={`card-base p-3 text-left border-t-4 ${accent} transition-shadow hover:shadow-md ${actief ? 'ring-2 ring-black' : ''} ${gedempt ? 'opacity-70' : ''}`}>
      <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide truncate">{titel}</p>
      <p className="text-lg font-bold text-gray-900 leading-tight mt-1">{formatEuro(regel.waarde)}</p>
      <p className="text-[11px] text-gray-500 mt-0.5">
        {regel.aantal} {regel.aantal === 1 ? 'opdracht' : 'opdrachten'}
        {regel.zonderWaarde > 0 && <span className="text-amber-700"> · {regel.zonderWaarde} zonder waarde</span>}
      </p>
    </button>
  )
}

function OpdrachtRij({ o, onStatus, onOpen, onVerwijder }: {
  o: Opdracht
  onStatus: (o: Opdracht, s: OpdrachtStatus) => void
  onOpen: () => void
  onVerwijder: () => void
}) {
  const info = statusInfo(o.status)
  const laat = isTeLaat(o)
  const nu = isVandaag(o)
  const tekst = deadlineTekst(o.deadline)
  const volgende = volgendeStatus(o.status)
  const facturen = o.facturen ?? []
  const verstuurd = facturen.filter((f) => f.status === 'verstuurd' || f.status === 'gefactureerd' || f.status === 'betaald').length
  const laatsteFactuur = facturen[0]
  const klaar = info.eind && o.status !== 'geannuleerd' && o.status !== 'geen_interesse'

  return (
    <div className={`card-base p-3 flex items-start gap-3 ${laat ? 'border-red-200 bg-red-50/40' : ''}`}>
      {/* Afvinken zonder de dialoog te openen: dat is de handeling die het
          vaakst gebeurt. */}
      <button
        onClick={() => onStatus(o, klaar ? 'open' : 'afgerond')}
        title={klaar ? 'Heropenen' : 'Afronden'}
        className={`mt-0.5 h-5 w-5 shrink-0 rounded-md border flex items-center justify-center transition-colors ${
          klaar ? 'bg-green-500 border-green-500 text-white' : 'border-gray-300 hover:border-gray-400 bg-white'}`}>
        {klaar && <Check className="h-3.5 w-3.5" />}
      </button>

      <button onClick={onOpen} className="flex-1 min-w-0 text-left">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`font-medium text-sm ${klaar ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
            {o.titel}
          </span>
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${info.badge}`} title={`${faseInfo(info.fase).label} · ${info.hint}`}>
            {info.label}
          </span>
          {o.status_bron === 'automatisch' && (
            <span className="text-[10px] text-gray-400" title="Deze status volgde automatisch uit het contract of de factuur">· automatisch</span>
          )}
          {laat && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-200">
              {tekst}
            </span>
          )}
          {nu && (
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
              vandaag
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {o.klant_naam && <span>{o.klant_naam}</span>}
          {(o.waarde ?? null) !== null && (
            <span className="font-medium text-gray-700" title={o.waarde_bron === 'facturen' ? 'Som van de gekoppelde facturen (excl. btw)' : 'Waarde van de opdracht (excl. btw)'}>
              · {formatEuro(o.waarde as number)}{o.waarde_bron === 'facturen' ? ' (facturen)' : ''}
            </span>
          )}
          {o.wie && <span>· {o.wie}</span>}
          {o.deadline && !laat && !nu && <span>· {o.deadline} ({tekst})</span>}
          {o.omschrijving && <span className="truncate max-w-md">· {o.omschrijving}</span>}
        </div>
        {/* De koppelingen: waar het contract en de facturen staan. */}
        {(o.contract || facturen.length > 0) && (
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {o.contract && (
              <Link href={`/admin/contracts/${o.contract.id}`} onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] rounded-lg border border-blue-200 bg-blue-50 text-blue-800 px-2 py-0.5 hover:border-blue-400"
                title="Open het contract">
                <FileSignature className="h-3 w-3" />{o.contract.title ?? 'Contract'} · {o.contract.label ?? o.contract.status}
              </Link>
            )}
            {facturen.length > 0 && (
              <Link href={`/admin/invoices?maand=${(laatsteFactuur?.invoice_date ?? '').slice(0, 7)}`} onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-[11px] rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 px-2 py-0.5 hover:border-emerald-400"
                title={facturen.map((f) => `${datumKort(f.invoice_date)} · ${formatEuro(Number(f.amount_incl) || 0)} · ${FACTUUR_LABEL[f.status] ?? f.status}`).join('\n')}>
                <Receipt className="h-3 w-3" />
                {facturen.length === 1
                  ? `Factuur ${datumKort(laatsteFactuur.invoice_date)} · ${FACTUUR_LABEL[laatsteFactuur.status] ?? laatsteFactuur.status}`
                  : `${verstuurd} van ${facturen.length} facturen verstuurd`}
              </Link>
            )}
          </div>
        )}
      </button>

      <div className="flex items-center gap-1 shrink-0">
        {volgende && (
          <button onClick={() => onStatus(o, volgende)} className="btn-secondary text-xs px-2" title={`Volgende stap: ${statusInfo(volgende).label}`}>
            <ArrowRight className="h-3.5 w-3.5" /><span className="hidden lg:inline">{statusInfo(volgende).label}</span>
          </button>
        )}
        <select
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white max-w-[190px]"
          value={o.status}
          onChange={(e) => onStatus(o, e.target.value as OpdrachtStatus)}
          title="Status wijzigen">
          {FASEN.map((f) => (
            <optgroup key={f.key} label={f.label}>
              {statussenPerFase(f.key).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </optgroup>
          ))}
        </select>
        <button onClick={onVerwijder} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"
          title="Verwijderen">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function OpdrachtDialoog({ bestaand, klanten, contracten, facturen, onClose, onOpgeslagen }: {
  bestaand: Opdracht | null
  klanten: Klant[]
  contracten: ContractOptie[]
  facturen: FactuurOptie[]
  onClose: () => void
  onOpgeslagen: () => void
}) {
  const [titel, setTitel] = useState(bestaand?.titel ?? '')
  const [omschrijving, setOmschrijving] = useState(bestaand?.omschrijving ?? '')
  const [clientId, setClientId] = useState(bestaand?.client_id ?? '')
  const [klantVrij, setKlantVrij] = useState(bestaand?.klant_vrij ?? '')
  const [status, setStatus] = useState<OpdrachtStatus>(bestaand?.status ?? 'open')
  const [deadline, setDeadline] = useState(bestaand?.deadline ?? '')
  const [wie, setWie] = useState(bestaand?.wie ?? '')
  const [bedragExcl, setBedragExcl] = useState(bestaand?.bedrag_excl !== null && bestaand?.bedrag_excl !== undefined ? String(bestaand.bedrag_excl) : '')
  const [contractId, setContractId] = useState(bestaand?.contract_id ?? '')
  const [invoiceId, setInvoiceId] = useState(bestaand?.invoice_id ?? '')
  const [bezig, setBezig] = useState(false)

  // Keuzelijsten volgen de klant: de contracten en facturen van déze klant
  // eerst, de rest (zonder klant, of van iemand anders) daaronder.
  const contractOpties = useMemo(() => {
    const eigen = contracten.filter((c) => clientId && c.client_id === clientId)
    const rest = contracten.filter((c) => !clientId || c.client_id !== clientId)
    return { eigen, rest }
  }, [contracten, clientId])
  const factuurOpties = useMemo(() => {
    const bij = (f: FactuurOptie) => (contractId && f.contract_id === contractId) || (clientId && f.client_id === clientId)
    return { eigen: facturen.filter(bij), rest: facturen.filter((f) => !bij(f)) }
  }, [facturen, clientId, contractId])
  const factuurTekst = (f: FactuurOptie) => `${datumKort(f.invoice_date)} · ${formatEuro(Number(f.amount_incl) || 0)} · ${FACTUUR_LABEL[f.status] ?? f.status}${f.description ? ` · ${f.description}` : ''}${!clientId && f.klant_naam ? ` · ${f.klant_naam}` : ''}`

  const bewaar = async () => {
    if (!titel.trim()) { toast.error('Geef de opdracht een titel'); return }
    setBezig(true)
    try {
      const body = {
        ...(bestaand ? { id: bestaand.id } : {}),
        titel: titel.trim(), omschrijving, status, deadline, wie,
        client_id: clientId || null,
        klant_vrij: clientId ? null : klantVrij,
        contract_id: contractId || null,
        invoice_id: invoiceId || null,
        bedrag_excl: bedragExcl.trim() === '' ? null : bedragExcl,
      }
      const res = await fetch('/api/admin/opdrachten', {
        method: bestaand ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(bestaand ? 'Opgeslagen.' : 'Opdracht toegevoegd.')
      onOpgeslagen()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  const gekozenStatus = statusInfo(status)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-gray-400" />
            {bestaand ? 'Opdracht bewerken' : 'Nieuwe opdracht'}
          </h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Wat moet er gebeuren?</label>
            <input className="input-base" value={titel} onChange={(e) => setTitel(e.target.value)}
              placeholder="Website en webshop — projectvoorstel" autoFocus maxLength={200} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Voor welke klant?</label>
            <select className="input-base" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— geen klant uit de lijst —</option>
              {klanten.map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}
            </select>
            {!clientId && (
              <input className="input-base mt-1.5" value={klantVrij} onChange={(e) => setKlantVrij(e.target.value)}
                placeholder="Of tik een naam — bv. een prospect die nog geen klant is" maxLength={120} />
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select className="input-base" value={status} onChange={(e) => setStatus(e.target.value as OpdrachtStatus)}>
              {FASEN.map((f) => (
                <optgroup key={f.key} label={f.label}>
                  {statussenPerFase(f.key).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </optgroup>
              ))}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">{gekozenStatus.hint}</p>
            {bestaand?.afgeleid && bestaand.afgeleid !== status && (
              <p className="text-[11px] text-blue-700 mt-1">
                Volgens het gekoppelde contract of de factuur staat dit op <b>{statusInfo(bestaand.afgeleid).label}</b>.
              </p>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700 flex items-center gap-1.5"><Link2 className="h-3.5 w-3.5" />Koppelingen</p>
            <p className="text-[11px] text-gray-500">
              Koppel het contract en de factuur die bij deze opdracht horen. De status schuift dan vanzelf mee:
              tekenlink verstuurd → Contract verstuurd, ondertekend → Getekend, factuur verstuurd → Factuur verstuurd.
              Facturen van het gekoppelde contract tellen automatisch mee.
            </p>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contract</label>
              <select className="input-base" value={contractId} onChange={(e) => setContractId(e.target.value)}>
                <option value="">— geen contract gekoppeld —</option>
                {contractOpties.eigen.length > 0 && (
                  <optgroup label="Van deze klant">
                    {contractOpties.eigen.map((c) => <option key={c.id} value={c.id}>{c.titel} · {c.label}</option>)}
                  </optgroup>
                )}
                <optgroup label={contractOpties.eigen.length > 0 ? 'Andere contracten' : 'Contracten'}>
                  {contractOpties.rest.map((c) => <option key={c.id} value={c.id}>{c.titel} · {c.label}</option>)}
                </optgroup>
              </select>
              {contractId && (
                <Link href={`/admin/contracts/${contractId}`} className="text-[11px] text-blue-700 underline mt-1 inline-block">Contract openen</Link>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Factuur <span className="text-gray-400">— voor werk zonder contract</span></label>
              <select className="input-base" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                <option value="">— geen losse factuur gekoppeld —</option>
                {factuurOpties.eigen.length > 0 && (
                  <optgroup label="Van deze klant of dit contract">
                    {factuurOpties.eigen.map((f) => <option key={f.id} value={f.id}>{factuurTekst(f)}</option>)}
                  </optgroup>
                )}
                <optgroup label={factuurOpties.eigen.length > 0 ? 'Andere facturen' : 'Facturen'}>
                  {factuurOpties.rest.slice(0, 150).map((f) => <option key={f.id} value={f.id}>{factuurTekst(f)}</option>)}
                </optgroup>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Waarde van de opdracht <span className="text-gray-400">— excl. btw</span></label>
            <div className="relative">
              <Euro className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input type="text" inputMode="decimal" className="input-base pl-8" value={bedragExcl}
                onChange={(e) => setBedragExcl(e.target.value)} placeholder="4950" />
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              Telt mee in het verslag bovenaan. Leeg maar wel facturen gekoppeld? Dan telt de som van die facturen.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Deadline</label>
              <input type="date" className="input-base" value={deadline}
                onChange={(e) => setDeadline(e.target.value)} min="2020-01-01" max="2099-12-31" />
              <p className="text-[11px] text-gray-500 mt-1">
                Leeg = geen datum. Verleden én nog open = rood bolletje in het menu.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Wie pakt dit op?</label>
              <input className="input-base" value={wie} onChange={(e) => setWie(e.target.value)}
                placeholder="Bram" maxLength={60} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Notities <span className="text-gray-400">— optioneel</span>
            </label>
            <textarea rows={3} className="input-base" value={omschrijving}
              onChange={(e) => setOmschrijving(e.target.value)} maxLength={4000}
              placeholder="Wat is er afgesproken, waar wacht je op, wat is de volgende stap?" />
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={bewaar} disabled={bezig} className="btn-primary flex-1">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {bestaand ? 'Opslaan' : 'Toevoegen'}
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}
