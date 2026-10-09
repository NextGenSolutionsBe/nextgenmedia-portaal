'use client'

import { KaartTabel } from '@/components/ui/kaart-tabel'

import { leesGetal } from '@/lib/getal'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Receipt, Plus, CalendarRange, Link2, Unlink, Pencil, Repeat, Info, AlertTriangle, ChevronDown, Sparkles, ExternalLink } from 'lucide-react'
import { formatEuro } from '@/lib/utils'
import { DEFAULT_VAT } from '@/lib/invoices'
import { maakReeks, valideerReeks, isDoorlopend, reeksTotaal, type ReeksInvoer } from '@/lib/facturatie/reeks'
import { AFL_STATUS_LABEL, euro, isActiefItem, type AflItem, type Aflettering } from '@/lib/contracten/aflettering'
import { AflBadgeChip } from '@/components/contracten/afl-badge'
import { FactuurEditor, StatusChip } from '@/app/admin/invoices/factuur-editor'
import { INP } from '@/app/admin/instellingen/ui'
import { FactuurVoorstellen } from './factuur-voorstellen'

/**
 * Facturatie & aflettering van één contract.
 *  · Bovenaan: contractwaarde (excl. btw) en vier bedragen — ingepland, al
 *    gefactureerd, nog te factureren — plus wat nog in te plannen is.
 *  · Per gekoppelde factuur: het deel binnen de contractwaarde en de extra
 *    kosten (kilometers, meerwerk) apart, zodat extra's geen valse afwijking geven.
 *  · Facturen zelf toevoegen, bestaande koppelen (of verdelen over contracten),
 *    of factuurvoorstellen laten voorbereiden die je eerst controleert.
 * Eén bron: dezelfde facturen als in Facturen en de planner. De betaalstatus
 * staat los van de aflettering: verstuurd = gefactureerd.
 */

type ContractAfl = { waarde: number | null; waarde_gewijzigd_op: string | null; waarde_gewijzigd_door: string | null; items: AflItem[]; doorlopend: boolean; aflettering: Aflettering }
type Regel = { id: string; invoice_id: string; artikel: string | null; omschrijving: string | null; bedrag_excl: number; is_extra: boolean; contract_id: string | null }
type Kandidaat = { id: string; invoice_date: string | null; description: string | null; amount_excl: number; status: string }
type Data = {
  contract: { id: string; title: string | null; client_id: string | null; status: string | null; klant_naam: string | null }
  kandidaten: Kandidaat[]
  gekoppeldElders: (Kandidaat & { contract_id: string; contract_titel: string | null })[]
  andereContracten: { id: string; title: string | null }[]
  afl: ContractAfl | null
  regels: Regel[]
}

const d = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—')
const eur = (c: number | null | undefined) => (c === null || c === undefined ? '—' : formatEuro(euro(c)))
const STATUS_CLS: Record<string, string> = {
  te_factureren: 'bg-gray-100 text-gray-700 border-gray-200', verstuurd: 'bg-green-100 text-green-800 border-green-200', betaald: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  geannuleerd: 'bg-red-50 text-red-700 border-red-200', gecrediteerd: 'bg-red-50 text-red-700 border-red-200',
}


function Bedrag({ titel, uitleg, waarde, sub, toon }: { titel: string; uitleg: string; waarde: string; sub?: React.ReactNode; toon?: 'rood' | 'groen' | 'grijs' }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 min-w-0">
      <div className="text-[11px] font-medium text-gray-500 flex items-center gap-1">{titel}<span title={uitleg} aria-label={uitleg} className="text-gray-400 cursor-help"><Info className="h-3 w-3" /></span></div>
      <div className={`text-lg font-semibold tabular-nums mt-0.5 ${toon === 'rood' ? 'text-red-700' : toon === 'groen' ? 'text-[#166534]' : toon === 'grijs' ? 'text-gray-400' : 'text-gray-900'}`}>{waarde}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

export function ContractFacturatie({ contractId, clientId, contractTitle, isSigned, expectedCount, expectedAmountExcl }: {
  contractId: string; clientId: string | null; serviceSlug?: string | null; contractTitle: string; isSigned: boolean
  expectedCount?: number | null; invoiceFrequency?: string | null; expectedAmountExcl?: number | null
}) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState<string | null>(null)
  const [factuurId, setFactuurId] = useState<string | null>(null)
  const [nieuweFactuur, setNieuweFactuur] = useState(false)
  const [plannen, setPlannen] = useState(false)
  const [koppelen, setKoppelen] = useState(false)
  const [voorstellen, setVoorstellen] = useState(false)
  const [toonAfgesloten, setToonAfgesloten] = useState(false)
  const [waardeBewerken, setWaardeBewerken] = useState(false)
  const [waardeInvoer, setWaardeInvoer] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [verdelen, setVerdelen] = useState<{ id: string; titel: string } | null>(null)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setData(j)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [contractId])
  useEffect(() => { laad() }, [laad])

  const actie = async (body: Record<string, unknown>, sleutel: string, melding?: string): Promise<{ ok: boolean; j?: Record<string, unknown>; status?: number }> => {
    setBezig(sleutel)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) { if (j.code) return { ok: false, j, status: r.status }; throw new Error(j.error) }
      if (melding) toast.success(melding)
      if (j.afl !== undefined) setData(j)
      router.refresh()
      return { ok: true, j }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); return { ok: false } } finally { setBezig(null) }
  }

  const afl = data?.afl ?? null
  const a = afl?.aflettering ?? null
  const items = useMemo(() => (afl?.items ?? []).filter((i) => toonAfgesloten || isActiefItem(i.status)), [afl, toonAfgesloten])
  const verborgen = (afl?.items.length ?? 0) - (afl?.items.filter((i) => isActiefItem(i.status)).length ?? 0)
  const regelsVan = (invoiceId: string | null) => (data?.regels ?? []).filter((r) => r.invoice_id === invoiceId)
  const suggestie = expectedCount && expectedAmountExcl ? Math.round(expectedCount * expectedAmountExcl * 100) / 100 : null
  const knop = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50'
  const contractNaam = (cid: string | null) => (cid === contractId || cid === null ? 'Dit contract' : data?.andereContracten.find((x) => x.id === cid)?.title ?? 'Ander contract')

  const bewaarWaarde = async (w: string | null) => {
    const r = await actie({ action: 'waarde', waarde: w }, 'waarde', w === null ? 'Contractwaarde leeggemaakt.' : 'Contractwaarde bewaard.')
    if (r.ok) setWaardeBewerken(false)
  }

  return (
    <div id="facturatie" className="card-base space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5"><Receipt className="h-4 w-4 text-gray-400" />Facturatie &amp; aflettering</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">Contractwaarde tegenover de gekoppelde facturen, los van de betaalstatus. Bedragen excl. btw.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          <button type="button" onClick={() => setKoppelen(true)} className="btn-secondary text-xs"><Link2 className="h-3.5 w-3.5" />Bestaande factuur koppelen</button>
          <button type="button" onClick={() => setPlannen(true)} className="btn-secondary text-xs" title="Meerdere facturen of maandelijkse facturatie zelf invullen"><CalendarRange className="h-3.5 w-3.5" />Meerdere facturen plannen</button>
          <button type="button" onClick={() => setVoorstellen(true)} disabled={!clientId} title={clientId ? 'Voorstellen op basis van de contractgegevens, eerst te controleren' : 'Koppel eerst een klant'} className="btn-secondary text-xs"><Sparkles className="h-3.5 w-3.5" />Factuurvoorstellen maken</button>
          <button type="button" onClick={() => setNieuweFactuur(true)} className="btn-primary text-xs"><Plus className="h-3.5 w-3.5" />Factuur toevoegen</button>
        </div>
      </div>

      {/* Contractwaarde */}
      {afl && (afl.waarde === null && !waardeBewerken ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1 min-w-[200px]"><b>Contractwaarde ontbreekt.</b> {isSigned ? 'Het contract is getekend; vul de afgesproken totale waarde excl. btw in om te kunnen afletteren.' : 'Vul de afgesproken totale waarde excl. btw in (ondertekenen kan ook zonder).'}{suggestie !== null && <span className="block text-[11px] mt-0.5">Op basis van de facturatiegegevens van het contract: {expectedCount} × {formatEuro(expectedAmountExcl ?? 0)} = <b>{formatEuro(suggestie)}</b> — enkel overnemen als dat klopt.</span>}</span>
          <button type="button" onClick={() => { setWaardeInvoer(suggestie !== null ? String(suggestie).replace('.', ',') : ''); setWaardeBewerken(true) }} className="btn-primary text-xs">Contractwaarde invullen</button>
        </div>
      ) : waardeBewerken ? (
        <form onSubmit={(e) => { e.preventDefault(); const v = waardeInvoer.trim(); if (v && leesGetal(v) === null) { toast.error('Geef een geldig bedrag, bv. 5874 of 5.874,00.'); return } bewaarWaarde(v ? String(leesGetal(v)) : null) }} className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex items-end gap-2 flex-wrap">
          <div className="min-w-[180px] flex-1 max-w-xs">
            <label className="block text-xs font-medium text-gray-700 mb-1">Totale contractwaarde excl. btw</label>
            <input autoFocus className={INP} inputMode="decimal" value={waardeInvoer} onChange={(e) => setWaardeInvoer(e.target.value)} placeholder="bv. 5874" aria-label="Contractwaarde excl. btw" />
            <p className="text-[11px] text-gray-500 mt-1">Leeg = ontbreekt. € 0 = bewust geen waarde.</p>
          </div>
          <button type="submit" disabled={bezig === 'waarde'} className="btn-primary text-sm">{bezig === 'waarde' && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
          <button type="button" onClick={() => setWaardeBewerken(false)} className="btn-secondary text-sm">Annuleren</button>
        </form>
      ) : null)}

      {/* Financieel overzicht */}
      {afl && a && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Bedrag titel="Contractwaarde" uitleg="Het afgesproken totaal excl. btw, zoals ingevuld bij dit contract." waarde={a.waardeCent === null ? 'Ontbreekt' : eur(a.waardeCent)} toon={a.waardeCent === null ? 'grijs' : undefined}
              sub={a.waardeCent !== null && <button type="button" onClick={() => { setWaardeInvoer(String(afl.waarde ?? '').replace('.', ',')); setWaardeBewerken(true) }} className="underline hover:text-gray-800" title={afl.waarde_gewijzigd_op ? `Laatst gewijzigd ${d(afl.waarde_gewijzigd_op)}${afl.waarde_gewijzigd_door ? ` door ${afl.waarde_gewijzigd_door}` : ''}` : undefined}>aanpassen{afl.waarde_gewijzigd_door ? ` · ${afl.waarde_gewijzigd_door}` : ''}</button>} />
            <Bedrag titel="Facturen ingepland/opgesteld" uitleg="Deel binnen de contractwaarde van alle actieve factuuritems: te factureren, verstuurd en betaald. Geannuleerd, gecrediteerd en niet-bevestigde voorstellen tellen niet." waarde={eur(a.ingeplandCent)}
              sub={a.nogInTePlannenCent ? <span className="text-blue-800">Nog in te plannen: {eur(a.nogInTePlannenCent)}</span> : a.overschotIngeplandCent ? <span className="text-red-700">{eur(a.overschotIngeplandCent)} meer dan de contractwaarde</span> : undefined} />
            <Bedrag titel="Al gefactureerd" uitleg="Deel binnen de contractwaarde van verstuurde en betaalde facturen. Een betaalde factuur telt één keer, niet bovenop verstuurd." waarde={eur(a.gefactureerdCent)} toon="groen" />
            <Bedrag titel="Nog te factureren" uitleg="Contractwaarde min al gefactureerd. Negatief = er is meer gefactureerd dan afgesproken." waarde={a.nogTeFacturerenCent === null ? '—' : eur(a.nogTeFacturerenCent)} toon={a.nogTeFacturerenCent !== null && a.nogTeFacturerenCent < 0 ? 'rood' : undefined}
              sub={a.nogTeFacturerenCent !== null && a.nogTeFacturerenCent < 0 ? 'Overschreden — controleer' : undefined} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-gray-600 border-b border-gray-100 pb-3">
            <span title="Het deel van de gekoppelde facturen dat meetelt voor de contractwaarde.">Telt voor aflettering: <b className="text-gray-900 tabular-nums">{eur(a.ingeplandCent)}</b></span>
            <span title="Kilometers, extra uren, meerwerk en andere bijkomende kosten op de gekoppelde facturen.">Extra kosten / meerwerk: <b className="text-gray-900 tabular-nums">{eur(a.extraCent)}</b></span>
            <span>Totaal gekoppelde facturen: <b className="text-gray-900 tabular-nums">{eur(a.totaalGekoppeldCent)}</b></span>
            {a.gecrediteerdCent !== 0 && <span>Gecrediteerd: <b className="tabular-nums">{eur(a.gecrediteerdCent)}</b></span>}
            <span className="flex items-center gap-1 flex-wrap ml-auto">{a.badges.map((b) => <AflBadgeChip key={b} badge={b} />)}</span>
          </div>
          {a.teControleren > 0 && <p className="text-xs text-red-800 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />{a.teControleren} oude factu{a.teControleren === 1 ? 'ur heeft' : 'ren hebben'} nog geen verdeling tussen contractbedrag en extra kosten. Ze tellen voorlopig volledig binnen de contractwaarde — controleer ze hieronder.</p>}
          {afl.doorlopend && <p className="text-[11px] text-purple-800 flex items-center gap-1.5"><Repeat className="h-3.5 w-3.5" />Maandelijkse facturatie zonder einde: enkel de maanden tot en met deze maand tellen mee.</p>}
        </>
      )}

      {/* Gekoppelde facturen */}
      {!laden && afl && items.length === 0 && (
        <p className="text-sm text-gray-400">{afl.items.length === 0 ? `Nog geen facturen gekoppeld${isSigned ? '' : ' — dat kan ook al vóór ondertekening'}. Voeg er een toe, koppel een bestaande, of laat voorstellen maken.` : 'Alle gekoppelde facturen zijn geannuleerd of gecrediteerd.'}</p>
      )}
      {items.length > 0 && (
        <div className="overflow-x-auto -mx-2">
          <KaartTabel><table className="w-full text-xs min-w-[820px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-500 bg-gray-50">
                <th className="px-2 py-1.5 text-left">Artikel / omschrijving</th><th className="px-2 py-1.5 text-left">Geplande datum</th><th className="px-2 py-1.5 text-left">Factuurnr.</th>
                <th className="px-2 py-1.5 text-right">Binnen contractwaarde</th><th className="px-2 py-1.5 text-right">Extra kosten</th><th className="px-2 py-1.5 text-right">Totaal excl.</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5 text-right">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((i) => {
                const regels = regelsVan(i.invoice_id)
                const isOpen = open === i.sleutel
                return (
                  <Fragment key={i.sleutel}>
                    <tr className={isActiefItem(i.status) ? '' : 'opacity-60'}>
                      <td className="px-2 py-1.5 max-w-[280px]">
                        <div className="truncate" title={i.omschrijving ?? ''}>{i.bron === 'recurring_maand' && <Repeat className="h-3 w-3 inline mr-1 text-purple-600" />}{i.omschrijving ?? '—'}{i.bron === 'recurring_maand' && i.maand && <span className="text-gray-400"> · {i.maand}</span>}</div>
                        <div className="flex gap-1 mt-0.5">
                          {i.verdelingOnbekend && <span className="rounded-full border border-red-300 bg-red-50 text-red-800 px-1.5 text-[10px]">Verdeling controleren</span>}
                          {i.gedeeld && <span className="rounded-full border border-gray-300 bg-gray-50 text-gray-700 px-1.5 text-[10px]">Verdeeld over contracten</span>}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 whitespace-nowrap">{d(i.datum)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap text-gray-600">{i.referentie ?? '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium">{eur(i.contractCent)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">{i.extraCent ? eur(i.extraCent) : '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{eur(i.contractCent + i.extraCent)}</td>
                      <td className="px-2 py-1.5"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_CLS[i.status]}`}>{AFL_STATUS_LABEL[i.status]}</span></td>
                      <td className="px-2 py-1.5 text-right whitespace-nowrap">
                        {i.invoice_id ? (
                          <>
                            <button type="button" className={`${knop} bg-white border-gray-200`} onClick={() => setFactuurId(i.invoice_id)}><Pencil className="h-3 w-3" />Bekijken</button>
                            <button type="button" className={`${knop} bg-white border-gray-200 ml-1`} aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : i.sleutel)} title="Verdeling binnen contractwaarde / extra kosten"><ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? '' : '-rotate-90'}`} />Verdeling</button>
                            <button type="button" disabled={!!bezig} className={`${knop} bg-white border-gray-200 text-gray-500 ml-1`} title="Losmaken van dit contract (de factuur blijft bestaan)" aria-label="Losmaken van dit contract" onClick={() => { if (confirm('Deze factuur losmaken van het contract? De factuur blijft bestaan als losse factuur.')) actie({ action: 'ontkoppel', invoice_id: i.invoice_id }, i.sleutel, 'Factuur losgemaakt.') }}><Unlink className="h-3 w-3" /></button>
                          </>
                        ) : <a href={`/admin/invoices${i.maand ? `?maand=${i.maand}` : ''}`} className={`${knop} bg-white border-gray-200`}><ExternalLink className="h-3 w-3" />Bekijken</a>}
                      </td>
                    </tr>
                    {isOpen && i.invoice_id && (
                      <tr className="bg-gray-50/70">
                        <td colSpan={8} className="px-3 py-2.5" data-label="">
                          {regels.length === 0 ? (
                            <VerdelingZonderRegels item={i} bezig={bezig === i.sleutel} onBewaar={(bedrag) => actie({ action: 'verdeling', invoice_id: i.invoice_id, contract_bedrag_excl: bedrag }, i.sleutel, 'Verdeling bewaard.')} />
                          ) : (
                            <div className="space-y-1.5">
                              <p className="text-[11px] text-gray-500">Duid per regel aan of ze binnen de contractwaarde valt of een extra kost / meerwerk is{(data?.andereContracten.length ?? 0) > 0 ? ', en bij welk contract ze hoort' : ''}.</p>
                              {regels.map((r) => (
                                <div key={r.id} className="flex items-center gap-2 flex-wrap text-xs">
                                  <span className="flex-1 min-w-[160px] truncate">{r.artikel || r.omschrijving || 'Regel'}</span>
                                  <span className="tabular-nums w-24 text-right">{formatEuro(r.bedrag_excl)}</span>
                                  <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden" role="group" aria-label={`Soort van ${r.artikel ?? 'regel'}`}>
                                    {[false, true].map((x) => (
                                      <button key={String(x)} type="button" disabled={!!bezig} aria-pressed={r.is_extra === x} onClick={() => r.is_extra !== x && actie({ action: 'regel', line_id: r.id, is_extra: x }, i.sleutel, x ? 'Gemarkeerd als extra kost.' : 'Gemarkeerd als binnen contractwaarde.')}
                                        className={`px-2 py-1 text-[11px] font-medium border-l first:border-l-0 border-gray-200 ${r.is_extra === x ? 'bg-black text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>{x ? 'Extra kosten / meerwerk' : 'Binnen contractwaarde'}</button>
                                    ))}
                                  </div>
                                  {(data?.andereContracten.length ?? 0) > 0 && (
                                    <select className={`${INP} w-auto py-1 text-xs`} value={r.contract_id ?? contractId} disabled={!!bezig} aria-label="Contract van deze regel"
                                      onChange={(e) => actie({ action: 'regel', line_id: r.id, contract_id: e.target.value === contractId ? contractId : e.target.value }, i.sleutel, 'Regel toegewezen.')}>
                                      <option value={contractId}>Dit contract</option>
                                      {data!.andereContracten.map((c) => <option key={c.id} value={c.id}>{c.title ?? 'Contract'}</option>)}
                                    </select>
                                  )}
                                  {r.contract_id && r.contract_id !== contractId && <span className="text-[10px] text-gray-500">telt bij {contractNaam(r.contract_id)}</span>}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table></KaartTabel>
        </div>
      )}
      {verborgen > 0 && <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-500"><input type="checkbox" checked={toonAfgesloten} onChange={(e) => setToonAfgesloten(e.target.checked)} />Toon geannuleerd en gecrediteerd ({verborgen})</label>}

      {factuurId && <FactuurEditor invoiceId={factuurId} onClose={() => setFactuurId(null)} onSaved={() => { laad(); router.refresh() }} />}
      {nieuweFactuur && <FactuurEditor standaard={{ client_id: clientId, contract_id: contractId, description: contractTitle }} onClose={() => setNieuweFactuur(false)} onSaved={() => { laad(); router.refresh() }} />}
      {voorstellen && <FactuurVoorstellen contractId={contractId} waarde={afl?.waarde ?? null} onSluit={() => setVoorstellen(false)} onBevestigd={() => { laad(); router.refresh() }} />}
      {plannen && <ReeksDialoog contractTitle={contractTitle} bezig={bezig === 'reeks'} onSluit={() => setPlannen(false)} onBevestig={async (inv, extra) => { const r = await actie({ action: 'reeks', ...inv, ...extra }, 'reeks'); if (r.ok) { setPlannen(false); const n = Number(r.j?.aangemaakt ?? 0); toast.success(r.j?.recurring_id ? 'Maandelijkse facturatie ingesteld.' : `${n} factu${n === 1 ? 'ur' : 'ren'} toegevoegd${r.j?.overgeslagen ? ` (${r.j.overgeslagen} bestond al)` : ''}.`) } }} />}
      {koppelen && data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100"><h3 className="font-semibold">Bestaande factuur koppelen</h3><p className="text-xs text-gray-500 mt-0.5">Facturen van {data.contract.klant_naam ?? 'deze klant'}. Een factuur telt nooit volledig bij twee contracten.</p></div>
            <div className="flex-1 overflow-y-auto text-sm">
              <div className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Losse facturen</div>
              <ul className="divide-y divide-gray-100">
                {data.kandidaten.map((k) => (
                  <li key={k.id} className="px-5 py-2 flex items-center gap-3">
                    <div className="flex-1 min-w-0"><div className="truncate">{k.description ?? 'Factuur'}</div><div className="text-[11px] text-gray-500">{d(k.invoice_date)} · {formatEuro(k.amount_excl)} excl.</div></div>
                    <StatusChip status={k.status} klein />
                    <button type="button" disabled={!!bezig} onClick={() => actie({ action: 'koppel', invoice_id: k.id }, k.id, 'Factuur gekoppeld.')} className="btn-primary text-xs"><Link2 className="h-3.5 w-3.5" />Koppelen</button>
                  </li>
                ))}
                {data.kandidaten.length === 0 && <li className="px-5 py-3 text-gray-400 text-xs">Geen losse facturen.</li>}
              </ul>
              {data.gekoppeldElders.length > 0 && (
                <>
                  <div className="px-5 pt-3 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Al aan een ander contract</div>
                  <ul className="divide-y divide-gray-100">
                    {data.gekoppeldElders.map((k) => (
                      <li key={k.id} className="px-5 py-2 flex items-center gap-2 flex-wrap">
                        <div className="flex-1 min-w-[160px]"><div className="truncate">{k.description ?? 'Factuur'}</div><div className="text-[11px] text-gray-500">{d(k.invoice_date)} · {formatEuro(k.amount_excl)} · nu bij “{k.contract_titel ?? 'ander contract'}”</div></div>
                        <button type="button" disabled={!!bezig} onClick={() => setVerdelen({ id: k.id, titel: k.description ?? 'Factuur' })} className="btn-secondary text-xs">Regels verdelen</button>
                        <button type="button" disabled={!!bezig} onClick={() => { if (confirm(`De volledige factuur verhangen van “${k.contract_titel ?? 'ander contract'}” naar dit contract?`)) actie({ action: 'koppel', invoice_id: k.id, verhangen: true }, k.id, 'Factuur verhangen naar dit contract.') }} className="btn-secondary text-xs">Volledig verhangen</button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end"><button type="button" onClick={() => setKoppelen(false)} className="btn-secondary text-sm">Sluiten</button></div>
          </div>
        </div>
      )}
      {verdelen && <RegelsVerdelen contractId={contractId} factuur={verdelen} andere={data?.andereContracten ?? []} onSluit={() => { setVerdelen(null); laad(); router.refresh() }} />}
    </div>
  )
}

/** Oude factuur zonder regels: expliciet vastleggen welk deel binnen de contractwaarde valt. */
function VerdelingZonderRegels({ item, bezig, onBewaar }: { item: AflItem; bezig: boolean; onBewaar: (bedrag: number) => void }) {
  const totaal = euro(item.contractCent + item.extraCent)
  const [binnen, setBinnen] = useState(String(euro(item.contractCent)).replace('.', ','))
  const n = leesGetal(binnen)
  return (
    <div className="flex items-end gap-2 flex-wrap text-xs">
      <div className="text-gray-600 basis-full">Deze factuur heeft geen regels. Hoeveel van de {formatEuro(totaal)} valt binnen de contractwaarde? De rest telt als extra kosten / meerwerk.</div>
      <div><label className="block text-[11px] text-gray-600 mb-0.5">Binnen contractwaarde (excl.)</label><input className={`${INP} w-36 py-1`} inputMode="decimal" value={binnen} onChange={(e) => setBinnen(e.target.value)} /></div>
      <span className="pb-1.5 text-gray-600">Extra: {n === null ? '—' : formatEuro(Math.max(0, Math.round((totaal - n) * 100) / 100))}</span>
      <button type="button" disabled={bezig || n === null || n < 0 || n > totaal + 0.001} onClick={() => onBewaar(n!)} className="btn-primary text-xs">{bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Verdeling bevestigen</button>
      <button type="button" disabled={bezig} onClick={() => onBewaar(totaal)} className="btn-secondary text-xs">Alles binnen contractwaarde</button>
    </div>
  )
}

/** Een factuur die al aan een ander contract hangt per regel verdelen. */
function RegelsVerdelen({ contractId, factuur, andere, onSluit }: { contractId: string; factuur: { id: string; titel: string }; andere: { id: string; title: string | null }[]; onSluit: () => void }) {
  const [regels, setRegels] = useState<(Omit<Regel, 'invoice_id'>)[] | null>(null)
  const [factuurContract, setFactuurContract] = useState<string | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const post = async (body: Record<string, unknown>) => {
    const r = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json(); if (!r.ok) throw new Error(j.error); return j
  }
  const laad = useCallback(async () => {
    try { const j = await post({ action: 'regels_van', invoice_id: factuur.id }); setRegels(j.regels); setFactuurContract(j.factuur_contract_id) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [factuur.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { laad() }, [laad])
  const opties = [{ id: contractId, title: 'Dit contract' }, ...andere]
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/40" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="font-semibold">Regels verdelen · {factuur.titel}</h3><p className="text-xs text-gray-500 mt-0.5">Kies per regel bij welk contract ze hoort. Elk bedrag telt bij precies één contract.</p></div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2 text-sm">
          {!regels && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {regels?.length === 0 && <p className="text-xs text-gray-600">Deze factuur heeft nog geen regels. Open ze in Facturen en splits het bedrag in regels; daarna kun je ze hier verdelen.</p>}
          {regels?.map((r) => (
            <div key={r.id} className="flex items-center gap-2 flex-wrap">
              <span className="flex-1 min-w-[140px] truncate">{r.artikel || r.omschrijving || 'Regel'}</span>
              <span className="tabular-nums text-xs">{formatEuro(r.bedrag_excl)}</span>
              <select className={`${INP} w-auto py-1 text-xs`} disabled={bezig === r.id} value={r.contract_id ?? factuurContract ?? ''} aria-label="Contract van deze regel"
                onChange={async (e) => { setBezig(r.id); try { await post({ action: 'regel', line_id: r.id, contract_id: e.target.value }); await laad(); toast.success('Regel toegewezen.') } catch (er) { toast.error(er instanceof Error ? er.message : 'Mislukt') } finally { setBezig(null) } }}>
                {opties.map((o) => <option key={o.id} value={o.id}>{o.title ?? 'Contract'}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end"><button type="button" onClick={onSluit} className="btn-primary text-sm">Klaar</button></div>
      </div>
    </div>
  )
}

/** Meerdere facturen plannen: alles handmatig ingevuld, met een voorbeeld vóór het aanmaken. */
function ReeksDialoog({ contractTitle, bezig, onSluit, onBevestig }: { contractTitle: string; bezig: boolean; onSluit: () => void; onBevestig: (inv: ReeksInvoer, extra: { verantwoordelijke: string; notitie: string }) => Promise<void> }) {
  const vandaag = new Date().toISOString().slice(0, 10)
  const [type, setType] = useState<ReeksInvoer['type']>('meerdere')
  const [aantal, setAantal] = useState('3')
  const [doorlopend, setDoorlopend] = useState(true)
  const [bedrag, setBedrag] = useState('')
  const [btw, setBtw] = useState(String(DEFAULT_VAT))
  const [start, setStart] = useState(vandaag)
  const [interval, setInterval_] = useState('1')
  const [omschrijving, setOmschrijving] = useState(contractTitle)
  const [termijn, setTermijn] = useState('30')
  const [verantwoordelijke, setVerantwoordelijke] = useState('')
  const [notitie, setNotitie] = useState('')
  const inv: ReeksInvoer = {
    type, aantal: type === 'eenmalig' ? 1 : type === 'maandelijks' && doorlopend ? null : Number(aantal) || 0,
    bedrag_excl: leesGetal(bedrag) ?? 0, btw_pct: leesGetal(btw) ?? 0, start_datum: start, interval_maanden: Number(interval) || 1,
    omschrijving, betalingstermijn_dagen: Number(termijn) || 0,
  }
  const fouten = valideerReeks(inv)
  const voorbeeld = useMemo(() => maakReeks(inv), [inv.type, inv.aantal, inv.bedrag_excl, inv.btw_pct, inv.start_datum, inv.interval_maanden, inv.omschrijving, inv.betalingstermijn_dagen]) // eslint-disable-line react-hooks/exhaustive-deps
  const tot = reeksTotaal(voorbeeld)
  const keuze = (v: ReeksInvoer['type'], label: string, uitleg: string) => (
    <button type="button" onClick={() => setType(v)} className={`rounded-xl border p-2.5 text-left text-sm transition-colors ${type === v ? 'border-[#fff848] bg-[#fff848]/10 ring-1 ring-[#fff848]' : 'border-gray-200 hover:border-gray-300'}`}><div className="font-medium">{label}</div><div className="text-[11px] text-gray-500">{uitleg}</div></button>
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="font-semibold">Meerdere facturen plannen</h3><p className="text-xs text-gray-500 mt-0.5">Jij bepaalt aantal, bedrag en datums; de app maakt exact die facturen aan met status Te factureren. Elke factuur blijft daarna volledig bewerkbaar.</p></div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {keuze('eenmalig', 'Eén factuur', 'Eén geplande factuur')}
            {keuze('meerdere', 'Meerdere termijnen', 'Bv. 6 × € 979, maandelijks of per kwartaal')}
            {keuze('maandelijks', 'Maandelijks', 'Doorlopend of voor een aantal maanden')}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {type !== 'eenmalig' && (
              <div><label className="block text-xs font-medium text-gray-600 mb-1">{type === 'maandelijks' ? 'Aantal maanden' : 'Aantal facturen'}</label>
                {type === 'maandelijks' && <label className="flex items-center gap-1.5 text-[11px] text-gray-600 mb-1 cursor-pointer"><input type="checkbox" checked={doorlopend} onChange={(e) => setDoorlopend(e.target.checked)} />Doorlopend (geen einde)</label>}
                <input className={INP} inputMode="numeric" value={aantal} disabled={type === 'maandelijks' && doorlopend} onChange={(e) => setAantal(e.target.value)} />
              </div>
            )}
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Bedrag per factuur (excl.)</label><input className={INP} inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="979" autoFocus /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Btw %</label><input className={INP} inputMode="decimal" value={btw} onChange={(e) => setBtw(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">{type === 'eenmalig' ? 'Geplande factuurdatum' : 'Eerste factuurdatum'}</label><input type="date" className={INP} value={start} onChange={(e) => setStart(e.target.value)} /></div>
            {type === 'meerdere' && <div><label className="block text-xs font-medium text-gray-600 mb-1">Interval</label><select className={INP} value={interval} onChange={(e) => setInterval_(e.target.value)}><option value="1">Maandelijks</option><option value="2">Om de 2 maanden</option><option value="3">Per kwartaal</option><option value="6">Per half jaar</option><option value="12">Jaarlijks</option></select></div>}
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Betaaltermijn (dagen)</label><input className={INP} inputMode="numeric" value={termijn} onChange={(e) => setTermijn(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Verantwoordelijke</label><input className={INP} list="ngm-verantwoordelijken-reeks" value={verantwoordelijke} onChange={(e) => setVerantwoordelijke(e.target.value)} placeholder="Bv. Bram Reinquin" /><datalist id="ngm-verantwoordelijken-reeks"><option value="Bram Reinquin" /><option value="Marco Castermans" /></datalist></div>
            <div className="col-span-2 md:col-span-4"><label className="block text-xs font-medium text-gray-600 mb-1">Omschrijving</label><input className={INP} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} placeholder="Bv. Social media beheer" /></div>
            <div className="col-span-2 md:col-span-4"><label className="block text-xs font-medium text-gray-600 mb-1">Interne notitie <span className="text-gray-400">— optioneel, niet voor de klant</span></label><input className={INP} value={notitie} onChange={(e) => setNotitie(e.target.value)} placeholder="Bv. kilometervergoeding nog toevoegen" /></div>
          </div>
          {fouten.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">Nog in te vullen: {fouten.join(', ')}.</div>}
          {isDoorlopend(inv) && fouten.length === 0 && <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-xs text-purple-900">Er komt een <b>maandelijkse facturatie</b> vanaf {start.slice(0, 7)} van {formatEuro(inv.bedrag_excl)} excl. per maand, zonder einddatum. Elke maand verschijnt ze in Facturen en de planner; stopzetten kan daar.</div>}
          {voorbeeld.length > 0 && (
            <div>
              <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Voorbeeld — {voorbeeld.length} factu{voorbeeld.length === 1 ? 'ur' : 'ren'} · {formatEuro(tot.excl)} excl. · {formatEuro(tot.incl)} incl.</div>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 text-xs max-h-48 overflow-y-auto">{voorbeeld.map((m) => <li key={m.volgnr} className="px-3 py-1.5 flex justify-between gap-2"><span>{d(m.factuurdatum)} · {m.omschrijving}</span><span className="tabular-nums">{formatEuro(m.bedrag_excl)}</span></li>)}</ul>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/60">
          <button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button>
          <button type="button" disabled={bezig || fouten.length > 0} onClick={() => onBevestig(inv, { verantwoordelijke, notitie })} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{isDoorlopend(inv) ? 'Maandelijkse facturatie aanmaken' : `${voorbeeld.length || ''} factu${voorbeeld.length === 1 ? 'ur' : 'ren'} aanmaken`}</button>
        </div>
      </div>
    </div>
  )
}
