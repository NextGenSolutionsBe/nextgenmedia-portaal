'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X, CalendarClock, Trash2, AlertTriangle } from 'lucide-react'
import { OutcomePanel } from './outcome-panel'
import { LeadKiezer, type LeadOption } from './lead-kiezer'

type Appt = {
  id: string; starts_at: string; ends_at: string
  lead_id: string | null; company: string | null; contact: string | null
  pipeline_id?: string | null
  outcome?: 'won' | 'lost' | null
  deal_value_cents?: number | null
  commission_pct?: number | null
}
type Pipeline = { id: string; name: string }

/** Datum-tijd voor een <input type="datetime-local">, in lokale tijd. */
function forInput(iso: string | number): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Een bestaande afspraak bewerken: lead, begin- en einduur.
 *
 * Verplaatsen kan BEWUST niet meer door te slepen. Een afspraak verzetten
 * verplaatst het agenda-item van Bram of Marco, laat de prospect een wijziging
 * zien en raakt de herinneringsmail — dat hoort niet per ongeluk te kunnen
 * gebeuren omdat je de muis liet slippen.
 */
export function EditAppointment({ appt, pipelines, isAdmin, onClose, onSaved }: {
  appt: Appt
  pipelines: Pipeline[]
  /** Enkel een admin legt gewonnen/verloren vast — daar hangt commissie aan. */
  isAdmin?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [start, setStart] = useState(forInput(appt.starts_at))
  const [end, setEnd] = useState(forInput(appt.ends_at))
  // De afspraak draagt de bedrijfs- en contactnaam zelf al mee, dus de
  // gekoppelde lead is meteen toonbaar zonder hem eerst op te halen.
  const [lead, setLead] = useState<LeadOption | null>(
    appt.lead_id
      ? {
          id: appt.lead_id,
          label: [appt.company, appt.contact].filter(Boolean).join(' · ') || 'Lead',
          email: null,
          pipelineId: appt.pipeline_id ?? null,
        }
      : null,
  )
  const leadId = lead?.id ?? ''
  // Het merk kan hier ook nog wisselen — bv. wanneer tijdens het gesprek blijkt
  // dat de prospect beter bij het andere bedrijf past.
  const [pipelineId, setPipelineId] = useState(appt.pipeline_id ?? pipelines[0]?.id ?? '')
  const [saving, setSaving] = useState(false)

  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  const changed = start !== forInput(appt.starts_at) || end !== forInput(appt.ends_at)
    || leadId !== (appt.lead_id ?? '') || pipelineId !== (appt.pipeline_id ?? '')
  const valid = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs

  const leadPipeline = lead ? pipelines.find((p) => p.id === lead.pipelineId) ?? null : null

  const save = async () => {
    if (!valid) { toast.error('Het einduur moet ná het beginuur liggen'); return }
    setSaving(true)
    try {
      const r = await fetch('/api/admin/sales/appointments', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: appt.id, startsAt: startMs, endsAt: endMs,
          leadId: leadId || null, pipelineId: pipelineId || null,
        }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Afspraak verzet.')
      // Was de herinnering al vertrokken, dan moet je dat weten — vandaar een
      // aparte, blijvende melding in plaats van een vluchtige toast.
      if (j.reminderNote) toast.warning(j.reminderNote, { duration: 12000 })
      onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verzetten mislukt') } finally { setSaving(false) }
  }

  const cancel = async () => {
    if (!confirm('Deze afspraak annuleren?\n\nHet agenda-item wordt verwijderd en de herinneringsmail gaat niet uit.')) return
    setSaving(true)
    try {
      const r = await fetch(`/api/admin/sales/appointments?id=${appt.id}`, { method: 'DELETE' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Afspraak geannuleerd.')
      onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Annuleren mislukt') } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-gray-400" />Afspraak bewerken
            </h3>
            <p className="text-sm text-gray-600 mt-0.5 truncate">
              {appt.company ?? 'Afspraak zonder lead'}{appt.contact ? ` · ${appt.contact}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lead</label>
            <LeadKiezer waarde={lead} onKies={setLead} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Afspraak voor</label>
            <select className="input-base" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Bepaalt welke one-pager en welke afzender bij de herinneringsmail horen.
              {leadPipeline && pipelineId !== leadPipeline.id && (
                <> De lead blijft in <b>{leadPipeline.name}</b> staan; enkel deze afspraak telt voor het
                gekozen merk.</>
              )}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Begint om</label>
              <input type="datetime-local" className="input-base" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Eindigt om</label>
              <input type="datetime-local" className="input-base" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          {!valid && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Het einduur moet ná het beginuur liggen.
            </p>
          )}

          {changed && valid && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Bij opslaan verplaatsen we ook het agenda-item, en de prospect krijgt een gewijzigde
                uitnodiging. Staat de herinneringsmail nog klaar, dan wordt die op het nieuwe uur gezet.
              </span>
            </p>
          )}

          {isAdmin && (
            <OutcomePanel
              appointmentId={appt.id}
              outcome={appt.outcome ?? null}
              dealValueCents={appt.deal_value_cents}
              commissionPct={appt.commission_pct}
              onDone={onSaved}
            />
          )}

          <p className="text-[11px] text-gray-500">
            Het nieuwe tijdvak wordt opnieuw gecontroleerd: valt het buiten de vrije (witte) uren of botst
            het met iets anders, dan wordt er niets gewijzigd.
          </p>
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={save} disabled={saving || !valid || !changed} className="btn-primary flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            {changed ? 'Verzetten bevestigen' : 'Niets gewijzigd'}
          </button>
          <button onClick={cancel} disabled={saving} className="btn-danger" title="Afspraak annuleren">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
