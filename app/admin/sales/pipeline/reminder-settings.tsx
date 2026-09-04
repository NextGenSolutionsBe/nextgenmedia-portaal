'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X, Save, Mail, Send, Paperclip } from 'lucide-react'

type Pipeline = {
  id: string; key: string; name: string
  reminder_enabled: boolean
  brochure_url: string | null
  brochure_filename: string | null
  reminder_from: string | null
  reminder_reply_to: string | null
  /** ClickUp-lijst waar de afspraaktaken van dit merk in komen. */
  clickup_list_id?: string | null
  /** Intern adres dat bij elke nieuwe afspraak van dit merk een melding krijgt. */
  notify_email?: string | null
  /** Heeft dit merk een eigen Resend-sleutel in de omgeving staan? */
  ownKey?: boolean
  /** Wat er vertrekt als het afzenderveld leeg blijft. */
  fallbackFrom?: string
}

type ClickupLijst = { id: string; naam: string; pad: string }

/**
 * De herinneringsmail per merk. Die gaat 24 uur voor de afspraak uit, of een
 * kwartier na het inboeken als er minder dan een dag tussen zit.
 *
 * Dit is de enige mail in het platform die automatisch vertrekt. Daarom staat
 * er een schakelaar per merk op, en kun je hem eerst naar jezelf sturen.
 */
export function ReminderSettings({ onClose }: { onClose: () => void }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [rows, setRows] = useState<Pipeline[]>([])
  const [active, setActive] = useState(0)
  const [defaultFrom, setDefaultFrom] = useState('')
  const [testTo, setTestTo] = useState('')
  const [lijsten, setLijsten] = useState<ClickupLijst[]>([])
  const [clickupIngesteld, setClickupIngesteld] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/sales/pipelines')
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setRows(j.pipelines ?? [])
      setDefaultFrom(j.defaultFrom ?? '')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // De ClickUp-lijsten los laden: zijn die traag of niet ingesteld, dan staat
  // de rest van het paneel er al.
  useEffect(() => {
    fetch('/api/admin/sales/clickup-opties')
      .then((r) => r.json())
      .then((j) => { setLijsten(j.lijsten ?? []); setClickupIngesteld(j.ingesteld !== false) })
      .catch(() => setLijsten([]))
  }, [])

  const p = rows[active]
  const set = (patch: Partial<Pipeline>) =>
    setRows((prev) => prev.map((r, i) => (i === active ? { ...r, ...patch } : r)))

  const save = async () => {
    if (!p) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/sales/pipelines', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Opgeslagen.')
      onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setSaving(false) }
  }

  const test = async () => {
    if (!p) return
    setTesting(true)
    try {
      // Eerst opslaan, anders test je de vorige instellingen.
      await fetch('/api/admin/sales/pipelines', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
      })
      const res = await fetch('/api/admin/sales/pipelines', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, to: testTo }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(j.attached ? 'Testmail verstuurd, met brochure.' : 'Testmail verstuurd — zonder brochure!')
      if (j.afzenderTeruggevallen) {
        toast.warning('Let op: verstuurd vanaf het hoofdadres, want het domein van dit merk is niet geverifieerd bij Resend. Antwoorden komen wel bij het merk aan.', { duration: 12000 })
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Testmail mislukt') } finally { setTesting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Mail className="h-4 w-4 text-gray-400" />Herinneringsmail
            </h3>
            <p className="text-sm text-gray-600 mt-0.5">
              Gaat 24 uur voor de afspraak uit — of een kwartier na het inboeken als er minder dan een dag
              tussen zit. De mail wordt bij het boeken al ingepland, dus het uur klopt op de minuut.
            </p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        {loading || !p ? (
          <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        ) : (
          <div className="p-5 space-y-4 overflow-y-auto">
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {rows.map((r, i) => (
                <button key={r.id} onClick={() => setActive(i)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    i === active ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-black'}`}>
                  {r.name}
                </button>
              ))}
            </div>

            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[#fff848]"
                checked={p.reminder_enabled} onChange={(e) => set({ reminder_enabled: e.target.checked })} />
              <span>
                <span className="block text-sm font-medium text-gray-900">Herinnering automatisch versturen</span>
                <span className="block text-[11px] text-gray-500">
                  Staat dit uit, dan vertrekt er voor {p.name} niets. Afspraken zonder e-mailadres krijgen
                  sowieso niets.
                </span>
              </span>
            </label>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Afzender</label>
              <input className="input-base" value={p.reminder_from ?? ''}
                onChange={(e) => set({ reminder_from: e.target.value })}
                placeholder={p.fallbackFrom ?? defaultFrom} />
              <p className="text-[11px] text-gray-500 mt-1">
                Leeg = <b>{p.fallbackFrom ?? defaultFrom}</b>. Wil je vanaf een ander domein sturen, dan moet
                dat domein eerst geverifieerd zijn bij Resend — anders weigert die de mail.
              </p>
              {p.key === 'nextgensolutions' && (
                <p className={`text-[11px] mt-1 rounded-lg px-2 py-1 border ${
                  p.ownKey
                    ? 'text-green-800 bg-green-50 border-green-200'
                    : 'text-amber-800 bg-amber-50 border-amber-200'}`}>
                  {p.ownKey
                    ? 'Eigen Resend-sleutel gevonden (RESEND_API_KEY_SOLUTIONS) — deze mails vertrekken daarmee.'
                    : 'Geen RESEND_API_KEY_SOLUTIONS gevonden. Deze mails vertrekken met de gewone sleutel, dus vanaf het NextGenMedia-domein.'}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Antwoorden gaan naar</label>
              <input className="input-base" type="email" value={p.reminder_reply_to ?? ''}
                onChange={(e) => set({ reminder_reply_to: e.target.value })}
                placeholder="leeg = naar de afzender" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1 flex items-center gap-1.5">
                <Paperclip className="h-3 w-3 text-gray-400" />Brochure in bijlage
              </label>
              <input className="input-base" value={p.brochure_url ?? ''}
                onChange={(e) => set({ brochure_url: e.target.value })}
                placeholder="/brochures/Kennismaking.pdf" />
              <input className="input-base mt-1.5" value={p.brochure_filename ?? ''}
                onChange={(e) => set({ brochure_filename: e.target.value })}
                placeholder="Bestandsnaam zoals de prospect hem ziet" />
              <p className="text-[11px] text-gray-500 mt-1">
                Een pad dat met <code>/</code> begint verwijst naar een bestand in de app; een volledige
                https-link mag ook. Laat je dit leeg, dan gaat de mail zónder bijlage.
              </p>
            </div>

            {/* ── ClickUp & interne melding per merk ─────────────────────── */}
            <div className="border-t border-gray-100 pt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Melding bij elke nieuwe afspraak naar
                </label>
                <input className="input-base" type="email" value={p.notify_email ?? ''}
                  onChange={(e) => set({ notify_email: e.target.value })}
                  placeholder={p.key === 'nextgensolutions' ? 'info@nextgensolutions.be' : 'info@nextgenmedia.be'} />
                <p className="text-[11px] text-gray-500 mt-1">
                  Wordt er voor {p.name} een afspraak ingeboekt, dan gaat er meteen een mail met alle
                  gegevens naar dit adres. Leeg = geen melding.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  ClickUp-lijst voor afspraken van {p.name}
                </label>
                <select className="input-base" value={p.clickup_list_id ?? ''}
                  onChange={(e) => set({ clickup_list_id: e.target.value })}>
                  <option value="">Geen ClickUp-taak aanmaken</option>
                  {/* Een opgeslagen lijst die (even) niet in ClickUp gevonden wordt
                      blijft zichtbaar, anders zou openen+opslaan hem stilletjes wissen. */}
                  {p.clickup_list_id && !lijsten.some((l) => l.id === p.clickup_list_id) && (
                    <option value={p.clickup_list_id}>Huidige lijst ({p.clickup_list_id})</option>
                  )}
                  {lijsten.map((l) => <option key={l.id} value={l.id}>{l.pad}</option>)}
                </select>
                <p className="text-[11px] text-gray-500 mt-1">
                  {clickupIngesteld
                    ? 'Elke geboekte afspraak wordt hier als taak gezet, toegewezen aan de closer van de gekozen agenda, met de afspraakdatum als deadline. Verzetten en annuleren bewegen mee.'
                    : 'De ClickUp-koppeling is niet ingesteld (CLICKUP_API_KEY ontbreekt of hapert) — er kunnen nu geen lijsten opgehaald en geen taken aangemaakt worden.'}
                </p>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Eerst zelf bekijken</label>
              <div className="flex gap-2">
                <input className="input-base" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)}
                  placeholder="jouw@adres.be" />
                <button onClick={test} disabled={testing || !testTo.trim()} className="btn-secondary text-sm whitespace-nowrap">
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Testmail
                </button>
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                Stuurt exact dezelfde mail met dezelfde bijlage naar dit adres. Instellingen worden meteen
                mee opgeslagen.
              </p>
            </div>
          </div>
        )}

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={save} disabled={saving || loading} className="btn-primary flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Opslaan
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}
