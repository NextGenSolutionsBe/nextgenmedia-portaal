'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Activity, Check, Loader2, Pencil, Trash2, X } from 'lucide-react'
import {
  ACTIVITEIT_LABEL, UITKOMSTEN, formatDuur, parseDuur, uitkomstLabel, type Activiteit, type ActiviteitType,
} from '@/lib/sales/activiteiten-model'

/**
 * De geregistreerde activiteiten van een lead (gesprekken, mails, voorstellen,
 * opvolgdatums…) met aanpassen en verwijderen.
 *
 * Hier draaien de statistieken op, dus een verkeerd geregistreerd gesprek moet
 * je kunnen rechtzetten of weghalen. Verwijderen is zacht (verwijderd_op): de
 * rij blijft bestaan maar telt nergens meer mee. Afspraken, fasewissels en
 * gewonnen/verloren staan hier bewust niet: die horen bij hun eigen actie
 * (kalender, bord, sluitdialoog).
 */

/** Wat een mens rechtstreeks registreert — en dus ook zelf mag rechtzetten. */
export const BEHEERBARE_TYPES: ActiviteitType[] = [
  'telefoongesprek', 'email_verstuurd', 'voorstel_verstuurd', 'opvolging', 'lead_afgehandeld',
]

type Bewerk = { id: string; notitie: string; duur: string; uitkomst: string }

const wanneer = (iso: string) =>
  new Date(iso).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const datumTekst = (d: string | null) => {
  const m = d ? /^(\d{4})-(\d{2})-(\d{2})/.exec(d) : null
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

export function LeadActiviteiten({ activiteiten, meId, isAdmin, naamVan, onGewijzigd }: {
  activiteiten: Activiteit[]
  meId: string | null
  isAdmin: boolean
  naamVan: (id: string | null, email: string | null) => string
  onGewijzigd: () => void
}) {
  const [bewerk, setBewerk] = useState<Bewerk | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [alles, setAlles] = useState(false)

  if (activiteiten.length === 0) return null
  const zichtbaar = alles ? activiteiten : activiteiten.slice(0, 8)

  const stuur = async (id: string, method: 'PATCH' | 'DELETE', body?: Record<string, unknown>, ok?: string) => {
    setBezig(id)
    try {
      const r = await fetch(`/api/admin/sales/activiteiten/${id}`, {
        method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      if (ok) toast.success(ok, { duration: 1500 })
      setBewerk(null)
      onGewijzigd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(null) }
  }

  const bewaar = (a: Activiteit) => {
    if (!bewerk) return
    const body: Record<string, unknown> = { notitie: bewerk.notitie }
    if (a.type === 'telefoongesprek') {
      if (bewerk.duur.trim()) {
        const s = parseDuur(bewerk.duur)
        if (s === null) { toast.error('De duur klopt niet (bv. 3:20).'); return }
        body.duurSeconden = s
      } else body.duurSeconden = null
      body.uitkomst = bewerk.uitkomst || null
    }
    void stuur(a.id, 'PATCH', body, 'Activiteit aangepast.')
  }

  const verwijder = (a: Activiteit) => {
    const label = ACTIVITEIT_LABEL[a.type as ActiviteitType] ?? 'Activiteit'
    if (!window.confirm(`${label} van ${wanneer(a.created_at)} verwijderen?\n\nHij telt daarna niet meer mee in de statistieken.`)) return
    void stuur(a.id, 'DELETE', undefined, `${label} verwijderd.`)
  }

  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wide text-gray-400 font-bold mb-2 flex items-center gap-1">
        <Activity className="h-3 w-3" />Geregistreerde activiteiten
      </h3>
      <ul className="space-y-1.5">
        {zichtbaar.map((a) => {
          const magBeheren = isAdmin || (!!meId && a.medewerker_id === meId)
          const isGesprek = a.type === 'telefoongesprek'
          return (
            <li key={a.id} className="rounded-lg border border-gray-100 px-2.5 py-1.5">
              {bewerk?.id === a.id ? (
                <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); bewaar(a) }}>
                  {isGesprek && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      <label className="text-[11px] text-gray-500">Duur (m:ss)
                        <input className="input-base text-sm mt-0.5" inputMode="numeric" placeholder="bv. 3:20" value={bewerk.duur}
                          onChange={(e) => setBewerk({ ...bewerk, duur: e.target.value })} />
                      </label>
                      <label className="text-[11px] text-gray-500">Uitkomst
                        <select className="input-base text-sm mt-0.5" value={bewerk.uitkomst} onChange={(e) => setBewerk({ ...bewerk, uitkomst: e.target.value })}>
                          <option value="">Geen</option>
                          {UITKOMSTEN.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                        </select>
                      </label>
                    </div>
                  )}
                  <textarea rows={2} className="input-base text-sm" placeholder="Notitie (optioneel)" value={bewerk.notitie}
                    onChange={(e) => setBewerk({ ...bewerk, notitie: e.target.value })} aria-label="Notitie" />
                  <div className="flex gap-1.5">
                    <button type="submit" disabled={bezig === a.id} className="btn-primary text-xs">
                      {bezig === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Bewaren
                    </button>
                    <button type="button" onClick={() => setBewerk(null)} className="btn-secondary text-xs"><X className="h-3.5 w-3.5" />Annuleer</button>
                  </div>
                </form>
              ) : (
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] text-gray-900">
                      <b className="font-semibold">{ACTIVITEIT_LABEL[a.type as ActiviteitType] ?? a.type}</b>
                      {isGesprek && a.uitkomst && <> · {uitkomstLabel(a.uitkomst)}</>}
                      {isGesprek && a.duur_seconden !== null && <> · {formatDuur(a.duur_seconden)}</>}
                      {a.type === 'opvolging' && <> · {a.opvolgdatum ? datumTekst(a.opvolgdatum) : 'gewist'}</>}
                    </p>
                    {a.notitie && <p className="text-[12px] text-gray-700 whitespace-pre-wrap break-words">{a.notitie}</p>}
                    <p className="text-[10px] text-gray-400">{wanneer(a.created_at)} · {naamVan(a.medewerker_id, a.medewerker_email)}</p>
                  </div>
                  {magBeheren && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button type="button" disabled={!!bezig} title="Aanpassen"
                        onClick={() => setBewerk({
                          id: a.id, notitie: a.notitie ?? '',
                          duur: a.duur_seconden !== null ? formatDuur(a.duur_seconden) : '', uitkomst: a.uitkomst ?? '',
                        })}
                        className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-black">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" disabled={!!bezig} title="Verwijderen" onClick={() => verwijder(a)}
                        className="h-7 w-7 flex items-center justify-center rounded-md text-red-500 hover:bg-red-50 hover:text-red-700">
                        {bezig === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {activiteiten.length > 8 && (
        <button type="button" onClick={() => setAlles((v) => !v)} className="text-[11px] text-gray-500 underline mt-1.5">
          {alles ? 'Minder tonen' : `Alle ${activiteiten.length} tonen`}
        </button>
      )}
    </section>
  )
}
