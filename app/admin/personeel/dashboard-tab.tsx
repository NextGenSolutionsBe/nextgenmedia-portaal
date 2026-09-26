'use client'

import { KaartTabel } from '@/components/ui/kaart-tabel'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Clock, CheckCircle2, CalendarDays, Wallet, TrendingUp, AlertTriangle, ArrowLeftRight, FileDown } from 'lucide-react'
import { ExportKnop } from '@/components/admin/export-knop'
import { api, Kaart, euro, uren, datumNl } from '@/components/personeel/ui'
import { MEDEWERKER_TYPES, SESSIE_STATUS, type SessieStatus } from '@/lib/personeel/model'
import type { Dashboard, Rij } from '@/lib/personeel/dashboard'
import type { Werkmap } from '@/lib/excel/spec'

type Antwoord = Dashboard & { periode: { van: string; tot: string }; soort: string; magFinancieel: boolean; keuzes: { medewerkers: { id: string; naam: string }[]; klanten: { id: string; company_name: string }[] } }
type Soort = 'dag' | 'week' | 'maand' | 'kwartaal' | 'aangepast'

const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' }).format(new Date())

/** Het financiële managementdashboard van Personeel. */
export function DashboardTab() {
  const [soort, setSoort] = useState<Soort>('maand')
  const [anker, setAnker] = useState(vandaag())
  const [van, setVan] = useState(''), [tot, setTot] = useState('')
  const [f, setF] = useState({ personeel_id: '', type: '', client_id: '', project: '', status: '' })
  const [d, setD] = useState<Antwoord | null>(null)
  const [laden, setLaden] = useState(false)
  const [groep, setGroep] = useState<'perMedewerker' | 'perProject' | 'perKlant' | 'perMaand' | 'perType'>('perMedewerker')

  const laad = useCallback(async () => {
    setLaden(true)
    const q = new URLSearchParams({ periode: soort, anker, ...(soort === 'aangepast' ? { van, tot } : {}), ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) })
    try { setD(await api<Antwoord>(`/api/admin/personeel/dashboard?${q}`)) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [soort, anker, van, tot, f])
  useEffect(() => { const t = setTimeout(laad, 200); return () => clearTimeout(t) }, [laad])

  const k = d?.kaarten
  const fin = !!d?.magFinancieel
  const sel = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm'
  const GROEPEN = [['perMedewerker', 'Per medewerker'], ['perProject', 'Per project'], ['perKlant', 'Per klant'], ['perMaand', 'Per maand'], ['perType', 'Per type']] as const

  const filterTekst = () => {
    const uit: { label: string; waarde: string }[] = [{ label: 'Periode', waarde: d ? `${datumNl(d.periode.van)} – ${datumNl(d.periode.tot)}` : '' }]
    if (f.personeel_id) uit.push({ label: 'Medewerker', waarde: d?.keuzes.medewerkers.find((m) => m.id === f.personeel_id)?.naam ?? '' })
    if (f.type) uit.push({ label: 'Type', waarde: MEDEWERKER_TYPES.find((t) => t.key === f.type)?.label ?? f.type })
    if (f.client_id) uit.push({ label: 'Klant', waarde: d?.keuzes.klanten.find((c) => c.id === f.client_id)?.company_name ?? '' })
    if (f.project) uit.push({ label: 'Project', waarde: f.project })
    if (f.status) uit.push({ label: 'Status', waarde: SESSIE_STATUS[f.status as SessieStatus]?.label ?? f.status })
    return uit
  }
  const kolommen = (label: string) => [{ kop: label }, { kop: 'Gewerkt (u)', stijl: 'uren' as const }, { kop: 'Goedgekeurd (u)', stijl: 'uren' as const }, { kop: 'Gepland (u)', stijl: 'uren' as const }, ...(fin ? [{ kop: 'Werkelijke kost', stijl: 'euro' as const }, { kop: 'Voorlopige kost', stijl: 'euro' as const }, { kop: 'Verwachte kost', stijl: 'euro' as const }] : [])]
  const rij = (r: Rij) => [r.label, r.uren, r.goedgekeurd, r.gepland, ...(fin ? [r.kostWerkelijk, r.kostVoorlopig, r.kostVerwacht] : [])]
  const werkmap = (): Werkmap => ({
    bestandsnaam: 'NextGenMedia_Personeel', titel: 'Personeel — uren en kosten', filters: filterTekst(),
    bladen: [
      { naam: 'Overzicht', titel: 'Overzicht', blokken: [{ soort: 'kpis', items: [
        { label: 'Werkelijk gewerkte uren', waarde: k?.gewerktUren ?? 0, stijl: 'uren' }, { label: 'Goedgekeurde uren', waarde: k?.goedgekeurdUren ?? 0, stijl: 'uren' }, { label: 'Geplande uren', waarde: k?.geplandUren ?? 0, stijl: 'uren' },
        ...(fin ? [{ label: 'Werkelijke personeelskost', waarde: k?.kostWerkelijk ?? 0, stijl: 'euro' as const }, { label: 'Verwachte personeelskost', waarde: k?.kostVerwacht ?? 0, stijl: 'euro' as const }, { label: 'Verschil (werkelijk − verwacht)', waarde: k?.verschilKost ?? 0, stijl: 'euro' as const }] : []),
        { label: 'Nog te controleren (u)', waarde: k?.teControlerenUren ?? 0, stijl: 'uren' },
      ] }] },
      ...GROEPEN.map(([g, label]) => ({ naam: label, titel: label, blokken: [{ soort: 'tabel' as const, kolommen: kolommen(label.replace('Per ', '').replace(/^./, (c) => c.toUpperCase())), rijen: (d?.[g] ?? []).map(rij) }] })),
    ],
  })
  const csv = () => {
    const rijen = (d?.[groep] ?? []).map(rij)
    const kop = kolommen(GROEPEN.find(([g]) => g === groep)![1]).map((c) => c.kop)
    const esc = (v: unknown) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
    const tekst = [kop, ...rijen].map((r) => r.map((v) => (typeof v === 'number' ? String(v).replace('.', ',') : esc(v))).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + tekst], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `personeel-${groep}-${d?.periode.van}-${d?.periode.tot}.csv`; a.click(); URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <div className="card-base p-3 space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
            {(['dag', 'week', 'maand', 'kwartaal', 'aangepast'] as Soort[]).map((s) => <button key={s} type="button" onClick={() => setSoort(s)} className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize ${soort === s ? 'bg-black text-white' : 'text-gray-600 hover:bg-white'}`}>{s}</button>)}
          </div>
          {soort === 'aangepast'
            ? <><input type="date" className={sel} value={van} onChange={(e) => setVan(e.target.value)} /><span className="text-gray-400">–</span><input type="date" className={sel} value={tot} onChange={(e) => setTot(e.target.value)} /></>
            : <input type="date" className={sel} value={anker} onChange={(e) => e.target.value && setAnker(e.target.value)} aria-label="Datum in de periode" />}
          {d && <span className="text-xs text-gray-500">{datumNl(d.periode.van)} – {datumNl(d.periode.tot)}</span>}
          {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          <div className="ml-auto flex gap-2">
            <ExportKnop werkmap={werkmap} label="Excel" className="btn-secondary text-xs" />
            <button type="button" onClick={csv} className="btn-secondary text-xs"><FileDown className="h-3.5 w-3.5" />CSV</button>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <select className={sel} value={f.personeel_id} onChange={(e) => setF({ ...f, personeel_id: e.target.value })}><option value="">Alle medewerkers</option>{d?.keuzes.medewerkers.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}</select>
          <select className={sel} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Alle types</option>{MEDEWERKER_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          <select className={sel} value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}><option value="">Alle klanten</option>{d?.keuzes.klanten.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
          <input className={sel} placeholder="Project…" value={f.project} onChange={(e) => setF({ ...f, project: e.target.value })} />
          <select className={sel} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Alle statussen</option>{(Object.keys(SESSIE_STATUS) as SessieStatus[]).map((s) => <option key={s} value={s}>{SESSIE_STATUS[s].label}</option>)}</select>
        </div>
      </div>

      {!d ? <div className="py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Kaart label="Werkelijk gewerkt" waarde={uren(k!.gewerktUren)} icon={<Clock className="h-3.5 w-3.5" />} />
            <Kaart label="Goedgekeurd" waarde={uren(k!.goedgekeurdUren)} kleur="text-green-700" icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
            <Kaart label="Gepland" waarde={uren(k!.geplandUren)} kleur="text-blue-700" icon={<CalendarDays className="h-3.5 w-3.5" />} />
            <Kaart label="Werkelijke kost" waarde={fin ? euro(k!.kostWerkelijk) : '—'} sub={fin ? `voorlopig: ${euro(k!.kostVoorlopig)}` : 'enkel met rechten op Financiën'} icon={<Wallet className="h-3.5 w-3.5" />} />
            <Kaart label="Verwachte kost" waarde={fin ? euro(k!.kostVerwacht) : '—'} kleur="text-blue-700" icon={<TrendingUp className="h-3.5 w-3.5" />} />
            <Kaart label="Nog te controleren" waarde={uren(k!.teControlerenUren)} sub={`${k!.teControlerenAantal} registratie${k!.teControlerenAantal === 1 ? '' : 's'}`} kleur={k!.teControlerenAantal ? 'text-amber-700' : undefined} icon={<AlertTriangle className="h-3.5 w-3.5" />} />
            <Kaart label="Planning vs werkelijk" waarde={`${k!.verschilUren > 0 ? '+' : ''}${uren(k!.verschilUren)}`} sub={fin ? `${k!.verschilKost > 0 ? '+' : ''}${euro(k!.verschilKost)}${k!.verschilPct !== null ? ` (${k!.verschilPct}%)` : ''}` : 'goedgekeurd − gepland'} kleur={k!.verschilUren < 0 ? 'text-amber-700' : 'text-gray-900'} icon={<ArrowLeftRight className="h-3.5 w-3.5" />} />
          </div>
          {k!.urenZonderTarief > 0 && fin && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 flex gap-2"><AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />{uren(k!.urenZonderTarief)} zonder tarief: die uren tellen voorlopig aan € 0. Vul het tarief in bij de medewerker (tabblad Kosten).</div>}

          <div className="card-base p-0 overflow-hidden">
            <div className="flex gap-1 overflow-x-auto p-2 border-b border-gray-100">
              {GROEPEN.map(([g, label]) => <button key={g} type="button" onClick={() => setGroep(g)} className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${groep === g ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{label}</button>)}
            </div>
            <div className="overflow-x-auto">
              <KaartTabel><table className="w-full text-sm min-w-[640px]">
                <thead><tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide bg-gray-50">
                  <th className="px-3 py-2 font-medium">{GROEPEN.find(([g]) => g === groep)![1].replace('Per ', '')}</th><th className="px-3 py-2 font-medium text-right">Gewerkt</th><th className="px-3 py-2 font-medium text-right">Goedgekeurd</th><th className="px-3 py-2 font-medium text-right">Gepland</th>
                  {fin && <><th className="px-3 py-2 font-medium text-right">Werkelijke kost</th><th className="px-3 py-2 font-medium text-right">Voorlopig</th><th className="px-3 py-2 font-medium text-right">Verwacht</th></>}
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {(d[groep] ?? []).filter((r) => r.uren || r.gepland || r.kostWerkelijk || r.kostVerwacht).map((r) => (
                    <tr key={r.sleutel}>
                      <td className="px-3 py-2 font-medium">{r.label}</td><td className="px-3 py-2 text-right tabular-nums">{uren(r.uren)}</td><td className="px-3 py-2 text-right tabular-nums text-green-700">{uren(r.goedgekeurd)}</td><td className="px-3 py-2 text-right tabular-nums text-blue-700">{uren(r.gepland)}</td>
                      {fin && <><td className="px-3 py-2 text-right tabular-nums font-semibold">{euro(r.kostWerkelijk)}</td><td className="px-3 py-2 text-right tabular-nums text-amber-700">{euro(r.kostVoorlopig)}</td><td className="px-3 py-2 text-right tabular-nums text-blue-700">{euro(r.kostVerwacht)}</td></>}
                    </tr>
                  ))}
                  {!(d[groep] ?? []).some((r) => r.uren || r.gepland || r.kostWerkelijk || r.kostVerwacht) && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">Geen gegevens in deze periode.</td></tr>}
                </tbody>
              </table></KaartTabel>
            </div>
            {groep === 'perProject' && fin && <p className="px-3 py-2 text-[11px] text-gray-500 border-t border-gray-100">Kosten per dag, per maand en eenmalige kosten horen bij de medewerker, niet bij één project; ze staan apart als "Vaste kosten", zodat de som klopt met de werkelijke kost.</p>}
          </div>
        </>
      )}
    </div>
  )
}
