'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, ExternalLink, Loader2, RefreshCw, Check } from 'lucide-react'
import { DAG_KORT } from '@/lib/agenda/reeksen'
import { kortDag, dag, uur, TZ } from '@/lib/agenda/model'
import type { Beschikbaarheid } from '@/lib/agenda/team'
import { api, PersonenLijst, Popover, focusRing, type BoomData } from './gedeeld'
import { teamActie } from './reeks'

/** Beschikbaarheid: wanneer iemand normaal werkt (per weekdag). Eigen; een zaakvoerder ook die van anderen. */
export function BeschikbaarheidTab({ boom }: { boom: BoomData }) {
  const [wie, setWie] = useState(boom.ik)
  const [lijst, setLijst] = useState<Beschikbaarheid[] | null>(null)
  const [rijen, setRijen] = useState<{ van: string; tot: string }[]>([])
  const [kies, setKies] = useState(false)
  const [bezig, setBezig] = useState(false)
  useEffect(() => { api<{ beschikbaarheid: Beschikbaarheid[] }>('/api/admin/agenda/team?beschikbaarheid=1').then((j) => setLijst(j.beschikbaarheid)).catch(() => setLijst([])) }, [])
  useEffect(() => {
    if (!lijst) return
    setRijen(Array.from({ length: 7 }, (_, n) => { const b = lijst.find((x) => x.persoon_id === wie && x.weekdag === n + 1); return { van: b?.van ?? '', tot: b?.tot ?? '' } }))
  }, [lijst, wie])
  const naam = boom.personen.find((p) => p.id === wie)?.naam ?? 'Iemand'
  const bewaar = async () => {
    setBezig(true)
    try {
      await teamActie({ actie: 'beschikbaarheid.zet', persoon_id: wie, dagen: rijen.map((r, n) => ({ weekdag: n + 1, ...r })) })
      const j = await api<{ beschikbaarheid: Beschikbaarheid[] }>('/api/admin/agenda/team?beschikbaarheid=1'); setLijst(j.beschikbaarheid)
      toast.success('Beschikbaarheid bewaard.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const standaard = () => setRijen(rijen.map((r, n) => (n < 5 ? { van: '09:00', tot: '17:00' } : { van: '', tot: '' })))
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Wanneer iemand normaal werkt. In de teamagenda staat dat als lichte achtergrond en de capaciteit telt ermee. Leeg = die dag niet.</p>
      {boom.isAdmin && (
        <div className="relative">
          <button type="button" onClick={() => setKies(!kies)} className={`btn-secondary !py-1.5 !text-sm ${focusRing}`}>Voor: {naam}</button>
          <Popover open={kies} onSluit={() => setKies(false)}><PersonenLijst personen={boom.personen} eerst={boom.zaakvoerders} ik={boom.ik} gekozen={[wie]} onWissel={(p) => { setWie(p); setKies(false) }} /></Popover>
        </div>
      )}
      {!lijst ? <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div> : (
        <>
          <ul className="rounded-xl border border-gray-100 divide-y divide-gray-100">
            {rijen.map((r, n) => (
              <li key={n} className="flex items-center gap-2 px-3 py-1.5">
                <span className="w-8 text-sm font-semibold text-gray-700">{DAG_KORT[n]}</span>
                <input type="time" step={900} value={r.van} onChange={(e) => setRijen(rijen.map((x, m) => (m === n ? { ...x, van: e.target.value } : x)))} className="input-base !w-[7rem] !py-1 text-sm" aria-label={`${DAG_KORT[n]} van`} />
                <span className="text-gray-400 text-sm">tot</span>
                <input type="time" step={900} value={r.tot} onChange={(e) => setRijen(rijen.map((x, m) => (m === n ? { ...x, tot: e.target.value } : x)))} className="input-base !w-[7rem] !py-1 text-sm" aria-label={`${DAG_KORT[n]} tot`} />
                {(r.van || r.tot) && <button type="button" onClick={() => setRijen(rijen.map((x, m) => (m === n ? { van: '', tot: '' } : x)))} className="text-xs text-gray-500 hover:text-gray-900 ml-auto">Wissen</button>}
              </li>
            ))}
          </ul>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={standaard} className="btn-secondary !py-1.5 !text-sm">Ma–vr 9–17</button>
            <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary !py-1.5 !text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
          </div>
        </>
      )}
    </div>
  )
}

/** Agenda-abonnement (iCal): je agenda in Google Agenda, Apple Agenda of Outlook. De link toont de app één keer. */
export function AbonnementTab() {
  const [links, setLinks] = useState<{ team: boolean; created_at: string; laatst_gebruikt_op: string | null }[] | null>(null)
  const [nieuw, setNieuw] = useState<{ team: boolean; url: string } | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const laad = () => api<{ links: typeof links }>('/api/admin/agenda/team?ical=1').then((j) => setLinks(j.links ?? [])).catch(() => setLinks([]))
  useEffect(() => { void laad() }, [])
  const maak = async (team: boolean) => {
    setBezig(team ? 'team' : 'mijn')
    try { const r = await teamActie<{ ok: true; url: string }>({ actie: 'ical.nieuw', team }); setNieuw({ team, url: r.url }); void laad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  const trekIn = async (team: boolean) => {
    if (!confirm('Deze link intrekken? Een agenda die hem gebruikt, krijgt niets meer.')) return
    try { await teamActie({ actie: 'ical.intrekken', team }); if (nieuw?.team === team) setNieuw(null); void laad() } catch { toast.error('Intrekken mislukt') }
  }
  const rij = (team: boolean) => {
    const l = links?.find((x) => x.team === team)
    return (
      <div className="rounded-xl border border-gray-100 p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div><div className="text-sm font-semibold">{team ? 'Team' : 'Mijn agenda'}</div><div className="text-xs text-gray-500">{team ? 'Alles wat jij van het team ziet' : 'Wat op jou staat'}{l ? ` · gemaakt ${kortDag(dag(l.created_at, TZ))}${l.laatst_gebruikt_op ? `, laatst opgehaald ${kortDag(dag(l.laatst_gebruikt_op, TZ))} ${uur(l.laatst_gebruikt_op, TZ)}` : ''}` : ''}</div></div>
          <div className="flex gap-1.5 shrink-0">
            <button type="button" onClick={() => maak(team)} disabled={!!bezig} className="btn-secondary !py-1 !text-xs">{bezig === (team ? 'team' : 'mijn') ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}{l ? 'Nieuwe link' : 'Link maken'}</button>
            {l && <button type="button" onClick={() => trekIn(team)} className="btn-secondary !py-1 !text-xs text-red-700">Intrekken</button>}
          </div>
        </div>
        {nieuw?.team === team && (
          <div className="flex items-center gap-1.5">
            <input readOnly value={nieuw.url} className="input-base !py-1 text-xs font-mono" aria-label="Link" onFocus={(e) => e.target.select()} />
            <button type="button" onClick={() => { navigator.clipboard.writeText(nieuw.url).then(() => toast.success('Gekopieerd.')).catch(() => null) }} className="btn-secondary !py-1 !px-2" aria-label="Kopiëren"><Copy className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Abonneer je agenda-app op deze link (in Google Agenda: Andere agenda&apos;s → Via URL). Enkel lezen. Wie de link heeft, ziet de titels: deel hem niet. Een nieuwe link maakt de vorige ongeldig.</p>
      {!links ? <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div> : <>{rij(false)}{rij(true)}</>}
    </div>
  )
}

type Verschil = { id: string; titel: string; clickup_url: string | null; op: string; clickup: { titel?: string; status?: string; start_op?: string | null; eind_op?: string | null; deadline_op?: string | null } | null }

/** Verschillen met ClickUp: in de app aangepast terwijl ClickUp iets anders zegt. De app-versie bleef staan. */
export function VerschillenTab({ onOpenItem }: { onOpenItem?: (id: string) => void }) {
  const [lijst, setLijst] = useState<Verschil[] | null>(null)
  const laad = () => api<{ verschillen: Verschil[] }>('/api/admin/agenda/team?verschillen=1').then((j) => setLijst(j.verschillen)).catch(() => setLijst([]))
  useEffect(() => { void laad() }, [])
  const doe = async (v: Verschil, actie: 'verschil.gezien' | 'verschil.overnemen') => {
    try { await teamActie({ actie, id: v.id }); toast.success(actie === 'verschil.overnemen' ? 'ClickUp-versie overgenomen.' : 'App-versie blijft.'); void laad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const wanneer = (s?: string | null) => (s ? `${kortDag(dag(s, TZ))} ${uur(s, TZ)}` : '—')
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Taken die in de app aangepast werden terwijl er in ClickUp ook iets veranderde. De app-versie bleef staan; kies per taak welke geldt. Niets wordt vanzelf verwijderd.</p>
      {!lijst ? <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        : !lijst.length ? <div className="py-6 text-center text-sm text-gray-500">Geen verschillen.</div> : (
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
            {lijst.map((v) => (
              <li key={v.id} className="px-3 py-2.5 space-y-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <button type="button" onClick={() => onOpenItem?.(v.id)} className="text-sm font-semibold text-left truncate hover:underline">{v.titel}</button>
                  {v.clickup_url && <a href={v.clickup_url} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-0.5 shrink-0"><ExternalLink className="h-3 w-3" />ClickUp</a>}
                </div>
                {v.clickup && <div className="text-xs text-gray-600">ClickUp zegt: <strong>{v.clickup.titel}</strong> · {v.clickup.status === 'klaar' ? 'Completed' : 'open'} · {v.clickup.deadline_op ? `deadline ${wanneer(v.clickup.deadline_op)}` : wanneer(v.clickup.start_op ?? v.clickup.eind_op)}</div>}
                <div className="flex gap-1.5">
                  <button type="button" onClick={() => doe(v, 'verschil.gezien')} className="btn-secondary !py-1 !text-xs"><Check className="h-3.5 w-3.5" />App-versie houden</button>
                  <button type="button" onClick={() => doe(v, 'verschil.overnemen')} className="btn-secondary !py-1 !text-xs">ClickUp-versie overnemen</button>
                </div>
              </li>
            ))}
          </ul>
        )}
    </div>
  )
}
