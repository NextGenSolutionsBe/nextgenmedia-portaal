'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Save, Square, Trash2, Undo2 } from 'lucide-react'
import { Dialoog, INP } from '@/app/admin/instellingen/ui'
import { GetalInvoer } from '@/components/ui/getal-invoer'
import { INVOICE_DAY_LABEL } from '@/lib/invoices'
import { euro2, type Moment } from '@/lib/facturatie/planner-model'

type Reeks = {
  id: string; client_id: string | null; contract_id: string | null; service_slug: string | null; description: string | null
  amount_excl: number; vat_pct: number; start_month: string; end_month: string | null; invoice_day: string | null
  verantwoordelijke: string | null; payment_term_days: number | null; deleted_at: string | null
}
type Antwoord = { reeks: Reeks; uitgevoerd: number; klanten: { id: string; company_name: string }[]; contracten: { id: string; title: string; client_id: string | null }[] }

const LBL = 'block text-xs font-medium text-gray-600 mb-1'

async function api<T>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(url, { method: init?.method ?? (init?.body ? 'POST' : 'GET'), headers: init?.body ? { 'Content-Type': 'application/json' } : undefined, body: init?.body ? JSON.stringify(init.body) : undefined, cache: 'no-store' })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Mislukt')
  return j as T
}

/**
 * Een terugkerende facturatie volledig bewerken: klant, contract, omschrijving,
 * bedrag, btw, start- en eindmaand, factuurdag, verantwoordelijke en
 * betaaltermijn. Plus stopzetten en — zolang er niets verstuurd is — verwijderen.
 */
export function ReeksBewerken({ recurringId, onSluit, onKlaar }: { recurringId: string; onSluit: () => void; onKlaar: () => void }) {
  const [d, setD] = useState<Antwoord | null>(null)
  const [v, setV] = useState<Partial<Reeks>>({})
  const [bezig, setBezig] = useState(false)
  useEffect(() => {
    api<Antwoord>(`/api/admin/invoices/recurring/${recurringId}`)
      .then((r) => { setD(r); setV({ ...r.reeks, start_month: r.reeks.start_month?.slice(0, 7), end_month: r.reeks.end_month?.slice(0, 7) ?? null }) })
      .catch((e) => { toast.error(e.message); onSluit() })
  }, [recurringId]) // eslint-disable-line react-hooks/exhaustive-deps
  const zet = <K extends keyof Reeks>(k: K, w: Reeks[K]) => setV((o) => ({ ...o, [k]: w }))

  const bewaar = async () => {
    setBezig(true)
    try {
      await api(`/api/admin/invoices/recurring/${recurringId}`, { method: 'PATCH', body: {
        client_id: v.client_id ?? null, contract_id: v.contract_id ?? null, description: v.description ?? '', service_slug: v.service_slug ?? '',
        amount_excl: v.amount_excl, vat_pct: v.vat_pct, start_month: v.start_month, end_month: v.end_month || null,
        invoice_day: v.invoice_day ?? 'last', verantwoordelijke: v.verantwoordelijke ?? '', payment_term_days: v.payment_term_days ?? '',
      } })
      toast.success('Terugkerende facturatie bijgewerkt. Verstuurde maanden blijven zoals ze waren.'); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  const stop = async () => {
    if (!confirm('De reeks stopzetten? Toekomstige, nog niet verstuurde maanden worden geannuleerd; wat al verstuurd is blijft staan.')) return
    setBezig(true)
    try { await api(`/api/admin/invoices/recurring/${recurringId}`, { method: 'DELETE' }); toast.success('Reeks stopgezet.'); onKlaar() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  const verwijder = async () => {
    if (!confirm('Deze terugkerende facturatie definitief verwijderen, met alle geplande maanden? Dit kan niet ongedaan gemaakt worden.')) return
    setBezig(true)
    try { await api(`/api/admin/invoices/recurring/${recurringId}?definitief=1`, { method: 'DELETE' }); toast.success('Terugkerende facturatie verwijderd.'); onKlaar() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }

  return (
    <Dialoog titel="Terugkerende facturatie bewerken" onSluit={onSluit} breed>
      {!d ? <div className="py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" /></div> : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={LBL}>Klant</label>
              <select className={INP} value={v.client_id ?? ''} onChange={(e) => zet('client_id', e.target.value || null)}>
                <option value="">— Geen klant —</option>{d.klanten.map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}
              </select></div>
            <div><label className={LBL}>Contract</label>
              <select className={INP} value={v.contract_id ?? ''} onChange={(e) => zet('contract_id', e.target.value || null)}>
                <option value="">— Geen contract —</option>{d.contracten.filter((c) => !v.client_id || !c.client_id || c.client_id === v.client_id || c.id === v.contract_id).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select></div>
            <div className="sm:col-span-2"><label className={LBL}>Omschrijving op de factuur</label><input className={INP} value={v.description ?? ''} onChange={(e) => zet('description', e.target.value)} placeholder="bv. Social media beheer" /></div>
            <div><label className={LBL}>Bedrag per maand excl. btw (€)</label><GetalInvoer className={INP} waarde={v.amount_excl ?? 0} min={0} onWaarde={(n) => zet('amount_excl', n)} /></div>
            <div><label className={LBL}>Btw %</label><GetalInvoer className={INP} waarde={v.vat_pct ?? 21} min={0} max={100} onWaarde={(n) => zet('vat_pct', n)} /></div>
            <div><label className={LBL}>Startmaand</label><input type="month" className={INP} value={v.start_month ?? ''} onChange={(e) => zet('start_month', e.target.value)} /></div>
            <div><label className={LBL}>Eindmaand <span className="text-gray-400">(leeg = doorlopend)</span></label><input type="month" className={INP} value={v.end_month ?? ''} min={v.start_month ?? undefined} onChange={(e) => zet('end_month', e.target.value || null)} /></div>
            <div><label className={LBL}>Factuurdag</label>
              <select className={INP} value={v.invoice_day ?? 'last'} onChange={(e) => zet('invoice_day', e.target.value)}>
                {Object.entries(INVOICE_DAY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>
            <div><label className={LBL}>Betaaltermijn (dagen)</label><GetalInvoer className={INP} waarde={v.payment_term_days ?? 30} min={0} max={365} onWaarde={(n) => zet('payment_term_days', Math.round(n))} /></div>
            <div className="sm:col-span-2"><label className={LBL}>Verantwoordelijke</label><input className={INP} value={v.verantwoordelijke ?? ''} onChange={(e) => zet('verantwoordelijke', e.target.value)} placeholder="bv. Bram Reinquin" /></div>
          </div>
          <p className="text-[11px] text-gray-500">
            Wijzigingen gelden voor alle maanden die nog niet verstuurd zijn{d.uitgevoerd ? ` — ${d.uitgevoerd} verstuurde maand(en) behouden hun eigen bedrag en datum` : ''}. Het bedrag van één maand pas je aan in het detail van die maand.
          </p>
          <div className="flex flex-wrap justify-between gap-2 pt-1">
            <div className="flex gap-2">
              {!d.reeks.deleted_at && <button type="button" disabled={bezig} onClick={stop} className="btn-secondary text-red-600"><Square className="h-4 w-4" />Stopzetten</button>}
              {d.uitgevoerd === 0 && <button type="button" disabled={bezig} onClick={verwijder} className="btn-secondary text-red-600"><Trash2 className="h-4 w-4" />Verwijderen</button>}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button>
              <button type="button" disabled={bezig} onClick={bewaar} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren</button>
            </div>
          </div>
        </div>
      )}
    </Dialoog>
  )
}

/** Het bedrag van één maand van een terugkerende facturatie aanpassen (of terugzetten). */
export function MaandBedrag({ m, onKlaar }: { m: Moment; onKlaar: () => void }) {
  const [bedrag, setBedrag] = useState<number>(m.bedrag_excl)
  const [btw, setBtw] = useState<number>(m.btw_pct)
  const [bezig, setBezig] = useState(false)
  const stuur = async (terug: boolean) => {
    setBezig(true)
    try {
      await api('/api/admin/invoices/planner', { body: { actie: 'bedrag', id: m.id, bedrag_excl: terug ? null : bedrag, btw_pct: btw } })
      toast.success(terug ? 'Bedrag terug naar het reeksbedrag.' : `Bedrag van deze maand: ${euro2(bedrag)} excl. btw.`); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-2">
      <div className="text-xs font-medium text-gray-600">Bedrag van alleen deze maand</div>
      <div className="flex items-end gap-2 flex-wrap">
        <div className="w-36"><label className={LBL}>Excl. btw (€)</label><GetalInvoer className={INP} waarde={bedrag} min={0} onWaarde={setBedrag} /></div>
        <div className="w-20"><label className={LBL}>Btw %</label><GetalInvoer className={INP} waarde={btw} min={0} max={100} onWaarde={setBtw} /></div>
        <button type="button" disabled={bezig || (bedrag === m.bedrag_excl && btw === m.btw_pct)} onClick={() => stuur(false)} className="btn-primary text-xs">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Bewaren</button>
        <button type="button" disabled={bezig} onClick={() => stuur(true)} className="btn-secondary text-xs" title="Deze maand volgt weer het bedrag van de reeks"><Undo2 className="h-3.5 w-3.5" />Reeksbedrag</button>
      </div>
    </div>
  )
}
