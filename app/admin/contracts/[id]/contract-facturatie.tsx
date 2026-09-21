'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Receipt, Plus, CalendarRange, Link2, Unlink, Pencil, Repeat } from 'lucide-react'
import { formatEuro } from '@/lib/utils'
import { DEFAULT_VAT } from '@/lib/invoices'
import { isAfgesloten, type Verzendstatus, type Betaalstatus } from '@/lib/facturen/status'
import { maakReeks, valideerReeks, isDoorlopend, reeksTotaal, type ReeksInvoer } from '@/lib/facturatie/reeks'
import { FactuurEditor, StatusChip, BetaalChip } from '@/app/admin/invoices/factuur-editor'
import { INP } from '@/app/admin/instellingen/ui'

/**
 * Facturen van een contract — eenvoudig en manueel:
 *  · overzicht van de gekoppelde facturen (omschrijving, datum, bedrag, status, betaalstatus);
 *  · "Factuur toevoegen" (één factuur, volledig bewerkbaar) en "Meerdere facturen plannen"
 *    (aantal × bedrag vanaf een datum, of maandelijks doorlopend) — ingevuld door een mens,
 *    de app leest niets uit het contract;
 *  · bestaande losse facturen koppelen of losmaken.
 * Eén bron: dezelfde facturen als in Facturen en in de planner.
 */

type Rij = {
  id: string; bron: 'invoice' | 'recurring'; invoice_date: string | null; description: string | null
  amount_excl: number; amount_incl: number; vat_pct: number; status: string; betaalstatus: Betaalstatus | null
  sent_at: string | null; payment_term_days: number | null; verantwoordelijke: string | null; aantal_regels: number
  recurring: { start_month: string; end_month: string | null; invoice_day: string; actief: boolean } | null
}
type Data = {
  contract: { id: string; title: string | null; client_id: string | null; status: string | null; klant_naam: string | null }
  facturen: Rij[]
  totalen: { aantal: number; gepland: number; verstuurd: number; teFactureren: number; terugkerend: number }
  kandidaten: { id: string; invoice_date: string | null; description: string | null; amount_excl: number; status: string }[]
}

const d = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—')

export function ContractFacturatie({ contractId, clientId, contractTitle, isSigned }: {
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
  const [toonAfgesloten, setToonAfgesloten] = useState(false)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setData(j)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [contractId])
  useEffect(() => { laad() }, [laad])

  const actie = async (body: Record<string, unknown>, sleutel: string, melding?: string): Promise<{ ok: boolean; j?: Record<string, unknown> }> => {
    setBezig(sleutel)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturatie`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      if (melding) toast.success(melding)
      setData(j); router.refresh()
      return { ok: true, j }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); return { ok: false } } finally { setBezig(null) }
  }

  const facturen = data?.facturen ?? []
  const zichtbaar = useMemo(() => facturen.filter((f) => toonAfgesloten || !isAfgesloten(f.status as Verzendstatus)).sort((a, b) => (a.invoice_date ?? '').localeCompare(b.invoice_date ?? '')), [facturen, toonAfgesloten])
  const t = data?.totalen
  const knop = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50'

  return (
    <div id="facturatie" className="card-base space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5"><Receipt className="h-4 w-4 text-gray-400" />Facturen van dit contract</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">Facturen koppel je zelf: één factuur, meerdere termijnen of maandelijks. De app leest niets uit het contract. Een contract mag ook zonder facturen bestaan.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          {(data?.kandidaten.length ?? 0) > 0 && <button type="button" onClick={() => setKoppelen(true)} className="btn-secondary text-xs"><Link2 className="h-3.5 w-3.5" />Bestaande factuur koppelen</button>}
          <button type="button" onClick={() => setPlannen(true)} className="btn-secondary text-xs" title="Meerdere facturen of maandelijkse facturatie instellen"><CalendarRange className="h-3.5 w-3.5" />Meerdere facturen plannen</button>
          <button type="button" onClick={() => setNieuweFactuur(true)} className="btn-primary text-xs"><Plus className="h-3.5 w-3.5" />Factuur toevoegen</button>
        </div>
      </div>

      {t && t.aantal + t.terugkerend > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600 border-b border-gray-100 pb-3">
          <span>{t.aantal} factu{t.aantal === 1 ? 'ur' : 'ren'}{t.terugkerend ? ` · ${t.terugkerend} maandelijkse facturatie${t.terugkerend === 1 ? '' : 's'}` : ''}</span>
          <span>Gepland: <b className="text-gray-900 tabular-nums">{formatEuro(t.gepland)}</b> excl.</span>
          <span>Nog te factureren: <b className="text-gray-900 tabular-nums">{formatEuro(t.teFactureren)}</b></span>
          <span>Verstuurd: <b className="text-green-700 tabular-nums">{formatEuro(t.verstuurd)}</b></span>
          <label className="ml-auto flex items-center gap-1.5 cursor-pointer text-gray-500"><input type="checkbox" checked={toonAfgesloten} onChange={(e) => setToonAfgesloten(e.target.checked)} />Toon geannuleerd</label>
        </div>
      )}

      {!laden && zichtbaar.length === 0 && (
        <p className="text-sm text-gray-400">{facturen.length === 0 ? `Nog geen facturen gekoppeld${isSigned ? '' : ' — dat kan ook al vóór ondertekening'}. Klik op "Factuur toevoegen" of plan er meerdere.` : 'Alle facturen van dit contract zijn geannuleerd.'}</p>
      )}
      {zichtbaar.length > 0 && (
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-xs min-w-[760px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-500 bg-gray-50">
                <th className="px-2 py-1.5 text-left">Omschrijving</th><th className="px-2 py-1.5 text-left">Geplande datum</th><th className="px-2 py-1.5 text-left">Verstuurd op</th>
                <th className="px-2 py-1.5 text-right">Excl. btw</th><th className="px-2 py-1.5 text-right">Incl.</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5 text-left">Betaling</th><th className="px-2 py-1.5 text-left">Verantw.</th><th className="px-2 py-1.5 text-right">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {zichtbaar.map((f) => (
                <tr key={`${f.bron}:${f.id}`} onClick={() => f.bron === 'invoice' && setFactuurId(f.id)} className={`${f.bron === 'invoice' ? 'cursor-pointer hover:bg-gray-50' : ''} ${isAfgesloten(f.status as Verzendstatus) ? 'opacity-60' : ''}`}>
                  <td className="px-2 py-1.5 max-w-[280px] truncate" title={f.description ?? ''}>{f.bron === 'recurring' && <Repeat className="h-3 w-3 inline mr-1 text-purple-600" />}{f.description ?? '—'}{f.recurring && <span className="text-gray-400"> · maandelijks vanaf {f.recurring.start_month}{f.recurring.end_month ? ` t/m ${f.recurring.end_month}` : ''}</span>}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{f.bron === 'recurring' ? 'elke maand' : d(f.invoice_date)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">{f.sent_at ? d(f.sent_at) : '—'}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatEuro(f.amount_excl)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{formatEuro(f.amount_incl)}</td>
                  <td className="px-2 py-1.5">{f.bron === 'recurring' ? <span className="text-[10px] rounded-full border border-purple-200 bg-purple-50 text-purple-700 px-2 py-0.5">{f.recurring?.actief ? 'Loopt' : 'Stopgezet'}</span> : <StatusChip status={f.status} klein />}</td>
                  <td className="px-2 py-1.5"><BetaalChip status={f.betaalstatus} klein /></td>
                  <td className="px-2 py-1.5 text-gray-600 truncate max-w-[120px]">{f.verantwoordelijke ?? '—'}</td>
                  <td className="px-2 py-1.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {f.bron === 'invoice' ? (
                      <>
                        <button type="button" className={`${knop} bg-white border-gray-200`} onClick={() => setFactuurId(f.id)}><Pencil className="h-3 w-3" />Openen</button>
                        <button type="button" disabled={!!bezig} className={`${knop} bg-white border-gray-200 text-gray-500 ml-1`} title="Losmaken van dit contract (de factuur blijft bestaan)" onClick={() => { if (confirm('Deze factuur losmaken van het contract? De factuur blijft bestaan als losse factuur.')) actie({ action: 'ontkoppel', invoice_id: f.id }, f.id, 'Factuur losgemaakt.') }}><Unlink className="h-3 w-3" /></button>
                      </>
                    ) : <a href="/admin/invoices" className={`${knop} bg-white border-gray-200`}>In Facturen</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {factuurId && <FactuurEditor invoiceId={factuurId} onClose={() => setFactuurId(null)} onSaved={() => { laad(); router.refresh() }} />}
      {nieuweFactuur && <FactuurEditor standaard={{ client_id: clientId, contract_id: contractId, description: contractTitle }} onClose={() => setNieuweFactuur(false)} onSaved={() => { laad(); router.refresh() }} />}
      {plannen && <ReeksDialoog contractTitle={contractTitle} bezig={bezig === 'reeks'} onSluit={() => setPlannen(false)} onBevestig={async (inv, extra) => { const r = await actie({ action: 'reeks', ...inv, ...extra }, 'reeks'); if (r.ok) { setPlannen(false); const n = Number(r.j?.aangemaakt ?? 0); toast.success(r.j?.recurring_id ? 'Maandelijkse facturatie ingesteld.' : `${n} factu${n === 1 ? 'ur' : 'ren'} toegevoegd${r.j?.overgeslagen ? ` (${r.j.overgeslagen} bestond al)` : ''}.`) } }} />}
      {koppelen && data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100"><h3 className="font-semibold">Bestaande factuur koppelen</h3><p className="text-xs text-gray-500 mt-0.5">Losse facturen van {data.contract.klant_naam ?? 'deze klant'} die nog aan geen contract hangen.</p></div>
            <ul className="flex-1 overflow-y-auto divide-y divide-gray-100 text-sm">
              {data.kandidaten.map((k) => (
                <li key={k.id} className="px-5 py-2 flex items-center gap-3">
                  <div className="flex-1 min-w-0"><div className="truncate">{k.description ?? 'Factuur'}</div><div className="text-[11px] text-gray-500">{d(k.invoice_date)} · {formatEuro(k.amount_excl)} excl.</div></div>
                  <StatusChip status={k.status} klein />
                  <button type="button" disabled={!!bezig} onClick={async () => { const r = await actie({ action: 'koppel', invoice_id: k.id }, k.id, 'Factuur gekoppeld.'); if (r.ok && (r.j?.kandidaten as unknown[] | undefined)?.length === 0) setKoppelen(false) }} className="btn-primary text-xs"><Link2 className="h-3.5 w-3.5" />Koppelen</button>
                </li>
              ))}
              {data.kandidaten.length === 0 && <li className="px-5 py-6 text-center text-gray-400">Geen losse facturen meer.</li>}
            </ul>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end"><button type="button" onClick={() => setKoppelen(false)} className="btn-secondary text-sm">Sluiten</button></div>
          </div>
        </div>
      )}
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
    bedrag_excl: Number(String(bedrag).replace(',', '.')) || 0, btw_pct: Number(btw) || 0, start_datum: start, interval_maanden: Number(interval) || 1,
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
