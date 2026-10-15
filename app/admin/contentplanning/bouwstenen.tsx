'use client'

import { useState, type ReactNode } from 'react'
import { X, Pin, PinOff, Pencil, Trash2, Check, StickyNote, Bell, Loader2, AlertTriangle, CircleDashed, CheckCircle2, Clock, Hourglass, Ban, PlayCircle } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import { statusVan, isAchterstallig, type Status } from '@/lib/contentplanning/model'
import type { Doe, Notitie, Taak } from './types'
import { datumNl } from './types'

export const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-1'

const STATUS_ICOON: Record<string, typeof Clock> = { nog_in_te_plannen: CircleDashed, ingepland: Clock, in_uitvoering: PlayCircle, wacht_op_klant: Hourglass, afgerond: CheckCircle2, nvt: Ban }

/** Status altijd met tekst (en icoon), niet enkel kleur. */
export function StatusBadge({ status, statussen, klein }: { status: string; statussen: Status[]; klein?: boolean }) {
  const s = statusVan(status, statussen)
  const Icon = STATUS_ICOON[s.key] ?? (s.klaar ? CheckCircle2 : Clock)
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 ${klein ? 'py-0 text-[10px]' : 'py-0.5 text-[11px]'} font-medium whitespace-nowrap ${s.kleur}`}><Icon className={klein ? 'h-2.5 w-2.5' : 'h-3 w-3'} aria-hidden />{s.label}</span>
}

/** Zijpaneel: je blijft in je planning. */
export function Paneel({ titel, sub, onSluit, children, breed }: { titel: ReactNode; sub?: ReactNode; onSluit: () => void; children: ReactNode; breed?: boolean }) {
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/25" onClick={onSluit} />
      <aside className={`absolute inset-y-0 right-0 w-full ${breed ? 'sm:w-[560px]' : 'sm:w-[480px]'} bg-white shadow-2xl flex flex-col`}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0"><h3 className="font-semibold text-gray-900 truncate">{titel}</h3>{sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}</div>
          <button type="button" onClick={onSluit} className={`h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 shrink-0 ${focusRing}`} aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">{children}</div>
      </aside>
    </div>
  )
}

/** Compacte taakkaart: eerst actie, klant en datum. Direct afvinken of openen. */
export function TaakKaart({ t, klant, statussen, vandaag, aantalNotities, onOpen, onVink, sleepbaar, onSleep, compact, toonDatum }: {
  t: Taak; klant: string | null; statussen: Status[]; vandaag: string; aantalNotities: number
  onOpen: () => void; onVink?: () => void; sleepbaar?: boolean; onSleep?: (e: React.DragEvent) => void; compact?: boolean; toonDatum?: boolean
}) {
  const s = statusVan(t.status, statussen)
  const laat = isAchterstallig(t, vandaag, statussen)
  return (
    <div draggable={sleepbaar} onDragStart={onSleep}
      className={`group flex items-start gap-2 rounded-lg border bg-white ${compact ? 'px-1.5 py-1' : 'px-2.5 py-2'} ${laat ? 'border-orange-400 ring-1 ring-orange-200' : 'border-gray-200'} ${s.klaar ? 'opacity-70' : ''} ${sleepbaar ? 'cursor-grab active:cursor-grabbing' : ''}`}>
      {onVink && (
        <button type="button" onClick={onVink} aria-pressed={s.klaar} aria-label={s.klaar ? 'Weer open zetten' : 'Afvinken'}
          className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center ${s.klaar ? 'bg-[#166534] border-[#166534] text-white' : 'border-gray-400 bg-white hover:border-black'} ${focusRing}`}>{s.klaar && <Check className="h-3 w-3" />}</button>
      )}
      <button type="button" onClick={onOpen} className={`min-w-0 flex-1 text-left ${focusRing} rounded`}>
        <div className={`truncate ${compact ? 'text-[11px]' : 'text-sm'} font-medium ${s.klaar ? 'line-through text-gray-500' : 'text-gray-900'}`}>{t.titel}</div>
        <div className={`flex items-center gap-1.5 flex-wrap ${compact ? 'text-[10px]' : 'text-[11px]'} text-gray-500`}>
          {klant && <span className="truncate max-w-[160px] font-medium text-gray-700">{klant}</span>}
          {toonDatum && t.werkdatum && <span>· {datumNl(t.werkdatum)}</span>}
          {!compact && t.verantwoordelijke && <span>· {t.verantwoordelijke}</span>}
          {t.deadline && <span className={t.deadline < vandaag && !s.klaar ? 'text-orange-700 font-semibold' : ''}>· deadline {datumNl(t.deadline)}</span>}
          {aantalNotities > 0 && <StickyNote className="h-3 w-3 text-amber-500" aria-label={`${aantalNotities} notitie(s)`} />}
          {laat && <span className="inline-flex items-center gap-0.5 text-orange-700 font-semibold"><AlertTriangle className="h-3 w-3" />achterstallig</span>}
        </div>
      </button>
      {!compact && <StatusBadge status={t.status} statussen={statussen} klein />}
    </div>
  )
}

const SOORT_LABEL: Record<Notitie['soort'], string> = { afspraak: 'Blijvende afspraak', cyclus: 'Notitie voor deze cyclus', herinnering: 'Herinnering' }

/**
 * Notities bij een klant, taak, batch, reeks of cyclus: blijvende afspraak,
 * notitie voor deze cyclus, of herinnering op een datum. Met auteur en datum,
 * aanpasbaar, verwijderbaar (met ongedaan maken) en vast te pinnen.
 */
export function Notities({ notities, standaard, doe, kanSchrijven, titel = 'Notities' }: {
  notities: Notitie[]; standaard: Partial<Notitie>; doe: Doe; kanSchrijven: boolean; titel?: string
}) {
  const [nieuw, setNieuw] = useState(false)
  const [v, setV] = useState({ tekst: '', soort: (standaard.soort ?? 'cyclus') as Notitie['soort'], herinner_op: '' })
  const [bewerk, setBewerk] = useState<string | null>(null)
  const [bewerkTekst, setBewerkTekst] = useState('')
  const [bezig, setBezig] = useState(false)
  const lijst = [...notities].sort((a, b) => Number(b.vastgepind) - Number(a.vastgepind) || b.updated_at.localeCompare(a.updated_at))
  const bewaar = async () => {
    setBezig(true)
    const r = await doe('notitie.maak', { ...standaard, tekst: v.tekst, soort: v.soort, herinner_op: v.soort === 'herinnering' ? v.herinner_op || null : null }, { melding: 'Notitie bewaard.' })
    setBezig(false)
    if (r) { setNieuw(false); setV({ tekst: '', soort: standaard.soort ?? 'cyclus', herinner_op: '' }) }
  }
  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{titel}</h4>
        {kanSchrijven && !nieuw && <button type="button" onClick={() => setNieuw(true)} className={`text-xs underline text-gray-700 ${focusRing}`}>+ notitie</button>}
      </div>
      {nieuw && (
        <div className="rounded-xl border border-gray-200 p-3 space-y-2 mb-2">
          <div className="flex gap-1 flex-wrap">
            {(['afspraak', 'cyclus', 'herinnering'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setV({ ...v, soort: s })} className={`rounded-full border px-2.5 py-1 text-xs ${v.soort === s ? 'bg-black text-white border-black' : 'bg-white border-gray-200'} ${focusRing}`}>{SOORT_LABEL[s]}</button>
            ))}
          </div>
          <textarea rows={2} className={INP} value={v.tekst} onChange={(e) => setV({ ...v, tekst: e.target.value })} placeholder={v.soort === 'afspraak' ? 'bv. Heeft zeven werkdagen om goed te keuren.' : v.soort === 'herinnering' ? 'bv. Shootdatum nog bevestigen.' : 'bv. Deze maand extra beelden opvragen.'} autoFocus />
          {v.soort === 'herinnering' && <div className="flex items-center gap-2"><label className="text-xs text-gray-600">Herinner me op</label><input type="date" className={`${INP} w-44`} value={v.herinner_op} onChange={(e) => setV({ ...v, herinner_op: e.target.value })} /></div>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setNieuw(false)} className="btn-secondary text-xs">Annuleren</button><button type="button" disabled={bezig || !v.tekst.trim() || (v.soort === 'herinnering' && !v.herinner_op)} onClick={bewaar} className="btn-primary text-xs">{bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Bewaren</button></div>
        </div>
      )}
      {lijst.length === 0 && !nieuw && <p className="text-sm text-gray-400">Nog geen notities.</p>}
      <ul className="space-y-2">
        {lijst.map((n) => (
          <li key={n.id} className={`rounded-xl border p-2.5 text-sm ${n.vastgepind ? 'border-amber-300 bg-amber-50/60' : 'border-gray-200'} ${n.afgevinkt_op ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-2">
              {n.soort === 'herinnering' && kanSchrijven && (
                <button type="button" onClick={() => doe('notitie.wijzig', { id: n.id, afgevinkt: !n.afgevinkt_op }, { stil: true })} aria-label={n.afgevinkt_op ? 'Weer open zetten' : 'Afvinken'}
                  className={`mt-0.5 h-4 w-4 shrink-0 rounded border flex items-center justify-center ${n.afgevinkt_op ? 'bg-[#166534] border-[#166534] text-white' : 'border-gray-400'} ${focusRing}`}>{n.afgevinkt_op && <Check className="h-3 w-3" />}</button>
              )}
              <div className="min-w-0 flex-1">
                {bewerk === n.id ? (
                  <div className="space-y-1.5"><textarea rows={2} className={INP} value={bewerkTekst} onChange={(e) => setBewerkTekst(e.target.value)} /><div className="flex gap-2 justify-end"><button type="button" className="btn-secondary text-xs" onClick={() => setBewerk(null)}>Annuleren</button><button type="button" className="btn-primary text-xs" onClick={async () => { if (await doe('notitie.wijzig', { id: n.id, tekst: bewerkTekst }, { melding: 'Notitie aangepast.' })) setBewerk(null) }}>Bewaren</button></div></div>
                ) : <div className={`whitespace-pre-wrap ${n.afgevinkt_op ? 'line-through' : ''}`}>{n.tekst}</div>}
                <div className="text-[11px] text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
                  {n.soort === 'herinnering' ? <span className="inline-flex items-center gap-0.5"><Bell className="h-3 w-3" />{datumNl(n.herinner_op)}</span> : <span>{SOORT_LABEL[n.soort]}</span>}
                  <span>· {n.auteur ?? 'onbekend'} · {new Date(n.updated_at).toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: '2-digit' })}</span>
                </div>
              </div>
              {kanSchrijven && bewerk !== n.id && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button type="button" onClick={() => doe('notitie.wijzig', { id: n.id, vastgepind: !n.vastgepind }, { stil: true })} className={`h-7 w-7 rounded-lg hover:bg-gray-100 flex items-center justify-center ${focusRing}`} aria-label={n.vastgepind ? 'Losmaken' : 'Vastpinnen'} title={n.vastgepind ? 'Losmaken' : 'Vastpinnen'}>{n.vastgepind ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}</button>
                  <button type="button" onClick={() => { setBewerk(n.id); setBewerkTekst(n.tekst) }} className={`h-7 w-7 rounded-lg hover:bg-gray-100 flex items-center justify-center ${focusRing}`} aria-label="Aanpassen"><Pencil className="h-3.5 w-3.5" /></button>
                  <button type="button" onClick={() => doe('notitie.verwijder', { id: n.id }, { melding: 'Notitie verwijderd.' })} className={`h-7 w-7 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center ${focusRing}`} aria-label="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function Leeg({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-gray-300 p-4 text-sm text-gray-500 text-center">{children}</div>
}
