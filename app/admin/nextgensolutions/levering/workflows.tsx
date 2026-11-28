'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, Loader2, Plus, CalendarPlus, Pause, Play, Video, Archive, AlertTriangle, ChevronDown } from 'lucide-react'
import {
  WF_FASES, wfFaseLabel, bouwDagenGeteld, bouwTeLaat, bouwDeadline, nazorgStand, dodVan, waaromNietNaarWf, tijdlijnBalken,
  type WfLevering, type Levering,
} from '@/lib/ngs/workflow-levering'
import { maatLabel } from '@/lib/werking/instellingen'
import { MailComposer } from '@/components/admin/mail-composer'
import { inp, lbl, dagKort, eur } from '../ui'

export type WfCall = { id: string | null; op: string; titel: string; bron: 'meeting' | 'zelf'; notitie: string | null; index: number | null }
export type WfRij = WfLevering & { calls: WfCall[] }
export type WfData = { workflows: WfRij[]; uitRapport: { aantal: number; afgerond: boolean }; levering: Levering }
type Doe = (body: Record<string, unknown>, sleutel: string, ok?: string) => Promise<Record<string, unknown> | null>

const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const FASE_KLEUR: Record<string, string> = { gepland: 'bg-gray-300', bouw: 'bg-blue-600', oplevering: 'bg-amber-500', nazorg: 'bg-violet-500', klaar: 'bg-green-600' }

/** Levering per workflow (nieuwe werking fase 4): elke workflow uit het rapport apart door bouw, oplevering en nazorg. */
export function WorkflowsSectie({ data, clientId, stories, bezig, doe, onVernieuw }: { data: WfData; clientId: string | null; stories: { status: string; workflow_id?: string | null }[]; bezig: string | null; doe: Doe; onVernieuw: () => void }) {
  const [naam, setNaam] = useState('')
  const ws = data.workflows
  const d = vandaag()
  const lijn = tijdlijnBalken(ws, d)
  const klaar = ws.filter((w) => w.fase === 'klaar').length
  return (
    <details className="group rounded-xl border border-gray-100" open>
      <summary className="px-3.5 py-2.5 cursor-pointer select-none flex items-center gap-2 list-none">
        <span className="text-sm font-semibold flex-1">Workflows</span>
        <span className="text-xs text-gray-500">{ws.length ? `${ws.length} · ${klaar} klaar` : 'nog geen'}</span>
        <ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3.5 pb-3.5 space-y-3">
        {data.uitRapport.aantal > 0 && (data.uitRapport.afgerond
          ? <button type="button" disabled={!!bezig} onClick={() => doe({ actie: 'wf.overnemen' }, 'over', 'Workflows overgenomen.')} className="btn-primary !py-1.5 !text-sm">{bezig === 'over' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{data.uitRapport.aantal} {data.uitRapport.aantal === 1 ? 'workflow' : 'workflows'} uit het auditrapport overnemen</button>
          : <p className="text-xs text-gray-500">Het auditrapport heeft {data.uitRapport.aantal} {data.uitRapport.aantal === 1 ? 'workflow' : 'workflows'}, maar is nog niet afgerond.</p>)}

        {lijn && (
          <div className="rounded-xl bg-gray-50 p-2.5 space-y-1" aria-label="Tijdlijn">
            {lijn.balken.map((b) => (
              <div key={b.id} className="flex items-center gap-2">
                <span className="text-[11px] text-gray-600 w-28 truncate shrink-0">{b.naam}</span>
                <div className="relative flex-1 h-3.5">
                  <div className={`absolute h-3.5 rounded ${FASE_KLEUR[b.fase]}`} style={{ left: `${b.links}%`, width: `${b.breedte}%` }} title={`${wfFaseLabel(b.fase)}: ${dagKort(b.van)} – ${dagKort(b.tot)}`} />
                </div>
              </div>
            ))}
            <div className="flex justify-between text-[10px] text-gray-400 pl-[7.5rem]"><span>{dagKort(lijn.van)}</span><span>{dagKort(lijn.tot)}</span></div>
          </div>
        )}

        <ul className="space-y-2">
          {ws.map((w) => <WorkflowKaart key={w.id} w={w} L={data.levering} clientId={clientId} stories={stories.filter((s) => s.workflow_id === w.id)} bezig={bezig} doe={doe} onVernieuw={onVernieuw} />)}
        </ul>

        <form className="flex gap-1.5" onSubmit={async (e) => { e.preventDefault(); if (naam.trim().length < 2) return; const j = await doe({ actie: 'wf.nieuw', naam }, 'wfn', 'Workflow toegevoegd.'); if (j) setNaam('') }}>
          <input className={`${inp} !py-1.5`} value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Workflow zonder rapport toevoegen" />
          <button type="submit" disabled={naam.trim().length < 2 || !!bezig} className="btn-secondary !py-1.5 !px-2.5" aria-label="Toevoegen"><Plus className="h-4 w-4" /></button>
        </form>
      </div>
    </details>
  )
}

function WorkflowKaart({ w, L, clientId, stories, bezig, doe, onVernieuw }: { w: WfRij; L: Levering; clientId: string | null; stories: { status: string }[]; bezig: string | null; doe: Doe; onVernieuw: () => void }) {
  const d = vandaag()
  const [open, setOpen] = useState(w.fase !== 'klaar')
  const [reden, setReden] = useState('')
  const [links, setLinks] = useState({ opname: w.opname_link ?? '', video: w.video_link ?? '' })
  const [call, setCall] = useState('')
  const [wie, setWie] = useState(w.verantwoordelijke ?? '')
  const zet = (body: Record<string, unknown>, sleutel: string, ok?: string) => doe({ ...body, workflow: w.id }, sleutel, ok)
  const teLaat = bouwTeLaat(w, d, L)
  const deadline = bouwDeadline(w, L)
  const geteld = bouwDagenGeteld(w, d)
  const nz = nazorgStand(w, w.calls, d, L)
  const dod = dodVan(w, stories)
  const linksGewijzigd = links.opname !== (w.opname_link ?? '') || links.video !== (w.video_link ?? '')
  const idx = WF_FASES.findIndex((f) => f.key === w.fase)
  return (
    <li className="rounded-xl border border-gray-200">
      <button type="button" onClick={() => setOpen(!open)} className="w-full text-left px-3 py-2.5 flex items-center gap-2">
        <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${FASE_KLEUR[w.fase]}`} />
        <span className="text-sm font-semibold flex-1 min-w-0 truncate">{w.naam}</span>
        {(teLaat || nz.teLaat) && <AlertTriangle className="h-3.5 w-3.5 text-red-600" aria-label="Op te volgen" />}
        {w.wacht_op_klant && <span className="text-[10px] rounded-full px-1.5 border border-amber-200 bg-amber-50 text-amber-900">wacht op klant</span>}
        <span className="text-[11px] text-gray-500">{wfFaseLabel(w.fase)}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-100">
          <div className="text-xs text-gray-600">{[maatLabel(w.maat), w.prijs ? `${eur(w.prijs)} vaste prijs` : null, w.oplossing].filter(Boolean).join(' · ') || 'Zonder rapport'}</div>

          <div className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-gray-100" role="group" aria-label="Fase van de workflow">
            {WF_FASES.map((f, i) => {
              const fout = waaromNietNaarWf(w, f.key, stories)
              return (
                <button key={f.key} type="button" disabled={!!bezig} title={fout ?? undefined} aria-pressed={w.fase === f.key}
                  onClick={() => f.key !== w.fase && zet({ actie: 'wf.fase', naar: f.key }, `f${w.id}`, `${w.naam}: ${f.label}.`)}
                  className={`h-8 rounded-lg text-[11px] leading-tight px-0.5 ${w.fase === f.key ? 'bg-white shadow-sm font-semibold text-gray-900' : i < idx ? 'text-gray-700' : 'text-gray-500 hover:text-gray-900'}`}>{f.label}</button>
              )
            })}
          </div>

          <label className="block"><span className={lbl}>Bouwt</span>
            <input className={inp} value={wie} onChange={(e) => setWie(e.target.value)} onBlur={() => wie !== (w.verantwoordelijke ?? '') && zet({ actie: 'wf.wijzig', verantwoordelijke: wie }, `v${w.id}`)} placeholder={L.verantwoordelijke} />
          </label>

          {w.fase === 'bouw' && (
            <div className="rounded-xl bg-gray-50 px-3 py-2.5 space-y-2">
              <div className={`text-sm ${teLaat ? 'text-red-700 font-medium' : ''}`}>
                {w.wacht_op_klant ? <>Wacht op de klant: {w.wacht_reden}. Deze dagen tellen niet mee.</>
                  : teLaat ? <>{teLaat} {teLaat === 1 ? 'dag' : 'dagen'} over de {L.bouw_dagen} dagen bouw.</>
                  : <>Dag {geteld ?? 0} van {L.bouw_dagen}{deadline ? `, af tegen ${dagKort(deadline)}` : ''}.</>}
                {w.wacht_dagen > 0 && !w.wacht_op_klant && <span className="text-gray-500"> ({w.wacht_dagen} {w.wacht_dagen === 1 ? 'dag' : 'dagen'} gewacht, telt niet)</span>}
              </div>
              {w.wacht_op_klant
                ? <button type="button" disabled={!!bezig} onClick={() => zet({ actie: 'wf.wacht_stop' }, `w${w.id}`, 'We bouwen verder.')} className="btn-secondary !py-1.5 !text-sm"><Play className="h-4 w-4" />Klant is rond, verder bouwen</button>
                : (
                  <form className="flex gap-1.5" onSubmit={async (e) => { e.preventDefault(); const j = await zet({ actie: 'wf.wacht', reden }, `w${w.id}`, 'Wacht op de klant.'); if (j) setReden('') }}>
                    <input className={`${inp} !py-1.5`} value={reden} onChange={(e) => setReden(e.target.value)} placeholder="Waarop wachten we? (bv. logins)" />
                    <button type="submit" disabled={reden.trim().length < 3 || !!bezig} className="btn-secondary !py-1.5 !text-sm whitespace-nowrap"><Pause className="h-4 w-4" />Wacht op klant</button>
                  </form>
                )}
            </div>
          )}

          {idx >= 2 && (
            <div className="space-y-2">
              <div className="grid sm:grid-cols-2 gap-2">
                <label className="block"><span className={lbl}>Link naar de opname</span><input className={inp} value={links.opname} onChange={(e) => setLinks({ ...links, opname: e.target.value })} placeholder="https://" inputMode="url" /></label>
                <label className="block"><span className={lbl}>Link naar de video voor de klant</span><input className={inp} value={links.video} onChange={(e) => setLinks({ ...links, video: e.target.value })} placeholder="https://" inputMode="url" /></label>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {linksGewijzigd && <button type="button" disabled={!!bezig} onClick={() => zet({ actie: 'wf.links', opname_link: links.opname, video_link: links.video }, `l${w.id}`, 'Links bewaard.')} className="btn-secondary !py-1.5 !text-sm"><Check className="h-4 w-4" />Bewaren</button>}
                {w.video_link && !linksGewijzigd && <MailComposer context={{ type: 'ngs_workflow', workflowId: w.id }} label={w.video_gestuurd_op ? 'Video opnieuw sturen' : 'Video naar de klant'} className="btn-secondary !py-1.5 !text-sm" onSent={onVernieuw} />}
                {w.video_gestuurd_op && <span className="text-[11px] text-green-800 inline-flex items-center gap-1"><Video className="h-3.5 w-3.5" />bij de klant sinds {dagKort(w.video_gestuurd_op)}</span>}
              </div>
            </div>
          )}

          {idx >= 3 && (
            <div className="space-y-1.5">
              <div className={`text-xs font-semibold ${nz.teLaat ? 'text-red-700' : ''}`}>
                Nazorg: {nz.gehouden} van {nz.nodig} {nz.nodig === 1 ? 'call' : 'calls'} van {L.nazorg_call_min} min
                {nz.teLaat ? ` · deze week nog geen call (${nz.teLaat} ${nz.teLaat === 1 ? 'dag' : 'dagen'} te laat)` : nz.volgendeTegen ? ` · volgende tegen ${dagKort(nz.volgendeTegen)}` : ''}
              </div>
              {w.calls.length > 0 && (
                <ul className="text-sm space-y-0.5">
                  {w.calls.map((c, i) => (
                    <li key={`${c.id ?? 'z'}${i}`} className="flex items-center gap-2">
                      <span className="tabular-nums text-gray-600 w-20">{dagKort(c.op)}</span>
                      <span className="flex-1 truncate">{c.bron === 'meeting' ? c.titel : c.notitie || 'Call buiten de app'}</span>
                      {c.bron === 'zelf' && c.index !== null && <button type="button" disabled={!!bezig} onClick={() => zet({ actie: 'wf.call_weg', index: c.index }, `c${w.id}`)} className="text-[11px] text-gray-500 hover:text-gray-900">weg</button>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-1.5 items-center">
                <Link href={`/admin/meetings?plan=1&workflow=${w.id}${clientId ? `&klant=${clientId}` : ''}`} className="btn-secondary !py-1.5 !text-sm"><CalendarPlus className="h-4 w-4" />Call inplannen</Link>
                <form className="flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (!call) return; const j = await zet({ actie: 'wf.call', op: call }, `c${w.id}`, 'Call genoteerd.'); if (j) setCall('') }}>
                  <input type="date" className={`${inp} !py-1.5 !w-40`} value={call} onChange={(e) => setCall(e.target.value)} aria-label="Call buiten de app" />
                  <button type="submit" disabled={!call || !!bezig} className="btn-secondary !py-1.5 !text-sm">Gehouden</button>
                </form>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="text-xs font-semibold">Definitie van klaar</div>
            {dod.map((x) => (
              <div key={x.titel} className="flex items-center gap-2 text-sm">
                {x.titel.startsWith('Interface')
                  ? <input type="checkbox" checked={x.ok} disabled={!!bezig} onChange={(e) => zet({ actie: 'wf.wijzig', interface_of_logboek: e.target.checked }, `i${w.id}`)} aria-label={x.titel} />
                  : <span className={`h-3.5 w-3.5 rounded-full border ${x.ok ? 'bg-green-600 border-green-600' : 'border-gray-300'}`} />}
                <span className={x.ok ? 'text-gray-500' : ''}>{x.titel}</span>
              </div>
            ))}
          </div>

          {w.fase === 'gepland' && (
            <button type="button" disabled={!!bezig} onClick={() => { if (confirm(`"${w.naam}" weghalen uit de levering? Hij blijft bewaard.`)) void zet({ actie: 'wf.weg' }, `x${w.id}`, 'Weggehaald.') }} className="text-xs text-gray-500 inline-flex items-center gap-1 hover:text-gray-900"><Archive className="h-3.5 w-3.5" />Weghalen</button>
          )}
        </div>
      )}
    </li>
  )
}
