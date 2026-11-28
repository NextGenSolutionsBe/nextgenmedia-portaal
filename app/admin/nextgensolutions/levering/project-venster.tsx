'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, Loader2, Plus, Sparkles, CalendarPlus, FileText, Archive, ChevronDown, Undo2, AlertTriangle } from 'lucide-react'
import {
  PROJECT_FASES, BRIEFING_VELDEN, briefingOntbreekt, STORY_STATUSSEN, storyZin, planUitStories, urenStand, waaromNietKlaar,
  TIJDSCAN_SJABLOON, type Briefing, type ProjectFase, type UserStory, type StoryVoorstel, type BriefingVoorstel,
} from '@/lib/ngs/levering'
import { DicteerKnop } from '@/components/admin/dicteer-knop'
import { Venster, inp, lbl, dagKort, eur, eurCent, tijdstip } from '../ui'
import { CareLijst, lever, type CareRij } from './care'
import { WorkflowsSectie, type WfData } from './workflows'

type Project = {
  id: string; deal_id: string | null; client_id: string | null; titel: string; fase: ProjectFase; verantwoordelijke: string | null
  briefing: Briefing; briefing_bevestigd_op: string | null; briefing_bevestigd_door: string | null
  tijdscan_op: string | null; tijdscan_notities: string | null; plan_uurtarief: number | null; plan_prijs: number | null
  plan_goedgekeurd_op: string | null; plan_goedgekeurd_door: string | null; review_dag: number | null; review_uur: string | null; review_reeks_id: string | null
  acties: { id: string; tekst: string; wie: string | null; tegen: string | null; gedaan_op: string | null; uit_review: string | null }[]
}
type Detail = { project: Project; stories: UserStory[]; klant: string | null; deal: { id: string; bedrijf: string; fase: string } | null; care: CareRij[] }
const DAGEN = ['ma', 'di', 'wo', 'do', 'vr']

function Sectie({ titel, sub, open, children, waarschuwing }: { titel: string; sub?: string; open?: boolean; children: React.ReactNode; waarschuwing?: boolean }) {
  return (
    <details className="group rounded-xl border border-gray-100" open={open}>
      <summary className="px-3.5 py-2.5 cursor-pointer select-none flex items-center gap-2 list-none">
        <span className="text-sm font-semibold flex-1">{titel}{waarschuwing && <AlertTriangle className="h-3.5 w-3.5 inline ml-1.5 text-amber-600" />}</span>
        {sub && <span className="text-xs text-gray-500 truncate max-w-[55%]">{sub}</span>}
        <ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="px-3.5 pb-3.5 space-y-3">{children}</div>
    </details>
  )
}

export function ProjectVenster({ id, onSluit, onVernieuw }: { id: string; onSluit: () => void; onVernieuw: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [wf, setWf] = useState<WfData | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const laad = useCallback(async () => {
    const [r, rw] = await Promise.all([
      fetch(`/api/admin/nextgensolutions/levering?project=${id}`, { cache: 'no-store' }),
      fetch(`/api/admin/nextgensolutions/levering?workflows=${id}`, { cache: 'no-store' }),
    ])
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j.error || 'Laden mislukt'); onSluit(); return }
    setD(j as Detail)
    if (rw.ok) setWf((await rw.json()) as WfData)
  }, [id, onSluit])
  useEffect(() => { void laad() }, [laad])

  const doe = async (body: Record<string, unknown>, sleutel: string, ok?: string) => {
    setBezig(sleutel)
    try { const j = await lever({ id, ...body }); if (ok) toast.success(ok); await laad(); onVernieuw(); return j } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); return null } finally { setBezig(null) }
  }

  if (!d) return <Venster titel="Project" onSluit={onSluit} breed><div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div></Venster>
  const p = d.project
  const geldig = d.stories
  const plan = planUitStories(geldig, p.plan_uurtarief)
  const u = urenStand(geldig)
  const faseIdx = PROJECT_FASES.findIndex((f) => f.key === p.fase)
  // Met workflows uit het auditrapport ligt de vaste prijs per workflow vast; het oude plan (uren × tarief) valt weg.
  const metWf = !!wf?.workflows.length
  const wfPrijs = (wf?.workflows ?? []).reduce((s, w) => s + (w.prijs ?? 0), 0)

  return (
    <Venster breed onSluit={onSluit} titel={p.titel}
      sub={<span>{d.klant ? `Klant: ${d.klant}` : 'Nog geen klant gekoppeld'}{d.deal ? <> · <Link href={`/admin/nextgensolutions?deal=${d.deal.id}`} className="underline">deal</Link></> : null}{p.verantwoordelijke ? ` · ${p.verantwoordelijke}` : ''}</span>}>
      {/* Fase: klik = verplaatsen (de app zegt wat er nog ontbreekt) */}
      <div className="grid grid-cols-4 sm:grid-cols-7 gap-1 p-1 rounded-xl bg-gray-100" role="group" aria-label="Fase">
        {PROJECT_FASES.map((f, i) => (
          <button key={f.key} type="button" disabled={!!bezig} onClick={() => f.key !== p.fase && doe({ actie: 'project.fase', naar: f.key }, 'fase', `Naar ${f.label}.`)} aria-pressed={p.fase === f.key}
            className={`h-9 rounded-lg text-[11px] leading-tight px-1 ${p.fase === f.key ? 'bg-white shadow-sm font-semibold text-gray-900' : i < faseIdx ? 'text-gray-700' : 'text-gray-500 hover:text-gray-900'}`}>{f.label}</button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Getal label="User stories" waarde={`${geldig.filter((s) => s.status === 'klaar').length}/${geldig.filter((s) => s.status !== 'voorstel').length}`} sub="klaar" />
        <Getal label="Uren" waarde={`${u.besteed}/${u.geschat}`} sub={u.over ? 'meer dan geschat' : 'besteed / geschat'} rood={u.over} />
        {metWf
          ? <Getal label="Vaste prijs" waarde={wfPrijs ? eur(wfPrijs) : '—'} sub={`${wf!.workflows.length} ${wf!.workflows.length === 1 ? 'workflow' : 'workflows'}`} />
          : <Getal label="Vaste prijs" waarde={p.plan_goedgekeurd_op && p.plan_prijs ? eur(p.plan_prijs) : plan.prijs ? `± ${eur(plan.prijs)}` : '—'} sub={p.plan_goedgekeurd_op ? 'goedgekeurd' : 'nog niet goedgekeurd'} />}
      </div>

      {wf && <WorkflowsSectie data={wf} clientId={p.client_id} stories={d.stories} bezig={bezig} doe={doe} onVernieuw={() => { void laad(); onVernieuw() }} />}
      <Tijdscan p={p} klantId={p.client_id} bezig={bezig} doe={doe} stories={d.stories} />
      <BriefingSectie p={p} bezig={bezig} doe={doe} />
      <Stories p={p} stories={d.stories} bezig={bezig} doe={doe} workflows={(wf?.workflows ?? []).map((w) => ({ id: w.id, naam: w.naam }))} />
      {!metWf && <PlanSectie p={p} stories={d.stories} bezig={bezig} doe={doe} />}
      <Review p={p} bezig={bezig} doe={doe} />

      <Sectie titel="Care" sub={d.care.length ? `${d.care.length} in Care` : 'na de oplevering'}>
        <CareLijst items={d.care} onVernieuw={() => { void laad(); onVernieuw() }} nieuw={{ client_id: p.client_id, project_id: p.id }} />
      </Sectie>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/admin/opleveringen" className="btn-secondary !py-1.5 !text-sm"><FileText className="h-4 w-4" />Oplevering delen (demo, handleiding)</Link>
        {p.client_id && <Link href={`/admin/contracts/templates?client=${p.client_id}`} className="btn-secondary !py-1.5 !text-sm"><FileText className="h-4 w-4" />Contract opmaken</Link>}
        <button type="button" disabled={!!bezig} onClick={() => { if (confirm('Dit project archiveren? Alles blijft bewaard.')) void doe({ actie: 'project.archiveer' }, 'arch', 'Gearchiveerd.').then((j) => { if (j) onSluit() }) }} className="text-xs text-gray-500 inline-flex items-center gap-1 hover:text-gray-900 ml-auto"><Archive className="h-3.5 w-3.5" />Archiveren</button>
      </div>
    </Venster>
  )
}

function Getal({ label, waarde, sub, rood }: { label: string; waarde: string; sub: string; rood?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-100 px-2 py-2.5">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`text-base sm:text-lg font-semibold tabular-nums ${rood ? 'text-red-700' : ''}`}>{waarde}</div>
      <div className={`text-[10px] ${rood ? 'text-red-700' : 'text-gray-400'}`}>{sub}</div>
    </div>
  )
}

type Doe = (body: Record<string, unknown>, sleutel: string, ok?: string) => Promise<Record<string, unknown> | null>

/** Audit (vroeger tijdscan): datum, notities met sjabloon, inplannen en een AI-voorstel voor briefing en stories. */
function Tijdscan({ p, klantId, bezig, doe, stories }: { p: Project; klantId: string | null; bezig: string | null; doe: Doe; stories: UserStory[] }) {
  const [datum, setDatum] = useState(p.tijdscan_op ?? '')
  const [notities, setNotities] = useState(p.tijdscan_notities ?? TIJDSCAN_SJABLOON)
  const [voorstel, setVoorstel] = useState<{ briefing: BriefingVoorstel; stories: StoryVoorstel[] } | null>(null)
  const [kies, setKies] = useState<Set<number>>(new Set())
  const gewijzigd = datum !== (p.tijdscan_op ?? '') || notities !== (p.tijdscan_notities ?? TIJDSCAN_SJABLOON)
  const vraagVoorstel = async () => {
    if (gewijzigd) await doe({ actie: 'project.wijzig', tijdscan_op: datum || null, tijdscan_notities: notities }, 'tijdscan')
    const j = await doe({ actie: 'project.voorstel', notities }, 'ai')
    const v = j?.voorstel as typeof voorstel
    if (v) { setVoorstel(v); setKies(new Set(v.stories.map((_, i) => i))) }
  }
  const briefingLeeg = BRIEFING_VELDEN.filter((v) => voorstel?.briefing[v.key] && !p.briefing[v.key])
  return (
    <Sectie titel="Audit" sub={p.tijdscan_op ? `op ${dagKort(p.tijdscan_op)}` : 'nog niet gehouden'} open={p.fase === 'briefing' && !p.briefing_bevestigd_op}>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="block"><span className={lbl}>Datum van de audit</span><input type="date" className={inp} value={datum} onChange={(e) => setDatum(e.target.value)} /></label>
        <Link href={`/admin/meetings?plan=1${klantId ? `&klant=${klantId}` : ''}`} className="btn-secondary !py-2 !text-sm"><CalendarPlus className="h-4 w-4" />Audit inplannen</Link>
      </div>
      <label className="block">
        <span className={lbl}>Notities</span>
        <div className="relative">
          <textarea rows={10} className={`${inp} pr-10 font-mono text-[13px]`} value={notities} onChange={(e) => setNotities(e.target.value)} />
          <div className="absolute right-1.5 top-1.5"><DicteerKnop klein zet={setNotities} context={p.titel} /></div>
        </div>
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!gewijzigd || !!bezig} onClick={() => doe({ actie: 'project.wijzig', tijdscan_op: datum || null, tijdscan_notities: notities }, 'tijdscan', 'Tijdscan bewaard.')} className="btn-secondary !py-1.5 !text-sm">{bezig === 'tijdscan' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bewaren</button>
        <button type="button" disabled={!!bezig} onClick={vraagVoorstel} className="btn-primary !py-1.5 !text-sm">{bezig === 'ai' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Voorstel voor briefing en user stories</button>
      </div>
      {voorstel && (
        <div className="rounded-xl border border-dashed border-gray-300 p-3 space-y-3">
          <p className="text-xs text-gray-600">Enkel een voorstel: kijk na en neem over wat klopt. Er is nog niets bewaard.</p>
          {briefingLeeg.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold">Briefing (enkel lege velden)</div>
              {briefingLeeg.map((v) => <div key={v.key} className="text-xs"><b>{v.label}:</b> {voorstel.briefing[v.key]}</div>)}
              <button type="button" disabled={!!bezig} onClick={() => doe({ actie: 'project.wijzig', briefing: { ...p.briefing, ...Object.fromEntries(briefingLeeg.map((v) => [v.key, voorstel.briefing[v.key]])) } }, 'bri', 'In de briefing gezet. Kijk ze na en bevestig.')} className="btn-secondary !py-1 !text-xs">In de briefing zetten</button>
            </div>
          )}
          {voorstel.stories.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold">User stories ({kies.size} van {voorstel.stories.length} gekozen)</div>
              <ul className="space-y-1">
                {voorstel.stories.map((s, i) => (
                  <li key={i}><label className="flex items-start gap-2 text-xs cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={kies.has(i)} onChange={(e) => { const n = new Set(kies); if (e.target.checked) n.add(i); else n.delete(i); setKies(n) }} />
                    <span><b>{s.titel}</b>{s.schatting_uren !== null ? ` · ${s.schatting_uren} u` : ''}<br /><span className="text-gray-600">{storyZin(s)}</span></span>
                  </label></li>
                ))}
              </ul>
              {p.briefing_bevestigd_op
                ? <button type="button" disabled={!kies.size || !!bezig} onClick={async () => { const j = await doe({ actie: 'story.nieuw', stories: voorstel.stories.filter((_, i) => kies.has(i)) }, 'st', 'User stories toegevoegd als voorstel.'); if (j) setVoorstel(null) }} className="btn-secondary !py-1 !text-xs">Gekozen stories toevoegen</button>
                : <p className="text-[11px] text-amber-800">Bevestig eerst de briefing; daarna kan je de stories toevoegen.</p>}
            </div>
          )}
          <button type="button" onClick={() => setVoorstel(null)} className="text-xs text-gray-500 underline">Voorstel sluiten</button>
        </div>
      )}
      {stories.length === 0 && p.briefing_bevestigd_op && !voorstel && <p className="text-[11px] text-gray-500">Tip: het voorstel maakt ook user stories uit deze notities.</p>}
    </Sectie>
  )
}

/** Briefing: vast formulier, verplicht voor de user stories. Een mens bevestigt. */
function BriefingSectie({ p, bezig, doe }: { p: Project; bezig: string | null; doe: Doe }) {
  const [b, setB] = useState<Briefing>(p.briefing)
  useEffect(() => { setB(p.briefing) }, [p.briefing])
  const gewijzigd = JSON.stringify(b) !== JSON.stringify(p.briefing)
  const mist = briefingOntbreekt(b)
  return (
    <Sectie titel="Briefing" sub={p.briefing_bevestigd_op ? `bevestigd${p.briefing_bevestigd_door ? ` door ${p.briefing_bevestigd_door}` : ''}` : mist.length ? `ontbreekt: ${mist.join(', ').toLowerCase()}` : 'klaar om te bevestigen'} open={!p.briefing_bevestigd_op}>
      {BRIEFING_VELDEN.map((v) => (
        <label key={v.key} className="block"><span className={lbl}>{v.label}{v.verplicht ? ' *' : ''}</span>
          <textarea rows={2} className={inp} value={b[v.key]} onChange={(e) => setB({ ...b, [v.key]: e.target.value })} placeholder={v.hint} />
        </label>
      ))}
      {p.briefing_bevestigd_op && gewijzigd && <p className="text-[11px] text-amber-800">Aanpassen = de briefing opnieuw bevestigen.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!gewijzigd || !!bezig} onClick={() => doe({ actie: 'project.wijzig', briefing: b }, 'bri', 'Briefing bewaard.')} className="btn-secondary !py-1.5 !text-sm">{bezig === 'bri' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bewaren</button>
        {!p.briefing_bevestigd_op && <button type="button" disabled={!!mist.length || gewijzigd || !!bezig} title={mist.length ? `Vul eerst in: ${mist.join(', ')}` : gewijzigd ? 'Bewaar eerst' : undefined} onClick={() => doe({ actie: 'project.briefing' }, 'bev', 'Briefing bevestigd. Tijd voor de user stories.')} className="btn-primary !py-1.5 !text-sm"><Check className="h-4 w-4" />Briefing bevestigen</button>}
      </div>
    </Sectie>
  )
}

/** User stories met acceptatiecriteria, schatting, bestede uren en de definitie van klaar. */
function Stories({ p, stories, bezig, doe, workflows }: { p: Project; stories: UserStory[]; bezig: string | null; doe: Doe; workflows: { id: string; naam: string }[] }) {
  const [nieuw, setNieuw] = useState<{ titel: string; als: string; wil: string; zodat: string; acceptatiecriteria: string; schatting_uren: string } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Sectie titel="User stories" sub={stories.length ? `${stories.length} stories` : p.briefing_bevestigd_op ? 'nog geen' : 'na de briefing'} open={!!p.briefing_bevestigd_op && ['user_stories', 'akkoord', 'bouw', 'review'].includes(p.fase)}>
      {!p.briefing_bevestigd_op && <p className="text-xs text-gray-500">Bevestig eerst de briefing.</p>}
      <ul className="space-y-1.5">
        {stories.map((s) => {
          const isOpen = open === s.id
          const klaarFout = waaromNietKlaar(s)
          return (
            <li key={s.id} className="rounded-xl border border-gray-100">
              <button type="button" onClick={() => setOpen(isOpen ? null : s.id)} className="w-full text-left px-3 py-2 flex items-center gap-2">
                <span className="text-[11px] font-mono text-gray-400 w-6">#{s.nummer}</span>
                <span className="text-sm font-medium flex-1 min-w-0 truncate">{s.titel}</span>
                {s.klant_akkoord_op && <span className="text-[10px] text-green-800 bg-green-50 border border-green-100 rounded-full px-1.5">klant akkoord</span>}
                <span className="text-[11px] text-gray-500 tabular-nums">{s.bestede_uren}/{s.schatting_uren ?? '?'} u</span>
                <span className={`text-[11px] rounded-full px-2 py-0.5 border ${s.status === 'klaar' ? 'bg-green-50 border-green-100 text-green-800' : s.status === 'voorstel' ? 'bg-gray-50 border-gray-200 text-gray-600' : 'bg-white border-gray-200 text-gray-800'}`}>{STORY_STATUSSEN.find((x) => x.key === s.status)?.label}</span>
              </button>
              {isOpen && <StoryDetail p={p} s={s} bezig={bezig} doe={doe} klaarFout={klaarFout} workflows={workflows} />}
            </li>
          )
        })}
      </ul>
      {p.briefing_bevestigd_op && !nieuw && <button type="button" onClick={() => setNieuw({ titel: '', als: '', wil: '', zodat: '', acceptatiecriteria: '', schatting_uren: '' })} className="btn-secondary !py-1.5 !text-sm"><Plus className="h-4 w-4" />User story toevoegen</button>}
      {nieuw && (
        <div className="rounded-xl border border-gray-200 p-3 space-y-2">
          <input className={inp} value={nieuw.titel} onChange={(e) => setNieuw({ ...nieuw, titel: e.target.value })} placeholder="Korte titel" autoFocus />
          <div className="grid sm:grid-cols-3 gap-2">
            <input className={inp} value={nieuw.als} onChange={(e) => setNieuw({ ...nieuw, als: e.target.value })} placeholder="Als … (wie)" />
            <input className={inp} value={nieuw.wil} onChange={(e) => setNieuw({ ...nieuw, wil: e.target.value })} placeholder="wil ik … (wat)" />
            <input className={inp} value={nieuw.zodat} onChange={(e) => setNieuw({ ...nieuw, zodat: e.target.value })} placeholder="zodat … (waarom)" />
          </div>
          <textarea rows={3} className={inp} value={nieuw.acceptatiecriteria} onChange={(e) => setNieuw({ ...nieuw, acceptatiecriteria: e.target.value })} placeholder={'Acceptatiecriteria, één per regel'} />
          <div className="flex gap-2 items-center">
            <input inputMode="decimal" className={`${inp} !w-32`} value={nieuw.schatting_uren} onChange={(e) => setNieuw({ ...nieuw, schatting_uren: e.target.value })} placeholder="Schatting (u)" />
            <div className="flex-1" />
            <button type="button" onClick={() => setNieuw(null)} className="btn-secondary !py-1.5 !text-sm">Annuleren</button>
            <button type="button" disabled={!nieuw.titel.trim() || !!bezig} onClick={async () => { const j = await doe({ actie: 'story.nieuw', ...nieuw }, 'sn', 'User story toegevoegd.'); if (j) setNieuw(null) }} className="btn-primary !py-1.5 !text-sm">Toevoegen</button>
          </div>
        </div>
      )}
    </Sectie>
  )
}

function StoryDetail({ p, s, bezig, doe, klaarFout, workflows }: { p: Project; s: UserStory; bezig: string | null; doe: Doe; klaarFout: string | null; workflows: { id: string; naam: string }[] }) {
  const [v, setV] = useState({ titel: s.titel, als: s.als, wil: s.wil, zodat: s.zodat, acceptatiecriteria: s.acceptatiecriteria.join('\n'), schatting_uren: s.schatting_uren === null ? '' : String(s.schatting_uren).replace('.', ',') })
  const [uren, setUren] = useState('')
  const [dodNieuw, setDodNieuw] = useState('')
  const gewijzigd = v.titel !== s.titel || v.als !== s.als || v.wil !== s.wil || v.zodat !== s.zodat || v.acceptatiecriteria !== s.acceptatiecriteria.join('\n') || v.schatting_uren !== (s.schatting_uren === null ? '' : String(s.schatting_uren).replace('.', ','))
  const wijzig = (extra: Record<string, unknown>, sleutel: string, ok?: string) => doe({ actie: 'story.wijzig', story: s.id, ...extra }, sleutel, ok)
  return (
    <div className="px-3 pb-3 space-y-2.5 border-t border-gray-100 pt-2.5">
      <div className="flex flex-wrap gap-1">
        {STORY_STATUSSEN.map((x) => (
          <button key={x.key} type="button" disabled={!!bezig} onClick={() => x.key !== s.status && wijzig({ status: x.key }, `s${s.id}`, `#${s.nummer}: ${x.label}.`)} aria-pressed={s.status === x.key}
            title={x.key === 'klaar' && klaarFout ? klaarFout : undefined}
            className={`px-2.5 py-1 rounded-full text-xs border ${s.status === x.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white hover:border-gray-400'}`}>{x.label}</button>
        ))}
      </div>
      {workflows.length > 0 && (
        <label className="block"><span className={lbl}>Workflow</span>
          <select className={inp} value={s.workflow_id ?? ''} disabled={!!bezig} onChange={(e) => wijzig({ workflow_id: e.target.value || null }, `wf${s.id}`, 'Bewaard.')}>
            <option value="">Geen workflow</option>
            {workflows.map((w) => <option key={w.id} value={w.id}>{w.naam}</option>)}
          </select>
        </label>
      )}
      <input className={inp} value={v.titel} onChange={(e) => setV({ ...v, titel: e.target.value })} />
      <div className="grid sm:grid-cols-3 gap-2">
        <input className={inp} value={v.als} onChange={(e) => setV({ ...v, als: e.target.value })} placeholder="Als …" />
        <input className={inp} value={v.wil} onChange={(e) => setV({ ...v, wil: e.target.value })} placeholder="wil ik …" />
        <input className={inp} value={v.zodat} onChange={(e) => setV({ ...v, zodat: e.target.value })} placeholder="zodat …" />
      </div>
      <label className="block"><span className={lbl}>Acceptatiecriteria (één per regel)</span><textarea rows={3} className={inp} value={v.acceptatiecriteria} onChange={(e) => setV({ ...v, acceptatiecriteria: e.target.value })} /></label>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="block"><span className={lbl}>Schatting (uren)</span><input inputMode="decimal" className={`${inp} !w-28`} value={v.schatting_uren} onChange={(e) => setV({ ...v, schatting_uren: e.target.value })} /></label>
        {gewijzigd && <button type="button" disabled={!!bezig} onClick={() => wijzig({ velden: v }, `v${s.id}`, 'Bewaard.')} className="btn-secondary !py-2 !text-sm"><Check className="h-4 w-4" />Bewaren</button>}
        <div className="flex-1" />
        <label className="block"><span className={lbl}>Uren bijtellen (nu {s.bestede_uren})</span>
          <div className="flex gap-1"><input inputMode="decimal" className={`${inp} !w-20`} value={uren} onChange={(e) => setUren(e.target.value)} placeholder="1,5" />
            <button type="button" disabled={!uren || !!bezig} onClick={async () => { const n = Number(uren.replace(',', '.')); if (!Number.isFinite(n)) return; const j = await wijzig({ bestede_uren: Math.max(0, s.bestede_uren + n) }, `u${s.id}`, 'Uren bijgeteld.'); if (j) setUren('') }} className="btn-secondary !py-2 !text-sm">+</button></div>
        </label>
      </div>
      <div className="space-y-1">
        <div className="text-xs font-semibold">Definitie van klaar</div>
        {s.dod.map((punt, i) => (
          <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={punt.gedaan} disabled={!!bezig} onChange={(e) => wijzig({ dod: s.dod.map((x, j) => (j === i ? { ...x, gedaan: e.target.checked } : x)) }, `d${s.id}`)} />
            <span className={punt.gedaan ? 'line-through text-gray-400' : ''}>{punt.titel}</span>
          </label>
        ))}
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (dodNieuw.trim()) { void wijzig({ dod: [...s.dod, { titel: dodNieuw.trim(), gedaan: false }] }, `d${s.id}`); setDodNieuw('') } }}>
          <input className={`${inp} !py-1`} value={dodNieuw} onChange={(e) => setDodNieuw(e.target.value)} placeholder="Punt toevoegen" />
          <button type="submit" className="btn-secondary !py-1 !px-2" aria-label="Toevoegen"><Plus className="h-3.5 w-3.5" /></button>
        </form>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!s.klant_akkoord_op} disabled={!!bezig} onChange={(e) => wijzig({ klant_akkoord: e.target.checked }, `k${s.id}`, e.target.checked ? 'Klant akkoord genoteerd.' : undefined)} />Klant keurde deze story goed (acceptatie)</label>
        {s.klant_akkoord_op && <span className="text-[11px] text-gray-500">{s.klant_akkoord_door} · {tijdstip(s.klant_akkoord_op)}</span>}
        <div className="flex-1" />
        <button type="button" disabled={!!bezig} onClick={() => { if (confirm(`User story #${s.nummer} weghalen? Ze blijft bewaard in het archief.`)) void doe({ actie: 'story.archiveer', story: s.id }, `x${s.id}`, 'Weggehaald.') }} className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"><Archive className="h-3.5 w-3.5" />Weghalen</button>
      </div>
      {s.status !== 'klaar' && klaarFout && s.status !== 'voorstel' && <p className="text-[11px] text-gray-500">Klaar kan pas als: {klaarFout.toLowerCase()}</p>}
      <span className="hidden">{p.id}</span>
    </div>
  )
}

/** Plan met vaste prijs uit de goedgekeurde stories; de klant keurt het goed. */
function PlanSectie({ p, stories, bezig, doe }: { p: Project; stories: UserStory[]; bezig: string | null; doe: Doe }) {
  const [tarief, setTarief] = useState(p.plan_uurtarief === null ? '' : String(p.plan_uurtarief).replace('.', ','))
  const [prijs, setPrijs] = useState('')
  const t = Number(tarief.replace(',', '.'))
  const plan = useMemo(() => planUitStories(stories, Number.isFinite(t) && t > 0 ? t : null), [stories, t])
  return (
    <Sectie titel="Plan met vaste prijs" sub={p.plan_goedgekeurd_op ? `goedgekeurd: ${eur(p.plan_prijs ?? 0)}` : plan.stories ? `${plan.stories} stories, ${plan.uren} u` : 'na de user stories'} open={['user_stories', 'akkoord'].includes(p.fase) && plan.stories > 0}>
      <div className="grid sm:grid-cols-3 gap-2 items-end">
        <label className="block"><span className={lbl}>Uurtarief (€, excl. btw)</span><input inputMode="decimal" className={inp} value={tarief} onChange={(e) => setTarief(e.target.value)} onBlur={() => tarief !== (p.plan_uurtarief === null ? '' : String(p.plan_uurtarief).replace('.', ',')) && doe({ actie: 'project.wijzig', plan_uurtarief: tarief }, 'tar')} placeholder="bv. 95" /></label>
        <div className="text-sm"><div className="text-[11px] text-gray-500">Goedgekeurde stories</div><div className="font-semibold">{plan.stories} · {plan.uren} uur{plan.zonderSchatting ? ` (${plan.zonderSchatting} zonder schatting)` : ''}</div></div>
        <div className="text-sm"><div className="text-[11px] text-gray-500">Prijs uit de uren</div><div className="font-semibold">{plan.prijs ? eurCent(plan.prijs) : '—'}</div></div>
      </div>
      {p.plan_goedgekeurd_op ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-green-50 border border-green-100 px-3 py-2 text-sm text-green-900">
          <Check className="h-4 w-4" /> Goedgekeurd: {eur(p.plan_prijs ?? 0)} vaste prijs{p.plan_goedgekeurd_door ? ` · ${p.plan_goedgekeurd_door}` : ''} · {tijdstip(p.plan_goedgekeurd_op)}
          <button type="button" disabled={!!bezig} onClick={() => doe({ actie: 'project.plan_terug' }, 'pt', 'Teruggezet.')} className="ml-auto text-xs underline inline-flex items-center gap-1"><Undo2 className="h-3 w-3" />Terugzetten</button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 items-end">
          <label className="block"><span className={lbl}>Vaste prijs (leeg = uit de uren)</span><input inputMode="decimal" className={`${inp} !w-40`} value={prijs} onChange={(e) => setPrijs(e.target.value)} placeholder={plan.prijs ? String(plan.prijs).replace('.', ',') : ''} /></label>
          <button type="button" disabled={!plan.stories || !!bezig} onClick={() => { if (confirm('De klant keurde dit plan goed? Het project gaat dan naar In bouw.')) void doe({ actie: 'project.plan', prijs: prijs || null }, 'plan', 'Plan goedgekeurd.') }} className="btn-primary !py-2 !text-sm"><Check className="h-4 w-4" />Klant keurde het plan goed</button>
        </div>
      )}
      <p className="text-[11px] text-gray-500">De prijs gaat via de offerte of het contract naar de klant, zoals altijd. Hier hou je bij wat afgesproken is.</p>
    </Sectie>
  )
}

/** Wekelijkse review (30 min) in de agenda; notities worden actiepunten. */
function Review({ p, bezig, doe }: { p: Project; bezig: string | null; doe: Doe }) {
  const [dag, setDag] = useState(p.review_dag ?? 1)
  const [uur, setUur] = useState(p.review_uur ?? '10:00')
  const [notities, setNotities] = useState('')
  const open = p.acties.filter((a) => !a.gedaan_op)
  return (
    <Sectie titel="Wekelijkse review" sub={p.review_reeks_id ? `elke ${DAGEN[(p.review_dag ?? 1) - 1]} ${p.review_uur}${open.length ? ` · ${open.length} open actiepunt${open.length === 1 ? '' : 'en'}` : ''}` : 'nog niet ingepland'} open={['bouw', 'review'].includes(p.fase)}>
      {!p.review_reeks_id && (
        <div className="flex flex-wrap gap-2 items-end">
          <label className="block"><span className={lbl}>Dag</span><select className={inp} value={dag} onChange={(e) => setDag(Number(e.target.value))}>{DAGEN.map((x, i) => <option key={x} value={i + 1}>{x}</option>)}</select></label>
          <label className="block"><span className={lbl}>Uur</span><input type="time" step={900} className={inp} value={uur} onChange={(e) => setUur(e.target.value)} /></label>
          <button type="button" disabled={!!bezig} onClick={() => doe({ actie: 'review.plan', dag, uur }, 'rv', 'De wekelijkse review staat in je agenda.')} className="btn-secondary !py-2 !text-sm"><CalendarPlus className="h-4 w-4" />In mijn agenda zetten (30 min)</button>
        </div>
      )}
      <label className="block"><span className={lbl}>Notities van de review</span>
        <div className="relative">
          <textarea rows={3} className={`${inp} pr-10`} value={notities} onChange={(e) => setNotities(e.target.value)} placeholder={'- Koppeling testen met echte offertes\n- Klant stuurt voorbeelden door'} />
          <div className="absolute right-1.5 top-1.5"><DicteerKnop klein zet={setNotities} context={p.titel} /></div>
        </div>
      </label>
      <button type="button" disabled={!notities.trim() || !!bezig} onClick={async () => { const j = await doe({ actie: 'review.acties', notities }, 'ra', 'Actiepunten gemaakt.'); if (j) setNotities('') }} className="btn-secondary !py-1.5 !text-sm"><Plus className="h-4 w-4" />Actiepunten maken</button>
      {p.acties.length > 0 && (
        <ul className="space-y-1">
          {[...open, ...p.acties.filter((a) => a.gedaan_op)].map((a) => (
            <li key={a.id}><label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="mt-0.5" checked={!!a.gedaan_op} disabled={!!bezig} onChange={(e) => doe({ actie: 'actie.zet', actie_id: a.id, gedaan: e.target.checked }, `a${a.id}`)} />
              <span className={a.gedaan_op ? 'line-through text-gray-400' : ''}>{a.tekst}<span className="text-[11px] text-gray-400"> · {a.wie ?? '—'}{a.uit_review ? ` · review ${dagKort(a.uit_review)}` : ''}</span></span>
            </label></li>
          ))}
        </ul>
      )}
    </Sectie>
  )
}
