'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Crosshair, Download, ExternalLink, FileSignature, FileText, Loader2, Phone, Plus, Search, Trash2, Upload, UserPlus, CalendarClock, ArrowRight, X } from 'lucide-react'
import { ABM_KOLOMMEN, rijenUitTabel, leesCsv, voorbeeldCsv, type AbmBedrijf, type AbmRij, type AbmVeld } from '@/lib/abm'
import { PROJECT_VERANTWOORDELIJKEN } from '@/lib/opdrachten-kanban'
import { zoekVeld } from '@/lib/zoekveld'

type Bedrijf = AbmBedrijf & { klant_naam?: string | null }
const SLEUTEL = 'ngm-abm-open'

async function post<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j as T
}

/**
 * Account-based marketing: de bedrijven waar we gericht achter gaan, als
 * inklapbare kolom vooraan op het bord. Importeren uit csv of xlsx met een
 * vaste structuur. Vanaf een kaart: naar Opvolging, offerte opmaken, meeting
 * inplannen, contract of klantaccount (de klant wordt dan aangemaakt of de
 * bestaande gekoppeld).
 */
export function AbmKolom({ onVernieuw }: { onVernieuw: () => void }) {
  const [open, setOpen] = useState(false)
  const [lijst, setLijst] = useState<Bedrijf[] | null>(null)
  const [zoek, setZoek] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [venster, setVenster] = useState<Bedrijf | 'nieuw' | null>(null)

  useEffect(() => { try { setOpen(localStorage.getItem(SLEUTEL) === '1') } catch { /* standaard dicht */ } }, [])
  const zet = (v: boolean) => { setOpen(v); try { localStorage.setItem(SLEUTEL, v ? '1' : '0') } catch { /* niet erg */ } }

  const laad = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/abm', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      setLijst(j.bedrijven ?? [])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setLijst([]) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase()
    return (lijst ?? []).filter((b) => !q || `${b.naam} ${b.contactpersoon ?? ''} ${b.gemeente ?? ''} ${b.sector ?? ''}`.toLowerCase().includes(q))
  }, [lijst, zoek])

  if (!open) {
    return (
      <button type="button" onClick={() => zet(true)} title="Account-based marketing openen"
        className="shrink-0 w-11 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 flex flex-col items-center gap-2 py-3 max-h-[calc(100dvh-14rem)] min-h-[14rem]">
        <ChevronRight className="h-4 w-4 text-amber-800" />
        <Crosshair className="h-4 w-4 text-amber-800" />
        <span className="text-xs tabular-nums font-semibold text-amber-900">{lijst?.length ?? ''}</span>
        <span className="text-[12px] font-semibold text-amber-900 [writing-mode:vertical-rl] rotate-180 whitespace-nowrap">Account-based marketing</span>
      </button>
    )
  }

  return (
    <section className="shrink-0 w-[85vw] max-w-[19rem] sm:w-[17.5rem] snap-start rounded-xl flex flex-col max-h-[calc(100dvh-14rem)] min-h-[14rem] bg-amber-50 border border-amber-200">
      <header className="px-3 pt-2.5 pb-2 space-y-2" title="Bedrijven waar we gericht achter gaan">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Crosshair className="h-3.5 w-3.5 text-amber-800 shrink-0" />
            <span className="text-[13px] font-semibold text-gray-900 truncate">Account-based marketing</span>
            <span className="text-xs text-gray-500 tabular-nums">{lijst?.length ?? 0}</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" onClick={() => setImportOpen(true)} title="Importeren uit csv of Excel" aria-label="Importeren" className="h-6 w-6 rounded-md flex items-center justify-center text-gray-600 hover:bg-white hover:text-black"><Upload className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setVenster('nieuw')} title="Bedrijf toevoegen" aria-label="Bedrijf toevoegen" className="h-6 w-6 rounded-md flex items-center justify-center text-gray-600 hover:bg-white hover:text-black"><Plus className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => zet(false)} title="Inklappen" aria-label="Inklappen" className="h-6 w-6 rounded-md flex items-center justify-center text-gray-600 hover:bg-white hover:text-black"><ChevronLeft className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        {(lijst?.length ?? 0) > 6 && (
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input {...zoekVeld()} value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoeken" className="w-full pl-7 pr-2 py-1 text-xs rounded-md border border-amber-200 bg-white" />
          </div>
        )}
      </header>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
        {lijst === null && <div className="py-6 text-center text-gray-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>}
        {lijst && lijst.length === 0 && (
          <div className="text-xs text-center py-6 rounded-lg border border-dashed border-amber-300 text-amber-900 space-y-2 px-3">
            <p>Nog geen bedrijven. Importeer een lijst uit csv of Excel.</p>
            <button type="button" onClick={() => setImportOpen(true)} className="btn-secondary text-xs"><Upload className="h-3.5 w-3.5" />Importeren</button>
          </div>
        )}
        {zichtbaar.map((b) => (
          <article key={b.id} onClick={() => setVenster(b)} className="rounded-lg bg-white border border-gray-200 px-2.5 py-2 cursor-pointer hover:border-gray-400">
            <div className="text-[13px] font-semibold text-gray-900 truncate">{b.naam}</div>
            <div className="text-[11px] text-gray-500 truncate">{[b.contactpersoon, b.gemeente, b.sector].filter(Boolean).join(' · ') || '—'}</div>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              {b.client_id && <span className="text-[10px] rounded-full bg-green-50 text-green-800 border border-green-200 px-1.5">klant</span>}
              {b.opdracht_id && <span className="text-[10px] rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-1.5">in Opvolging</span>}
              {b.telefoon && <a href={`tel:${b.telefoon.replace(/\s/g, '')}`} onClick={(e) => e.stopPropagation()} className="text-[11px] text-gray-500 hover:text-black inline-flex items-center gap-0.5"><Phone className="h-3 w-3" />{b.telefoon}</a>}
            </div>
          </article>
        ))}
      </div>
      {importOpen && <ImportVenster onSluit={() => setImportOpen(false)} onKlaar={() => { setImportOpen(false); laad() }} />}
      {venster && <BedrijfVenster b={venster === 'nieuw' ? null : venster} onSluit={() => setVenster(null)} onVernieuw={() => { laad(); onVernieuw() }} />}
    </section>
  )
}

function Venster({ titel, onSluit, children }: { titel: string; onSluit: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" role="dialog" aria-modal="true" onClick={onSluit}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-2 p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Crosshair className="h-4 w-4" />{titel}</h3>
          <button type="button" onClick={onSluit} className="text-gray-400 hover:text-black" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

function ImportVenster({ onSluit, onKlaar }: { onSluit: () => void; onKlaar: () => void }) {
  const [rijen, setRijen] = useState<AbmRij[] | null>(null)
  const [info, setInfo] = useState<{ bestand: string; overgeslagen: number; herkend: AbmVeld[] } | null>(null)
  const [bezig, setBezig] = useState(false)
  const invoer = useRef<HTMLInputElement>(null)

  const kies = async (f: File | undefined) => {
    if (!f) return
    setBezig(true); setRijen(null)
    try {
      let tabel: string[][]
      if (/\.xlsx$/i.test(f.name)) { const { leesXlsx } = await import('@/lib/xlsx-lezen'); tabel = await leesXlsx(f) }
      else if (/\.(csv|txt)$/i.test(f.name)) tabel = leesCsv(await f.text())
      else throw new Error('Kies een .csv- of .xlsx-bestand. Een oud .xls-bestand? Bewaar het eerst als .xlsx of .csv.')
      const r = rijenUitTabel(tabel)
      if (!r.herkend.includes('naam')) throw new Error('Geen kolom met de bedrijfsnaam gevonden. Gebruik de kop "Bedrijfsnaam" (zie het voorbeeldbestand).')
      setRijen(r.rijen); setInfo({ bestand: f.name, overgeslagen: r.overgeslagen, herkend: r.herkend })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Lezen mislukt') } finally { setBezig(false) }
  }

  const importeer = async () => {
    if (!rijen?.length) return
    setBezig(true)
    try {
      const j = await post<{ toegevoegd: number; dubbel: number; ongeldig: number }>('/api/admin/abm', { actie: 'import', rijen })
      toast.success(`${j.toegevoegd} ${j.toegevoegd === 1 ? 'bedrijf' : 'bedrijven'} toegevoegd${j.dubbel ? `, ${j.dubbel} stond${j.dubbel === 1 ? '' : 'en'} er al in` : ''}.`)
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Importeren mislukt'); setBezig(false) }
  }

  const voorbeeld = () => {
    const url = URL.createObjectURL(new Blob([voorbeeldCsv()], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'account-based-marketing-voorbeeld.csv'; a.click(); URL.revokeObjectURL(url)
  }
  const kop = (v: AbmVeld) => ABM_KOLOMMEN.find((c) => c.veld === v)?.kop ?? v

  return (
    <Venster titel="Bedrijven importeren" onSluit={onSluit}>
      <p className="text-sm text-gray-600">Een csv- of Excel-bestand (.xlsx) met één bedrijf per rij. De eerste rij zijn de koppen. Enkel de bedrijfsnaam is verplicht.</p>
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700">
        <div className="font-medium mb-1">Kolommen</div>
        <div className="flex flex-wrap gap-1">{ABM_KOLOMMEN.map((c) => <span key={c.veld} className={`rounded-full px-2 py-0.5 border ${c.veld === 'naam' ? 'border-gray-900 font-semibold' : 'border-gray-200 bg-white'}`}>{c.kop}</span>)}</div>
        <button type="button" onClick={voorbeeld} className="mt-2 inline-flex items-center gap-1 underline underline-offset-2"><Download className="h-3.5 w-3.5" />Voorbeeldbestand downloaden</button>
      </div>
      <input ref={invoer} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={(e) => { kies(e.target.files?.[0]); e.target.value = '' }} />
      <button type="button" onClick={() => invoer.current?.click()} disabled={bezig} className="btn-secondary w-full justify-center">{bezig && !rijen ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}{info ? 'Ander bestand kiezen' : 'Bestand kiezen'}</button>
      {rijen && info && (
        <div className="space-y-2">
          <p className="text-sm text-gray-800"><b>{rijen.length}</b> {rijen.length === 1 ? 'bedrijf' : 'bedrijven'} in {info.bestand}{info.overgeslagen ? ` · ${info.overgeslagen} rij${info.overgeslagen === 1 ? '' : 'en'} zonder bedrijfsnaam overgeslagen` : ''}.</p>
          <p className="text-xs text-gray-500">Herkend: {info.herkend.map(kop).join(', ')}. Bedrijven die er al in staan (zelfde btw-nummer of naam) slaan we over.</p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500"><tr>{info.herkend.slice(0, 5).map((v) => <th key={v} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{kop(v)}</th>)}</tr></thead>
              <tbody>{rijen.slice(0, 5).map((r, i) => <tr key={i} className="border-t border-gray-100">{info.herkend.slice(0, 5).map((v) => <td key={v} className="px-2 py-1.5 whitespace-nowrap max-w-[10rem] truncate">{r[v] ?? ''}</td>)}</tr>)}</tbody>
            </table>
          </div>
          <button type="button" onClick={importeer} disabled={bezig || !rijen.length} className="btn-primary w-full justify-center">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{rijen.length} importeren</button>
        </div>
      )}
    </Venster>
  )
}

function BedrijfVenster({ b, onSluit, onVernieuw }: { b: Bedrijf | null; onSluit: () => void; onVernieuw: () => void }) {
  const router = useRouter()
  const [v, setV] = useState<Partial<Record<AbmVeld, string>>>(() => Object.fromEntries(ABM_KOLOMMEN.map((c) => [c.veld, (b?.[c.veld] as string | null | undefined) ?? ''])))
  const [bezig, setBezig] = useState<string | null>(null)
  const [wie, setWie] = useState<string>('')
  const [clientId, setClientId] = useState<string | null>(b?.client_id ?? null)
  const veranderd = !b || ABM_KOLOMMEN.some((c) => (v[c.veld] ?? '') !== ((b[c.veld] as string | null | undefined) ?? ''))

  const bewaar = async () => {
    setBezig('bewaar')
    try {
      await post('/api/admin/abm', b ? { actie: 'wijzig', id: b.id, ...v } : { actie: 'nieuw', ...v })
      toast.success(b ? 'Bewaard.' : 'Toegevoegd.'); onVernieuw(); if (!b) onSluit()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(null) }
  }

  /** Klant aanmaken of de bestaande koppelen; geeft de klant-id terug. */
  const klant = async (): Promise<string | null> => {
    if (!b) return null
    if (clientId) return clientId
    if (!window.confirm(`Hiervoor maken we ${b.naam} aan als klant (of koppelen we de bestaande klant). Verder?`)) return null
    const j = await post<{ client_id: string; bestond?: boolean }>('/api/admin/abm', { actie: 'klant', id: b.id })
    setClientId(j.client_id); onVernieuw()
    toast.success(j.bestond ? 'Bestaande klant gekoppeld.' : 'Klant aangemaakt.')
    return j.client_id
  }
  const ga = async (sleutel: string, url: (k: string) => string) => {
    if (veranderd && b) await bewaar()
    setBezig(sleutel)
    try { const k = await klant(); if (k) router.push(url(k)) } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const naarOpvolging = async () => {
    if (!b) return
    if (!wie) { toast.error('Kies wie het opvolgt.'); return }
    setBezig('opvolging')
    try {
      const j = await post<{ id?: string }>('/api/admin/opdrachten', {
        titel: b.naam, status: 'open', verantwoordelijke: wie, bron: 'outbound',
        ...(clientId ? { client_id: clientId } : { klant_vrij: b.naam, btw_nummer: b.btw_nummer ?? null }),
        notitie: ['Uit account-based marketing.', b.contactpersoon ? `Contact: ${b.contactpersoon}${b.functie ? ` (${b.functie})` : ''}` : null, b.telefoon ? `Tel: ${b.telefoon}` : null, b.email ? `Mail: ${b.email}` : null, b.website ? `Website: ${b.website}` : null, b.notitie].filter(Boolean).join('\n'),
      })
      if (j.id) await post('/api/admin/abm', { actie: 'opdracht', id: b.id, opdracht_id: j.id })
      toast.success(`${b.naam} staat in Opvolging.`); onVernieuw(); onSluit()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const verwijder = async () => {
    if (!b || !window.confirm(`${b.naam} uit account-based marketing halen?`)) return
    setBezig('weg')
    try { await post('/api/admin/abm', { actie: 'verwijder', id: b.id }); onVernieuw(); onSluit() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const inp = 'w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg'
  const Actie = ({ k, icoon: I, label, onClick }: { k: string; icoon: React.ElementType; label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} disabled={!!bezig} className="btn-secondary text-sm justify-start">{bezig === k ? <Loader2 className="h-4 w-4 animate-spin" /> : <I className="h-4 w-4" />}{label}</button>
  )

  return (
    <Venster titel={b ? b.naam : 'Bedrijf toevoegen'} onSluit={onSluit}>
      {b && (
        <section className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Actie k="offerte" icoon={FileText} label="Offerte opmaken" onClick={() => ga('offerte', (k) => `/admin/offertes/opmaken?client=${k}${b.opdracht_id ? `&opdracht=${b.opdracht_id}` : ''}`)} />
            <Actie k="meeting" icoon={CalendarClock} label="Meeting inplannen" onClick={() => ga('meeting', (k) => `/admin/meetings?plan=1&klant=${k}`)} />
            <Actie k="contract" icoon={FileSignature} label="Contract" onClick={() => ga('contract', (k) => `/admin/contracts/templates?client=${k}${b.opdracht_id ? `&opdracht=${b.opdracht_id}` : ''}`)} />
            <Actie k="account" icoon={UserPlus} label="Klantaccount" onClick={() => ga('account', (k) => `/admin/clients/${k}#klantaccount`)} />
          </div>
          {clientId && <a href={`/admin/clients/${clientId}`} className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1">Klantfiche{b.klant_naam ? `: ${b.klant_naam}` : ''}<ExternalLink className="h-3 w-3" /></a>}
          {!b.opdracht_id ? (
            <div className="rounded-lg border border-gray-200 p-2.5 flex items-center gap-2 flex-wrap">
              <select value={wie} onChange={(e) => setWie(e.target.value)} className="px-2 py-1.5 text-sm border border-gray-200 rounded-lg" aria-label="Wie volgt op?">
                <option value="">Wie volgt op?</option>
                {PROJECT_VERANTWOORDELIJKEN.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <button type="button" onClick={naarOpvolging} disabled={!!bezig} className="btn-primary text-sm flex-1 justify-center">{bezig === 'opvolging' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Naar Opvolging</button>
            </div>
          ) : <a href={`/admin/opdrachten?opdracht=${b.opdracht_id}`} className="text-xs text-gray-600 underline">Staat in Opvolging: kaart openen</a>}
        </section>
      )}
      <section className="grid grid-cols-2 gap-2">
        {ABM_KOLOMMEN.map((c) => (
          <label key={c.veld} className={`block text-xs text-gray-500 ${c.veld === 'notitie' || c.veld === 'naam' ? 'col-span-2' : ''}`}>{c.kop}{c.veld === 'naam' && <span className="text-red-600"> *</span>}
            {c.veld === 'notitie'
              ? <textarea rows={3} className={`${inp} mt-0.5`} value={v[c.veld] ?? ''} onChange={(e) => setV({ ...v, [c.veld]: e.target.value })} />
              : <input className={`${inp} mt-0.5`} value={v[c.veld] ?? ''} onChange={(e) => setV({ ...v, [c.veld]: e.target.value })} placeholder={`bv. ${c.voorbeeld}`} />}
          </label>
        ))}
      </section>
      {b?.website && <a href={b.website} target="_blank" rel="noreferrer" className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1">{b.website}<ExternalLink className="h-3 w-3" /></a>}
      <div className="flex gap-2">
        <button type="button" onClick={bewaar} disabled={!!bezig || !veranderd || !(v.naam ?? '').trim()} className="btn-primary flex-1 justify-center">{bezig === 'bewaar' && <Loader2 className="h-4 w-4 animate-spin" />}{b ? 'Bewaren' : 'Toevoegen'}</button>
        {b && <button type="button" onClick={verwijder} disabled={!!bezig} className="btn-secondary text-red-700" title="Weghalen"><Trash2 className="h-4 w-4" /></button>}
      </div>
    </Venster>
  )
}
