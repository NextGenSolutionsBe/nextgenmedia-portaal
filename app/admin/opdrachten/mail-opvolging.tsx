'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDownLeft, ArrowUpRight, CalendarCheck, Check, ChevronDown, FileSignature, FileText, Loader2, Mail, RefreshCw } from 'lucide-react'
import { AI_SOORT_LABEL, STATUS_LABEL, type Gebeurtenis, type Opvolging } from '@/lib/mail-opvolging/regels'

type Stand = { gekoppeld: boolean; mailboxen: { mailbox: string; map: string; laatst_gelezen_op: string | null; fout: string | null }[] }
type Data = { opvolging: Opvolging | null; gebeurtenissen: Gebeurtenis[]; actief: boolean; stand: Stand }

const KLEUR: Record<Opvolging['status'], string> = {
  akkoord: 'border-green-300 bg-green-50 text-green-950', weigering: 'border-red-200 bg-red-50 text-red-950',
  wacht_op_ons: 'border-amber-300 bg-amber-50 text-amber-950', geen_reactie: 'border-amber-300 bg-amber-50 text-amber-950',
  na_meeting: 'border-amber-300 bg-amber-50 text-amber-950', wacht_op_klant: 'border-gray-200 bg-gray-50 text-gray-800',
}
const ICOON: Record<Gebeurtenis['soort'], React.ElementType> = { in: ArrowDownLeft, uit: ArrowUpRight, meeting: CalendarCheck, offerte: FileText, contract: FileSignature }
const SOORT: Record<Gebeurtenis['soort'], string> = { in: 'Mail van de klant', uit: 'Mail van ons', meeting: 'Meeting', offerte: 'Offerte verstuurd', contract: 'Contract verstuurd' }
const tijd = (iso: string) => new Date(iso).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })

/**
 * Opvolging van één project op de projectkaart: wat er nu moet gebeuren (de
 * klant wacht op ons, geen reactie, na de meeting nog niets gestuurd, lijkt
 * akkoord) en de tijdlijn van mails, meetings, offerte en contract. Geen
 * mailconcepten: enkel wat er opgevolgd moet worden. "Opgevolgd" haalt het weg
 * tot er iets nieuws gebeurt.
 */
export function MailOpvolging({ opdrachtId, onNaarFase }: { opdrachtId: string; onNaarFase: (kolom: 'geaccepteerd' | 'stopgezet') => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/mail-opvolging?opdracht=${opdrachtId}`, { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) setData(j)
    } catch { /* blok is een extra */ }
  }, [opdrachtId])
  useEffect(() => { laad() }, [laad])

  const post = async (body: Record<string, unknown>, sleutel: string) => {
    setBezig(sleutel)
    try {
      const r = await fetch('/api/admin/mail-opvolging', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Mislukt')
      return j
    } finally { setBezig(null) }
  }
  const opgevolgd = async () => {
    if (!data?.opvolging) return
    try { await post({ actie: 'opgevolgd', opdracht_id: opdrachtId, sleutel: data.opvolging.sleutel }, 'klaar'); toast.success('Opgevolgd. Het komt terug zodra er iets nieuws gebeurt.'); laad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const lezen = async () => {
    try {
      const j = await post({ actie: 'lezen' }, 'lezen')
      if (!j.gekoppeld) toast.info('Er is nog geen mailbox gekoppeld. De agenda is wel gelezen.')
      else if (j.fouten?.length) toast.error(`Niet alles gelezen: ${j.fouten.join(' · ')}`)
      else toast.success(`Mails gelezen: ${j.bewaard} nieuwe mail${j.bewaard === 1 ? '' : 's'} met klanten.`)
      laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Lezen mislukt') }
  }

  if (!data || !data.actief) return null
  const o = data.opvolging
  const laatst = data.stand.mailboxen.map((m) => m.laatst_gelezen_op).filter(Boolean).sort().pop() ?? null
  const fouten = data.stand.mailboxen.filter((m) => m.fout)

  return (
    <section className="px-5 py-4 border-b border-gray-100 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2"><Mail className="h-4 w-4" />Opvolging</p>
      {o ? (
        <div className={`rounded-xl border px-3 py-2.5 text-sm space-y-2 ${KLEUR[o.status]}`}>
          <p><b className="font-semibold">{STATUS_LABEL[o.status]}{o.dringend ? ' · dringend' : ''}.</b> {o.tekst}</p>
          {o.elders && <p className="text-xs opacity-80">Staat ook bij Offertes of Contracten opvolgen in het Command Center.</p>}
          {o.status !== 'wacht_op_klant' && (
            <div className="flex gap-2 flex-wrap">
              {o.actie === 'naar_geaccepteerd' && <button type="button" onClick={() => onNaarFase('geaccepteerd')} className="btn-primary text-xs">Naar Offerte geaccepteerd</button>}
              {o.actie === 'naar_verloren' && <button type="button" onClick={() => onNaarFase('stopgezet')} className="btn-secondary text-xs">Naar Verloren</button>}
              <button type="button" onClick={opgevolgd} disabled={!!bezig} className="btn-secondary text-xs">{bezig === 'klaar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Opgevolgd</button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-gray-500">{data.gebeurtenissen.some((g) => g.soort === 'meeting' || g.soort === 'offerte' || g.soort === 'contract') ? 'Niets op te volgen.' : 'De opvolging start na een meeting, offerte of contract.'}</p>
      )}

      {data.gebeurtenissen.length > 0 && (
        <div>
          <button type="button" onClick={() => setOpen((x) => !x)} className="text-xs text-gray-600 hover:text-black inline-flex items-center gap-1">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />Mails en meetings ({data.gebeurtenissen.length})
          </button>
          {open && (
            <ul className="mt-2 space-y-1.5">
              {data.gebeurtenissen.map((g) => {
                const I = ICOON[g.soort]
                return (
                  <li key={g.sleutel} className="flex items-start gap-2 text-xs">
                    <I className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${g.soort === 'in' ? 'text-blue-600' : g.soort === 'uit' ? 'text-gray-500' : 'text-gray-700'}`} />
                    <div className="min-w-0">
                      <div className="text-gray-800"><span className="text-gray-500 tabular-nums">{tijd(g.op)}</span> · {SOORT[g.soort]}{g.titel ? `: ${g.titel}` : ''}{g.ai && g.ai !== 'anders' ? <span className="ml-1 rounded-full bg-blue-50 text-blue-800 px-1.5">{AI_SOORT_LABEL[g.ai]}</span> : null}</div>
                      {g.fragment && <div className="text-gray-500 line-clamp-2">{g.fragment}</div>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
        {data.stand.gekoppeld
          ? <span>Mails gelezen{laatst ? ` op ${tijd(laatst)}` : ': nog niet'}{fouten.length ? ` · ${fouten.length} mailbox${fouten.length === 1 ? '' : 'en'} met een fout` : ''}.</span>
          : <span>Nog geen mailbox gekoppeld: enkel meetings, offertes en contracten tellen mee.</span>}
        <button type="button" onClick={lezen} disabled={!!bezig} className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-black">{bezig === 'lezen' ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Nu lezen</button>
      </div>
    </section>
  )
}
