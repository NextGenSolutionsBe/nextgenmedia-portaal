'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Check, FileText, Layers, Loader2, Plus, Sparkles, Trash2, Unlink, Lock, Unlock } from 'lucide-react'
import { DicteerKnop } from '@/components/admin/dicteer-knop'
import {
  urenPerWeek, workflowUren, voorstelVoor, binnenVork, waaromNietApart, waaromNietAfronden, terugverdienMaanden,
  type Proces, type Workflow, type Prijzen, type ProcesVoorstel, type Betrokkene,
} from '@/lib/ngs/audit'
import { maatLabel } from '@/lib/werking/instellingen'
import type { RapportDeal } from '@/lib/ngs/audit-server'
import { Venster, eur, inp, lbl } from './ui'

type Data = { deal: RapportDeal; processen: Proces[]; workflows: Workflow[]; prijzen: Prijzen }
const API = '/api/admin/nextgensolutions/levering/rapport'
async function doe(body: Record<string, unknown>) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Mislukt')
  return j as Record<string, unknown>
}

/**
 * Het auditrapport (nieuwe werking fase 3): de processen met wie ze aanraakt en
 * hoeveel uur per week, gebundeld tot workflows met een maat en een vaste prijs.
 * Intern zie je de formule; de klant (pdf, klantapp) ziet enkel maat, prijs,
 * bespaarde uren en terugverdientijd.
 */
export function RapportVenster({ dealId, onSluit }: { dealId: string; onSluit: () => void }) {
  const [d, setD] = useState<Data | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [kies, setKies] = useState<Set<string>>(new Set())
  const [voorstel, setVoorstel] = useState<ProcesVoorstel[] | null>(null)
  const [notities, setNotities] = useState({ audit: '', briefing: '' })
  const laad = useCallback(async () => {
    const r = await fetch(`${API}?deal=${dealId}`, { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j) { toast.error(j?.error || 'Laden mislukt'); return }
    setD(j as Data)
    setNotities({ audit: j.deal.audit_notities ?? '', briefing: j.deal.briefing_notities ?? '' })
  }, [dealId])
  useEffect(() => { laad() }, [laad])

  const stap = async (sleutel: string, body: Record<string, unknown>, melding?: string) => {
    setBezig(sleutel)
    try { await doe({ deal: dealId, ...body }); if (melding) toast.success(melding); await laad(); return true }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); return false } finally { setBezig(null) }
  }
  if (!d) return <Venster titel="Auditrapport" onSluit={onSluit} breed><div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div></Venster>

  const vast = !!d.deal.rapport_afgerond_op
  const p = d.prijzen
  const los = d.processen.filter((x) => !x.workflow_id)
  const waarom = waaromNietAfronden(d.workflows, d.processen, p)
  const totaal = d.workflows.reduce((s, w) => s + (w.prijs ?? 0), 0)
  const bewaarNotities = () => stap('notities', { actie: 'notities', audit_notities: notities.audit, briefing_notities: notities.briefing })
  const vraagVoorstel = async () => {
    setBezig('ai')
    try { await doe({ deal: dealId, actie: 'notities', audit_notities: notities.audit, briefing_notities: notities.briefing }); const j = await doe({ deal: dealId, actie: 'voorstel', audit_notities: notities.audit, briefing_notities: notities.briefing }); setVoorstel(j.voorstel as ProcesVoorstel[]) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  return (
    <Venster titel={`Auditrapport: ${d.deal.bedrijf}`} sub={vast ? 'Afgerond. Open het opnieuw om iets te veranderen.' : `${d.workflows.length} ${d.workflows.length === 1 ? 'workflow' : 'workflows'} · ${eur(totaal)}`} onSluit={onSluit} breed>
      <fieldset disabled={vast} className="space-y-5 disabled:opacity-90">
        {/* Notities en het voorstel van de AI */}
        <section className="space-y-2">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block"><span className={lbl}>Notities van de auditdag</span>
              <div className="relative"><textarea rows={5} className={`${inp} pr-10`} value={notities.audit} onChange={(e) => setNotities({ ...notities, audit: e.target.value })} onBlur={bewaarNotities} placeholder="Welke processen, wie doet ze, hoeveel uur per week?" />
                <div className="absolute right-1.5 top-1.5"><DicteerKnop klein zet={(f) => setNotities((n) => ({ ...n, audit: f(n.audit) }))} context={d.deal.bedrijf} /></div></div>
            </label>
            <label className="block"><span className={lbl}>Briefing aan de bouwer</span>
              <textarea rows={5} className={inp} value={notities.briefing} onChange={(e) => setNotities({ ...notities, briefing: e.target.value })} onBlur={bewaarNotities} placeholder="Wat moet de bouwer weten (30 minuten)?" />
            </label>
          </div>
          <button type="button" onClick={vraagVoorstel} disabled={!!bezig || notities.audit.trim().length < 40} className="btn-secondary text-sm">{bezig === 'ai' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Eerste versie voorstellen</button>
          {voorstel && (
            <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 space-y-2">
              <div className="text-sm font-semibold">Voorstel van de AI ({voorstel.length})</div>
              <ul className="space-y-1.5">{voorstel.map((x, i) => <li key={i} className="text-sm"><b>{x.naam}</b>{x.betrokkenen.length ? ` · ${x.betrokkenen.map((b) => `${b.naam} ${b.uren} u`).join(', ')}` : ''}<div className="text-xs text-gray-600">{x.oplossing}</div></li>)}</ul>
              <div className="flex gap-2">
                <button type="button" className="btn-primary !py-1 text-xs" disabled={!!bezig} onClick={async () => { if (await stap('over', { actie: 'voorstel.overnemen', processen: voorstel }, 'Overgenomen. Kijk de uren na.')) setVoorstel(null) }}><Check className="h-3.5 w-3.5" />Overnemen</button>
                <button type="button" className="btn-secondary !py-1 text-xs" onClick={() => setVoorstel(null)}>Niet overnemen</button>
              </div>
            </div>
          )}
        </section>

        {/* Processen */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold flex-1">Processen</h3>
            {kies.size >= 2 && <button type="button" className="btn-primary !py-1 text-xs" disabled={!!bezig} onClick={async () => { if (await stap('bundel', { actie: 'samenvoegen', processen: [...kies] }, 'Gebundeld tot één workflow.')) setKies(new Set()) }}><Layers className="h-3.5 w-3.5" />Samenvoegen ({kies.size})</button>}
          </div>
          {d.processen.length === 0 && <p className="text-sm text-gray-500">Nog geen processen. Voeg ze toe of laat de AI een eerste versie voorstellen.</p>}
          {d.processen.map((x) => (
            <ProcesRij key={x.id} p={x} prijzen={p} gekozen={kies.has(x.id)} onKies={(aan) => setKies((s) => { const n = new Set(s); if (aan) n.add(x.id); else n.delete(x.id); return n })}
              onBewaar={(b) => stap(`p${x.id}`, { actie: 'proces.wijzig', id: x.id, ...b })} onWeg={() => stap(`p${x.id}`, { actie: 'proces.weg', id: x.id })}
              onLos={() => stap(`p${x.id}`, { actie: 'proces.los', id: x.id }, 'Losgemaakt.')} bezig={bezig === `p${x.id}`} vast={vast} />
          ))}
          {!vast && <NieuwProces prijzen={p} onVoegToe={(b) => stap('nieuw', { actie: 'proces.nieuw', ...b })} />}
          {los.length > 0 && <p className="text-xs text-amber-800 inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Vink processen aan en voeg ze samen: elke workflow haalt minstens {p.min_uren} uur per week.</p>}
        </section>

        {/* Workflows */}
        <section className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold flex-1">Workflows</h3>
            {!vast && <button type="button" className="btn-secondary !py-1 text-xs" disabled={!!bezig} onClick={() => { const naam = prompt('Naam van het project zonder tijdswinst (bv. tool voor leads, klantenportaal)'); if (naam) stap('andere', { actie: 'workflow.andere', naam }) }}><Plus className="h-3.5 w-3.5" />Project zonder tijdswinst</button>}
          </div>
          {d.workflows.length === 0 && <p className="text-sm text-gray-500">Een proces dat minstens {p.min_uren} uur per week haalt, wordt vanzelf een workflow.</p>}
          {d.workflows.map((w) => <WorkflowRij key={w.id} w={w} processen={d.processen} prijzen={p} vast={vast} bezig={bezig === `w${w.id}`} onBewaar={(b) => stap(`w${w.id}`, { actie: 'workflow.wijzig', id: w.id, ...b }, 'Bewaard.')} onWeg={() => stap(`w${w.id}`, { actie: 'workflow.weg', id: w.id })} />)}
        </section>
      </fieldset>

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
        {vast ? (
          <button type="button" className="btn-secondary text-sm" disabled={!!bezig} onClick={() => stap('heropen', { actie: 'heropen' }, 'Weer open.')}><Unlock className="h-4 w-4" />Opnieuw openen</button>
        ) : (
          <button type="button" className="btn-primary text-sm" disabled={!!bezig || !!waarom} title={waarom ?? undefined} onClick={() => stap('afronden', { actie: 'afronden' }, 'Rapport afgerond.')}><Lock className="h-4 w-4" />Rapport afronden</button>
        )}
        <a href={`${API}?pdf=${dealId}`} target="_blank" rel="noopener" className="btn-secondary text-sm"><FileText className="h-4 w-4" />Rapport (pdf)</a>
        {!vast && waarom && <span className="text-xs text-amber-800">{waarom}</span>}
      </div>
    </Venster>
  )
}

function Betrokkenen({ lijst, zet, vast }: { lijst: Betrokkene[]; zet: (l: Betrokkene[]) => void; vast: boolean }) {
  return (
    <div className="space-y-1.5">
      {lijst.map((b, i) => (
        <div key={i} className="flex gap-1.5">
          <input className={inp} value={b.naam} onChange={(e) => zet(lijst.map((x, j) => (j === i ? { ...x, naam: e.target.value } : x)))} placeholder="Wie (functie of naam)" aria-label="Wie" />
          <input className={`${inp} !w-24`} inputMode="decimal" value={String(b.uren)} onChange={(e) => zet(lijst.map((x, j) => (j === i ? { ...x, uren: Number(e.target.value.replace(',', '.')) || 0 } : x)))} aria-label="Uren per week" />
          <span className="text-xs text-gray-500 self-center shrink-0">u/week</span>
          {!vast && <button type="button" onClick={() => zet(lijst.filter((_, j) => j !== i))} className="h-9 w-9 shrink-0 rounded-lg border border-gray-200 text-gray-500 hover:text-red-600" aria-label="Weghalen"><Trash2 className="h-4 w-4 mx-auto" /></button>}
        </div>
      ))}
      {!vast && <button type="button" onClick={() => zet([...lijst, { naam: '', uren: 0 }])} className="text-xs underline text-gray-600">+ iemand die het proces aanraakt</button>}
    </div>
  )
}

function ProcesRij({ p, prijzen, gekozen, onKies, onBewaar, onWeg, onLos, bezig, vast }: {
  p: Proces; prijzen: Prijzen; gekozen: boolean; onKies: (aan: boolean) => void; onBewaar: (b: Record<string, unknown>) => void; onWeg: () => void; onLos: () => void; bezig: boolean; vast: boolean
}) {
  const [naam, setNaam] = useState(p.naam)
  const [lijst, setLijst] = useState<Betrokkene[]>(p.betrokkenen)
  useEffect(() => { setNaam(p.naam); setLijst(p.betrokkenen) }, [p])
  const uren = urenPerWeek(lijst.filter((b) => b.naam.trim()))
  const gewijzigd = naam !== p.naam || JSON.stringify(lijst) !== JSON.stringify(p.betrokkenen)
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${p.workflow_id ? 'border-gray-100' : 'border-amber-300 bg-amber-50/40'}`}>
      <div className="flex items-center gap-2">
        {!vast && <input type="checkbox" className="h-4 w-4" checked={gekozen} onChange={(e) => onKies(e.target.checked)} aria-label={`${p.naam} kiezen om te bundelen`} />}
        <input className={`${inp} font-medium`} value={naam} onChange={(e) => setNaam(e.target.value)} aria-label="Naam van het proces" />
        <span className="text-xs text-gray-600 shrink-0 tabular-nums">{uren} u/week</span>
      </div>
      <Betrokkenen lijst={lijst} zet={setLijst} vast={vast} />
      {!p.workflow_id && <p className="text-xs text-amber-800">{waaromNietApart({ soort: 'tijd' }, p.uren_per_week, prijzen) ?? 'Nog in geen workflow.'}</p>}
      {!vast && (
        <div className="flex gap-2 flex-wrap">
          {gewijzigd && <button type="button" className="btn-primary !py-1 text-xs" disabled={bezig} onClick={() => onBewaar({ naam, betrokkenen: lijst.filter((b) => b.naam.trim()) })}>{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Bewaren</button>}
          {p.workflow_id && <button type="button" className="btn-secondary !py-1 text-xs" disabled={bezig} onClick={onLos}><Unlink className="h-3.5 w-3.5" />Losmaken uit de workflow</button>}
          <button type="button" className="text-xs text-red-600 underline" disabled={bezig} onClick={() => { if (confirm(`${p.naam} uit het rapport halen?`)) onWeg() }}>Weghalen</button>
        </div>
      )}
    </div>
  )
}

function NieuwProces({ prijzen, onVoegToe }: { prijzen: Prijzen; onVoegToe: (b: Record<string, unknown>) => Promise<boolean> }) {
  const [naam, setNaam] = useState('')
  const [lijst, setLijst] = useState<Betrokkene[]>([{ naam: '', uren: 0 }])
  const [bezig, setBezig] = useState(false)
  const uren = urenPerWeek(lijst.filter((b) => b.naam.trim()))
  return (
    <details className="rounded-xl border border-dashed border-gray-300 p-3">
      <summary className="text-sm font-medium cursor-pointer select-none inline-flex items-center gap-1.5"><Plus className="h-4 w-4" />Proces toevoegen</summary>
      <div className="space-y-2 mt-2">
        <input className={inp} value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="bv. Offertes opmaken" aria-label="Naam van het proces" />
        <Betrokkenen lijst={lijst} zet={setLijst} vast={false} />
        <p className="text-xs text-gray-500">{uren} uur per week{uren < prijzen.min_uren ? ` · onder ${prijzen.min_uren} uur: daarna bundelen met een ander proces` : ''}</p>
        <button type="button" className="btn-primary !py-1 text-xs" disabled={bezig || !naam.trim()} onClick={async () => { setBezig(true); if (await onVoegToe({ naam, betrokkenen: lijst.filter((b) => b.naam.trim()) })) { setNaam(''); setLijst([{ naam: '', uren: 0 }]) } setBezig(false) }}>{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Toevoegen</button>
      </div>
    </details>
  )
}

function WorkflowRij({ w, processen, prijzen, vast, bezig, onBewaar, onWeg }: {
  w: Workflow; processen: Proces[]; prijzen: Prijzen; vast: boolean; bezig: boolean; onBewaar: (b: Record<string, unknown>) => void; onWeg: () => void
}) {
  const [v, setV] = useState({ naam: w.naam, oplossing: w.oplossing ?? '', prijs: w.prijs ? String(w.prijs) : '', reden: w.prijs_reden ?? '', interface: w.interface_of_logboek, geschat: w.geschatte_uren ? String(w.geschatte_uren) : '', markt: w.marktcheck ?? '' })
  useEffect(() => { setV({ naam: w.naam, oplossing: w.oplossing ?? '', prijs: w.prijs ? String(w.prijs) : '', reden: w.prijs_reden ?? '', interface: w.interface_of_logboek, geschat: w.geschatte_uren ? String(w.geschatte_uren) : '', markt: w.marktcheck ?? '' }) }, [w])
  const delen = useMemo(() => processen.filter((x) => x.workflow_id === w.id), [processen, w.id])
  const uren = workflowUren(w, processen)
  const andere = w.soort === 'andere_waarde'
  const formule = voorstelVoor({ soort: w.soort, geschatte_uren: Number(v.geschat) || null }, uren, prijzen)
  const prijs = Number(v.prijs.replace(',', '.')) || 0
  const buiten = !andere && prijs > 0 && !binnenVork(w.maat, prijs, prijzen)
  const vork = w.maat ? prijzen.maten[w.maat] : null
  const apart = waaromNietApart(w, uren, prijzen)
  const tvt = terugverdienMaanden(prijs || null, uren, w, prijzen)
  const bewaar = () => onBewaar({
    naam: v.naam, oplossing: v.oplossing, interface_of_logboek: v.interface, prijs: v.prijs ? v.prijs.replace(',', '.') : null, prijs_reden: v.reden,
    ...(andere ? { geschatte_uren: v.geschat ? v.geschat.replace(',', '.') : null, marktcheck: v.markt } : {}),
  })
  return (
    <div className="rounded-xl border border-blue-100 bg-white p-3.5 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${inp} font-semibold flex-1 min-w-[12rem]`} value={v.naam} onChange={(e) => setV({ ...v, naam: e.target.value })} aria-label="Naam van de workflow" />
        <span className="text-xs rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-blue-900">{andere ? 'Andere waarde' : w.maat ? maatLabel(w.maat) : 'Geen maat'}</span>
      </div>
      {!andere && <p className="text-xs text-gray-600">{delen.map((x) => x.naam).join(' + ') || 'Geen processen'} · {uren} u/week bespaard</p>}
      {apart && <p className="text-xs text-amber-800 inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />{apart}</p>}
      {andere && (
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="block"><span className={lbl}>Geschatte uren werk</span><input className={inp} inputMode="decimal" value={v.geschat} onChange={(e) => setV({ ...v, geschat: e.target.value })} /></label>
          <label className="block"><span className={lbl}>Marktcheck</span><input className={inp} value={v.markt} onChange={(e) => setV({ ...v, markt: e.target.value })} placeholder="Wat kost dit elders?" /></label>
        </div>
      )}
      <label className="block"><span className={lbl}>Oplossing</span><textarea rows={3} className={inp} value={v.oplossing} onChange={(e) => setV({ ...v, oplossing: e.target.value })} placeholder="Wat bouwen we, en hoe ziet de klant het (interface of logboek)?" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.interface} onChange={(e) => setV({ ...v, interface: e.target.checked })} />Er is een interface of minstens een logboek</label>
      <div className="grid sm:grid-cols-2 gap-2 items-end">
        <label className="block"><span className={lbl}>Vaste prijs (excl. btw)</span><input className={inp} inputMode="decimal" value={v.prijs} onChange={(e) => setV({ ...v, prijs: e.target.value })} placeholder={formule.prijs ? String(formule.prijs) : ''} /></label>
        <p className="text-[11px] text-gray-500 pb-2">
          {/* Intern: de formule. De klant ziet dit nooit. */}
          {andere ? `${v.geschat || 0} u × ${eur(prijzen.andere_uurprijs)} = ${formule.prijs ? eur(formule.prijs) : '—'}` : `${uren} u × ${prijzen.weken} weken × ${eur(prijzen.uurwaarde)} = ${formule.prijs ? eur(formule.prijs) : '—'}`}
          {vork ? ` · vork ${eur(vork.min)}${vork.max ? ` tot ${eur(vork.max)}` : ' en meer'}` : ''}{tvt ? ` · terugverdiend in ± ${tvt.toLocaleString('nl-BE')} maanden` : ''}
        </p>
      </div>
      {buiten && <label className="block"><span className={lbl}>Waarom buiten de vork? (minstens tien tekens)</span><input className={inp} value={v.reden} onChange={(e) => setV({ ...v, reden: e.target.value })} /></label>}
      {!vast && (
        <div className="flex gap-2 flex-wrap">
          <button type="button" className="btn-primary !py-1 text-xs" disabled={bezig || (buiten && v.reden.trim().length < 10)} onClick={bewaar}>{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Bewaren</button>
          {w.prijs_reden && <button type="button" className="btn-secondary !py-1 text-xs" disabled={bezig} onClick={() => onBewaar({ prijs: null })}>Terug naar de formule</button>}
          <button type="button" className="text-xs text-red-600 underline" disabled={bezig} onClick={() => { if (confirm(`${w.naam} uit het rapport halen? De processen blijven en komen los te staan.`)) onWeg() }}>Weghalen</button>
        </div>
      )}
    </div>
  )
}
