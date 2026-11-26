'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Crosshair, Download, ExternalLink, FileSignature, FileText, Loader2, Phone, Plus, Search, Trash2, Upload, UserPlus, CalendarClock, ArrowRight, X, ThumbsDown, RotateCcw, Copy, Mail, User, StickyNote, Pencil } from 'lucide-react'
import { ABM_KOLOMMEN, UITKOMSTEN, rijenUitTabel, leesCsv, voorbeeldCsv, belNummers, netNummer, opvolgLabel, uitkomstLabel, type AbmBedrijf, type AbmNotitie, type AbmRij, type AbmUitkomst, type AbmVeld } from '@/lib/abm'
import { snelleDatums } from '@/lib/sales/lead-taken'
import { DicteerKnop } from '@/components/admin/dicteer-knop'
import { PROJECT_VERANTWOORDELIJKEN } from '@/lib/opdrachten-kanban'
import { zoekVeld } from '@/lib/zoekveld'
import { PersoonKnop } from '@/components/admin/persoon-foto'

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
  const [vuilbakOpen, setVuilbakOpen] = useState(false)

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

  // Geen interesse: uit de kolom, in het vuilbakje onderaan (terugzetten kan).
  const actief = useMemo(() => (lijst ?? []).filter((b) => !b.geen_interesse_op), [lijst])
  const vuilbak = useMemo(() => (lijst ?? []).filter((b) => !!b.geen_interesse_op).sort((a, b) => String(b.geen_interesse_op).localeCompare(String(a.geen_interesse_op))), [lijst])
  const [enkelOpvolgen, setEnkelOpvolgen] = useState(false)
  const vandaag = vandaagBE()
  // Wat vandaag (of eerder) opgevolgd moet worden staat bovenaan, oudste eerst; de rest blijft in volgorde.
  const teDoen = useMemo(() => actief.filter((b) => b.opvolgen_op && b.opvolgen_op <= vandaag), [actief, vandaag])
  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase()
    const l = (enkelOpvolgen ? actief.filter((b) => !!b.opvolgen_op) : actief).filter((b) => !q || `${b.naam} ${b.contactpersoon ?? ''} ${b.gemeente ?? ''} ${b.sector ?? ''} ${b.telefoon ?? ''}`.toLowerCase().includes(q))
    const dringend = (b: Bedrijf) => !!b.opvolgen_op && b.opvolgen_op <= vandaag
    return [...l].sort((a, b) => (dringend(a) === dringend(b) ? (dringend(a) || enkelOpvolgen ? String(a.opvolgen_op).localeCompare(String(b.opvolgen_op)) : 0) : dringend(a) ? -1 : 1))
  }, [actief, zoek, enkelOpvolgen, vandaag])

  const zetInteresse = async (b: Bedrijf, geen: boolean) => {
    const vorig = lijst
    setLijst((l) => (l ?? []).map((x) => (x.id === b.id ? { ...x, geen_interesse_op: geen ? new Date().toISOString() : null } : x)))
    try {
      await post('/api/admin/abm', { actie: geen ? 'geen_interesse' : 'terug', id: b.id })
      if (geen) toast.success(`${b.naam} staat bij Geen interesse.`, { action: { label: 'Ongedaan maken', onClick: () => { void zetInteresse(b, false) } } })
      else toast.success(`${b.naam} staat terug in de lijst.`)
      laad()
    } catch (e) { setLijst(vorig); toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => zet(true)} title="Account-based marketing openen"
        className="shrink-0 w-11 rounded-xl bg-amber-50 border border-amber-200 hover:bg-amber-100 flex flex-col items-center gap-2 py-3 max-h-[calc(100dvh-14rem)] min-h-[14rem]">
        <ChevronRight className="h-4 w-4 text-amber-800" />
        <Crosshair className="h-4 w-4 text-amber-800" />
        <span className="text-xs tabular-nums font-semibold text-amber-900">{lijst ? actief.length : ''}</span>
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
            <span className="text-xs text-gray-500 tabular-nums">{actief.length}</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" onClick={() => setImportOpen(true)} title="Importeren uit csv of Excel" aria-label="Importeren" className="h-6 w-6 rounded-md flex items-center justify-center text-gray-600 hover:bg-white hover:text-black"><Upload className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setVenster('nieuw')} title="Bedrijf toevoegen" aria-label="Bedrijf toevoegen" className="h-6 w-6 rounded-md flex items-center justify-center text-gray-600 hover:bg-white hover:text-black"><Plus className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => zet(false)} title="Inklappen" aria-label="Inklappen" className="h-6 w-6 rounded-md flex items-center justify-center text-gray-600 hover:bg-white hover:text-black"><ChevronLeft className="h-3.5 w-3.5" /></button>
          </div>
        </div>
        {actief.length > 6 && (
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
            <input {...zoekVeld()} value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoeken" className="w-full pl-7 pr-2 py-1 text-xs rounded-md border border-amber-200 bg-white" />
          </div>
        )}
        {actief.some((b) => b.opvolgen_op) && (
          <button type="button" onClick={() => setEnkelOpvolgen((x) => !x)} aria-pressed={enkelOpvolgen}
            className={`w-full rounded-md border px-2 py-1 text-xs inline-flex items-center gap-1.5 ${enkelOpvolgen ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-amber-200 text-gray-700 hover:border-amber-400'}`}>
            <CalendarClock className="h-3.5 w-3.5" />Enkel met opvolgdatum
            {teDoen.length > 0 && <span className={`ml-auto rounded-full px-1.5 text-[10px] font-semibold ${enkelOpvolgen ? 'bg-white text-gray-900' : 'bg-red-600 text-white'}`}>{teDoen.length} vandaag</span>}
          </button>
        )}
      </header>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
        {lijst === null && <div className="py-6 text-center text-gray-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>}
        {lijst && actief.length === 0 && (
          <div className="text-xs text-center py-6 rounded-lg border border-dashed border-amber-300 text-amber-900 space-y-2 px-3">
            <p>{vuilbak.length ? 'Geen bedrijven meer in de lijst.' : 'Nog geen bedrijven.'} Importeer een lijst uit csv of Excel.</p>
            <button type="button" onClick={() => setImportOpen(true)} className="btn-secondary text-xs"><Upload className="h-3.5 w-3.5" />Importeren</button>
          </div>
        )}
        {zichtbaar.map((b) => {
          const nr = belNummers(b.telefoon)
          const ov = opvolgLabel(b.opvolgen_op, vandaag)
          const ln = b.laatste_notitie
          return (
            <article key={b.id} onClick={() => setVenster(b)} className="rounded-lg bg-white border border-gray-200 px-2.5 py-2 cursor-pointer hover:border-gray-400">
              <div className="flex items-start gap-1.5">
                <div className="text-[13px] font-semibold text-gray-900 truncate flex-1">{b.naam}</div>
                {ov && <span className={`shrink-0 text-[10px] rounded-full border px-1.5 font-medium ${TOON[ov.toon]}`}>{ov.tekst.replace('Opvolgen ', '')}</span>}
              </div>
              <div className="text-[11px] text-gray-500 truncate">{[b.contactpersoon, b.gemeente, b.sector].filter(Boolean).join(' · ') || '—'}</div>
              {ln && (
                <div className="mt-1 text-[11px] text-gray-700 truncate flex items-center gap-1">
                  {ln.soort === 'gesprek' ? <Phone className="h-3 w-3 shrink-0 text-gray-400" /> : <StickyNote className="h-3 w-3 shrink-0 text-gray-400" />}
                  <span className="truncate">{[uitkomstLabel(ln.uitkomst), ln.tekst].filter(Boolean).join(': ')}</span>
                  <span className="shrink-0 text-gray-400">· {wanneer(ln.created_at).replace(/ \d{2}:\d{2}$/, '')}</span>
                </div>
              )}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                {b.client_id && <span className="text-[10px] rounded-full bg-green-50 text-green-800 border border-green-200 px-1.5">klant</span>}
                {b.opdracht_id && <span className="text-[10px] rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-1.5">in Opvolging</span>}
                {nr[0] && <a href={`tel:${nr[0].tel}`} onClick={(e) => e.stopPropagation()} title="Bellen" className="text-[11px] font-medium text-gray-800 hover:text-black inline-flex items-center gap-1 rounded-md border border-gray-200 px-1.5 py-0.5 hover:border-gray-400 tabular-nums"><Phone className="h-3 w-3" />{nr[0].weergave}{nr.length > 1 && <span className="text-gray-400">+{nr.length - 1}</span>}</a>}
                <button type="button" onClick={(e) => { e.stopPropagation(); void zetInteresse(b, true) }} title="Geen interesse: naar het vuilbakje"
                  className="ml-auto text-[10px] text-gray-400 hover:text-red-700 inline-flex items-center gap-0.5"><ThumbsDown className="h-3 w-3" />Geen interesse</button>
              </div>
            </article>
          )
        })}
      </div>
      <footer className="px-2 pb-2">
        <button type="button" onClick={() => setVuilbakOpen(true)} className="w-full rounded-lg border border-amber-200 bg-white/70 hover:bg-white px-2.5 py-1.5 text-xs text-gray-700 inline-flex items-center gap-1.5">
          <Trash2 className="h-3.5 w-3.5 text-gray-500" />Geen interesse<span className="ml-auto tabular-nums text-gray-500">{vuilbak.length}</span>
        </button>
      </footer>
      {vuilbakOpen && <VuilbakVenster lijst={vuilbak} onSluit={() => setVuilbakOpen(false)} onTerug={(b) => zetInteresse(b, false)} onOpen={(b) => { setVuilbakOpen(false); setVenster(b) }} />}
      {importOpen && <ImportVenster onSluit={() => setImportOpen(false)} onKlaar={() => { setImportOpen(false); laad() }} />}
      {venster && <BedrijfVenster b={venster === 'nieuw' ? null : venster} onSluit={() => setVenster(null)} onVernieuw={() => { laad(); onVernieuw() }}
        onInteresse={(b, geen) => { setVenster(null); void zetInteresse(b, geen) }} />}
    </section>
  )
}

function Venster({ titel, onSluit, children, breed = false }: { titel: string; onSluit: () => void; children: React.ReactNode; breed?: boolean }) {
  useEffect(() => {
    const toets = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    document.addEventListener('keydown', toets)
    return () => document.removeEventListener('keydown', toets)
  }, [onSluit])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/30" role="dialog" aria-modal="true" onClick={onSluit}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${breed ? 'max-w-xl' : 'max-w-lg'} max-h-[92dvh] overflow-y-auto`} onClick={(e) => e.stopPropagation()}>
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

const vandaagBE = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const wanneer = (iso: string) => {
  const d = new Date(iso)
  const dag = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  const uur = d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
  const v = vandaagBE()
  if (dag === v) return `vandaag ${uur}`
  const gisteren = new Date(Date.parse(`${v}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
  if (dag === gisteren) return `gisteren ${uur}`
  return `${d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' }).replace('.', '')} ${uur}`
}
const TOON: Record<'laat' | 'vandaag' | 'later', string> = {
  laat: 'bg-red-50 text-red-700 border-red-200',
  vandaag: 'bg-amber-50 text-amber-800 border-amber-200',
  later: 'bg-gray-50 text-gray-700 border-gray-200',
}

async function kopieer(tekst: string) {
  try { await navigator.clipboard.writeText(tekst); toast.success('Gekopieerd.') } catch { toast.error('Kopiëren lukte niet.') }
}

/** De gegevens van een bedrijf (nieuw, of onder "Gegevens aanpassen"). */
function Gegevens({ b, onBewaard }: { b: Bedrijf | null; onBewaard: () => void }) {
  const [v, setV] = useState<Partial<Record<AbmVeld, string>>>(() => Object.fromEntries(ABM_KOLOMMEN.map((c) => [c.veld, (b?.[c.veld] as string | null | undefined) ?? ''])))
  const [bezig, setBezig] = useState(false)
  const veranderd = !b || ABM_KOLOMMEN.some((c) => (v[c.veld] ?? '') !== ((b[c.veld] as string | null | undefined) ?? ''))
  const bewaar = async () => {
    setBezig(true)
    try {
      await post('/api/admin/abm', b ? { actie: 'wijzig', id: b.id, ...v } : { actie: 'nieuw', ...v })
      toast.success(b ? 'Bewaard.' : 'Toegevoegd.'); onBewaard()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const inp = 'input-base !py-1.5 text-sm mt-0.5'
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ABM_KOLOMMEN.map((c) => (
          <label key={c.veld} className={`block text-xs text-gray-500 ${c.veld === 'notitie' || c.veld === 'naam' ? 'sm:col-span-2' : ''}`}>{c.veld === 'notitie' ? 'Over dit bedrijf' : c.kop}{c.veld === 'naam' && <span className="text-red-600"> *</span>}
            {c.veld === 'notitie'
              ? <textarea rows={3} className={inp} value={v[c.veld] ?? ''} onChange={(e) => setV({ ...v, [c.veld]: e.target.value })} />
              : <input className={inp} value={v[c.veld] ?? ''} onChange={(e) => setV({ ...v, [c.veld]: e.target.value })} placeholder={`bv. ${c.voorbeeld}`} />}
          </label>
        ))}
      </div>
      <button type="button" onClick={bewaar} disabled={bezig || !veranderd || !(v.naam ?? '').trim()} className="btn-primary w-full justify-center">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{b ? 'Gegevens bewaren' : 'Toevoegen'}</button>
    </div>
  )
}

function BedrijfVenster({ b, onSluit, onVernieuw, onInteresse }: { b: Bedrijf | null; onSluit: () => void; onVernieuw: () => void; onInteresse: (b: Bedrijf, geen: boolean) => void }) {
  if (!b) return <Venster titel="Bedrijf toevoegen" onSluit={onSluit}><Gegevens b={null} onBewaard={() => { onVernieuw(); onSluit() }} /></Venster>
  return <BedrijfDetail b={b} onSluit={onSluit} onVernieuw={onVernieuw} onInteresse={onInteresse} />
}

/**
 * Eén bedrijf afgaan: bellen (tel:-link, op een Mac via de gekoppelde iPhone),
 * meteen noteren hoe het ging, een opvolgdatum zetten en de notities teruglezen.
 * Daaronder offerte, meeting, contract, klantaccount en Naar Opvolging.
 */
function BedrijfDetail({ b, onSluit, onVernieuw, onInteresse }: { b: Bedrijf; onSluit: () => void; onVernieuw: () => void; onInteresse: (b: Bedrijf, geen: boolean) => void }) {
  const router = useRouter()
  const [bezig, setBezig] = useState<string | null>(null)
  const [wie, setWie] = useState<string>('')
  const [clientId, setClientId] = useState<string | null>(b.client_id ?? null)
  const [notities, setNotities] = useState<AbmNotitie[] | null>(null)
  const [tekst, setTekst] = useState('')
  const [gesprek, setGesprek] = useState<{ weergave: string; tel: string } | null>(null)
  const [uitkomst, setUitkomst] = useState<AbmUitkomst | null>(null)
  const [opvolgen, setOpvolgen] = useState<string | null>(b.opvolgen_op ?? null)
  const [gegevensOpen, setGegevensOpen] = useState(false)
  const nummers = useMemo(() => belNummers(b.telefoon), [b.telefoon])
  const vandaag = vandaagBE()
  const snel = useMemo(() => [{ label: 'Vandaag', dag: vandaag }, ...snelleDatums(vandaag)], [vandaag])
  const notitieVak = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let weg = false
    fetch(`/api/admin/abm?notities=${b.id}`, { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (!weg) setNotities(j.notities ?? []) }).catch(() => { if (!weg) setNotities([]) })
    return () => { weg = true }
  }, [b.id])

  const sluit = () => {
    if (tekst.trim() && !window.confirm('Je notitie is nog niet bewaard. Toch sluiten?')) return
    onSluit()
  }

  const zetOpvolgen = async (dag: string | null) => {
    const vorig = opvolgen
    setOpvolgen(dag)
    try { await post('/api/admin/abm', { actie: 'opvolgen', id: b.id, opvolgen_op: dag }); onVernieuw() } catch (e) { setOpvolgen(vorig); toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  const bel = (n: { weergave: string; tel: string }) => {
    // De link opent het bellen zelf; hier zetten we enkel het notitieblok klaar voor na het gesprek.
    setGesprek(n)
    setTimeout(() => notitieVak.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50)
  }
  const kiesUitkomst = (u: AbmUitkomst) => {
    const nieuw = uitkomst === u ? null : u
    setUitkomst(nieuw)
    if (nieuw === 'terugbellen' && !opvolgen) void zetOpvolgen(snel[1]?.dag ?? vandaag)
  }

  const voegToe = async () => {
    if (!tekst.trim() && !uitkomst) return
    setBezig('notitie')
    try {
      const j = await post<{ notitie: AbmNotitie }>('/api/admin/abm', { actie: 'notitie', id: b.id, tekst, uitkomst, telefoon: gesprek?.tel ?? null })
      setNotities((l) => [j.notitie, ...(l ?? [])])
      setTekst(''); setUitkomst(null); setGesprek(null)
      onVernieuw()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(null) }
  }
  const haalWeg = async (n: AbmNotitie) => {
    if (!window.confirm('Deze notitie weghalen?')) return
    const vorig = notities
    setNotities((l) => (l ?? []).filter((x) => x.id !== n.id))
    try { await post('/api/admin/abm', { actie: 'notitie_weg', id: b.id, notitie_id: n.id }); onVernieuw() } catch (e) { setNotities(vorig); toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  /** Klant aanmaken of de bestaande koppelen; geeft de klant-id terug. */
  const klant = async (): Promise<string | null> => {
    if (clientId) return clientId
    if (!window.confirm(`Hiervoor maken we ${b.naam} aan als klant (of koppelen we de bestaande klant). Verder?`)) return null
    const j = await post<{ client_id: string; bestond?: boolean }>('/api/admin/abm', { actie: 'klant', id: b.id })
    setClientId(j.client_id); onVernieuw()
    toast.success(j.bestond ? 'Bestaande klant gekoppeld.' : 'Klant aangemaakt.')
    return j.client_id
  }
  const ga = async (sleutel: string, url: (k: string) => string) => {
    setBezig(sleutel)
    try { const k = await klant(); if (k) router.push(url(k)) } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const naarOpvolging = async () => {
    if (!wie) { toast.error('Kies wie het opvolgt.'); return }
    setBezig('opvolging')
    try {
      // De notities en gesprekken gaan mee naar de kaart, oudste eerst.
      const geschiedenis = [...(notities ?? [])].reverse().map((n) => `- ${wanneer(n.created_at)}${n.door ? `, ${n.door}` : ''}: ${[uitkomstLabel(n.uitkomst), n.tekst].filter(Boolean).join('. ')}`)
      const j = await post<{ id?: string }>('/api/admin/opdrachten', {
        titel: b.naam, status: 'open', verantwoordelijke: wie, bron: 'outbound',
        ...(clientId ? { client_id: clientId } : { klant_vrij: b.naam, btw_nummer: b.btw_nummer ?? null }),
        notitie: ['Uit account-based marketing.', b.contactpersoon ? `Contact: ${b.contactpersoon}${b.functie ? ` (${b.functie})` : ''}` : null, b.telefoon ? `Tel: ${b.telefoon}` : null, b.email ? `Mail: ${b.email}` : null, b.website ? `Website: ${b.website}` : null, b.notitie,
          geschiedenis.length ? `Notities:\n${geschiedenis.join('\n')}` : null].filter(Boolean).join('\n'),
      })
      if (j.id) await post('/api/admin/abm', { actie: 'opdracht', id: b.id, opdracht_id: j.id })
      toast.success(`${b.naam} staat in Opvolging.`); onVernieuw(); onSluit()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const verwijder = async () => {
    if (!window.confirm(`${b.naam} uit account-based marketing halen? De notities gaan mee weg.`)) return
    setBezig('weg')
    try { await post('/api/admin/abm', { actie: 'verwijder', id: b.id }); onVernieuw(); onSluit() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const Actie = ({ k, icoon: I, label, onClick }: { k: string; icoon: React.ElementType; label: string; onClick: () => void }) => (
    <button type="button" onClick={onClick} disabled={!!bezig} className="btn-secondary !text-[13px] !py-2 justify-start">{bezig === k ? <Loader2 className="h-4 w-4 animate-spin" /> : <I className="h-4 w-4" />}{label}</button>
  )
  const ov = opvolgLabel(opvolgen, vandaag)
  const sub = [b.sector, b.gemeente].filter(Boolean).join(' · ')

  return (
    <Venster titel={b.naam} onSluit={sluit} breed>
      {/* Wie en wat */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap text-sm text-gray-600">
          {sub && <span>{sub}</span>}
          {b.website && <a href={b.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-700 hover:text-black underline underline-offset-2">{b.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}<ExternalLink className="h-3 w-3" /></a>}
          {clientId && <a href={`/admin/clients/${clientId}`} className="text-[11px] rounded-full bg-green-50 text-green-800 border border-green-200 px-2 py-0.5">klant{b.klant_naam ? `: ${b.klant_naam}` : ''}</a>}
          {b.opdracht_id && <a href={`/admin/opdrachten?opdracht=${b.opdracht_id}`} className="text-[11px] rounded-full bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5">in Opvolging</a>}
        </div>
        {b.notitie && <p className="text-[14px] leading-relaxed text-gray-800 whitespace-pre-line">{b.notitie}</p>}
      </section>

      {/* Contact */}
      <section className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-2">
        {nummers.length ? nummers.map((n) => (
          <div key={n.tel} className="flex items-center gap-2">
            <a href={`tel:${n.tel}`} onClick={() => bel(n)} className="flex-1 min-w-0 flex items-center gap-3 rounded-lg bg-gray-900 text-white px-3.5 py-2.5 hover:bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2">
              <Phone className="h-4 w-4 shrink-0" />
              <span className="text-[15px] font-semibold tabular-nums tracking-wide truncate">{n.weergave}</span>
              <span className="ml-auto text-xs font-medium opacity-80 shrink-0">Bellen</span>
            </a>
            <button type="button" onClick={() => kopieer(n.weergave)} title="Nummer kopiëren" aria-label={`${n.weergave} kopiëren`} className="h-10 w-10 shrink-0 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:text-black"><Copy className="h-4 w-4" /></button>
          </div>
        )) : <p className="text-sm text-gray-500">Geen telefoonnummer. <button type="button" onClick={() => setGegevensOpen(true)} className="underline underline-offset-2">Toevoegen</button></p>}
        {(b.email || b.contactpersoon) && (
          <div className="flex items-center gap-x-4 gap-y-1.5 flex-wrap pt-0.5 text-sm">
            {b.contactpersoon && <span className="inline-flex items-center gap-1.5 text-gray-800"><User className="h-4 w-4 text-gray-400" />{b.contactpersoon}{b.functie && <span className="text-gray-500">· {b.functie}</span>}</span>}
            {b.email && (
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Mail className="h-4 w-4 text-gray-400 shrink-0" />
                <a href={`mailto:${b.email}`} className="text-gray-900 underline underline-offset-2 truncate">{b.email}</a>
                <button type="button" onClick={() => kopieer(b.email!)} title="E-mailadres kopiëren" aria-label="E-mailadres kopiëren" className="text-gray-400 hover:text-black"><Copy className="h-3.5 w-3.5" /></button>
              </span>
            )}
          </div>
        )}
      </section>

      {/* Notitie of gesprek */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="label-mono text-[10px] uppercase text-gray-500">{gesprek ? `Gesprek met ${gesprek.weergave}` : 'Notitie'}</h4>
          {gesprek && <button type="button" onClick={() => { setGesprek(null); setUitkomst(null) }} className="text-xs text-gray-500 hover:text-black">Geen gesprek</button>}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Hoe ging het gesprek?">
          {UITKOMSTEN.map((u) => (
            <button key={u.key} type="button" onClick={() => kiesUitkomst(u.key)} aria-pressed={uitkomst === u.key}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${uitkomst === u.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>{u.label}</button>
          ))}
        </div>
        <div className="relative">
          <textarea ref={notitieVak} rows={3} value={tekst} onChange={(e) => setTekst(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void voegToe() } }}
            placeholder={gesprek ? 'Wat werd er gezegd? Met wie sprak je?' : 'Notitie toevoegen…'} className="input-base text-sm leading-relaxed pr-10" aria-label="Notitie" />
          <span className="absolute right-2 top-2"><DicteerKnop zet={setTekst} context={b.naam} klein /></span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-gray-400 hidden sm:inline">Cmd/Ctrl + Enter om toe te voegen</span>
          <button type="button" onClick={voegToe} disabled={bezig === 'notitie' || (!tekst.trim() && !uitkomst)} className="btn-primary !py-1.5 text-sm ml-auto">{bezig === 'notitie' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Toevoegen</button>
        </div>
      </section>

      {/* Opvolgen */}
      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="label-mono text-[10px] uppercase text-gray-500">Opvolgen</h4>
          {ov ? <span className={`text-[11px] rounded-full border px-2 py-0.5 font-medium ${TOON[ov.toon]}`}>{ov.tekst}</span> : <span className="text-[11px] text-gray-400">Nog geen datum</span>}
          {opvolgen && <button type="button" onClick={() => zetOpvolgen(null)} className="text-[11px] text-gray-500 hover:text-black underline underline-offset-2">Weg</button>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {snel.map((x) => (
            <button key={x.dag} type="button" onClick={() => zetOpvolgen(x.dag)} aria-pressed={opvolgen === x.dag}
              className={`rounded-full border px-2.5 py-1 text-xs ${opvolgen === x.dag ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>{x.label}</button>
          ))}
          <input type="date" value={opvolgen ?? ''} onChange={(e) => zetOpvolgen(e.target.value || null)} aria-label="Andere datum" className="rounded-full border border-gray-200 bg-white px-2.5 py-0.5 text-xs" />
        </div>
      </section>

      {/* Tijdlijn */}
      <section className="space-y-2">
        <h4 className="label-mono text-[10px] uppercase text-gray-500">Notities {notities && notities.length > 0 && <span className="text-gray-400">· {notities.length}</span>}</h4>
        {notities === null ? <div className="py-3 text-gray-400"><Loader2 className="h-4 w-4 animate-spin" /></div>
          : notities.length === 0 ? <p className="text-sm text-gray-400">Nog niets genoteerd.</p>
          : (
            <ol className="space-y-2">
              {notities.map((n) => (
                <li key={n.id} className="group flex gap-2.5 rounded-xl border border-gray-100 bg-white px-3 py-2.5">
                  <span className={`mt-0.5 h-6 w-6 shrink-0 rounded-full flex items-center justify-center ${n.soort === 'gesprek' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {n.soort === 'gesprek' ? <Phone className="h-3 w-3" /> : <StickyNote className="h-3 w-3" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {n.uitkomst && <span className="text-[11px] font-semibold rounded-full bg-gray-100 text-gray-800 px-2 py-0.5">{uitkomstLabel(n.uitkomst)}</span>}
                      <span className="text-[11px] text-gray-500">{wanneer(n.created_at)}{n.door ? ` · ${n.door}` : ''}{n.telefoon ? ` · ${netNummer(n.telefoon)}` : ''}</span>
                    </div>
                    {n.tekst && <p className="mt-1 text-sm text-gray-900 whitespace-pre-line break-words">{n.tekst}</p>}
                  </div>
                  <button type="button" onClick={() => haalWeg(n)} title="Weghalen" aria-label="Notitie weghalen" className="self-start text-gray-300 hover:text-red-700 opacity-0 group-hover:opacity-100 focus:opacity-100"><X className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ol>
          )}
      </section>

      {/* Verder */}
      <section className="space-y-2 border-t border-gray-100 pt-4">
        <div className="grid grid-cols-2 gap-2">
          <Actie k="offerte" icoon={FileText} label="Offerte opmaken" onClick={() => ga('offerte', (k) => `/admin/offertes/opmaken?client=${k}${b.opdracht_id ? `&opdracht=${b.opdracht_id}` : ''}`)} />
          <Actie k="meeting" icoon={CalendarClock} label="Meeting inplannen" onClick={() => ga('meeting', (k) => `/admin/meetings?plan=1&klant=${k}`)} />
          <Actie k="contract" icoon={FileSignature} label="Contract" onClick={() => ga('contract', (k) => `/admin/contracts/templates?client=${k}${b.opdracht_id ? `&opdracht=${b.opdracht_id}` : ''}`)} />
          <Actie k="account" icoon={UserPlus} label="Klantaccount" onClick={() => ga('account', (k) => `/admin/clients/${k}#klantaccount`)} />
        </div>
        {!b.opdracht_id ? (
          <div className="rounded-xl border border-gray-200 p-2.5 flex items-center gap-2 flex-wrap">
            <span className="w-full text-xs text-gray-500">Wie volgt op?</span>
            <div className="w-full flex gap-1.5 flex-wrap" role="radiogroup" aria-label="Wie volgt op?">
              {PROJECT_VERANTWOORDELIJKEN.map((p) => <PersoonKnop key={p} naam={p} aan={wie === p} klein onClick={() => setWie(p)} />)}
            </div>
            <button type="button" onClick={naarOpvolging} disabled={!!bezig} className="btn-primary text-sm flex-1 justify-center">{bezig === 'opvolging' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}Naar Opvolging</button>
          </div>
        ) : <a href={`/admin/opdrachten?opdracht=${b.opdracht_id}`} className="text-xs text-gray-600 underline">Staat in Opvolging: kaart openen</a>}
      </section>

      <section className="rounded-xl border border-gray-200">
        <button type="button" onClick={() => setGegevensOpen((o) => !o)} aria-expanded={gegevensOpen} className="w-full flex items-center gap-2 px-3 py-2.5 text-sm font-medium text-gray-800">
          <Pencil className="h-4 w-4 text-gray-500" />Gegevens aanpassen<ChevronRight className={`h-4 w-4 ml-auto text-gray-400 transition-transform ${gegevensOpen ? 'rotate-90' : ''}`} />
        </button>
        {gegevensOpen && <div className="px-3 pb-3"><Gegevens b={b} onBewaard={onVernieuw} /></div>}
      </section>

      <div className="flex gap-2">
        {b.geen_interesse_op
          ? <button type="button" onClick={() => onInteresse(b, false)} disabled={!!bezig} className="btn-secondary flex-1 justify-center"><RotateCcw className="h-4 w-4" />Terugzetten</button>
          : <button type="button" onClick={() => onInteresse(b, true)} disabled={!!bezig} className="btn-secondary flex-1 justify-center"><ThumbsDown className="h-4 w-4" />Geen interesse</button>}
        <button type="button" onClick={verwijder} disabled={!!bezig} className="btn-secondary text-red-700" title="Weghalen" aria-label="Weghalen"><Trash2 className="h-4 w-4" /></button>
      </div>
    </Venster>
  )
}

/** Het vuilbakje: alle bedrijven zonder interesse, met wanneer en door wie. Terugzetten kan. */
function VuilbakVenster({ lijst, onSluit, onTerug, onOpen }: { lijst: Bedrijf[]; onSluit: () => void; onTerug: (b: Bedrijf) => void; onOpen: (b: Bedrijf) => void }) {
  const [zoek, setZoek] = useState('')
  const q = zoek.trim().toLowerCase()
  const zichtbaar = lijst.filter((b) => !q || `${b.naam} ${b.contactpersoon ?? ''} ${b.gemeente ?? ''} ${b.sector ?? ''}`.toLowerCase().includes(q))
  const dag = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Brussels' }) : '')
  return (
    <Venster titel={`Geen interesse (${lijst.length})`} onSluit={onSluit}>
      {lijst.length === 0 ? <p className="text-sm text-gray-500">Nog geen bedrijven zonder interesse.</p> : (
        <>
          {lijst.length > 8 && (
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input {...zoekVeld('geen-interesse')} value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoeken" className="w-full pl-8 pr-2 py-1.5 text-sm rounded-lg border border-gray-200" />
            </div>
          )}
          <ul className="divide-y divide-gray-100 -mx-1">
            {zichtbaar.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-1 py-2">
                <button type="button" onClick={() => onOpen(b)} className="min-w-0 flex-1 text-left">
                  <div className="text-sm font-medium text-gray-900 truncate">{b.naam}</div>
                  <div className="text-xs text-gray-500 truncate">{[b.contactpersoon, b.gemeente, b.sector].filter(Boolean).join(' · ') || '—'}</div>
                  <div className="text-[11px] text-gray-400">Geen interesse sinds {dag(b.geen_interesse_op)}{b.geen_interesse_door ? ` · ${b.geen_interesse_door}` : ''}</div>
                </button>
                <button type="button" onClick={() => onTerug(b)} className="btn-secondary text-xs h-8 shrink-0"><RotateCcw className="h-3.5 w-3.5" />Terugzetten</button>
              </li>
            ))}
            {zichtbaar.length === 0 && <li className="px-1 py-2 text-sm text-gray-500">Niets gevonden.</li>}
          </ul>
        </>
      )}
    </Venster>
  )
}
