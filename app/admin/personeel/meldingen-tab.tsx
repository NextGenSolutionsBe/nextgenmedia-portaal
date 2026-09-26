'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, CheckCheck, Save, Bell, Mail } from 'lucide-react'
import { api } from '@/components/personeel/ui'
import { MELDING_EVENTS, type MeldingInstellingen } from '@/lib/personeel/model'

type Melding = { id: string; titel: string; tekst: string | null; link: string | null; gelezen_op: string | null; created_at: string }

/** Meldingen voor admins + de instellingen voor e-mail en in-app, per soort apart. */
export function MeldingenTab() {
  const [lijst, setLijst] = useState<Melding[] | null>(null)
  const [inst, setInst] = useState<MeldingInstellingen | null>(null)
  const [bezig, setBezig] = useState(false)
  const laad = useCallback(async () => {
    try { const j = await api<{ meldingen: Melding[]; instellingen: MeldingInstellingen }>('/api/admin/personeel/meldingen'); setLijst(j.meldingen); setInst(j.instellingen) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])
  const gelezen = async (id: string) => { await api('/api/admin/personeel/meldingen', { method: 'PATCH', body: { gelezen: id } }).catch(() => {}); laad() }
  const bewaar = async () => {
    setBezig(true)
    try { await api('/api/admin/personeel/meldingen', { method: 'PUT', body: { instellingen: inst } }); toast.success('Notificaties bewaard.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="grid lg:grid-cols-[1fr_420px] gap-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Meldingen</h2>{(lijst ?? []).some((m) => !m.gelezen_op) && <button type="button" onClick={async () => { await api('/api/admin/personeel/meldingen', { method: 'PATCH', body: { gelezen: 'alles' } }).catch(() => {}); laad() }} className="btn-secondary text-xs"><CheckCheck className="h-3.5 w-3.5" />Alles gelezen</button>}</div>
        {lijst === null && <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>}
        {lijst && lijst.length === 0 && <div className="card-base text-sm text-gray-400 text-center py-8">Nog geen meldingen.</div>}
        {(lijst ?? []).map((m) => (
          <div key={m.id} className={`card-base p-3 ${m.gelezen_op ? '' : 'border-yellow-300 bg-[#fff848]/10'}`}>
            <div className="flex items-start justify-between gap-2"><div className={`text-sm ${m.gelezen_op ? '' : 'font-semibold'}`}>{m.titel}</div><span className="text-[10px] text-gray-400 whitespace-nowrap">{new Date(m.created_at).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div>
            {m.tekst && <div className="text-xs text-gray-600 mt-0.5">{m.tekst}</div>}
            <div className="flex gap-3 mt-1.5 text-xs">{m.link && <Link href={m.link} prefetch={false} onClick={() => gelezen(m.id)} className="text-blue-700 hover:underline">Openen</Link>}{!m.gelezen_op && <button type="button" onClick={() => gelezen(m.id)} className="text-gray-500 hover:text-black">Gelezen</button>}</div>
          </div>
        ))}
      </div>
      <div className="card-base p-4 space-y-3 h-fit">
        <div><h2 className="text-sm font-semibold">Notificaties instellen</h2><p className="text-xs text-gray-500 mt-0.5">Per soort apart: in de app en/of per e-mail. Meldingen voor de admins gaan per mail naar het e-mailadres uit Instellingen → Bedrijf.</p></div>
        {!inst ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : (
          <div className="table-wrap"><table className="w-full text-sm">
            <thead><tr className="text-[11px] text-gray-500"><th className="text-left font-medium py-1">Soort</th><th className="font-medium"><Bell className="h-3.5 w-3.5 inline" /> App</th><th className="font-medium"><Mail className="h-3.5 w-3.5 inline" /> Mail</th></tr></thead>
            <tbody className="divide-y divide-gray-50">
              {MELDING_EVENTS.map((e) => (
                <tr key={e.key}>
                  <td className="py-1.5 pr-2">{e.label}<div className="text-[10px] text-gray-400">{e.voor === 'admin' ? 'naar admins' : e.voor === 'medewerker' ? 'naar de medewerker' : 'medewerker en admins'}</div></td>
                  <td className="text-center"><input type="checkbox" checked={inst[e.key].inapp} onChange={(x) => setInst({ ...inst, [e.key]: { ...inst[e.key], inapp: x.target.checked } })} /></td>
                  <td className="text-center"><input type="checkbox" checked={inst[e.key].email} onChange={(x) => setInst({ ...inst, [e.key]: { ...inst[e.key], email: x.target.checked } })} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <button type="button" disabled={bezig || !inst} onClick={bewaar} className="btn-primary w-full justify-center">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren</button>
      </div>
    </div>
  )
}
