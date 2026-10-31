'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CircleCheck, Loader2, Mail, Search, Send } from 'lucide-react'
import { Dialoog } from '@/app/admin/instellingen/ui'

type Ontvanger = { email: string; naam: string | null; klant: string; client_id: string; bron: 'klant' | 'gebruiker'; afgemeld: boolean; al_verstuurd: boolean }
type Resultaat = { verstuurd: number; overgeslagen: number; mislukt: { email: string; fout: string }[] }

/**
 * Nieuwsbrief per mail versturen. Nooit automatisch: je ziet het voorbeeld,
 * kiest de ontvangers en bevestigt. Wie zich afmeldde of de mail al kreeg,
 * staat uit en kan niet aangevinkt worden.
 */
export function MailDialoog({ id, onSluit, onVerstuurd }: { id: string; onSluit: () => void; onVerstuurd: () => void }) {
  const [data, setData] = useState<{ voorbeeld: { onderwerp: string; html: string }; ontvangers: Ontvanger[] } | null>(null)
  const [gekozen, setGekozen] = useState<Set<string>>(new Set())
  const [zoek, setZoek] = useState('')
  const [nagekeken, setNagekeken] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [res, setRes] = useState<Resultaat | null>(null)
  const [tab, setTab] = useState<'ontvangers' | 'voorbeeld'>('ontvangers')

  useEffect(() => {
    fetch(`/api/admin/nieuwsbrieven/${id}/mail`, { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (j.error) throw new Error(j.error)
      setData(j)
      setGekozen(new Set((j.ontvangers as Ontvanger[]).filter((o) => !o.afgemeld && !o.al_verstuurd).map((o) => o.email)))
    }).catch((e) => { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); onSluit() })
  }, [id, onSluit])

  const lijst = useMemo(() => (data?.ontvangers ?? []).filter((o) => !zoek || `${o.klant} ${o.naam ?? ''} ${o.email}`.toLowerCase().includes(zoek.toLowerCase())), [data, zoek])
  const kiesbaar = (o: Ontvanger) => !o.afgemeld && !o.al_verstuurd
  const wissel = (e: string) => setGekozen((s) => { const n = new Set(s); if (n.has(e)) n.delete(e); else n.add(e); return n })
  const alles = (aan: boolean) => setGekozen((s) => { const n = new Set(s); for (const o of lijst) if (kiesbaar(o)) { if (aan) n.add(o.email); else n.delete(o.email) } return n })

  const verstuur = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/nieuwsbrieven/${id}/mail`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emails: [...gekozen], bevestigd: true }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setRes(j); onVerstuurd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Versturen mislukt') } finally { setBezig(false) }
  }

  return (
    <Dialoog titel="Nieuwsbrief per mail versturen" onSluit={onSluit} breed>
      {!data ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        : res ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-base font-semibold"><CircleCheck className="h-5 w-5 text-green-600" />{res.verstuurd} mail{res.verstuurd === 1 ? '' : 's'} verstuurd</p>
            {res.overgeslagen > 0 && <p className="text-sm text-gray-600">{res.overgeslagen} overgeslagen (afgemeld of al eerder verstuurd).</p>}
            {res.mislukt.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-medium">{res.mislukt.length} niet verstuurd:</p>
                <ul className="mt-1 space-y-0.5">{res.mislukt.slice(0, 10).map((m) => <li key={m.email}>{m.email}: {m.fout}</li>)}</ul>
              </div>
            )}
            <p className="text-xs text-gray-500">Elke mail staat in het E-mail Center.</p>
            <button type="button" onClick={onSluit} className="btn-primary">Sluiten</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">Onderwerp: <b>{data.voorbeeld.onderwerp}</b>. Vertrekt vanuit info@nextgenmedia.be, met onderaan een afmeldlink.</p>
            <div className="flex gap-1.5" role="tablist">
              {(['ontvangers', 'voorbeeld'] as const).map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm font-medium border ${tab === t ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200'}`}>{t === 'ontvangers' ? `Ontvangers (${gekozen.size})` : 'Voorbeeld van de mail'}</button>)}
            </div>
            {tab === 'voorbeeld' ? (
              <iframe title="Voorbeeld van de mail" srcDoc={data.voorbeeld.html} sandbox="" className="w-full h-[60vh] rounded-xl border border-gray-200 bg-gray-50" />
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 min-w-[180px]"><Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" /><input className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="Zoek klant of adres" value={zoek} onChange={(e) => setZoek(e.target.value)} /></div>
                  <button type="button" onClick={() => alles(true)} className="btn-secondary !py-1.5 text-xs">Alles aan</button>
                  <button type="button" onClick={() => alles(false)} className="btn-secondary !py-1.5 text-xs">Alles uit</button>
                </div>
                <ul className="max-h-[45vh] overflow-y-auto rounded-xl border border-gray-200 divide-y divide-gray-100">
                  {lijst.map((o) => (
                    <li key={o.email}>
                      <label className={`flex items-center gap-3 px-3 py-2 text-sm ${kiesbaar(o) ? 'cursor-pointer hover:bg-gray-50' : 'opacity-60'}`}>
                        <input type="checkbox" checked={gekozen.has(o.email)} disabled={!kiesbaar(o)} onChange={() => wissel(o.email)} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{o.klant}</span>
                          <span className="block truncate text-xs text-gray-500">{[o.naam, o.email].filter(Boolean).join(' · ')}{o.bron === 'gebruiker' ? ' · portaalgebruiker' : ''}</span>
                        </span>
                        {o.afgemeld && <span className="text-[11px] text-gray-500 shrink-0">afgemeld</span>}
                        {o.al_verstuurd && <span className="text-[11px] text-green-700 shrink-0">al verstuurd</span>}
                      </label>
                    </li>
                  ))}
                  {!lijst.length && <li className="px-3 py-3 text-sm text-gray-500">Geen ontvangers gevonden.</li>}
                </ul>
              </div>
            )}
            <label className="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" className="mt-0.5" checked={nagekeken} onChange={(e) => setNagekeken(e.target.checked)} />Ik heb het voorbeeld nagekeken en wil de nieuwsbrief nu versturen.</label>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button>
              <button type="button" onClick={verstuur} disabled={bezig || !nagekeken || gekozen.size === 0} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Versturen naar {gekozen.size} ontvanger{gekozen.size === 1 ? '' : 's'}</button>
            </div>
            <p className="text-[11px] text-gray-400 flex items-center gap-1"><Mail className="h-3 w-3" />Elke ontvanger krijgt de mail maar één keer; ook bij een tweede klik.</p>
          </div>
        )}
    </Dialoog>
  )
}
