'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarCog, Loader2 } from 'lucide-react'
import { ROL_INFO, ROL_VOLGORDE, kalenderRechten, type KalenderRol, type RolOfStandaard } from '@/lib/content/kalender-rol'

/**
 * Toegang contentkalender — één rol per klant, voor alle gebruikers van die klant.
 * Subaccounts houden binnen die rol hun eigen rechten (Gebruikers & rechten).
 * Leeg = Standaard: de werking van vóór de rollen, zodat bestaande klanten niets merken.
 */
type Rechten = { view: boolean; edit: boolean; feedback: boolean; approve_scripts: boolean }
type Data = {
  rol: KalenderRol | null
  oudBeheer: boolean
  gewijzigd: { door: string | null; op: string } | null
  subaccounts: { id: string; naam: string | null; email: string | null; actief: boolean; rechten: Rechten }[]
}

const RECHT_LABEL: Record<keyof Rechten, string> = { view: 'bekijken', edit: 'bewerken', feedback: 'feedback', approve_scripts: 'goedkeuren' }

export function KalenderRolInstelling({ clientId }: { clientId: string }) {
  const [data, setData] = useState<Data | null>(null)
  const [keuze, setKeuze] = useState<RolOfStandaard>('standaard')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const zet = (d: Data) => { setData(d); setKeuze(d.rol ?? 'standaard') }
  useEffect(() => {
    fetch(`/api/admin/clients/${clientId}/kalender-rol`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); zet(j) })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [clientId])

  if (fout) return <div className="card-base text-sm text-gray-500"><b className="text-gray-800">Toegang contentkalender</b> — {fout}</div>
  if (!data) return <div className="card-base py-6 text-center"><Loader2 className="h-4 w-4 animate-spin mx-auto text-gray-400" /></div>

  const huidig: RolOfStandaard = data.rol ?? 'standaard'
  const gewijzigd = keuze !== huidig

  // Welke subaccounts kunnen minder dan de rol toelaat, door hun eigen rechten?
  const rolVoorBerekening = keuze === 'standaard' ? null : keuze
  const vol = JSON.stringify(kalenderRechten(rolVoorBerekening, null, { isOwner: true, perms: {} }))
  const beperkt = data.subaccounts.filter((s) => s.actief).flatMap((s) => {
    if (JSON.stringify(kalenderRechten(rolVoorBerekening, null, { isOwner: false, perms: s.rechten })) === vol) return []
    const mist = (Object.keys(RECHT_LABEL) as (keyof Rechten)[]).filter((k) => !s.rechten[k]).map((k) => RECHT_LABEL[k])
    return [{ id: s.id, naam: s.naam || s.email || 'Subaccount', mist: s.rechten.view ? mist : ['bekijken'] }]
  })

  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/clients/${clientId}/kalender-rol`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rol: keuze }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      const d = j as Data
      zet(d)
      toast.success(`Rol bijgewerkt naar “${ROL_INFO[d.rol ?? 'standaard'].label}”. Dit geldt meteen voor alle gebruikers van deze klant.`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="card-base space-y-3" id="kalender-rol">
      <div className="flex items-start gap-3">
        <CalendarCog className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-sm">Toegang contentkalender</h2>
          <p className="text-[11px] text-gray-500">
            Huidige rol: <b className="text-gray-800">{ROL_INFO[huidig].label}</b>
            {data.gewijzigd && <> · gewijzigd{data.gewijzigd.door ? ` door ${data.gewijzigd.door}` : ''} op {new Date(data.gewijzigd.op).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>}
          </p>
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="sr-only">Rol in de contentplanning</legend>
        {ROL_VOLGORDE.map((r) => {
          const actief = keuze === r
          return (
            <label key={r} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 cursor-pointer transition-colors ${actief ? 'border-[#fff848] bg-[#fff848]/10' : 'border-gray-100 hover:border-gray-200'}`}>
              <input type="radio" name={`kalender-rol-${clientId}`} className="mt-1" checked={actief} onChange={() => setKeuze(r)} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900">{ROL_INFO[r].label}{r === huidig && <span className="ml-1.5 text-[10px] font-normal text-gray-500">(huidig)</span>}</span>
                <span className="block text-[11px] text-gray-500 leading-snug">{ROL_INFO[r].uitleg}</span>
              </span>
            </label>
          )
        })}
      </fieldset>

      {keuze === 'standaard' && data.oudBeheer && (
        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">Voor deze klant staat het vroegere kalenderbeheer nog aan. Op Standaard blijft dat gelden; kies een rol om het te vervangen.</p>
      )}
      {keuze !== 'geen' && beperkt.length > 0 && (
        <div className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">
          <p>Deze subaccounts kunnen minder door hun eigen rechten (aan te passen onder Gebruikers &amp; rechten):</p>
          <ul className="mt-1 space-y-0.5">{beperkt.map((b) => <li key={b.id}><b className="font-medium text-gray-800">{b.naam}</b> — geen recht op {b.mist.join(', ')}</li>)}</ul>
        </div>
      )}
      <p className="text-[11px] text-gray-400">NextGenMedia houdt altijd alle rechten. De rol geldt enkel voor deze klant.</p>

      {gewijzigd && (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setKeuze(huidig)} className="btn-secondary text-xs">Annuleren</button>
          <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-xs">{bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Rol bewaren</button>
        </div>
      )}
    </div>
  )
}
