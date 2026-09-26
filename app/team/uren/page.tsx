'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ChevronDown, AlertTriangle, Send, Save } from 'lucide-react'
import { api, Chip, datumNl, uurNl, duur, dagVanIso, vandaagBE, naarLokaal, vanLokaal, INP, LBL, LinksLijst, type LinkItem } from '@/components/personeel/ui'
import { SESSIE_STATUS, type SessieStatus } from '@/lib/personeel/model'

type Pauze = { start: string; eind: string | null }
type Verslag = { project?: string | null; taak?: string | null; content?: string | null; goed?: string | null; mis?: string | null; todo?: string | null; blokkades?: string | null }
type Sessie = { id: string; start_at: string; eind_at: string | null; pauzes: Pauze[]; status: SessieStatus; project: string | null; taak: string | null; klant: string | null; verslag: Verslag; links: LinkItem[]; correctie_vraag: string | null }

const minuten = (s: Sessie) => {
  const eind = s.eind_at ? new Date(s.eind_at).getTime() : Date.now()
  const p = (s.pauzes ?? []).reduce((t, x) => t + Math.max(0, (x.eind ? new Date(x.eind).getTime() : Date.now()) - new Date(x.start).getTime()), 0)
  return Math.max(0, Math.round((eind - new Date(s.start_at).getTime() - p) / 60000))
}
const pauzeMin = (s: Sessie) => Math.round((s.pauzes ?? []).reduce((t, x) => t + Math.max(0, (x.eind ? new Date(x.eind).getTime() : Date.now()) - new Date(x.start).getTime()), 0) / 60000)

/** Mijn uren: werkdatum, begin, einde, pauzes, project, eigen verslag en status. Geen bedragen. */
export default function UrenPagina() {
  const [maand, setMaand] = useState(vandaagBE().slice(0, 7))
  const [lijst, setLijst] = useState<Sessie[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const laad = useCallback(async () => {
    const [j, m] = maand.split('-').map(Number)
    const tot = `${maand}-${String(new Date(Date.UTC(j, m, 0)).getUTCDate()).padStart(2, '0')}`
    try { setLijst((await api<{ sessies: Sessie[] }>(`/api/team/sessies?van=${maand}-01&tot=${tot}`)).sessies) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [maand])
  useEffect(() => { laad() }, [laad])

  const totaal = (lijst ?? []).filter((s) => s.status !== 'afgekeurd').reduce((t, s) => t + minuten(s), 0)
  const goed = (lijst ?? []).filter((s) => s.status === 'goedgekeurd').reduce((t, s) => t + minuten(s), 0)
  const correcties = (lijst ?? []).filter((s) => s.status === 'correctie_gevraagd').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2"><h1 className="text-lg font-bold">Mijn uren</h1><input type="month" className="rounded-lg border border-gray-200 px-2 py-1.5 text-sm bg-white" value={maand} onChange={(e) => e.target.value && setMaand(e.target.value)} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white rounded-xl border border-gray-100 p-3"><div className="text-[11px] text-gray-500">Gewerkt deze maand</div><div className="text-lg font-bold">{duur(totaal)}</div></div>
        <div className="bg-white rounded-xl border border-gray-100 p-3"><div className="text-[11px] text-gray-500">Goedgekeurd</div><div className="text-lg font-bold text-green-700">{duur(goed)}</div></div>
      </div>
      {correcties > 0 && <div className="rounded-xl border border-orange-200 bg-orange-50 p-3 text-sm text-orange-900 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />Er {correcties === 1 ? 'is 1 sessie' : `zijn ${correcties} sessies`} waarvoor een correctie gevraagd is.</div>}
      {lijst === null && <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>}
      {lijst && lijst.length === 0 && <div className="text-sm text-gray-400 bg-white rounded-xl border border-gray-100 p-4">Geen sessies in deze maand.</div>}
      {(lijst ?? []).map((s) => (
        <div key={s.id} className={`bg-white rounded-xl border p-3 ${s.status === 'correctie_gevraagd' ? 'border-orange-300' : 'border-gray-100'}`}>
          <button type="button" onClick={() => setOpen(open === s.id ? null : s.id)} className="w-full text-left flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-medium">{datumNl(dagVanIso(s.start_at))} · {uurNl(s.start_at)}–{s.eind_at ? uurNl(s.eind_at) : 'loopt'}</div>
              <div className="text-xs text-gray-500">{duur(minuten(s))}{pauzeMin(s) ? ` · ${pauzeMin(s)} min pauze` : ''}{s.taak || s.project ? ` · ${[s.klant, s.project, s.taak].filter(Boolean).join(' · ')}` : ''}</div>
            </div>
            <span className="flex items-center gap-1 shrink-0"><Chip cls={SESSIE_STATUS[s.status].chip}>{SESSIE_STATUS[s.status].label}</Chip><ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open === s.id ? 'rotate-180' : ''}`} /></span>
          </button>
          {s.status === 'correctie_gevraagd' && s.correctie_vraag && <div className="mt-2 text-xs rounded-lg bg-orange-50 text-orange-900 px-2 py-1.5">Gevraagde correctie: {s.correctie_vraag}</div>}
          {open === s.id && (['ingediend', 'correctie_gevraagd'].includes(s.status) ? <Bewerk s={s} onKlaar={laad} /> : <Lezen s={s} />)}
        </div>
      ))}
    </div>
  )
}

function Lezen({ s }: { s: Sessie }) {
  const v = s.verslag ?? {}
  const regels: [string, string | null | undefined][] = [['Project', v.project], ['Taak', v.taak], ["Video's/content", v.content], ['Wat ging goed', v.goed], ['Wat liep mis', v.mis], ['Nog te doen', v.todo], ['Blokkades/vragen', v.blokkades]]
  return (
    <div className="mt-3 space-y-1.5 text-sm border-t border-gray-100 pt-2">
      {regels.filter(([, w]) => w).map(([l, w]) => <div key={l}><div className="text-[11px] text-gray-500">{l}</div><div className="whitespace-pre-wrap">{w}</div></div>)}
      <LinksLijst links={s.links} bestandUrl={(p) => `/api/team/bestand?pad=${encodeURIComponent(p)}`} />
    </div>
  )
}

function Bewerk({ s, onKlaar }: { s: Sessie; onKlaar: () => void }) {
  const [v, setV] = useState<Verslag>({ project: '', taak: '', content: '', goed: '', mis: '', todo: '', blokkades: '', ...s.verslag })
  const [start, setStart] = useState(naarLokaal(s.start_at))
  const [eind, setEind] = useState(naarLokaal(s.eind_at))
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  const correctie = s.status === 'correctie_gevraagd'
  const tijdGewijzigd = start !== naarLokaal(s.start_at) || eind !== naarLokaal(s.eind_at)
  const bewaar = async (indienen: boolean) => {
    setBezig(true)
    try {
      const body: Record<string, unknown> = { verslag: v, indienen }
      if (correctie && tijdGewijzigd) { body.start_at = vanLokaal(start); body.eind_at = vanLokaal(eind); body.reden = reden }
      await api(`/api/team/sessies/${s.id}`, { method: 'PATCH', body })
      toast.success(indienen ? 'Opnieuw ingediend.' : 'Verslag bewaard.'); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const veld = (k: keyof Verslag, label: string) => (<div><label className={LBL}>{label}</label><textarea rows={2} className={INP} value={v[k] ?? ''} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></div>)
  return (
    <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
      {correctie && (
        <div className="grid grid-cols-2 gap-2">
          <div><label className={LBL}>Begin</label><input type="datetime-local" className={INP} value={start} onChange={(e) => setStart(e.target.value)} /></div>
          <div><label className={LBL}>Einde</label><input type="datetime-local" className={INP} value={eind} onChange={(e) => setEind(e.target.value)} /></div>
          {tijdGewijzigd && <div className="col-span-2"><label className={LBL}>Waarom andere tijden? *</label><input className={INP} value={reden} onChange={(e) => setReden(e.target.value)} /></div>}
        </div>
      )}
      {veld('project', 'Project')}{veld('taak', 'Taak')}{veld('content', "Video's of content")}{veld('goed', 'Wat ging goed')}{veld('mis', 'Wat liep mis')}{veld('todo', 'Nog te doen')}{veld('blokkades', 'Blokkades of vragen')}
      <div className="flex gap-2 pt-1">
        <button type="button" disabled={bezig} onClick={() => bewaar(false)} className="btn-secondary text-xs"><Save className="h-3.5 w-3.5" />Bewaren</button>
        {correctie && <button type="button" disabled={bezig} onClick={() => bewaar(true)} className="btn-primary text-xs">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Opnieuw indienen</button>}
      </div>
    </div>
  )
}
