'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Copy, ExternalLink, Check, AlertTriangle, RotateCcw } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import { focusRing } from '@/app/admin/materiaal/dialogen'

/**
 * Klantboekingen — de publieke link waarmee klanten zelf een gratis meeting van
 * 30 minuten boeken. Regels liggen vast (72 uur vooraf, 11–17 uur Belgische
 * tijd); hier kies je enkel of het aan staat en in welke agenda het komt, en
 * controleer je of de beschikbaarheid echt berekend kan worden.
 */

type Data = {
  instellingen: { actief: boolean; agenda_id: string | null }
  link: string
  agendas: { id: string; naam: string; gekoppeld: boolean; clickup: boolean }[]
  controle: { ok: boolean; aantal?: number; eerste?: string[]; fout?: string; detail?: string } | null
  magAanpassen: boolean
}

const lbl = 'block text-xs font-medium text-gray-700 mb-1'

export function KlantboekingenTab() {
  const [d, setD] = useState<Data | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const laad = useCallback(async (controle = false) => {
    if (controle) setBezig('controle')
    try {
      const r = await fetch(`/api/admin/meetings/klantboeking${controle ? '?controle=1' : ''}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      setD(j)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setBezig(null) }
  }, [])
  useEffect(() => { laad(true) }, [laad])

  async function bewaar(w: { actief: boolean; agenda_id: string | null }) {
    setBezig('bewaar')
    try {
      const r = await fetch('/api/admin/meetings/klantboeking', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(w) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      toast.success('Bewaard.'); await laad(true)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(null) }
  }

  if (!d) return <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const agenda = d.agendas.find((a) => a.id === d.instellingen.agenda_id)

  return (
    <div className="space-y-4">
      <section className="card-base space-y-3">
        <h2 className="font-medium">Boekingslink</h2>
        <div className="flex items-center gap-2 rounded-lg border border-gray-200 p-2.5">
          <code className="text-sm flex-1 min-w-0 truncate">{d.link}</code>
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(d.link); toast.success('Link gekopieerd.') } catch { toast.error('Kopiëren lukte niet.') } }} className={`h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 hover:bg-gray-50 ${focusRing}`} aria-label="Link kopiëren"><Copy className="h-4 w-4" /></button>
          <a href="/boeken" target="_blank" rel="noreferrer" className={`h-8 w-8 inline-flex items-center justify-center rounded-md border border-gray-200 hover:bg-gray-50 ${focusRing}`} aria-label="Pagina openen"><ExternalLink className="h-4 w-4" /></a>
        </div>
        <ul className="text-sm text-gray-700 list-disc pl-5 space-y-0.5">
          <li>Gratis meeting van 30 minuten via Google Meet.</li>
          <li>Minstens 72 uur vooraf. De klant ziet: “Boek minstens 3 dagen vooraf.”</li>
          <li>Enkel tussen 11:00 en 17:00 Belgische tijd; laatste startuur 16:30.</li>
          <li>Enkel momenten binnen de werkuren van de agenda die vrij zijn in Google, ClickUp en de app. De klant ziet nooit wat er gepland staat.</li>
          <li>Lukt een van die controles niet, dan kan er niet geboekt worden.</li>
          <li>De klant krijgt een bevestiging met een persoonlijke link om te verplaatsen of te annuleren, de uitnodiging van Google en 24 uur vooraf een herinnering.</li>
        </ul>
      </section>

      <section className="card-base space-y-3">
        <h2 className="font-medium">Instellingen</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={d.instellingen.actief} disabled={!d.magAanpassen || !!bezig} onChange={(e) => bewaar({ ...d.instellingen, actief: e.target.checked })} />
          Klanten kunnen online boeken
        </label>
        <div className="max-w-sm">
          <label className={lbl} htmlFor="kb-agenda">Agenda waarin klantboekingen komen</label>
          <select id="kb-agenda" className={INP} value={d.instellingen.agenda_id ?? ''} disabled={!d.magAanpassen || !!bezig} onChange={(e) => bewaar({ ...d.instellingen, agenda_id: e.target.value || null })}>
            {d.agendas.map((a) => <option key={a.id} value={a.id} disabled={!a.gekoppeld}>{a.naam}{a.gekoppeld ? '' : ' (koppeling verlopen)'}{a.clickup ? '' : ' (geen ClickUp-gebruiker)'}</option>)}
          </select>
          <p className="text-[11px] text-gray-500 mt-1">De bezetting in ClickUp wordt gelezen voor de ClickUp-gebruiker van deze agenda{agenda && !agenda.clickup ? ' (die ontbreekt nu: zonder kan niemand boeken)' : ''}. Werkuren stel je in via Calendar.</p>
        </div>
      </section>

      <section className="card-base space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h2 className="font-medium">Controle van de beschikbaarheid</h2>
          <button type="button" onClick={() => laad(true)} disabled={!!bezig} className={`btn-secondary !py-1 text-xs ${focusRing}`}>{bezig === 'controle' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}Opnieuw controleren</button>
        </div>
        {!d.controle && <p className="text-sm text-gray-500">Nog niet gecontroleerd.</p>}
        {d.controle?.ok && (
          <div className="text-sm space-y-1">
            <p className="flex items-center gap-1.5"><Check className="h-4 w-4" aria-hidden />Werkt: {d.controle.aantal} vrije momenten de komende vier weken (Google, ClickUp en werkuren gelezen).</p>
            {!!d.controle.eerste?.length && <p className="text-xs text-gray-600">Eerste: {d.controle.eerste.join(' · ')}</p>}
          </div>
        )}
        {d.controle && !d.controle.ok && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 space-y-1" role="alert">
            <p className="flex items-start gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden />Klanten kunnen nu niet boeken: {d.controle.fout}</p>
            {d.controle.detail && <p className="text-xs">Oorzaak: {d.controle.detail}</p>}
          </div>
        )}
      </section>
    </div>
  )
}
