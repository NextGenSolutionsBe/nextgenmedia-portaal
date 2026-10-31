'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Copy, Loader2, RefreshCw, RotateCcw, UserMinus } from 'lucide-react'
import { Bevestig } from '@/app/admin/instellingen/ui'
import { euro, type Inschrijving, type KlantEvent } from '@/lib/events'

export type InschrijvingRij = Inschrijving & { klant: string | null }

const datumTijd = (iso: string) => new Date(iso).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

const MAIL_LABEL: Record<string, { t: string; c: string }> = {
  nog_niet: { t: 'wacht', c: 'text-gray-500' }, bezig: { t: 'bezig', c: 'text-gray-500' }, verzonden: { t: 'verstuurd', c: 'text-green-700' },
  mislukt: { t: 'mislukt', c: 'text-red-600' }, overgeslagen: { t: 'niet nodig', c: 'text-gray-400' }, gepland: { t: 'gepland', c: 'text-gray-500' },
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Mislukt')
  return j as T
}

export function EventInschrijvingen({ event, rijen, magAanpassen, onWijziging }: {
  event: KlantEvent; rijen: InschrijvingRij[]; magAanpassen: boolean; onWijziging: () => void
}) {
  const [bezig, setBezig] = useState<string | null>(null)
  const [uit, setUit] = useState<InschrijvingRij | null>(null)
  const [toonWeg, setToonWeg] = useState(false)
  const actief = rijen.filter((r) => r.status === 'ingeschreven')
  const weg = rijen.filter((r) => r.status !== 'ingeschreven')
  const teFact = actief.filter((r) => r.factuur_status === 'te_factureren')
  const gefact = rijen.filter((r) => r.factuur_status === 'gefactureerd')
  const gastenAchter = event.status === 'gepubliceerd' && event.google_status === 'ok' && event.inschrijving_versie > event.google_sync_versie

  const doe = async (sleutel: string, body: Record<string, unknown>, ok?: string) => {
    setBezig(sleutel)
    try { await api(`/api/admin/events/${event.id}/inschrijvingen`, { method: 'PATCH', body: JSON.stringify(body) }); if (ok) toast.success(ok); onWijziging() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
    finally { setBezig(null) }
  }
  const syncGasten = async () => {
    setBezig('gasten')
    try { const j = await api<{ aantal: number | null }>(`/api/admin/events/${event.id}`, { method: 'PATCH', body: JSON.stringify({ actie: 'gasten' }) }); toast.success(`Gastenlijst in Google bijgewerkt${j.aantal != null ? ` (${j.aantal})` : ''}.`); onWijziging() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
    finally { setBezig(null) }
  }
  const kopieer = async () => {
    try { await navigator.clipboard.writeText(actief.map((r) => r.email).join(', ')); toast.success(`${actief.length} e-mailadressen gekopieerd.`) }
    catch { toast.error('Kopiëren lukte niet.') }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Telling label="Ingeschreven" waarde={`${actief.length}${event.capaciteit ? ` / ${event.capaciteit}` : ''}`} />
        <Telling label="Te factureren" waarde={teFact.length ? `${teFact.length} · ${euro(teFact.reduce((s, r) => s + r.prijs_cents, 0))}` : '0'} />
        <Telling label="Gefactureerd" waarde={String(gefact.length)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={kopieer} disabled={!actief.length} className="btn-secondary text-xs"><Copy className="h-3.5 w-3.5" />E-mails kopiëren</button>
        {magAanpassen && event.status === 'gepubliceerd' && event.google_status === 'ok' && (
          <button type="button" onClick={syncGasten} disabled={bezig === 'gasten'} className="btn-secondary text-xs">
            {bezig === 'gasten' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Gastenlijst Google bijwerken
          </button>
        )}
      </div>
      {gastenAchter && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">De gastenlijst in Google loopt achter. De app werkt ze binnen vijf minuten bij, of klik op “Gastenlijst Google bijwerken”.</p>}

      {actief.length === 0 ? <p className="text-sm text-gray-500">Nog niemand ingeschreven.</p> : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
          {actief.map((r) => (
            <li key={r.id} className="p-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.naam}</div>
                  <div className="text-xs text-gray-500 truncate">{r.email}{r.klant ? ` · ${r.klant}` : ''}</div>
                </div>
                {magAanpassen && (
                  <button type="button" onClick={() => setUit(r)} className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600" title="Uitschrijven" aria-label={`${r.naam} uitschrijven`}><UserMinus className="h-4 w-4" /></button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
                <span>{datumTijd(r.created_at)}{r.ingeschreven_door_naam && r.ingeschreven_door_naam !== r.naam ? ` · door ${r.ingeschreven_door_naam}` : ''}</span>
                <span>Bevestiging: <b className={`font-medium ${MAIL_LABEL[r.bevestiging_status]?.c}`}>{MAIL_LABEL[r.bevestiging_status]?.t}</b></span>
                <span>Herinnering: <b className={`font-medium ${MAIL_LABEL[r.herinnering_status]?.c}`}>{MAIL_LABEL[r.herinnering_status]?.t}</b></span>
                {r.bevestiging_status === 'mislukt' && magAanpassen && (
                  <button type="button" onClick={() => doe(`b${r.id}`, { inschrijving: r.id, actie: 'bevestiging_opnieuw' }, 'Bevestiging verstuurd.')} disabled={bezig === `b${r.id}`} className="inline-flex items-center gap-1 text-gray-700 underline">
                    {bezig === `b${r.id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}Opnieuw sturen
                  </button>
                )}
              </div>
              {(r.bevestiging_fout && r.bevestiging_status === 'mislukt') && <p className="text-[11px] text-red-600">{r.bevestiging_fout}</p>}
              {r.prijs_cents > 0 && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500">{euro(r.prijs_cents)} excl. btw</span>
                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden" role="group" aria-label="Facturatie">
                    {(['te_factureren', 'gefactureerd'] as const).map((s) => (
                      <button key={s} type="button" disabled={!magAanpassen || bezig === `f${r.id}`} aria-pressed={r.factuur_status === s}
                        onClick={() => r.factuur_status !== s && doe(`f${r.id}`, { inschrijving: r.id, actie: 'factuur', factuur_status: s })}
                        className={`px-2 py-1 border-l first:border-l-0 border-gray-200 inline-flex items-center gap-1 ${r.factuur_status === s ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                        {r.factuur_status === s && s === 'gefactureerd' && <Check className="h-3 w-3" />}{s === 'te_factureren' ? 'Te factureren' : 'Gefactureerd'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {weg.length > 0 && (
        <div>
          <button type="button" onClick={() => setToonWeg((v) => !v)} className="text-xs text-gray-500 underline">{toonWeg ? 'Verberg' : 'Toon'} uitgeschreven ({weg.length})</button>
          {toonWeg && (
            <ul className="mt-2 space-y-1">
              {weg.map((r) => <li key={r.id} className="text-xs text-gray-500">{r.naam} · {r.email}{r.geannuleerd_op ? ` · uitgeschreven ${datumTijd(r.geannuleerd_op)}${r.geannuleerd_door ? ` door ${r.geannuleerd_door}` : ''}` : ''}</li>)}
            </ul>
          )}
        </div>
      )}

      {uit && (
        <Bevestig titel="Uitschrijven" gevaarlijk bevestigLabel="Uitschrijven" bezig={bezig === `u${uit.id}`}
          tekst={<>{uit.naam} gaat van de lijst en van de gastenlijst in Google. Er vertrekt geen mail; laat het de persoon zelf weten.{uit.factuur_status === 'te_factureren' ? ' De inschrijving valt ook weg uit "te factureren".' : ''}</>}
          onAnnuleer={() => setUit(null)}
          onBevestig={async () => { await doe(`u${uit.id}`, { inschrijving: uit.id, actie: 'uitschrijven' }, `${uit.naam} is uitgeschreven.`); setUit(null) }} />
      )}
    </div>
  )
}

function Telling({ label, waarde }: { label: string; waarde: string }) {
  return (
    <div className="rounded-xl border border-gray-200 px-3 py-2 min-w-0">
      <div className="text-[10px] font-semibold text-gray-400 truncate">{label}</div>
      <div className="text-sm font-bold tabular-nums truncate">{waarde}</div>
    </div>
  )
}
