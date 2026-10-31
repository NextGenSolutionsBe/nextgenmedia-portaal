'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Camera, Loader2, Sparkles, Video } from 'lucide-react'
import { Kop, INP } from './ui'

type Lid = {
  id: string; naam: string; rol: string | null; expertises: string[]; foto_url: string | null
  expert_zichtbaar: boolean; meeting_zichtbaar: boolean; meeting_agenda_id: string | null; clickup_user_id: number | null; klantapp_volgorde: number | null
}
type Data = { leden: Lid[]; agendas: { id: string; naam: string; gekoppeld: boolean }[]; clickupLeden: { id: number; naam: string }[]; instelling: { diensten_iedereen: boolean } }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: init?.body instanceof FormData ? init?.headers : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Mislukt')
  return j as T
}

/**
 * Team in de klantapp: per teamlid waar de klant hem of haar ziet. "Kies jouw
 * expert" bij aanvragen en "Met wie?" bij Meeting boeken, met een grote foto.
 * Alles komt uit Personeel; hier zet je het per plek op orde. Elke wijziging
 * wordt meteen bewaard.
 */
export function SectieTeam() {
  const [d, setD] = useState<Data | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const laad = useCallback(async () => {
    try { setD(await api<Data>('/api/admin/instellingen/team')) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])

  const zetLid = async (lid: Lid, patch: Partial<Lid>) => {
    setD((x) => (x ? { ...x, leden: x.leden.map((l) => (l.id === lid.id ? { ...l, ...patch } : l)) } : x))
    try { await api('/api/admin/instellingen/team', { method: 'PATCH', body: JSON.stringify({ lid: lid.id, ...patch }) }) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); laad() }
  }
  const zetInstelling = async (diensten_iedereen: boolean) => {
    setD((x) => (x ? { ...x, instelling: { diensten_iedereen } } : x))
    try { await api('/api/admin/instellingen/team', { method: 'PATCH', body: JSON.stringify({ instelling: { diensten_iedereen } }) }); toast.success('Bewaard.') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); laad() }
  }
  const schuif = async (i: number, r: -1 | 1) => {
    if (!d) return
    const l = [...d.leden]; const j = i + r
    if (j < 0 || j >= l.length) return
    ;[l[i], l[j]] = [l[j], l[i]]
    setD({ ...d, leden: l.map((x, k) => ({ ...x, klantapp_volgorde: k + 1 })) })
    try { await Promise.all([api('/api/admin/instellingen/team', { method: 'PATCH', body: JSON.stringify({ lid: l[i].id, klantapp_volgorde: i + 1 }) }), api('/api/admin/instellingen/team', { method: 'PATCH', body: JSON.stringify({ lid: l[j].id, klantapp_volgorde: j + 1 }) })]) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); laad() }
  }
  const foto = async (lid: Lid, file: File) => {
    setBezig(lid.id)
    try {
      const fd = new FormData(); fd.append('file', file)
      await api(`/api/admin/personeel/${lid.id}/foto`, { method: 'POST', body: fd })
      toast.success(`Foto van ${lid.naam.split(' ')[0]} bewaard.`); await laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally { setBezig(null) }
  }

  if (!d) return <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const zonderFoto = d.leden.filter((l) => (l.expert_zichtbaar || l.meeting_zichtbaar) && !l.foto_url)

  return (
    <div className="space-y-4">
      <div className="card-base space-y-3">
        <Kop titel="Team in de klantapp" tekst="Wie ziet de klant bij “Kies jouw expert” (diensten en consultancy aanvragen) en bij “Met wie?” (meeting boeken)? Een gekozen teamlid krijgt de ClickUp-taak toegewezen. Wijzigingen worden meteen bewaard." />
        <div className="rounded-xl border border-gray-200 p-3 space-y-2">
          <p className="text-sm font-medium">Kies jouw expert bij diensten</p>
          <div className="flex flex-col sm:flex-row gap-2">
            {([[true, 'Iedereen die aan staat', 'Specialisten bovenaan met een label'], [false, 'Enkel specialisten', 'Wie de passende expertise heeft']] as const).map(([w, t, sub]) => (
              <button key={String(w)} type="button" onClick={() => zetInstelling(w)} aria-pressed={d.instelling.diensten_iedereen === w}
                className={`flex-1 text-left rounded-lg border px-3 py-2 ${d.instelling.diensten_iedereen === w ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200 hover:border-gray-400'}`}>
                <span className="block text-sm font-medium">{t}</span><span className="block text-xs text-gray-500">{sub}</span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-500">Consultancy blijft altijd op expertise: dat is betalend specialistenwerk. Expertises stel je in bij Personeel → dossier → Expertprofiel.</p>
        </div>
        {zonderFoto.length > 0 && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Nog zonder foto: {zonderFoto.map((l) => l.naam.split(' ')[0]).join(', ')}. Klanten zien dan enkel initialen; een staande foto (portret) werkt het best.</p>}
      </div>

      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {d.leden.map((l, i) => (
          <li key={l.id} className="card-base !p-0 overflow-hidden flex flex-col">
            <FotoVak lid={l} bezig={bezig === l.id} onFoto={(f) => foto(l, f)} />
            <div className="p-4 space-y-3 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{l.naam}</p>
                  <p className="text-xs text-gray-500 truncate">{l.rol ?? '—'}{l.expertises.length ? ` · ${l.expertises.slice(0, 3).join(', ')}${l.expertises.length > 3 ? '…' : ''}` : ''}</p>
                </div>
                <div className="flex shrink-0">
                  <button type="button" onClick={() => schuif(i, -1)} disabled={i === 0} className="h-8 w-8 rounded-lg hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center" aria-label="Naar voren"><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" onClick={() => schuif(i, 1)} disabled={i === d.leden.length - 1} className="h-8 w-8 rounded-lg hover:bg-gray-100 disabled:opacity-30 flex items-center justify-center" aria-label="Naar achter"><ArrowDown className="h-4 w-4" /></button>
                </div>
              </div>
              <Schakel aan={l.expert_zichtbaar} onZet={(v) => zetLid(l, { expert_zichtbaar: v })} icoon={Sparkles} titel="Kies jouw expert" sub="Bij diensten en consultancy aanvragen" />
              <Schakel aan={l.meeting_zichtbaar} onZet={(v) => zetLid(l, { meeting_zichtbaar: v })} icoon={Video} titel="Meeting boeken" sub="Klant kan een meeting met deze persoon boeken" />
              {l.meeting_zichtbaar && (
                <div>
                  <label className="block text-[11px] font-medium text-gray-600 mb-1" htmlFor={`ag-${l.id}`}>Agenda voor vrije momenten</label>
                  <select id={`ag-${l.id}`} className={INP} value={l.meeting_agenda_id ?? ''} onChange={(e) => zetLid(l, { meeting_agenda_id: e.target.value || null })}>
                    <option value="">Standaardagenda van klantboekingen</option>
                    {d.agendas.map((a) => <option key={a.id} value={a.id} disabled={!a.gekoppeld}>{a.naam}{a.gekoppeld ? '' : ' (koppeling verlopen)'}</option>)}
                  </select>
                  <p className="text-[11px] text-gray-500 mt-1">Zonder eigen agenda: de standaardagenda, en de ClickUp-meetings van deze persoon blokkeren ook.</p>
                </div>
              )}
              <div>
                <label className="block text-[11px] font-medium text-gray-600 mb-1" htmlFor={`cu-${l.id}`}>ClickUp-gebruiker (krijgt de taak)</label>
                <select id={`cu-${l.id}`} className={INP} value={l.clickup_user_id ?? ''} onChange={(e) => zetLid(l, { clickup_user_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">Niet gekoppeld</option>
                  {d.clickupLeden.map((c) => <option key={c.id} value={c.id}>{c.naam}</option>)}
                </select>
              </div>
              <Link href={`/admin/personeel/${l.id}`} className="inline-block text-xs text-gray-500 underline">Dossier en expertises</Link>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FotoVak({ lid, bezig, onFoto }: { lid: Lid; bezig: boolean; onFoto: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const initialen = lid.naam.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="relative aspect-[4/3] bg-gradient-to-br from-gray-100 to-gray-200">
      {lid.foto_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={lid.foto_url} alt={lid.naam} className="absolute inset-0 h-full w-full object-cover object-top" />
        : <span className="absolute inset-0 flex items-center justify-center text-4xl font-semibold text-gray-400">{initialen}</span>}
      <button type="button" onClick={() => ref.current?.click()} disabled={bezig} className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-medium shadow hover:bg-white">
        {bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}{lid.foto_url ? 'Andere foto' : 'Foto opladen'}
      </button>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFoto(f) }} />
    </div>
  )
}

function Schakel({ aan, onZet, icoon: Icoon, titel, sub }: { aan: boolean; onZet: (v: boolean) => void; icoon: React.ElementType; titel: string; sub: string }) {
  return (
    <button type="button" role="switch" aria-checked={aan} onClick={() => onZet(!aan)} className="w-full flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-2 text-left hover:border-gray-300">
      <Icoon className="h-4 w-4 text-gray-500 shrink-0" />
      <span className="flex-1 min-w-0"><span className="block text-sm font-medium">{titel}</span><span className="block text-[11px] text-gray-500">{sub}</span></span>
      <span className={`relative h-6 w-10 shrink-0 rounded-full transition ${aan ? 'bg-gray-900' : 'bg-gray-200'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${aan ? 'left-[18px]' : 'left-0.5'}`} /></span>
    </button>
  )
}
