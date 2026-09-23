'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, CheckCheck, Bell } from 'lucide-react'
import { api } from '@/components/personeel/ui'

type Melding = { id: string; titel: string; tekst: string | null; link: string | null; gelezen_op: string | null; created_at: string }

export default function MeldingenPagina() {
  const [lijst, setLijst] = useState<Melding[] | null>(null)
  const laad = useCallback(async () => {
    try { setLijst((await api<{ meldingen: Melding[] }>('/api/team/meldingen')).meldingen) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])
  const gelezen = async (id: string) => { await api('/api/team/meldingen', { method: 'PATCH', body: { gelezen: id } }).catch(() => {}); laad() }
  const alles = async () => { await api('/api/team/meldingen', { method: 'PATCH', body: { gelezen: 'alles' } }).catch(() => {}); laad() }
  const nieuw = (lijst ?? []).filter((m) => !m.gelezen_op).length
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h1 className="text-lg font-bold">Meldingen</h1>{nieuw > 0 && <button type="button" onClick={alles} className="btn-secondary text-xs"><CheckCheck className="h-3.5 w-3.5" />Alles gelezen</button>}</div>
      {lijst === null && <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>}
      {lijst && lijst.length === 0 && <div className="text-sm text-gray-400 bg-white rounded-xl border border-gray-100 p-6 text-center"><Bell className="h-6 w-6 mx-auto mb-2 opacity-40" />Nog geen meldingen.</div>}
      {(lijst ?? []).map((m) => {
        const inhoud = (
          <>
            <div className="flex items-start justify-between gap-2"><div className={`text-sm ${m.gelezen_op ? 'font-normal text-gray-700' : 'font-semibold'}`}>{m.titel}</div>{!m.gelezen_op && <span className="h-2 w-2 rounded-full bg-red-600 mt-1.5 shrink-0" />}</div>
            {m.tekst && <div className="text-xs text-gray-600 mt-0.5">{m.tekst}</div>}
            <div className="text-[10px] text-gray-400 mt-1">{new Date(m.created_at).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
          </>
        )
        return m.link
          ? <Link key={m.id} href={m.link} prefetch={false} onClick={() => gelezen(m.id)} className={`block rounded-xl border p-3 ${m.gelezen_op ? 'bg-white border-gray-100' : 'bg-[#fff848]/15 border-yellow-200'}`}>{inhoud}</Link>
          : <button key={m.id} type="button" onClick={() => gelezen(m.id)} className={`w-full text-left rounded-xl border p-3 ${m.gelezen_op ? 'bg-white border-gray-100' : 'bg-[#fff848]/15 border-yellow-200'}`}>{inhoud}</button>
      })}
    </div>
  )
}
