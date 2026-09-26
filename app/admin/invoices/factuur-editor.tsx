'use client'

import { GetalInvoer } from '@/components/ui/getal-invoer'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { X, Plus, Trash2, Copy, ArrowUp, ArrowDown, Loader2, Save, Send, Ban, RotateCcw, Wallet, History, AlertTriangle, ExternalLink } from 'lucide-react'
import { formatEuro } from '@/lib/utils'
import { DEFAULT_VAT } from '@/lib/invoices'
import { factuurdagVan } from '@/lib/facturatie/reeks'
import { berekenTotalen, berekenRegel, nieuweRegel, hernummer, verplaatsRegel, dupliceerRegel, verwijderRegel, getal, EENHEDEN, type FactuurRegel } from '@/lib/facturen/regels'
import { VERZENDSTATUS, BETAALSTATUS, KIESBARE_STATUSSEN, redenVerplicht, normaliseerVerzendstatus, type Verzendstatus, type Betaalstatus } from '@/lib/facturen/status'
import { Bevestig, INP } from '@/app/admin/instellingen/ui'
import { KostenEnWinstDialoog, KostenSamenvatting } from './kosten-en-winst'

/**
 * De factuureditor: één venster voor een nieuwe én een bestaande factuur, vanuit
 * de Facturen-module, de planner én het contractdetail. Alles gaat via
 * /api/admin/invoices/[id] (bestaand) of /api/admin/invoices {action:'aanmaken'}
 * (nieuw) — één bron, dus overal dezelfde cijfers.
 */

type Klant = { id: string; naam: string }
type ContractOptie = { id: string; titel: string; status: string; label: string; client_id: string | null }
type Wijziging = { id: number; actie: string; veld: string | null; oud: string | null; nieuw: string | null; reden: string | null; actor_email: string | null; created_at: string }
type Factuur = {
  id: string; client_id: string | null; contract_id: string | null; service_slug: string | null; invoice_date: string; due_date: string | null; periode: string | null; verantwoordelijke?: string | null; sent_by_email?: string | null
  description: string | null; reference: string | null; note: string | null; currency: string | null; vat_pct: number; payment_term_days: number | null
  amount_excl: number; amount_incl: number; status: string; verzendstatus: Verzendstatus; betaalstatus_afgeleid: Betaalstatus | null; betaald_bedrag: number; betaald_op: string | null
  sent_at: string | null; status_reden: string | null; contract_bedrag_excl: number | null; klant_naam: string | null; contract_titel: string | null; magInhoud: boolean
  voorstel: { volgnr: number; aantal: number } | null
}

export type EditorProps = {
  invoiceId?: string | null
  standaard?: { invoice_date?: string; client_id?: string | null; contract_id?: string | null; description?: string | null }
  onClose: () => void
  onSaved?: (id: string) => void
}

const dag = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : '')
const plusDagen = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const ACTIE_LABEL: Record<string, string> = { aangemaakt: 'Aangemaakt', bevestigd: 'Bevestigd uit voorstel', aangepast: 'Aangepast', verplaatst: 'Datum verplaatst', verstuurd: 'Verstuurd', geannuleerd: 'Geannuleerd', gecrediteerd: 'Gecrediteerd', betaalstatus: 'Betaling' }
const VELD_LABEL: Record<string, string> = { invoice_date: 'factuurdatum', due_date: 'vervaldatum', periode: 'periode', reference: 'referentie', note: 'interne notitie', payment_term_days: 'betaaltermijn', client_id: 'klant', contract_id: 'contract', description: 'omschrijving', currency: 'valuta', vat_pct: 'btw-tarief', amount_excl: 'bedrag excl.', amount_incl: 'bedrag incl.', contract_bedrag_excl: 'contractueel bedrag', regels: 'factuurregels', status: 'status', betaald_bedrag: 'betaald bedrag' }

export function StatusChip({ status, klein, betaald }: { status: Verzendstatus | string; klein?: boolean; betaald?: boolean }) {
  const s = VERZENDSTATUS[status as Verzendstatus] ?? VERZENDSTATUS.te_versturen
  // Een betaalde factuur mag nergens nog als "enkel verstuurd" ogen.
  const label = betaald && s.key === 'verstuurd' ? 'Verstuurd & betaald' : s.label
  // Zelfde kleuren als de facturenlijst: betaald = donkergroen.
  const cls = betaald && s.key === 'verstuurd' ? 'bg-emerald-700 text-white border-emerald-800' : s.cls
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 ${klein ? 'py-0 text-[10px]' : 'py-0.5 text-[11px]'} font-medium whitespace-nowrap ${cls}`}><span className={`h-1.5 w-1.5 rounded-full ${betaald && s.key === 'verstuurd' ? 'bg-white' : s.stip}`} />{label}</span>
}
export function BetaalChip({ status, klein }: { status: Betaalstatus | null; klein?: boolean }) {
  if (!status) return <span className="text-[11px] text-gray-400">—</span>
  const s = BETAALSTATUS[status]
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 ${klein ? 'py-0 text-[10px]' : 'py-0.5 text-[11px]'} font-medium whitespace-nowrap ${s.cls}`}><span className={`h-1.5 w-1.5 rounded-full ${s.stip}`} />{s.label}</span>
}

/** Factuurregels bewerken: toevoegen, aanpassen, dupliceren, verwijderen, van volgorde wisselen — met live totalen. */
export function RegelsEditor({ regels, onChange, btw, alleenLezen }: { regels: FactuurRegel[]; onChange: (r: FactuurRegel[]) => void; btw: number; alleenLezen?: boolean }) {
  const t = berekenTotalen(regels)
  const zet = (i: number, deel: Partial<FactuurRegel>) => onChange(regels.map((r, j) => (j === i ? { ...r, ...deel } : r)))
  const cel = 'w-full px-2 py-1 text-xs border border-gray-200 rounded-md bg-white disabled:bg-gray-50 disabled:text-gray-500'
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs min-w-[860px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-gray-500">
              <th className="px-1 py-1 text-left w-8">#</th><th className="px-1 py-1 text-left">Artikel</th><th className="px-1 py-1 text-left">Omschrijving</th>
              <th className="px-1 py-1 text-right w-16">Aantal</th><th className="px-1 py-1 text-left w-20">Eenheid</th><th className="px-1 py-1 text-right w-24">Prijs excl.</th>
              <th className="px-1 py-1 text-right w-14">Btw %</th><th className="px-1 py-1 text-right w-16">Korting %</th>
              <th className="px-1 py-1 text-right w-24">Excl.</th><th className="px-1 py-1 text-right w-20">Btw</th><th className="px-1 py-1 text-right w-24">Incl.</th><th className="px-1 py-1 w-28" />
            </tr>
          </thead>
          <tbody>
            {regels.map((r, i) => {
              const b = berekenRegel(r)
              return (
                <tr key={`${r.id ?? 'n'}-${i}`} className="border-t border-gray-100">
                  <td className="px-1 py-1 text-gray-400">{r.volgnr}</td>
                  <td className="px-1 py-1"><input className={cel} value={r.artikel} disabled={alleenLezen} onChange={(e) => zet(i, { artikel: e.target.value })} placeholder="Bv. Social media beheer" /></td>
                  <td className="px-1 py-1"><input className={cel} value={r.omschrijving} disabled={alleenLezen} onChange={(e) => zet(i, { omschrijving: e.target.value })} placeholder="Omschrijving op de factuur" /></td>
                  <td className="px-1 py-1"><GetalInvoer className={`${cel} text-right`} waarde={r.aantal} min={0} disabled={alleenLezen} onWaarde={(n) => zet(i, { aantal: n })} /></td>
                  <td className="px-1 py-1"><select className={cel} value={r.eenheid} disabled={alleenLezen} onChange={(e) => zet(i, { eenheid: e.target.value })}>{[...EENHEDEN, ...(EENHEDEN.includes(r.eenheid as typeof EENHEDEN[number]) ? [] : [r.eenheid])].map((u) => <option key={u} value={u}>{u}</option>)}</select></td>
                  <td className="px-1 py-1"><GetalInvoer className={`${cel} text-right`} waarde={r.prijs_excl} disabled={alleenLezen} onWaarde={(n) => zet(i, { prijs_excl: n })} /></td>
                  <td className="px-1 py-1"><GetalInvoer className={`${cel} text-right`} waarde={r.btw_pct} leeg={btw} min={0} max={100} disabled={alleenLezen} onWaarde={(n) => zet(i, { btw_pct: n })} /></td>
                  <td className="px-1 py-1"><GetalInvoer className={`${cel} text-right`} waarde={r.korting_pct} min={0} max={100} disabled={alleenLezen} onWaarde={(n) => zet(i, { korting_pct: n })} /></td>
                  <td className="px-1 py-1 text-right tabular-nums">{formatEuro(b.excl)}</td>
                  <td className="px-1 py-1 text-right tabular-nums text-gray-500">{formatEuro(b.btw)}</td>
                  <td className="px-1 py-1 text-right tabular-nums font-medium">{formatEuro(b.incl)}</td>
                  <td className="px-1 py-1">
                    {!alleenLezen && (
                      <div className="flex items-center justify-end gap-0.5">
                        <button type="button" onClick={() => onChange(verplaatsRegel(regels, i, i - 1))} disabled={i === 0} className="h-6 w-6 rounded hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center" title="Omhoog"><ArrowUp className="h-3 w-3" /></button>
                        <button type="button" onClick={() => onChange(verplaatsRegel(regels, i, i + 1))} disabled={i === regels.length - 1} className="h-6 w-6 rounded hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center" title="Omlaag"><ArrowDown className="h-3 w-3" /></button>
                        <button type="button" onClick={() => onChange(dupliceerRegel(regels, i))} className="h-6 w-6 rounded hover:bg-gray-100 flex items-center justify-center" title="Dupliceren"><Copy className="h-3 w-3" /></button>
                        <button type="button" onClick={() => onChange(verwijderRegel(regels, i))} className="h-6 w-6 rounded hover:bg-red-50 text-red-500 flex items-center justify-center" title="Verwijderen"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
            {regels.length === 0 && <tr><td colSpan={12} className="px-2 py-4 text-center text-gray-400">Nog geen factuurregels.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        {!alleenLezen && (
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => onChange(hernummer([...regels, nieuweRegel({}, btw)]))} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Factuurregel toevoegen</button>
            <span className="text-[11px] text-gray-400 self-center">Ook wat je doorrekent (kilometers, huur, drukwerk) is gewoon een regel.</span>
          </div>
        )}
        <div className="ml-auto text-xs text-right space-y-0.5 tabular-nums">
          {t.perBtw.map((p) => <div key={p.pct} className="text-gray-500">Btw {p.pct.toLocaleString('nl-BE')} %: {formatEuro(p.btw)}</div>)}
          <div className="text-sm">Totaal te factureren: <b>{formatEuro(t.excl)}</b> excl. · <b>{formatEuro(t.incl)}</b> incl.</div>
        </div>
      </div>
    </div>
  )
}

export function FactuurEditor({ invoiceId, standaard, onClose, onSaved }: EditorProps) {
  /**
   * Zodra een nieuwe factuur bewaard is, werkt dit venster verder met haar id:
   * zo kun je meteen interne kosten loggen (onderaanneming, freelancers,
   * materiaal) zonder de factuur opnieuw te moeten opzoeken.
   */
  const [id, setId] = useState<string | null>(invoiceId ?? null)
  useEffect(() => { setId(invoiceId ?? null) }, [invoiceId])
  const nieuw = !id
  const [klanten, setKlanten] = useState<Klant[]>([])
  const [contracten, setContracten] = useState<ContractOptie[]>([])
  const [factuur, setFactuur] = useState<Factuur | null>(null)
  const [wijzigingen, setWijzigingen] = useState<Wijziging[]>([])
  const [laden, setLaden] = useState(!nieuw)
  const [bezig, setBezig] = useState<string | null>(null)
  const [vraag, setVraag] = useState<{ naar: Verzendstatus } | null>(null)
  const [reden, setReden] = useState('')
  const [betaling, setBetaling] = useState<{ bedrag: string; op: string } | null>(null)
  const [vraagVerwijder, setVraagVerwijder] = useState(false)
  // Interne kosten (onderaanneming, materiaal, …): enkel voor ons, nooit voor de klant.
  const [kosten, setKosten] = useState(false)
  // Opgehoogd na elke kostenwijziging, zodat de samenvatting opnieuw laadt.
  const [kostenVersie, setKostenVersie] = useState(0)
  const [toonHistoriek, setToonHistoriek] = useState(false)
  const [verzendDatum, setVerzendDatum] = useState('')

  const [kop, setKop] = useState({
    invoice_date: standaard?.invoice_date ?? new Date().toISOString().slice(0, 10), due_date: '', payment_term_days: '30', periode: '',
    client_id: standaard?.client_id ?? '', contract_id: standaard?.contract_id ?? '', description: standaard?.description ?? '', reference: '', currency: 'EUR', note: '', vat_pct: String(DEFAULT_VAT), verantwoordelijke: '',
  })
  // Enkel bij een nieuwe factuur: eenmalig of maandelijks doorlopend (terugkerende definitie).
  const [herhaling, setHerhaling] = useState<'eenmalig' | 'maandelijks'>('eenmalig')
  const [regels, setRegels] = useState<FactuurRegel[]>(() => (nieuw ? [nieuweRegel({ artikel: standaard?.description ?? '', omschrijving: standaard?.description ?? '' })] : []))
  const [origineel, setOrigineel] = useState<string>('')

  const laad = useCallback(async () => {
    try {
      const [k, f] = await Promise.all([
        fetch('/api/admin/invoices/keuzes', { cache: 'no-store' }).then((r) => r.json()),
        id ? fetch(`/api/admin/invoices/${id}`, { cache: 'no-store' }).then((r) => r.json()) : Promise.resolve(null),
      ])
      setKlanten(k.klanten ?? []); setContracten(k.contracten ?? [])
      if (f) {
        if (f.error) throw new Error(f.error)
        const inv = f.factuur as Factuur
        setFactuur(inv); setWijzigingen(f.wijzigingen ?? [])
        const k2 = { invoice_date: dag(inv.invoice_date), due_date: dag(inv.due_date), payment_term_days: inv.payment_term_days === null || inv.payment_term_days === undefined ? '' : String(inv.payment_term_days), periode: inv.periode ?? '', client_id: inv.client_id ?? '', contract_id: inv.contract_id ?? '', description: inv.description ?? '', reference: inv.reference ?? '', currency: inv.currency ?? 'EUR', note: inv.note ?? '', vat_pct: String(inv.vat_pct ?? DEFAULT_VAT), verantwoordelijke: inv.verantwoordelijke ?? '' }
        setKop(k2); setRegels(f.regels ?? []); setOrigineel(JSON.stringify({ k: k2, r: f.regels ?? [], v: dag(inv.sent_at) })); setVerzendDatum(dag(inv.sent_at))
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [id])
  useEffect(() => { laad() }, [laad])

  const btw = getal(kop.vat_pct, DEFAULT_VAT)
  const totalen = useMemo(() => berekenTotalen(regels), [regels])
  const vuil = nieuw || JSON.stringify({ k: kop, r: regels, v: verzendDatum }) !== origineel
  const magInhoud = nieuw || (factuur?.magInhoud ?? false)
  const status: Verzendstatus = factuur?.verzendstatus ? (factuur.verzendstatus === 'gecrediteerd' ? 'geannuleerd' : normaliseerVerzendstatus(factuur.verzendstatus)) : 'te_versturen'
  const contractOpties = useMemo(() => contracten.filter((c) => !kop.client_id || !c.client_id || c.client_id === kop.client_id), [contracten, kop.client_id])
  const ontbreekt: string[] = []
  if (!kop.client_id) ontbreekt.push('klant')
  if (!kop.invoice_date) ontbreekt.push('factuurdatum')
  if (regels.length === 0 || totalen.excl <= 0) ontbreekt.push('minstens één regel met een bedrag')

  const zetTermijn = (t: string) => setKop((k) => ({ ...k, payment_term_days: t, due_date: t && k.invoice_date ? plusDagen(k.invoice_date, Math.max(0, Math.round(getal(t, 30)))) : k.due_date }))

  const bewaar = async () => {
    if (ontbreekt.length) { toast.error(`Vul eerst in: ${ontbreekt.join(', ')}.`); return }
    setBezig('opslaan')
    try {
      const body = { ...kop, client_id: kop.client_id || null, contract_id: kop.contract_id || null, payment_term_days: kop.payment_term_days === '' ? null : getal(kop.payment_term_days, 30), regels }
      const r = nieuw
        ? (herhaling === 'maandelijks'
          ? await fetch('/api/admin/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'recurring', client_id: body.client_id, contract_id: body.contract_id, start_month: kop.invoice_date.slice(0, 7), end_month: null, description: kop.description, amount_excl: totalen.excl, vat_pct: btw, invoice_day: factuurdagVan(kop.invoice_date), verantwoordelijke: kop.verantwoordelijke, payment_term_days: body.payment_term_days, lines: regels.map((x) => ({ omschrijving: x.omschrijving || x.artikel, aantal: x.aantal, prijs_excl: x.prijs_excl, classificatie: x.classificatie })) }) })
          : await fetch('/api/admin/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'aanmaken', ...body }) }))
        : await fetch(`/api/admin/invoices/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...(status === 'verstuurd' && verzendDatum ? { sent_at: verzendDatum } : {}) }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(nieuw ? (herhaling === 'maandelijks' ? 'Maandelijkse facturatie aangemaakt — elke maand verschijnt ze in de lijst en de planner.' : 'Factuur aangemaakt — staat in Facturen, in de planner en op het contract.') : 'Factuur opgeslagen.')
      onSaved?.(nieuw ? j.id : id!)
      if (nieuw) {
        // Maandelijkse facturatie heeft geen enkele factuur om kosten op te hangen.
        if (herhaling === 'maandelijks' || !j.id) { onClose(); return null }
        setId(String(j.id))
        return String(j.id)
      }
      await laad()
      return id
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt'); return null } finally { setBezig(null) }
  }

  /** "Kosten loggen" op een nieuwe factuur: eerst bewaren, dan het kostenvenster. */
  const bewaarEnKosten = async () => {
    const nieuwId = await bewaar()
    if (nieuwId) setKosten(true)
  }

  const zetStatus = async (naar: Verzendstatus, redenTekst?: string) => {
    if (!id) return
    setBezig(naar)
    try {
      const r = await fetch(`/api/admin/invoices/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', status: naar, reden: redenTekst }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success({ verstuurd: 'Gemarkeerd als verstuurd.', te_versturen: 'Terug op te factureren.', geannuleerd: 'Factuur geannuleerd.', gecrediteerd: 'Factuur gecrediteerd.' }[naar])
      setVraag(null); setReden('')
      onSaved?.(id); await laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const verwijder = async () => {
    if (!id) return
    setBezig('verwijderen')
    try {
      const r = await fetch(`/api/admin/invoices/${id}`, { method: 'DELETE' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Factuur verwijderd.')
      setVraagVerwijder(false)
      onSaved?.(id)
      onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBezig(null) }
  }

  const bewaarBetaling = async (betaalstatus?: Betaalstatus) => {
    if (!id) return
    setBezig('betaling')
    try {
      const r = await fetch(`/api/admin/invoices/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'betaling', betaalstatus, betaald_bedrag: betaling?.bedrag, betaald_op: betaling?.op || null }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Betaalstatus bijgewerkt.'); setBetaling(null)
      onSaved?.(id); await laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const klantNaam = klanten.find((k) => k.id === kop.client_id)?.naam ?? factuur?.klant_naam ?? '—'
  const contractTitel = contracten.find((c) => c.id === kop.contract_id)?.titel ?? factuur?.contract_titel ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-6 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-white sm:rounded-2xl shadow-xl w-full max-w-5xl h-dvh sm:h-auto max-h-dvh sm:max-h-[94dvh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-gray-400">{nieuw ? 'Nieuwe factuur' : `Factuur F-${id!.slice(0, 8).toUpperCase()}`}</div>
            <h3 className="font-semibold text-gray-900 truncate">{klantNaam}{contractTitel ? ` · ${contractTitel}` : ''}</h3>
            {!nieuw && factuur && (
              <div className="flex items-center gap-2 mt-1 flex-wrap text-xs text-gray-500">
                <StatusChip status={status} betaald={factuur.betaalstatus_afgeleid === 'betaald'} /><BetaalChip status={factuur.betaalstatus_afgeleid} />
                {factuur.sent_at && <span>verstuurd op {dag(factuur.sent_at).split('-').reverse().join('/')}{factuur.sent_by_email ? ` door ${factuur.sent_by_email.split('@')[0]}` : ''}</span>}
                {factuur.status_reden && <span className="text-red-700">reden: {factuur.status_reden}</span>}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!nieuw && factuur?.contract_id && <Link href={`/admin/contracts/${factuur.contract_id}`} className="btn-secondary text-xs"><ExternalLink className="h-3.5 w-3.5" />Contract</Link>}
            <button type="button" onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {laden ? <div className="py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : (
            <>
              {false && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900 flex gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>Deze factuur is {VERZENDSTATUS[status].label.toLowerCase()}.</div>
                </div>
              )}
              {!nieuw && status === 'verstuurd' && <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">Deze factuur is al verstuurd. Je kunt alles nog aanpassen; vergeet niet dezelfde wijziging in de boekhouding door te voeren. Elke wijziging komt in de historiek.</div>}
              {ontbreekt.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Nog in te vullen: {ontbreekt.join(', ')}.</div>}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Geplande factuurdatum</label><input type="date" className={INP} value={kop.invoice_date} onChange={(e) => setKop((k) => ({ ...k, invoice_date: e.target.value, due_date: k.payment_term_days && e.target.value ? plusDagen(e.target.value, Math.max(0, Math.round(getal(k.payment_term_days, 30)))) : k.due_date }))} /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Betaaltermijn (dagen)</label><input className={INP} inputMode="numeric" value={kop.payment_term_days} onChange={(e) => zetTermijn(e.target.value)} placeholder="30" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Vervaldatum</label><input type="date" className={INP} value={kop.due_date} onChange={(e) => setKop((k) => ({ ...k, due_date: e.target.value }))} /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Factuurperiode</label><input className={INP} value={kop.periode} onChange={(e) => setKop((k) => ({ ...k, periode: e.target.value }))} placeholder="bv. 2026-09 of Q4 2026" /></div>
                <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">Klant</label>
                  <select className={INP} value={kop.client_id} onChange={(e) => setKop((k) => ({ ...k, client_id: e.target.value }))}><option value="">— Kies klant —</option>{klanten.map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}</select>
                </div>
                <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">Contract of project <span className="text-gray-400">— optioneel</span></label>
                  <select className={INP} value={kop.contract_id} onChange={(e) => setKop((k) => ({ ...k, contract_id: e.target.value }))}><option value="">— Losse factuur, geen contract —</option>{contractOpties.map((c) => <option key={c.id} value={c.id}>{c.titel} · {c.label}</option>)}</select>
                </div>
                <div className="col-span-2"><label className="block text-xs font-medium text-gray-600 mb-1">Omschrijving</label><input className={INP} value={kop.description} onChange={(e) => setKop((k) => ({ ...k, description: e.target.value }))} placeholder="Wat staat er bovenaan de factuur?" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Referentie</label><input className={INP} value={kop.reference} onChange={(e) => setKop((k) => ({ ...k, reference: e.target.value }))} placeholder="PO-nummer, kenmerk klant" /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Verantwoordelijke</label><input className={INP} list="ngm-verantwoordelijken" value={kop.verantwoordelijke} onChange={(e) => setKop((k) => ({ ...k, verantwoordelijke: e.target.value }))} placeholder="Bv. Bram Reinquin" /><datalist id="ngm-verantwoordelijken"><option value="Bram Reinquin" /><option value="Marco Castermans" /></datalist></div>
                {nieuw && (
                  <div><label className="block text-xs font-medium text-gray-600 mb-1">Herhaling</label>
                    <select className={INP} value={herhaling} onChange={(e) => setHerhaling(e.target.value as 'eenmalig' | 'maandelijks')}><option value="eenmalig">Eenmalig</option><option value="maandelijks">Maandelijks, doorlopend</option></select>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-xs font-medium text-gray-600 mb-1">Valuta</label><input className={INP} value={kop.currency} onChange={(e) => setKop((k) => ({ ...k, currency: e.target.value.toUpperCase().slice(0, 3) }))} /></div>
                  <div><label className="block text-xs font-medium text-gray-600 mb-1">Std. btw %</label><input className={INP} inputMode="decimal" value={kop.vat_pct} onChange={(e) => setKop((k) => ({ ...k, vat_pct: e.target.value }))} /></div>
                </div>
              </div>

              <div>
                <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Factuurregels</div>
                <RegelsEditor regels={regels} onChange={setRegels} btw={btw} alleenLezen={false} />
              </div>

              <div><label className="block text-xs font-medium text-gray-600 mb-1">Interne notitie <span className="text-gray-400">— niet voor de klant</span></label><textarea rows={2} className={INP} value={kop.note} onChange={(e) => setKop((k) => ({ ...k, note: e.target.value }))} /></div>

              {!nieuw && id && <KostenSamenvatting invoiceId={id} versie={kostenVersie} onOpen={() => setKosten(true)} />}

              {!nieuw && factuur && (
                <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                  <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Status</div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-500 mb-1">Status</label>
                      <select className={`${INP} w-48`} value={status} disabled={!!bezig} onChange={(e) => { const naar = e.target.value as Verzendstatus; if (naar === status) return; if (vuil) { toast.error('Sla eerst je wijzigingen op.'); return } if (redenVerplicht(naar)) setVraag({ naar }); else zetStatus(naar) }}>
                        {KIESBARE_STATUSSEN.map((k) => <option key={k} value={k}>{VERZENDSTATUS[k].label}</option>)}
                      </select>
                    </div>
                    {status === 'verstuurd' && (
                      <div>
                        <label className="block text-[11px] text-gray-500 mb-1">Werkelijke verzenddatum</label>
                        <input type="date" className={`${INP} w-44`} value={verzendDatum} onChange={(e) => setVerzendDatum(e.target.value)} />
                      </div>
                    )}
                    {bezig && bezig !== 'opslaan' && <Loader2 className="h-4 w-4 animate-spin text-gray-400 mb-2.5" />}
                  </div>
                  {status === 'verstuurd' && factuur.sent_by_email && <p className="text-[11px] text-gray-500">Als verstuurd gemarkeerd door {factuur.sent_by_email.split('@')[0]}. Verwacht binnen = verzenddatum + betaaltermijn.</p>}
                  {status === 'verstuurd' && (
                    <div className="pt-2 border-t border-gray-100 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <Wallet className="h-3.5 w-3.5 text-gray-400" /><span className="text-gray-600">Betaling:</span><BetaalChip status={factuur.betaalstatus_afgeleid} />
                        <span className="text-gray-500">{formatEuro(factuur.betaald_bedrag)} van {formatEuro(factuur.amount_incl)} ontvangen{factuur.betaald_op ? ` · op ${dag(factuur.betaald_op).split('-').reverse().join('/')}` : ''}</span>
                      </div>
                      {betaling ? (
                        <div className="flex items-end gap-2 flex-wrap">
                          <div><label className="block text-[11px] text-gray-500 mb-1">Ontvangen bedrag (incl. btw)</label><input className={`${INP} w-40`} inputMode="decimal" value={betaling.bedrag} onChange={(e) => setBetaling({ ...betaling, bedrag: e.target.value })} /></div>
                          <div><label className="block text-[11px] text-gray-500 mb-1">Ontvangen op</label><input type="date" className={`${INP} w-44`} value={betaling.op} onChange={(e) => setBetaling({ ...betaling, op: e.target.value })} /></div>
                          <button type="button" disabled={!!bezig} onClick={() => bewaarBetaling()} className="btn-primary text-xs">Opslaan</button>
                          <button type="button" onClick={() => setBetaling(null)} className="btn-secondary text-xs">Annuleren</button>
                        </div>
                      ) : (
                        <div className="flex gap-2 flex-wrap">
                          <button type="button" disabled={!!bezig} onClick={() => bewaarBetaling('betaald')} className="btn-secondary text-xs">Volledig betaald</button>
                          <button type="button" disabled={!!bezig} onClick={() => setBetaling({ bedrag: String(factuur.betaald_bedrag || ''), op: dag(factuur.betaald_op) || new Date().toISOString().slice(0, 10) })} className="btn-secondary text-xs">Gedeeltelijk betaald…</button>
                          {factuur.betaald_bedrag > 0 && <button type="button" disabled={!!bezig} onClick={() => bewaarBetaling('niet_betaald')} className="btn-secondary text-xs">Betaling terugzetten</button>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!nieuw && (
                <div>
                  <button type="button" onClick={() => setToonHistoriek((v) => !v)} className="text-xs text-gray-600 inline-flex items-center gap-1.5 hover:text-black"><History className="h-3.5 w-3.5" />Wijzigingshistoriek ({wijzigingen.length}){toonHistoriek ? ' ▲' : ' ▼'}</button>
                  {toonHistoriek && (
                    <ul className="mt-2 divide-y divide-gray-50 text-xs max-h-56 overflow-y-auto rounded-lg border border-gray-100">
                      {wijzigingen.length === 0 && <li className="px-3 py-2 text-gray-400">Nog geen wijzigingen geregistreerd.</li>}
                      {wijzigingen.map((w) => (
                        <li key={w.id} className="px-3 py-1.5 flex flex-wrap gap-x-2">
                          <span className="text-gray-400 tabular-nums">{new Date(w.created_at).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                          <span className="font-medium">{ACTIE_LABEL[w.actie] ?? w.actie}</span>
                          {w.veld && <span className="text-gray-600">{VELD_LABEL[w.veld] ?? w.veld}: <s className="text-gray-400">{w.oud || '—'}</s> → {w.nieuw || '—'}</span>}
                          {!w.veld && w.nieuw && <span className="text-gray-600">{w.nieuw}</span>}
                          {w.reden && <span className="text-gray-500">({w.reden})</span>}
                          {w.actor_email && <span className="text-gray-400 ml-auto">{w.actor_email.split('@')[0]}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2 flex-wrap bg-gray-50/60">
          <div className="text-xs text-gray-600 mr-auto tabular-nums">Totaal: <b>{formatEuro(totalen.excl)}</b> excl. · <b>{formatEuro(totalen.incl)}</b> incl. btw{totalen.extra.excl > 0 && <> · waarvan {formatEuro(totalen.extra.excl)} extra kosten</>}</div>
          {!nieuw && (
            <button type="button" onClick={() => setVraagVerwijder(true)} disabled={!!bezig} className="btn-secondary text-sm text-red-600 hover:border-red-300" title="De factuur definitief verwijderen">
              <Trash2 className="h-4 w-4" />Verwijderen
            </button>
          )}
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Sluiten</button>
          {nieuw && herhaling !== 'maandelijks' && (
            <button type="button" onClick={bewaarEnKosten} disabled={!!bezig} className="btn-secondary text-sm" title="Bewaart de factuur en opent meteen de interne kosten (onderaanneming, materiaal…)">
              <Wallet className="h-4 w-4" />Aanmaken en kosten loggen
            </button>
          )}
          <button type="button" onClick={bewaar} disabled={!!bezig || (!nieuw && !vuil)} className="btn-primary text-sm">{bezig === 'opslaan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{nieuw ? (herhaling === 'maandelijks' ? 'Maandelijkse facturatie aanmaken' : 'Factuur aanmaken (te factureren)') : 'Opslaan'}</button>
        </div>
      </div>

      {kosten && id && (
        <KostenEnWinstDialoog
          factuur={{ invoice_id: id }}
          titel={`${klantNaam} · ${dag(factuur?.invoice_date ?? kop.invoice_date).split('-').reverse().join('/')} · ${formatEuro(factuur?.amount_excl ?? totalen.excl)} excl. btw${(factuur?.description ?? kop.description) ? ` · ${factuur?.description ?? kop.description}` : ''}`}
          clientId={factuur?.client_id ?? (kop.client_id || null)}
          onClose={() => setKosten(false)}
          onChanged={() => { onSaved?.(id!); setKostenVersie((v) => v + 1); laad() }}
        />
      )}
      {vraagVerwijder && factuur && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h4 className="font-semibold">Factuur definitief verwijderen</h4>
            <p className="text-sm text-gray-600">
              Je verwijdert <b>{factuur.reference ? `${factuur.reference} · ` : ''}{klantNaam}</b> van {dag(factuur.invoice_date).split('-').reverse().join('/')} ({formatEuro(factuur.amount_incl)} incl. btw).
              De factuurregels en de wijzigingshistoriek gaan mee. Dit kan niet ongedaan gemaakt worden.
            </p>
            <p className="text-xs text-gray-500">Wil je ze enkel uit de planning halen? Zet de status dan op <b>Geannuleerd</b>; de factuur blijft dan bestaan.</p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setVraagVerwijder(false)} className="btn-secondary text-sm" disabled={!!bezig}>Annuleren</button>
              <button type="button" onClick={verwijder} disabled={!!bezig} className="btn-primary text-sm bg-red-600 hover:bg-red-700 text-white border-red-600">
                {bezig === 'verwijderen' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Definitief verwijderen
              </button>
            </div>
          </div>
        </div>
      )}
      {vraag && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h4 className="font-semibold">{vraag.naar === 'gecrediteerd' ? 'Factuur crediteren' : 'Factuur annuleren'}</h4>
            <p className="text-sm text-gray-600">{vraag.naar === 'gecrediteerd' ? 'De factuur wordt als geheel gecrediteerd gemarkeerd en telt nergens meer mee als te ontvangen omzet.' : 'De factuur hoeft niet meer verstuurd te worden en telt niet meer mee als te versturen omzet.'} Geef een reden op; die komt in de historiek.</p>
            <textarea rows={3} className={INP} value={reden} onChange={(e) => setReden(e.target.value)} placeholder="Reden…" autoFocus />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setVraag(null); setReden('') }} className="btn-secondary text-sm">Terug</button>
              <button type="button" disabled={!!bezig || (redenVerplicht(vraag.naar) && !reden.trim())} onClick={() => zetStatus(vraag.naar, reden.trim())} className="btn-primary text-sm bg-red-600 hover:bg-red-700 text-white border-red-600">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{vraag.naar === 'gecrediteerd' ? 'Crediteren' : 'Annuleren'}</button>
            </div>
          </div>
        </div>
      )}
      {/* Bevestig wordt hergebruikt door andere schermen; hier niet nodig maar behouden voor consistente import. */}
      {false && <Bevestig titel="" tekst="" onBevestig={() => {}} onAnnuleer={() => {}} />}
    </div>
  )
}
