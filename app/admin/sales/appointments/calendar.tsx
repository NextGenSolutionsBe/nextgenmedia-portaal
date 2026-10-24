'use client'

// Het boekpaneel voor een afspraak met een lead (verkoopafspraak). De agenda
// zelf is Calendar in de Meeting Inplanner (app/admin/meetings/calendar.tsx);
// de vroegere Appointment setting-agenda is daarin opgegaan.

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, CalendarClock, X, Video } from 'lucide-react'
import { LeadKiezer, type LeadOption } from './lead-kiezer'
import { merkStijl } from '@/lib/sales/merk'

type Pipeline = { id: string; key: string; name: string; defaultCalendarId?: string | null }

const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })

// ── Boekingspaneel ───────────────────────────────────────────────────────────
export function BookingPanel({ ownerId, ownerName, start, end, pipelines, initialLeadId, merkVoorkeur, merkVast, onClose, onBooked }: {
  ownerId: string; ownerName: string | null
  start: number; end: number
  pipelines: Pipeline[]; initialLeadId?: string
  /** Merk van de gekozen agenda (of het actieve merkfilter): wordt de
   *  beginstand van "Afspraak voor", zodat agenda en merk samen kloppen. */
  merkVoorkeur?: string
  /** De gekozen agenda hoort bij een merk: dan ligt het merk VAST. De server
   *  weigert een andere combinatie toch, dus de keuze tonen zou enkel een
   *  gegarandeerde foutmelding opleveren. */
  merkVast?: boolean
  onClose: () => void; onBooked: () => void
}) {
  const [lead, setLead] = useState<LeadOption | null>(null)
  const leadId = lead?.id ?? ''
  /**
   * Voor welk merk is deze afspraak? Standaard dat van de lead, maar je kunt
   * het wisselen: aan de telefoon blijkt soms dat iemand uit de ene pipeline
   * beter bij het andere merk past. `touched` onthoudt of je zelf gekozen hebt,
   * zodat een latere leadwissel jouw keuze niet stilletjes overschrijft.
   */
  const [pipelineId, setPipelineId] = useState(merkVoorkeur || (pipelines[0]?.id ?? ''))
  const [touched, setTouched] = useState(false)
  const [email, setEmail] = useState('')
  const [titel, setTitel] = useState('')
  const [notes, setNotes] = useState('')
  const [adres, setAdres] = useState('')
  const [clientNote, setClientNote] = useState('')
  const [withMeet, setWithMeet] = useState(true)
  const [saving, setSaving] = useState(false)
  // Eerst nakijken, dan bevestigen (Meeting Inplanner): zo gaat er nooit een
  // uitnodiging naar een verkeerd adres of op een verkeerd uur.
  const [controle, setControle] = useState(false)

  const leadPipeline = lead ? pipelines.find((p) => p.id === lead.pipelineId) ?? null : null

  // Lead gekozen en zelf nog niets aangeduid -> het merk van die lead volgen.
  // MAAR: hoort de agenda bij een vast merk, dan wint de agenda. Anders zou
  // het kiezen van een lead uit het andere merk hier stilletjes een combinatie
  // instellen die de server gegarandeerd weigert.
  useEffect(() => {
    if (!merkVast && !touched && leadPipeline) setPipelineId(leadPipeline.id)
  }, [merkVast, touched, leadPipeline])

  const book = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/sales/appointments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: ownerId || null, pipelineId: pipelineId || null,
          startsAt: start, endsAt: end,
          titel: titel.trim() || null,
          leadId: leadId || null, attendeeEmail: email.trim() || null,
          notes, clientNote, adres, withMeet,
        }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(leadId ? 'Geboekt. De lead staat nu op “Afspraak ingepland”.' : 'Afspraak geboekt.')
      // De boeking is gelukt, maar de herinnering niet — dat mag niet stil
      // blijven, want dan merk je het pas als de prospect niet komt opdagen.
      if (j.waarschuwing) toast.warning(j.waarschuwing, { duration: 12000 })
      onBooked()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Boeken mislukt') } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-gray-400" />Afspraak boeken
              {(() => {
                const gekozen = pipelines.find((p) => p.id === pipelineId)
                if (!gekozen) return null
                const stijl = merkStijl(gekozen.key)
                return (
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stijl.badge}`}>
                    {gekozen.name}
                  </span>
                )
              })()}
            </h3>
            <p className="text-sm text-gray-600 mt-0.5">
              {ownerName ? <>Bij <b>{ownerName}</b> · </> : null}
              {new Date(start).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} · {hhmm(start)}–{hhmm(end)}
            </p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          {controle && (() => {
            const naar = email.trim() || lead?.email || null
            const merk = pipelines.find((p) => p.id === pipelineId)?.name ?? '—'
            const rijen: [string, string][] = [
              ['Wanneer', `${new Date(start).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} · ${hhmm(start)}–${hhmm(end)} (Belgische tijd)`],
              ['Agenda', ownerName ?? '—'],
              ['Lead', lead?.label ?? 'Geen lead gekoppeld'],
              ['Merk', merk],
              ['Uitnodiging naar', naar ?? 'niemand: zonder e-mailadres gaat er geen uitnodiging of herinnering uit'],
              ['Titel', titel.trim() || `${(lead?.label.split(' · ')[0] ?? 'Bedrijf')} — ${merk}`],
              ['Google Meet', withMeet ? 'ja, link wordt aangemaakt' : 'nee'],
              ...(adres.trim() ? [['Adres', adres.trim()] as [string, string]] : []),
              ['Herinnering', naar ? '24 uur vooraf naar de prospect (of 2 uur vooraf als dat te laat is)' : 'geen'],
            ]
            return (
              <div className="rounded-lg border border-gray-900 bg-gray-50 p-3 text-sm space-y-1" role="status">
                <p className="font-medium">Klopt dit? Na bevestigen gaat de uitnodiging de deur uit.</p>
                <dl className="text-xs space-y-0.5">{rijen.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-28 shrink-0 text-gray-500">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>)}</dl>
              </div>
            )
          })()}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lead koppelen <span className="text-gray-400">— optioneel</span></label>
            <LeadKiezer waarde={lead} initialId={initialLeadId} onKies={setLead} />
            {leadId && <p className="text-[11px] text-gray-500 mt-1">Deze lead springt na het boeken naar “Afspraak ingepland”.</p>}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Titel van de afspraak</label>
            <input className="input-base" value={titel} onChange={(e) => setTitel(e.target.value)}
              maxLength={120}
              placeholder={`${(lead?.label.split(' · ')[0] ?? 'Bedrijf')} — ${pipelines.find((p) => p.id === pipelineId)?.name ?? 'merk'}`} />
            <p className="text-[11px] text-gray-500 mt-1">
              Dit wordt de titel van de agenda-uitnodiging — de prospect ziet hem ook. Leeg = het voorbeeld hierboven.
            </p>
          </div>

          {/* Voor welk bedrijf is deze afspraak? Bepaalt de brochure en de
              afzender van de herinneringsmail die de dag ervoor uitgaat. */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-2">
              Afspraak voor
              {(() => {
                const gekozen = pipelines.find((p) => p.id === pipelineId)
                if (!gekozen) return null
                const stijl = merkStijl(gekozen.key)
                return (
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${stijl.badge}`}>
                    {gekozen.name}
                  </span>
                )
              })()}
            </label>
            <select className="input-base" value={pipelineId} disabled={merkVast}
              onChange={(e) => { setTouched(true); setPipelineId(e.target.value) }}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {merkVast && (
              <p className="text-[11px] text-gray-500 mt-1">
                Deze agenda hoort bij dit merk. Voor het andere merk kies je eerst de agenda van dat merk.
              </p>
            )}
            <p className="text-[11px] text-gray-500 mt-1">
              Bepaalt welke one-pager en welke afzender bij de herinneringsmail horen.
              {leadPipeline && pipelineId !== leadPipeline.id && (
                <> De lead staat nu in <b>{leadPipeline.name}</b> en verhuist bij het boeken mee naar het
                gekozen merk.</>
              )}
              {leadPipeline && pipelineId === leadPipeline.id && <> Overgenomen van de lead.</>}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-mail prospect</label>
            <input type="email" className="input-base" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={lead?.email ?? 'naam@bedrijf.be'} />
            <p className="text-[11px] text-gray-500 mt-1">
              Leeg laten = het adres van de lead. Vul je een ander adres in, dan wordt dat ook in de pipeline bijgewerkt.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={withMeet} onChange={(e) => setWithMeet(e.target.checked)} className="h-4 w-4 rounded border-gray-300 accent-gray-900" />
            <span className="flex items-center gap-1.5"><Video className="h-3.5 w-3.5 text-gray-400" />Google Meet-link toevoegen</span>
          </label>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Adres van de afspraak</label>
            <textarea rows={2} className="input-base" value={adres} onChange={(e) => setAdres(e.target.value)}
              placeholder="Dorpsstraat 12, 2400 Mol" />
            <p className="text-[11px] text-gray-400 mt-1">
              Komt in het agenda-item als locatie, zodat de closer er rechtstreeks naartoe kan navigeren.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Briefing voor de closer</label>
            <textarea rows={3} className="input-base" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Wat heb je gehoord aan de telefoon? Waar ligt de behoefte, wat is het budget, waar moet hij op inspelen?" />
            <p className="text-[11px] text-gray-400 mt-1">
              Dit staat in de agenda van Bram of Marco. Zij openen 's ochtends hun agenda en moeten daaraan
              genoeg hebben — zonder de app te openen.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Afgesproken met de prospect</label>
            <textarea rows={2} className="input-base" value={clientNote} onChange={(e) => setClientNote(e.target.value)}
              placeholder="Bv. vraagt naar referenties uit zijn sector" />
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          {controle ? (
            <>
              <button onClick={book} disabled={saving} className="btn-primary flex-1">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}Bevestigen en boeken
              </button>
              <button onClick={() => setControle(false)} disabled={saving} className="btn-secondary">Terug</button>
            </>
          ) : (
            <>
              <button onClick={() => {
                if (email.trim() && !/^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]{2,}$/.test(email.trim())) { toast.error('Dat e-mailadres is niet geldig.'); return }
                setControle(true)
              }} className="btn-primary flex-1">
                <CalendarClock className="h-4 w-4" />Nakijken
              </button>
              <button onClick={onClose} className="btn-secondary">Annuleer</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
