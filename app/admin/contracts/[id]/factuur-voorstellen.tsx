'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Sparkles, Trash2, Plus, AlertTriangle, Check, X, FileText } from 'lucide-react'
import { formatEuro } from '@/lib/utils'
import { leesGetal } from '@/lib/getal'
import { INP } from '@/app/admin/instellingen/ui'
import { FREQUENTIES, MOMENTEN, maakVoorstellen, ontbrekend, type Afspraken, type FactuurMoment, type Frequentie, type Voorstel } from '@/lib/facturatie/factuurvoorstellen'

/**
 * Factuurvoorstellen vanuit een contract — eerst controleren, dan bevestigen.
 * Vóór bevestiging blijven het voorstellen: ze tellen niet mee, worden niet
 * verstuurd en krijgen geen nummer. Na bevestiging worden ze factuuritems
 * "Te factureren" in Facturen, gekoppeld aan dit contract en deze klant.
 */

type Sug<T> = { waarde: T | null; citaat: string | null; zekerheid: number | null }
type Voorwaarden = { dienst: Sug<string>; start_dienstverlening: Sug<string>; duur_maanden: Sug<number>; frequentie: Sug<string>; bedrag_per_periode_excl: Sug<number>; btw_pct: Sug<number>; facturatiemoment: Sug<string>; inbegrepen_prestaties: string[] }
type Data = {
  contract: { id: string; title: string | null; start_date: string | null; end_date: string | null; signed_at: string | null; waarde: number | null }
  klant: { naam: string; btw: string | null; email: string | null; adres: string | null } | null
  velden: Record<string, string>
  afspraken: Afspraken
  bron: Record<string, string>
  bestaand: Record<string, string>
  aiBeschikbaar: boolean
}
type Rij = Voorstel & { id: string; gekozen: boolean; forceer: boolean; handmatig?: boolean }

const lbl = 'block text-xs font-medium text-gray-700 mb-1'
const d = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—')
const BTW = [21, 12, 6, 0]

export function FactuurVoorstellen({ contractId, waarde, onSluit, onBevestigd }: { contractId: string; waarde: number | null; onSluit: () => void; onBevestigd: () => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [a, setA] = useState<Afspraken | null>(null)
  const [ai, setAi] = useState<Voorwaarden | null>(null)
  const [aiBezig, setAiBezig] = useState(false)
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [termijn, setTermijn] = useState('30')
  const [bezig, setBezig] = useState(false)
  const [btwAnders, setBtwAnders] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/contracts/${contractId}/factuurvoorstellen`, { cache: 'no-store' }).then(async (r) => {
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setData(j); setA(j.afspraken)
    }).catch((e) => toast.error(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [contractId])

  const zet = <K extends keyof Afspraken>(k: K, v: Afspraken[K]) => { setA((x) => (x ? { ...x, [k]: v } : x)); setRijen(null) }
  const tekort = a ? ontbrekend(a) : []
  const leesContract = async () => {
    setAiBezig(true)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/factuurvoorstellen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ai' }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setAi(j.voorwaarden); toast.success('Afspraken uit het contract gelezen — neem over wat klopt.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Lezen mislukt') } finally { setAiBezig(false) }
  }
  const overnemen = (veld: keyof Voorwaarden) => {
    if (!ai) return
    const s = ai[veld] as Sug<unknown>
    if (s?.waarde === null || s?.waarde === undefined) return
    if (veld === 'dienst') zet('dienst', String(s.waarde))
    if (veld === 'start_dienstverlening') zet('start', String(s.waarde))
    if (veld === 'duur_maanden') zet('duurMaanden', Number(s.waarde))
    if (veld === 'frequentie' && FREQUENTIES.some((f) => f.key === s.waarde)) zet('frequentie', s.waarde as Frequentie)
    if (veld === 'bedrag_per_periode_excl') zet('bedrag', Number(s.waarde))
    if (veld === 'btw_pct') { zet('btwPct', Number(s.waarde)); setBtwAnders(!BTW.includes(Number(s.waarde))) }
    if (veld === 'facturatiemoment' && MOMENTEN.some((m) => m.key === s.waarde)) zet('moment', s.waarde as FactuurMoment)
  }
  const Uit = ({ veld, toon }: { veld: keyof Voorwaarden; toon?: (v: unknown) => string }) => {
    const s = ai?.[veld] as Sug<unknown> | undefined
    if (!ai || !s) return null
    if (s.waarde === null) return <p className="text-[11px] text-gray-400 mt-0.5">Contract: niet gevonden{s.citaat ? ` — “${s.citaat}”` : ''}</p>
    return (
      <p className="text-[11px] text-indigo-800 mt-0.5 flex items-start gap-1">
        <span className="flex-1">Contract: <b>{toon ? toon(s.waarde) : String(s.waarde)}</b>{s.citaat ? ` — “${s.citaat}”` : ''}{s.zekerheid !== null && s.zekerheid < 0.6 ? ' (onzeker)' : ''}</span>
        <button type="button" onClick={() => overnemen(veld)} className="underline shrink-0">Overnemen</button>
      </p>
    )
  }
  const Bron = ({ k }: { k: string }) => (data?.bron[k] ? <p className="text-[10px] text-gray-500 mt-0.5">{data.bron[k]}</p> : null)

  const maak = () => {
    if (!a || !data) return
    const v = maakVoorstellen(a, data.bestaand)
    setRijen(v.map((x, i) => ({ ...x, id: `${x.periode}-${i}`, gekozen: !x.bestaatAl, forceer: false })))
  }
  const zetRij = (id: string, deel: Partial<Rij>) => setRijen((r) => r?.map((x) => (x.id === id ? { ...x, ...deel } : x)) ?? r)
  const gekozen = (rijen ?? []).filter((r) => r.gekozen)
  const totaal = Math.round(gekozen.reduce((t, r) => t + (Number(r.bedrag_excl) || 0), 0) * 100) / 100
  const alleTotaal = Math.round((rijen ?? []).reduce((t, r) => t + (Number(r.bedrag_excl) || 0), 0) * 100) / 100
  const fouten = gekozen.filter((r) => !r.artikel.trim() || !(r.bedrag_excl > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(r.datum))
  const bevestig = async () => {
    if (!gekozen.length || fouten.length) return
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/factuurvoorstellen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'bevestigen', betaaltermijn: Number(termijn) || 30, voorstellen: gekozen.map((x) => ({ periode: x.handmatig ? x.datum.slice(0, 7) : x.periode, van: x.handmatig ? `${x.datum.slice(0, 7)}-01` : x.van, tot: x.handmatig ? x.datum : x.tot, datum: x.datum, artikel: x.artikel, omschrijving: x.omschrijving, bedrag_excl: x.bedrag_excl, btw_pct: x.btw_pct, forceer: x.forceer })) }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      const over = (j.overgeslagen as { periode: string; reden: string }[]) ?? []
      toast.success(`${j.aangemaakt} factuuritem${j.aangemaakt === 1 ? '' : 's'} aangemaakt met status Te factureren.${over.length ? ` ${over.length} overgeslagen (${[...new Set(over.map((o) => o.reden))].join(', ')}).` : ''}`)
      setData((dd) => (dd ? { ...dd, bestaand: j.bestaand } : dd))
      onBevestigd()
      onSluit()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bevestigen mislukt') } finally { setBezig(false) }
  }

  const velden = useMemo(() => Object.entries(data?.velden ?? {}).filter(([, v]) => v && String(v).trim()), [data])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-6 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Factuurvoorstellen maken">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-5xl max-h-[94dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold flex items-center gap-2"><Sparkles className="h-4 w-4" />Factuurvoorstellen maken{data?.contract.title ? ` · ${data.contract.title}` : ''}</h3>
            <p className="text-xs text-gray-500 mt-0.5">Eerst controleren. Pas na jouw bevestiging worden het factuuritems “Te factureren” in Facturen. Voorstellen tellen niet mee en worden nooit verstuurd.</p>
          </div>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        {!data || !a ? <div className="py-16 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" /></div> : (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Klantgegevens */}
            <section className="grid md:grid-cols-[1fr_1fr] gap-3">
              <div className="rounded-xl border border-gray-200 p-3 text-sm">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">Klantgegevens controleren</h4>
                {data.klant ? (
                  <dl className="grid grid-cols-[90px_1fr] gap-x-2 gap-y-0.5 text-xs">
                    <dt className="text-gray-500">Klant</dt><dd className="font-medium">{data.klant.naam}</dd>
                    <dt className="text-gray-500">Btw-nummer</dt><dd>{data.klant.btw ?? <span className="text-amber-700">ontbreekt</span>}</dd>
                    <dt className="text-gray-500">Factuurmail</dt><dd>{data.klant.email ?? <span className="text-amber-700">ontbreekt</span>}</dd>
                    <dt className="text-gray-500">Adres</dt><dd>{data.klant.adres ?? <span className="text-amber-700">ontbreekt</span>}</dd>
                  </dl>
                ) : <p className="text-xs text-red-700">Geen klant gekoppeld aan dit contract.</p>}
              </div>
              <div className="rounded-xl border border-gray-200 p-3 text-xs space-y-1">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Contract</h4>
                <div>Looptijd in de app: {d(data.contract.start_date)} – {d(data.contract.end_date)} · getekend {d(data.contract.signed_at)}</div>
                <div>Contractwaarde: {waarde === null ? <span className="text-amber-700">ontbreekt</span> : <b>{formatEuro(waarde)} excl.</b>}</div>
                {velden.length > 0 && <details><summary className="cursor-pointer text-gray-600">Ingevulde velden bij ondertekening ({velden.length})</summary><dl className="mt-1 grid grid-cols-[1fr_1fr] gap-x-2">{velden.map(([k, v]) => <Fragment key={k}><dt className="text-gray-500 truncate">{k}</dt><dd className="truncate">{String(v)}</dd></Fragment>)}</dl></details>}
                {data.aiBeschikbaar && <button type="button" onClick={leesContract} disabled={aiBezig} className="btn-secondary text-xs mt-1">{aiBezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}Afspraken uit het contract lezen</button>}
                {ai && ai.inbegrepen_prestaties.length > 0 && <div className="text-[11px] text-gray-600">In het contract opgesomd: {ai.inbegrepen_prestaties.join(' · ')}</div>}
              </div>
            </section>

            {/* Afspraken */}
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Facturatieafspraken — bevestig of vul aan</h4>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="sm:col-span-2"><label className={lbl}>Dienst of pakket (artikelnaam)</label><input className={INP} value={a.dienst} onChange={(e) => zet('dienst', e.target.value)} placeholder="bv. Socialmediabeheer" /><Bron k="dienst" /><Uit veld="dienst" /></div>
                <div><label className={lbl}>Start dienstverlening</label><input type="date" className={INP} value={a.start ?? ''} onChange={(e) => zet('start', e.target.value || null)} /><Bron k="start" /><Uit veld="start_dienstverlening" toon={(v) => d(String(v))} /></div>
                <div><label className={lbl}>Facturatiefrequentie</label><select className={INP} value={a.frequentie ?? ''} onChange={(e) => zet('frequentie', (e.target.value || null) as Frequentie | null)}><option value="">— kies —</option>{FREQUENTIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select><Bron k="frequentie" /><Uit veld="frequentie" /></div>
                {a.frequentie !== 'eenmalig' && <div><label className={lbl}>Contractduur (maanden)</label><input className={INP} inputMode="numeric" value={a.duurMaanden ?? ''} onChange={(e) => zet('duurMaanden', e.target.value ? Number(e.target.value.replace(/\D/g, '')) || null : null)} /><Bron k="duurMaanden" /><Uit veld="duur_maanden" /></div>}
                <div><label className={lbl}>{a.frequentie === 'eenmalig' ? 'Bedrag excl. btw' : 'Bedrag per periode excl. btw'}</label><input className={INP} inputMode="decimal" value={a.bedrag ?? ''} onChange={(e) => zet('bedrag', leesGetal(e.target.value))} /><Bron k="bedrag" /><Uit veld="bedrag_per_periode_excl" toon={(v) => formatEuro(Number(v))} /></div>
                <div><label className={lbl}>Btw-behandeling</label>
                  {btwAnders ? <input className={INP} inputMode="decimal" value={a.btwPct ?? ''} onChange={(e) => zet('btwPct', leesGetal(e.target.value))} placeholder="%" />
                    : <select className={INP} value={a.btwPct ?? ''} onChange={(e) => { if (e.target.value === 'x') { setBtwAnders(true); return } zet('btwPct', e.target.value === '' ? null : Number(e.target.value)) }}><option value="">— kies —</option>{BTW.map((x) => <option key={x} value={x}>{x} %{x === 0 ? ' (vrijgesteld / verlegd)' : ''}</option>)}<option value="x">Ander tarief…</option></select>}
                  <Bron k="btwPct" /><Uit veld="btw_pct" toon={(v) => `${v} %`} /></div>
                <div><label className={lbl}>Facturatiemoment</label><select className={INP} value={a.moment ?? ''} onChange={(e) => zet('moment', (e.target.value || null) as FactuurMoment | null)}><option value="">— kies —</option>{MOMENTEN.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
                  {a.moment === 'dag' && <input className={`${INP} mt-1`} inputMode="numeric" placeholder="dag (1–31)" value={a.dag ?? ''} onChange={(e) => zet('dag', e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null)} />}
                  <Bron k="moment" /><Uit veld="facturatiemoment" /></div>
                <div><label className={lbl}>Betaaltermijn (dagen)</label><input className={INP} inputMode="numeric" value={termijn} onChange={(e) => setTermijn(e.target.value.replace(/\D/g, ''))} /></div>
              </div>
              {tekort.length > 0 ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Nog te bevestigen of aan te vullen: {tekort.join(', ')}. De app vult dit niet zelf in.</div>
                : <button type="button" onClick={maak} className="btn-primary text-sm"><Sparkles className="h-4 w-4" />{rijen ? 'Voorstellen opnieuw maken' : 'Voorstellen maken'}</button>}
            </section>

            {/* Controle */}
            {rijen && (
              <section className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="text-sm font-semibold">Controle — {rijen.length} voorstel{rijen.length === 1 ? '' : 'len'}</h4>
                  <button type="button" onClick={() => setRijen((r) => r?.map((x) => ({ ...x, gekozen: !x.bestaatAl || x.forceer })) ?? r)} className="text-xs underline">alle nieuwe selecteren</button>
                  <button type="button" onClick={() => setRijen((r) => r?.map((x) => ({ ...x, gekozen: false })) ?? r)} className="text-xs underline">niets</button>
                </div>
                <div className="space-y-2">
                  {rijen.map((r) => (
                    <div key={r.id} className={`rounded-xl border p-2.5 ${r.bestaatAl ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200'} ${r.gekozen ? '' : 'opacity-70'}`}>
                      <div className="flex items-start gap-2 flex-wrap">
                        <input type="checkbox" className="h-4 w-4 mt-2" checked={r.gekozen} aria-label={`Voorstel ${r.artikel} selecteren`} onChange={(e) => zetRij(r.id, { gekozen: e.target.checked, forceer: e.target.checked && !!r.bestaatAl })} />
                        <div className="grid grid-cols-2 md:grid-cols-[140px_1fr_120px_90px] gap-2 flex-1 min-w-0">
                          <div><label className="block text-[10px] text-gray-500">Factuurdatum</label><input type="date" className={`${INP} py-1 text-xs`} value={r.datum} onChange={(e) => zetRij(r.id, { datum: e.target.value })} /></div>
                          <div className="col-span-2 md:col-span-1"><label className="block text-[10px] text-gray-500">Artikelnaam</label><input className={`${INP} py-1 text-xs`} value={r.artikel} onChange={(e) => zetRij(r.id, { artikel: e.target.value })} /></div>
                          <div><label className="block text-[10px] text-gray-500">Bedrag excl.</label><input className={`${INP} py-1 text-xs`} inputMode="decimal" value={String(r.bedrag_excl).replace('.', ',')} onChange={(e) => zetRij(r.id, { bedrag_excl: leesGetal(e.target.value) ?? 0 })} /></div>
                          <div><label className="block text-[10px] text-gray-500">Btw %</label><input className={`${INP} py-1 text-xs`} inputMode="decimal" value={String(r.btw_pct)} onChange={(e) => zetRij(r.id, { btw_pct: leesGetal(e.target.value) ?? 0 })} /></div>
                          <div className="col-span-2 md:col-span-4"><label className="block text-[10px] text-gray-500">Omschrijving</label><textarea rows={2} className={`${INP} py-1 text-xs`} value={r.omschrijving} onChange={(e) => zetRij(r.id, { omschrijving: e.target.value })} /></div>
                        </div>
                        <button type="button" onClick={() => setRijen((x) => x?.filter((y) => y.id !== r.id) ?? x)} className="h-8 w-8 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center" aria-label="Voorstel verwijderen"><Trash2 className="h-4 w-4" /></button>
                      </div>
                      {r.bestaatAl && <p className="text-[11px] text-amber-900 mt-1.5 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Voor deze periode bestaat al: “{r.bestaatAl}”. {r.gekozen ? 'Je maakt bewust een extra item aan.' : 'Niet geselecteerd om dubbels te vermijden.'}</p>}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={() => { const dt = new Date().toISOString().slice(0, 10); setRijen((x) => [...(x ?? []), { id: `h${Date.now()}`, periode: dt.slice(0, 7), van: `${dt.slice(0, 7)}-01`, tot: dt, datum: dt, artikel: a.dienst, omschrijving: '', bedrag_excl: 0, btw_pct: a.btwPct ?? 21, bestaatAl: data.bestaand[dt.slice(0, 7)] ?? null, gekozen: true, forceer: !!data.bestaand[dt.slice(0, 7)], handmatig: true }]) }} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Voorstel toevoegen</button>
                <div className="rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 text-sm flex flex-wrap gap-x-5 gap-y-1">
                  <span>Geselecteerd: <b className="tabular-nums">{formatEuro(totaal)}</b> excl. ({gekozen.length})</span>
                  <span className="text-gray-600">Alle voorstellen: <span className="tabular-nums">{formatEuro(alleTotaal)}</span></span>
                  <span className="text-gray-600">Contractwaarde: {waarde === null ? <span className="text-amber-700">ontbreekt</span> : <span className="tabular-nums">{formatEuro(waarde)}</span>}</span>
                  {waarde !== null && Math.abs(alleTotaal - waarde) >= 0.005 && <span className={alleTotaal > waarde ? 'text-red-700' : 'text-blue-800'}>Verschil met contractwaarde: {formatEuro(Math.round((alleTotaal - waarde) * 100) / 100)}</span>}
                  {waarde !== null && Math.abs(alleTotaal - waarde) < 0.005 && <span className="text-[#166534] inline-flex items-center gap-1"><Check className="h-4 w-4" />Gelijk aan de contractwaarde</span>}
                </div>
                {fouten.length > 0 && <p className="text-xs text-red-700">{fouten.length} geselecteerd voorstel heeft geen artikelnaam, geen geldig bedrag of geen datum.</p>}
              </section>
            )}
          </div>
        )}
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/60 flex-wrap">
          <button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button>
          <button type="button" disabled={!rijen || !gekozen.length || fouten.length > 0 || bezig} onClick={bevestig} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{gekozen.length ? `${gekozen.length} voorstel${gekozen.length === 1 ? '' : 'len'} bevestigen` : 'Bevestigen'}</button>
        </div>
      </div>
    </div>
  )
}
