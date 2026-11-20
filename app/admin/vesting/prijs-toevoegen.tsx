'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import Link from 'next/link'
import { Loader2, X, Plus, Check, ExternalLink, Ban, ChevronDown, ChevronUp } from 'lucide-react'
import { formatEuro, formatDate } from '@/lib/utils'
import { leesGetal } from '@/lib/getal'
import { toerekeningsfactor } from '@/lib/vesting'
import { controleerSnel, snelNaarRij, snelTotaal, type KandidaatContract, type SnelInvoer } from '@/lib/vesting-snel'

type Klant = { id: string; naam: string; closer?: string | null; setter?: string | null }

const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15'
const LBL = 'block text-xs font-medium text-gray-600 mb-1'
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const isMarco = (s?: string | null) => !!s && s.trim().toLowerCase().startsWith('marco')

/**
 * Vesting, de korte weg: klant, prijs, datum en wie het binnenbracht. Uit een
 * getekend contract is alles al ingevuld; enkel nakijken en bewaren. De rest
 * (kosten, status, termijnen) kan nadien in het uitgebreide venster.
 */
export function PrijsToevoegen({ kandidaat, kandidaten, klanten, onClose, onBewaard, onUitgebreid }: {
  kandidaat: KandidaatContract | null
  kandidaten: KandidaatContract[]
  klanten: Klant[]
  onClose: () => void
  onBewaard: () => void
  onUitgebreid: () => void
}) {
  const vanContract = (c: KandidaatContract | null): Partial<SnelInvoer> & { prijsTekst?: string } => {
    if (!c) return {}
    const k = c.client_id ? klanten.find((x) => x.id === c.client_id) : undefined
    return {
      contract_id: c.id, titel: c.titel, client_id: c.client_id, klant: c.klant ?? k?.naam ?? '',
      ondertekend_op: c.signed_at ?? vandaag(), start_dienst: c.start_date,
      prijsTekst: c.waarde ? String(c.waarde).replace('.', ',') : '',
      ...(k?.setter ? { afspraak: isMarco(k.setter) } : {}),
      ...(k?.closer ? { closing: isMarco(k.closer) } : {}),
    }
  }
  const start = vanContract(kandidaat)
  const [f, setF] = useState({
    contract_id: start.contract_id ?? '', titel: start.titel ?? '', client_id: start.client_id ?? '', klant: start.klant ?? '',
    ondertekend_op: start.ondertekend_op ?? vandaag(), start_dienst: start.start_dienst ?? '',
    soort: 'eenmalig' as 'eenmalig' | 'maand', prijs: start.prijsTekst ?? '', maanden: '',
    afspraak: start.afspraak ?? false, closing: start.closing ?? false,
  })
  const [bezig, setBezig] = useState(false)
  const zet = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))

  const kiesContract = (id: string) => {
    const c = kandidaten.find((x) => x.id === id) ?? null
    const v = vanContract(c)
    setF((p) => ({
      ...p, contract_id: id, titel: v.titel ?? p.titel,
      ...(c ? { client_id: v.client_id ?? '', klant: v.klant ?? p.klant, ondertekend_op: v.ondertekend_op ?? p.ondertekend_op, start_dienst: v.start_dienst ?? '', prijs: v.prijsTekst || p.prijs, soort: 'eenmalig' as const } : {}),
      ...(v.afspraak !== undefined ? { afspraak: v.afspraak } : {}),
      ...(v.closing !== undefined ? { closing: v.closing } : {}),
    }))
  }
  const kiesKlant = (id: string) => {
    const k = klanten.find((x) => x.id === id)
    setF((p) => ({ ...p, client_id: id, klant: k?.naam ?? p.klant, ...(k?.setter ? { afspraak: isMarco(k.setter) } : {}), ...(k?.closer ? { closing: isMarco(k.closer) } : {}) }))
  }

  const invoer: SnelInvoer = {
    klant: f.klant, client_id: f.client_id || null, contract_id: f.contract_id || null, titel: f.titel,
    ondertekend_op: f.ondertekend_op, start_dienst: f.start_dienst || null,
    soort: f.soort, prijs: leesGetal(f.prijs), maanden: f.soort === 'maand' ? leesGetal(f.maanden) : null,
    afspraak: f.afspraak, closing: f.closing,
  }
  const totaal = snelTotaal(invoer)
  const factor = toerekeningsfactor({ appointment_door_marco: f.afspraak, closed_door_marco: f.closing })
  const fout = controleerSnel(invoer)
  const gekozen = kandidaten.find((x) => x.id === f.contract_id) ?? null

  const bewaar = async () => {
    if (fout) { toast.error(fout); return }
    setBezig(true)
    try {
      const r = await fetch('/api/admin/vesting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snelNaarRij(invoer)) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      toast.success(`${f.klant}: ${totaal !== null ? formatEuro(totaal) : 'prijs'} toegevoegd.`)
      onBewaard()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">Prijs toevoegen</h3>
          <button type="button" onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          {kandidaten.length > 0 && (
            <div>
              <label className={LBL}>Getekend contract</label>
              <select className={INP} value={f.contract_id} onChange={(e) => kiesContract(e.target.value)}>
                <option value="">— Zonder contract —</option>
                {kandidaten.map((c) => <option key={c.id} value={c.id}>{c.klant ? `${c.klant} · ` : ''}{c.titel}{c.signed_at ? ` (${formatDate(c.signed_at)})` : ''}</option>)}
              </select>
              {gekozen && <Link href={`/admin/contracts/${gekozen.id}`} target="_blank" className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-black">Contract bekijken<ExternalLink className="h-3 w-3" /></Link>}
            </div>
          )}
          {!f.contract_id && (
            <div>
              <label className={LBL}>Klant</label>
              <select className={INP} value={f.client_id} onChange={(e) => kiesKlant(e.target.value)}>
                <option value="">— Kies een klant —</option>
                {klanten.map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className={LBL}>Prijs (excl. btw)</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
                <input className={`${INP} pl-7 text-base font-semibold`} inputMode="decimal" value={f.prijs} onChange={(e) => zet('prijs', e.target.value)} placeholder="0" autoFocus={!f.prijs} />
              </div>
              <div className="inline-flex rounded-lg border border-gray-200 p-0.5 shrink-0">
                {(['eenmalig', 'maand'] as const).map((s) => (
                  <button key={s} type="button" onClick={() => zet('soort', s)} className={`px-2.5 rounded-md text-xs ${f.soort === s ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{s === 'eenmalig' ? 'totaal' : 'per maand'}</button>
                ))}
              </div>
            </div>
            {f.soort === 'maand' && (
              <div className="mt-2 flex items-center gap-2 text-sm">
                <input className={`${INP} w-20`} inputMode="numeric" value={f.maanden} onChange={(e) => zet('maanden', e.target.value.replace(/\D/g, ''))} placeholder="12" aria-label="Aantal maanden" />
                <span className="text-gray-600">maanden</span>
              </div>
            )}
          </div>

          <div>
            <label className={LBL}>Getekend op</label>
            <input className={INP} type="date" value={f.ondertekend_op} onChange={(e) => zet('ondertekend_op', e.target.value)} />
          </div>

          <div>
            <span className={LBL}>Wat deed Marco?</span>
            <div className="flex flex-wrap gap-2">
              {([['afspraak', 'Afspraak gezet'], ['closing', 'Gesloten']] as const).map(([k, l]) => (
                <button key={k} type="button" onClick={() => zet(k, !f[k])}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm ${f[k] ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                  {f[k] && <Check className="h-3.5 w-3.5" />}{l}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 text-sm flex items-center justify-between gap-3">
            <span className="text-gray-600">Telt mee voor Marco</span>
            <span className="font-semibold tabular-nums">{totaal === null ? '—' : `${formatEuro(totaal * factor)}`}<span className="text-xs font-normal text-gray-500"> · {Math.round(factor * 100)}%</span></span>
          </div>
          {factor === 0 && <p className="text-[11px] text-amber-800 -mt-2">Zonder afspraak of closing door Marco telt dit contract niet mee. Gebruik dan "Telt niet mee" in de lijst.</p>}
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <button type="button" onClick={onUitgebreid} className="text-xs text-gray-500 hover:text-black mr-auto">Uitgebreid invullen</button>
          <button type="button" onClick={onClose} className="btn-secondary">Annuleren</button>
          <button type="button" onClick={bewaar} disabled={bezig || !!fout} className="btn-primary" title={fout ?? undefined}>
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Toevoegen
          </button>
        </div>
      </div>
    </div>
  )
}

/** Getekende contracten die nog niet in Vesting staan: toevoegen of "telt niet mee". */
export function TeBeoordelen({ lijst, onToevoegen, onVerwerkt }: { lijst: KandidaatContract[]; onToevoegen: (c: KandidaatContract) => void; onVerwerkt: () => void }) {
  const [alles, setAlles] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)
  const zichtbaar = useMemo(() => (alles ? lijst : lijst.slice(0, 5)), [alles, lijst])
  if (!lijst.length) return null

  const teltNiet = async (c: KandidaatContract) => {
    setBezig(c.id)
    try {
      const r = await fetch('/api/admin/vesting/beoordeel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contract_id: c.id, actie: 'telt_niet' }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Mislukt')
      toast.success(`${c.klant ?? c.titel} telt niet mee.`, {
        action: { label: 'Ongedaan maken', onClick: async () => { await fetch('/api/admin/vesting/beoordeel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contract_id: c.id, actie: 'herstel' }) }); onVerwerkt() } },
      })
      onVerwerkt()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  return (
    <div className="card-base">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <h2 className="font-semibold flex items-center gap-2">Te beoordelen <span className="min-w-[1.5rem] text-center rounded-full bg-gray-900 text-white text-xs font-bold px-2 py-0.5">{lijst.length}</span></h2>
      </div>
      <p className="text-xs text-gray-500 mb-3">Getekende contracten uit Projecten die nog niet in Vesting staan. Telt het mee, voeg de prijs toe; was Marco niet betrokken, zet het op "Telt niet mee".</p>
      <ul className="divide-y divide-gray-100 -mx-1">
        {zichtbaar.map((c) => (
          <li key={c.id} className="flex items-center gap-3 px-1 py-2.5 flex-wrap sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{c.klant ?? '—'}</div>
              <div className="text-xs text-gray-500 truncate">{c.titel}{c.signed_at ? ` · getekend ${formatDate(c.signed_at)}` : ''}</div>
            </div>
            <div className="text-sm tabular-nums text-gray-700 shrink-0">{c.waarde ? formatEuro(c.waarde) : <span className="text-gray-400">geen prijs</span>}</div>
            <div className="flex gap-1.5 shrink-0">
              <button type="button" onClick={() => onToevoegen(c)} className="btn-primary text-xs h-8"><Plus className="h-3.5 w-3.5" />Toevoegen</button>
              <button type="button" onClick={() => teltNiet(c)} disabled={bezig === c.id} className="btn-secondary text-xs h-8" title="Marco was niet betrokken">
                {bezig === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}Telt niet mee
              </button>
            </div>
          </li>
        ))}
      </ul>
      {lijst.length > 5 && (
        <button type="button" onClick={() => setAlles((x) => !x)} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black">
          {alles ? <><ChevronUp className="h-3.5 w-3.5" />Minder tonen</> : <><ChevronDown className="h-3.5 w-3.5" />Alle {lijst.length} tonen</>}
        </button>
      )}
    </div>
  )
}
