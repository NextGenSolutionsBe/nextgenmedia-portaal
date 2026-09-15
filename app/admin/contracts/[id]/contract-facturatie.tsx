'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, RefreshCw, Receipt, ExternalLink, CheckCircle2, AlertTriangle, Ban, Undo2, ListChecks } from 'lucide-react'
import { formatEuro, formatDate } from '@/lib/utils'
import { DEFAULT_VAT } from '@/lib/invoices'

/**
 * Facturatieopdrachten van een ondertekend contract, met de ClickUp-status.
 *
 * Eén kaart in de zijkolom van het contract, in de stijl van "Facturen
 * gekoppeld aan dit contract". Elke opdracht = één facturatiemoment. De
 * factuur zelf maak je met één klik in de bestaande Facturen-module; de
 * ClickUp-taak van de opdracht wordt dan overgenomen (geen tweede taak).
 */

type Opdracht = {
  id: string; volgnr: number; aantal: number; type: string; factuurdatum: string; periode: string | null
  bedrag_excl: number | string | null; btw_pct: number | string; bedrag_incl: number | string | null; omschrijving: string | null
  status: 'open' | 'controle_vereist' | 'afgehandeld' | 'geannuleerd'; ontbrekend: string[]; aandachtspunten: string[]
  sync_status: 'in_afwachting' | 'gesynchroniseerd' | 'mislukt' | 'controle_vereist'
  clickup_task_id: string | null; clickup_url: string | null; sync_fout: string | null; sync_pogingen: number; laatste_sync_op: string | null
  invoice_id: string | null
}
type Lijst = { ok: true; pad: string; url: string } | { ok: false; ingesteld: boolean; reden: string; verwacht: string }
type Antwoord = { opdrachten: Opdracht[]; lijst: Lijst; log: { id: number; gebeurtenis: string; fout: string | null; created_at: string }[] }

const TYPE: Record<string, string> = { voorschot: 'Voorschot', saldo: 'Saldo', periodiek: 'Periodiek', volledig: 'Volledig bedrag' }
const SYNC: Record<Opdracht['sync_status'], { label: string; cls: string }> = {
  in_afwachting: { label: 'In afwachting', cls: 'bg-gray-100 text-gray-700' },
  gesynchroniseerd: { label: 'Gesynchroniseerd', cls: 'bg-green-100 text-green-800' },
  mislukt: { label: 'Mislukt', cls: 'bg-red-100 text-red-700' },
  controle_vereist: { label: 'Controle vereist', cls: 'bg-amber-100 text-amber-800' },
}
const STATUS: Record<Opdracht['status'], { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-blue-100 text-blue-800' },
  controle_vereist: { label: 'Controle vereist', cls: 'bg-amber-100 text-amber-800' },
  afgehandeld: { label: 'Afgehandeld', cls: 'bg-green-100 text-green-800' },
  geannuleerd: { label: 'Geannuleerd', cls: 'bg-gray-100 text-gray-500' },
}
const n = (v: number | string | null) => (v === null ? null : Number(v))

export function ContractFacturatie({ contractId, clientId, serviceSlug }: { contractId: string; clientId: string | null; serviceSlug: string | null }) {
  const router = useRouter()
  const [data, setData] = useState<Antwoord | null>(null)
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setData(j)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [contractId])
  useEffect(() => { laad() }, [laad])

  const actie = async (body: Record<string, unknown>, sleutel: string, melding: string) => {
    setBezig(sleutel)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(melding)
      await laad(); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  /** Factuur in de bestaande Facturen-module, met overname van de ClickUp-taak. */
  const maakFactuur = async (o: Opdracht) => {
    const excl = n(o.bedrag_excl)
    if (excl === null || excl <= 0) { toast.error('Vul eerst het bedrag in (facturatieafspraken op het contract) en maak de opdrachten opnieuw aan.'); return }
    if (!clientId) { toast.error('Koppel eerst een klant aan het contract.'); return }
    if (!confirm(`Factuur aanmaken in Facturen voor ${formatEuro(excl)} excl. btw (${o.periode ?? o.factuurdatum})?`)) return
    setBezig(o.id)
    try {
      const r = await fetch('/api/admin/invoices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'one_time', client_id: clientId, service_slug: serviceSlug, contract_id: contractId,
          invoice_month: (o.periode ?? o.factuurdatum).slice(0, 7), invoice_date: o.factuurdatum,
          amount_excl: excl, vat_pct: n(o.btw_pct) ?? DEFAULT_VAT, description: o.omschrijving, clickup_task_id: o.clickup_task_id,
        }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      const k = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'gekoppeld', opdracht_id: o.id, invoice_id: j.id }) })
      const kj = await k.json(); if (!k.ok) throw new Error(kj.error)
      toast.success('Factuur aangemaakt in Facturen; de opdracht is afgehandeld.')
      await laad(); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Factuur aanmaken mislukt') } finally { setBezig(null) }
  }

  const opdrachten = data?.opdrachten ?? []
  const openstaand = opdrachten.filter((o) => o.status === 'open' || o.status === 'controle_vereist')
  const mislukt = openstaand.filter((o) => o.sync_status === 'mislukt' || o.sync_status === 'in_afwachting')
  const knop = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50'

  return (
    <div id="facturatie" className="card-base space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5"><ListChecks className="h-4 w-4 text-gray-400" />Facturatieopdrachten</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">Automatisch aangemaakt bij ondertekening; elke opdracht is één factuur die het team moet opstellen en versturen.</p>
        </div>
        {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {/* ClickUp-doel: subtiel, en enkel luid als het niet klopt. */}
      {data && (data.lijst.ok ? (
        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-green-500" />ClickUp: <a href={data.lijst.url} target="_blank" rel="noreferrer" className="hover:underline">{data.lijst.pad}</a>
        </p>
      ) : (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900 flex gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <div>
            <b>ClickUp-synchronisatie staat uit:</b> {data.lijst.reden}
            <div className="text-amber-800/80 mt-0.5">Verwachte lijst: {data.lijst.verwacht}. Zet het lijst-id in de omgevingsvariabele; de opdrachten hier blijven bewaard en worden daarna alsnog gesynchroniseerd.</div>
          </div>
        </div>
      ))}

      {!laden && opdrachten.length === 0 && (
        <div className="text-sm text-gray-500 space-y-2">
          <p>Nog geen facturatieopdrachten voor dit contract (ondertekend vóór deze automatisering, of nog niet verwerkt).</p>
          <button disabled={bezig === 'genereer'} onClick={() => actie({ action: 'genereer' }, 'genereer', 'Facturatieopdrachten aangemaakt.')} className="btn-secondary text-xs">
            {bezig === 'genereer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}Opdrachten aanmaken uit de facturatieafspraken
          </button>
        </div>
      )}

      {opdrachten.length > 0 && (
        <ul className="divide-y divide-gray-100 -mx-1">
          {opdrachten.map((o) => {
            const b = bezig === o.id
            const s = SYNC[o.sync_status]
            const st = STATUS[o.status]
            const isOpen = open === o.id
            return (
              <li key={o.id} className={`px-1 py-2 text-sm ${o.status === 'geannuleerd' ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <button type="button" onClick={() => setOpen(isOpen ? null : o.id)} className="text-left min-w-0">
                    <div className="font-medium truncate">{TYPE[o.type] ?? o.type}{o.aantal > 1 ? ` · termijn ${o.volgnr}/${o.aantal}` : ''}{o.periode && o.aantal > 1 ? ` (${o.periode})` : ''}</div>
                    <div className="text-xs text-gray-500">{formatDate(o.factuurdatum)} · {n(o.bedrag_excl) === null ? <span className="text-red-600">bedrag ontbreekt</span> : <>{formatEuro(n(o.bedrag_excl))} excl · {formatEuro(n(o.bedrag_incl))} incl</>}</div>
                  </button>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className={`status-badge text-[10px] ${st.cls}`}>{st.label}</span>
                    <span className={`status-badge text-[10px] ${o.status === 'afgehandeld' || o.status === 'geannuleerd' ? 'bg-gray-100 text-gray-500' : s.cls}`} title={o.sync_fout ?? undefined}>ClickUp: {s.label}</span>
                  </div>
                </div>

                {(isOpen || o.sync_status === 'mislukt' || o.status === 'controle_vereist') && (
                  <div className="mt-2 space-y-1.5 text-xs">
                    {o.sync_status === 'mislukt' && o.sync_fout && <div className="rounded-lg bg-red-50 border border-red-100 p-2 text-red-700">ClickUp: {o.sync_fout}{o.sync_pogingen > 1 ? ` (poging ${o.sync_pogingen})` : ''}</div>}
                    {o.ontbrekend.length > 0 && (
                      <div className="rounded-lg bg-amber-50 border border-amber-100 p-2 text-amber-900">
                        <b>Ontbreekt:</b>
                        <ul className="list-disc pl-4">{o.ontbrekend.map((x) => <li key={x}>{x}</li>)}</ul>
                      </div>
                    )}
                    {isOpen && o.aandachtspunten.length > 0 && (
                      <div className="text-gray-500"><b>Aandachtspunten:</b> {o.aandachtspunten.join(' · ')}</div>
                    )}
                    <div className="flex flex-wrap gap-1 pt-1">
                      {b && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
                      {o.clickup_url && <a href={o.clickup_url} target="_blank" rel="noreferrer" className={`${knop} bg-white border-gray-200 text-gray-600 hover:border-gray-400`}>ClickUp<ExternalLink className="h-3 w-3" /></a>}
                      {(o.status === 'open' || o.status === 'controle_vereist') && (
                        <>
                          {(o.sync_status === 'mislukt' || o.sync_status === 'in_afwachting') && (
                            <button disabled={b} onClick={() => actie({ action: 'sync', opdracht_id: o.id }, o.id, 'Gesynchroniseerd met ClickUp.')} className={`${knop} bg-black text-white border-black hover:bg-gray-800`}><RefreshCw className="h-3 w-3" />Opnieuw synchroniseren</button>
                          )}
                          {o.sync_status === 'gesynchroniseerd' && (
                            <button disabled={b} onClick={() => actie({ action: 'sync', opdracht_id: o.id }, o.id, 'ClickUp-taak bijgewerkt.')} className={`${knop} bg-white border-gray-200 text-gray-600 hover:border-gray-400`} title="Taak bijwerken met de huidige gegevens (maakt geen nieuwe taak)"><RefreshCw className="h-3 w-3" />Bijwerken</button>
                          )}
                          {!o.invoice_id && <button disabled={b} onClick={() => maakFactuur(o)} className={`${knop} bg-[#fff848] border-yellow-300 text-black hover:bg-[#f5ee30]`}><Receipt className="h-3 w-3" />Factuur aanmaken</button>}
                          {o.status === 'controle_vereist' && <button disabled={b} onClick={() => actie({ action: 'status', opdracht_id: o.id, status: 'open' }, o.id, 'Gecontroleerd; opdracht staat open.')} className={`${knop} bg-white border-gray-200 text-gray-600 hover:border-green-500`}><CheckCircle2 className="h-3 w-3" />Gecontroleerd</button>}
                          <button disabled={b} onClick={() => actie({ action: 'status', opdracht_id: o.id, status: 'afgehandeld' }, o.id, 'Opdracht afgehandeld.')} className={`${knop} bg-white border-gray-200 text-gray-600 hover:border-green-500`}><CheckCircle2 className="h-3 w-3" />Afgehandeld</button>
                          <button disabled={b} onClick={() => { if (confirm('Opdracht annuleren? De ClickUp-taak blijft staan; sluit ze daar zelf af.')) actie({ action: 'status', opdracht_id: o.id, status: 'geannuleerd' }, o.id, 'Opdracht geannuleerd.') }} className={`${knop} bg-white border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-300`}><Ban className="h-3 w-3" />Annuleer</button>
                        </>
                      )}
                      {(o.status === 'afgehandeld' || o.status === 'geannuleerd') && (
                        <button disabled={b} onClick={() => actie({ action: 'status', opdracht_id: o.id, status: 'open' }, o.id, 'Opdracht heropend.')} className={`${knop} bg-white border-gray-200 text-gray-500 hover:border-gray-400`}><Undo2 className="h-3 w-3" />Heropen</button>
                      )}
                      {o.invoice_id && <a href={`/admin/invoices?maand=${(o.periode ?? o.factuurdatum).slice(0, 7)}`} className={`${knop} bg-white border-gray-200 text-blue-700 hover:border-blue-300`}><Receipt className="h-3 w-3" />Factuur in Facturen</a>}
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {mislukt.length > 1 && (
        <button disabled={bezig === 'alle'} onClick={() => actie({ action: 'sync_alle' }, 'alle', 'Synchronisatie uitgevoerd.')} className="btn-secondary text-xs w-full justify-center">
          {bezig === 'alle' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Alles opnieuw synchroniseren ({mislukt.length})
        </button>
      )}
    </div>
  )
}
