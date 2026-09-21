'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, RefreshCw, Receipt, CheckCircle2, AlertTriangle, Plus, Copy, Trash2, Pencil, ChevronUp, ChevronDown, ListChecks, Save, Info, Ban, Wand2 } from 'lucide-react'
import { formatEuro } from '@/lib/utils'
import { useVuilMelder } from '@/lib/vuil-register'
import { DEFAULT_VAT } from '@/lib/invoices'
import { berekenTotalen, nieuweRegel, type FactuurRegel } from '@/lib/facturen/regels'
import { normaliseerVerzendstatus, isAfgesloten, type Betaalstatus } from '@/lib/facturen/status'
import type { ContractSamenvatting, Interpretatie } from '@/lib/facturatie/voorstel'
import { FactuurEditor, RegelsEditor, StatusChip, BetaalChip } from '@/app/admin/invoices/factuur-editor'
import { INP, Bevestig } from '@/app/admin/instellingen/ui'

/**
 * Facturatie van een contract, in drie delen:
 *  1. de facturatieafspraken (aantal, frequentie, bedrag) waaruit het voorstel komt;
 *  2. het FACTUURVOORSTEL: automatisch afgeleid, door een mens gecontroleerd,
 *     bewerkt en bevestigd — pas dan bestaan er facturen;
 *  3. de FACTUREN van dit contract met samenvatting en voortgang.
 * Eén bron: /api/admin/contracts/[id]/facturatie leest en schrijft alles.
 */

type Voorstel = {
  id: string; volgnr: number; aantal: number; type: string; factuurdatum: string; periode: string | null; omschrijving: string | null
  bedrag_excl: number | string | null; btw_pct: number | string; betalingstermijn_dagen: number | null; vervaldatum: string | null
  status: 'open' | 'controle_vereist' | 'afgehandeld' | 'geannuleerd'; ontbrekend: string[]; aandachtspunten: string[]
  regels: FactuurRegel[]; bron_velden: Record<string, string>; handmatig_gewijzigd: boolean; invoice_id: string | null; bevestigd_op: string | null
  bedrag: { excl: number | null; btw: number; incl: number | null }
}
type FactuurRij = {
  id: string; invoice_date: string | null; due_date: string | null; sent_at: string | null; periode: string | null; description: string | null; reference: string | null
  amount_excl: number; amount_incl: number; vat_pct: number; status: string; verzendstatus: string; betaalstatus: Betaalstatus | null; betaald_bedrag: number
  contract_bedrag_excl: number | null; extra_excl: number; aantal_regels: number; invoice_month: string | null
}
type Data = {
  voorstellen: Voorstel[]; facturen: FactuurRij[]; samenvatting: ContractSamenvatting; interpretatie: Interpretatie[]
  contract: { client_id: string | null; expected_invoice_count: number | null; invoice_frequency: string | null; expected_invoice_amount_excl: number | null; facturatie_bevestigd_op: string | null; facturatie_gewijzigd_na_bevestiging: boolean; facturatie_gestopt_op: string | null; klant_naam: string | null; status: string | null } | null
  vandaag: string
}

const FREQUENCIES = [{ value: '', label: '—' }, { value: 'eenmalig', label: 'Eenmalig' }, { value: 'maandelijks', label: 'Maandelijks' }, { value: 'kwartaal', label: 'Per kwartaal' }, { value: 'aangepast', label: 'Aangepast' }]
const TYPE_LABEL: Record<string, string> = { voorschot: 'Voorschot', saldo: 'Slotfactuur', periodiek: 'Periodiek', volledig: 'Volledig bedrag' }
const BRON_LABEL: Record<string, string> = { contract: 'uit het contract', afgeleid: 'afgeleid door de app', handmatig: 'handmatig aangepast', controle: 'controle vereist' }
const d = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '—')
const n = (v: number | string | null) => (v === null || v === undefined ? null : Number(v))

export function ContractFacturatie({ contractId, clientId, serviceSlug, contractTitle, isSigned, expectedCount, invoiceFrequency, expectedAmountExcl }: {
  contractId: string; clientId: string | null; serviceSlug: string | null; contractTitle: string; isSigned: boolean
  expectedCount: number | null; invoiceFrequency: string | null; expectedAmountExcl: number | null
}) {
  const router = useRouter()
  const [data, setData] = useState<Data | null>(null)
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState<string | null>(null)
  const [bewerk, setBewerk] = useState<Voorstel | null>(null)
  const [factuurId, setFactuurId] = useState<string | null>(null)
  const [nieuweFactuur, setNieuweFactuur] = useState(false)
  const [vraagGenereer, setVraagGenereer] = useState<string | null>(null)
  const [vraagBevestig, setVraagBevestig] = useState(false)
  const [vraagStop, setVraagStop] = useState(false)
  const [toonInterpretatie, setToonInterpretatie] = useState(false)
  const [toonAfgesloten, setToonAfgesloten] = useState(false)

  // Facturatieafspraken (bron van het voorstel)
  const [expCount, setExpCount] = useState(expectedCount != null ? String(expectedCount) : '')
  const [freq, setFreq] = useState(invoiceFrequency ?? '')
  const [expAmount, setExpAmount] = useState(expectedAmountExcl != null ? String(expectedAmountExcl) : '')
  const [savingSettings, setSavingSettings] = useState(false)

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
      const j = await r.json()
      if (!r.ok) {
        if (j.bevestigingNodig) { setVraagGenereer(j.error); return { ok: false, j } }
        throw new Error(j.error)
      }
      if (melding) toast.success(melding)
      setData(j); router.refresh()
      return { ok: true, j }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); return { ok: false } } finally { setBezig(null) }
  }

  const saveSettings = useCallback(async (): Promise<boolean> => {
    setSavingSettings(true)
    try {
      const res = await fetch(`/api/admin/contracts/${contractId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'invoice_settings', expected_invoice_count: expCount || null, invoice_frequency: freq || null, expected_invoice_amount_excl: expAmount || null }) })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Facturatieafspraken opgeslagen'); router.refresh(); await laad()
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); return false } finally { setSavingSettings(false) }
  }, [contractId, expCount, freq, expAmount, router, laad])
  const instellingenVuil = expCount !== (expectedCount != null ? String(expectedCount) : '') || freq !== (invoiceFrequency ?? '') || expAmount !== (expectedAmountExcl != null ? String(expectedAmountExcl) : '')
  useVuilMelder(`factuurinstellingen:${contractId}`, 'Facturatieafspraken van dit contract', instellingenVuil, saveSettings)

  const voorstellen = useMemo(() => (data?.voorstellen ?? []).filter((v) => !v.invoice_id && v.status !== 'afgehandeld' && v.status !== 'geannuleerd'), [data])
  const facturen = data?.facturen ?? []
  const s = data?.samenvatting
  const bevestigbaar = voorstellen.filter((v) => v.status === 'open')
  const controle = voorstellen.filter((v) => v.status === 'controle_vereist')
  const totaalVoorstel = voorstellen.reduce((t, v) => t + (v.bedrag.excl ?? 0), 0)
  const handmatig = voorstellen.filter((v) => v.handmatig_gewijzigd).length
  const gewijzigdNaBevestiging = !!data?.contract?.facturatie_gewijzigd_na_bevestiging && facturen.some((f) => normaliseerVerzendstatus(f.status) === 'te_versturen')
  const zichtbareFacturen = facturen.filter((f) => toonAfgesloten || !isAfgesloten(normaliseerVerzendstatus(f.status)))
  const knop = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50'

  return (
    <div id="facturatie" className="card-base space-y-5">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold text-sm flex items-center gap-1.5"><ListChecks className="h-4 w-4 text-gray-400" />Facturatie</h2>
          <p className="text-[11px] text-gray-500 mt-0.5">Van contract naar factuur: de app stelt voor, jij controleert en bevestigt, daarna staan de facturen in Facturen en in de planner.</p>
        </div>
        <div className="flex items-center gap-2">
          {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          <button type="button" onClick={() => setNieuweFactuur(true)} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Losse factuur</button>
        </div>
      </div>

      {/* 1. Facturatieafspraken */}
      <div className="rounded-xl border border-gray-100 p-3">
        <div className="grid grid-cols-3 gap-2">
          <div><label className="block text-[11px] text-gray-500 mb-1">Aantal facturen</label><input type="number" min="0" className={INP} value={expCount} onChange={(e) => setExpCount(e.target.value)} placeholder="6" /></div>
          <div><label className="block text-[11px] text-gray-500 mb-1">Frequentie</label><select className={INP} value={freq} onChange={(e) => setFreq(e.target.value)}>{FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}</select></div>
          <div><label className="block text-[11px] text-gray-500 mb-1">€ excl. btw per factuur</label><input type="number" min="0" step="0.01" className={INP} value={expAmount} onChange={(e) => setExpAmount(e.target.value)} placeholder="979" /></div>
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <button onClick={saveSettings} disabled={savingSettings || !instellingenVuil} className="btn-secondary text-xs">{savingSettings ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Afspraken opslaan</button>
          <button type="button" disabled={bezig === 'genereer' || !isSigned} onClick={() => actie({ action: 'genereer' }, 'genereer', 'Factuurplanning gegenereerd — controleer het voorstel hieronder.')} className="btn-primary text-xs" title={isSigned ? 'Leidt het factuurvoorstel af uit de afspraken hierboven' : 'Pas mogelijk als het contract ondertekend is'}>
            {bezig === 'genereer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}{voorstellen.length ? 'Factuurplanning opnieuw genereren' : 'Factuurplanning genereren'}
          </button>
          <button type="button" onClick={() => setToonInterpretatie((v) => !v)} className="text-[11px] text-gray-500 inline-flex items-center gap-1 hover:text-black"><Info className="h-3.5 w-3.5" />Wat las de app uit het contract?{toonInterpretatie ? ' ▲' : ' ▼'}</button>
          {!isSigned && <span className="text-[11px] text-gray-400">Het voorstel komt automatisch zodra het contract ondertekend is.</span>}
        </div>
        {toonInterpretatie && data && (
          <dl className="mt-3 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-xs border-t border-gray-100 pt-2">
            {data.interpretatie.map((i) => (
              <div key={i.veld} className="flex justify-between gap-2"><dt className="text-gray-500">{i.label}</dt><dd className={`text-right ${i.bron === 'controle' ? 'text-amber-700' : 'text-gray-800'}`}>{i.waarde ?? 'niet gevonden'} <span className="text-gray-400">· {BRON_LABEL[i.bron]}</span></dd></div>
            ))}
          </dl>
        )}
      </div>

      {/* Contract aangepast na bevestiging */}
      {gewijzigdNaBevestiging && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 space-y-2">
          <div className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><div><b>Het contract is aangepast nadat de factuurplanning bevestigd was.</b> Bestaande facturen zijn niet automatisch gewijzigd. Wat wil je doen?</div></div>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!!bezig} onClick={() => actie({ action: 'behoud_planning' }, 'behoud', 'Bestaande planning behouden.')} className={`${knop} bg-white border-gray-200`}>Bestaande planning behouden</button>
            <button type="button" disabled={!!bezig} onClick={() => actie({ action: 'herbereken_toekomstig' }, 'herbereken', 'Toekomstige, nog niet verstuurde facturen herberekend.')} className={`${knop} bg-black text-white border-black`}>Alleen toekomstige, nog niet verstuurde facturen herberekenen</button>
            <span className="text-amber-800 self-center">Of pas de facturen hieronder zelf aan. Verstuurde, betaalde of gecrediteerde facturen veranderen nooit automatisch.</span>
          </div>
        </div>
      )}

      {/* 2. Het factuurvoorstel */}
      {voorstellen.length > 0 && (
        <div className="space-y-3">
          <div className="rounded-xl border border-[#fff848] bg-[#fffde6] px-3 py-2.5 text-sm text-gray-900 flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-yellow-700" />
            <div>Dit is een automatisch gegenereerd factuurvoorstel. Controleer alle bedragen, datums en factuurregels voordat je de planning bevestigt.{handmatig > 0 && <span className="text-gray-600"> {handmatig} voorstel{handmatig === 1 ? ' is' : 'len zijn'} handmatig aangepast.</span>}</div>
          </div>
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-xs min-w-[900px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-gray-500 bg-gray-50">
                  <th className="px-2 py-1.5 text-left">#</th><th className="px-2 py-1.5 text-left">Periode</th><th className="px-2 py-1.5 text-left">Geplande datum</th><th className="px-2 py-1.5 text-left">Omschrijving</th>
                  <th className="px-2 py-1.5 text-right">Excl. btw</th><th className="px-2 py-1.5 text-right">Btw %</th><th className="px-2 py-1.5 text-right">Btw</th><th className="px-2 py-1.5 text-right">Incl. btw</th>
                  <th className="px-2 py-1.5 text-center">Regels</th><th className="px-2 py-1.5 text-left">Status</th><th className="px-2 py-1.5 text-right">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {voorstellen.map((v, i) => {
                  const b = bezig === v.id
                  const hand = v.handmatig_gewijzigd
                  return (
                    <tr key={v.id} className={v.status === 'controle_vereist' ? 'bg-amber-50/50' : ''}>
                      <td className="px-2 py-1.5 text-gray-500">{v.volgnr}/{v.aantal}</td>
                      <td className="px-2 py-1.5">{v.periode ?? '—'}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap" title={BRON_LABEL[v.bron_velden?.factuurdatum ?? 'afgeleid']}>{d(v.factuurdatum)}{v.bron_velden?.factuurdatum === 'handmatig' && <span className="text-[10px] text-blue-700 ml-1">✎</span>}</td>
                      <td className="px-2 py-1.5 max-w-[260px] truncate" title={v.omschrijving ?? ''}>{v.omschrijving ?? <span className="text-amber-700">omschrijving ontbreekt</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums font-medium" title={BRON_LABEL[v.bron_velden?.bedrag_excl ?? 'afgeleid']}>{v.bedrag.excl === null ? <span className="text-amber-700">ontbreekt</span> : formatEuro(v.bedrag.excl)}{v.bron_velden?.bedrag_excl === 'handmatig' && <span className="text-[10px] text-blue-700 ml-1">✎</span>}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{Number(v.btw_pct).toLocaleString('nl-BE')} %</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{formatEuro(v.bedrag.btw)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{v.bedrag.incl === null ? '—' : formatEuro(v.bedrag.incl)}</td>
                      <td className="px-2 py-1.5 text-center">{v.regels.length}</td>
                      <td className="px-2 py-1.5">
                        {v.status === 'controle_vereist'
                          ? <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 text-amber-800 px-2 py-0.5 text-[10px] font-medium" title={v.ontbrekend.join(' · ')}>Controle vereist</span>
                          : <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-100 text-gray-700 px-2 py-0.5 text-[10px] font-medium">Voorstel{hand ? ' · aangepast' : ''}</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-end gap-0.5">
                          {b && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
                          <button type="button" onClick={() => setBewerk(v)} className="h-6 w-6 rounded hover:bg-gray-100 flex items-center justify-center" title="Openen / bewerken"><Pencil className="h-3 w-3" /></button>
                          <button type="button" disabled={!!bezig} onClick={() => actie({ action: 'toevoegen', voor_id: v.id }, v.id, 'Voorstel toegevoegd (ervoor).')} className="h-6 w-6 rounded hover:bg-gray-100 flex items-center justify-center" title="Extra factuur ervoor toevoegen"><ChevronUp className="h-3 w-3" /></button>
                          <button type="button" disabled={!!bezig} onClick={() => actie({ action: 'toevoegen', na_id: v.id }, v.id, 'Voorstel toegevoegd (erna).')} className="h-6 w-6 rounded hover:bg-gray-100 flex items-center justify-center" title="Extra factuur erna toevoegen"><ChevronDown className="h-3 w-3" /></button>
                          <button type="button" disabled={!!bezig} onClick={() => actie({ action: 'dupliceer', opdracht_id: v.id }, v.id, 'Voorstel gedupliceerd.')} className="h-6 w-6 rounded hover:bg-gray-100 flex items-center justify-center" title="Dupliceren"><Copy className="h-3 w-3" /></button>
                          <button type="button" disabled={!!bezig} onClick={() => { if (confirm(`Voorstel ${v.volgnr}/${v.aantal} (${d(v.factuurdatum)}) uit het voorstel verwijderen?`)) actie({ action: 'verwijder', opdracht_id: v.id }, v.id, 'Uit het voorstel verwijderd.') }} className="h-6 w-6 rounded hover:bg-red-50 text-red-500 flex items-center justify-center" title="Verwijderen uit voorstel"><Trash2 className="h-3 w-3" /></button>
                        </div>
                        {i === voorstellen.length - 1 && null}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 text-xs font-medium">
                  <td colSpan={4} className="px-2 py-1.5">{voorstellen.length} voorgestelde factu{voorstellen.length === 1 ? 'ur' : 'ren'}{controle.length ? ` · ${controle.length} met controle vereist` : ''}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatEuro(totaalVoorstel)}</td><td colSpan={6} />
                </tr>
              </tfoot>
            </table>
          </div>
          {controle.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-900">
              <b>Controle vereist:</b> {[...new Set(controle.flatMap((v) => v.ontbrekend))].join(' · ')}. Open het voorstel, vul de gegevens in en markeer het als gecontroleerd; daarna kun je bevestigen.
            </div>
          )}
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" disabled={!!bezig} onClick={() => actie({ action: 'toevoegen' }, 'toevoegen', 'Nieuwe voorgestelde factuur toegevoegd.')} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Nieuwe voorgestelde factuur toevoegen</button>
            <button type="button" disabled={!!bezig} onClick={() => actie({ action: 'genereer' }, 'genereer', 'Factuurplanning opnieuw gegenereerd.')} className="btn-secondary text-xs"><RefreshCw className="h-3.5 w-3.5" />Factuurplanning opnieuw genereren</button>
            <span className="text-[11px] text-gray-500">Wijzigingen per voorstel worden opgeslagen wanneer je een voorstel bewaart.</span>
            <button type="button" disabled={!!bezig || bevestigbaar.length === 0 || controle.length > 0} onClick={() => setVraagBevestig(true)} className="btn-primary text-xs ml-auto" title={controle.length ? 'Los eerst de voorstellen met controle vereist op' : undefined}>
              <CheckCircle2 className="h-3.5 w-3.5" />Alle facturen bevestigen ({bevestigbaar.length})
            </button>
          </div>
        </div>
      )}
      {!laden && isSigned && voorstellen.length === 0 && facturen.length === 0 && (
        <p className="text-sm text-gray-500">Nog geen factuurvoorstel. Vul de facturatieafspraken in en klik op <b>Factuurplanning genereren</b>.</p>
      )}

      {/* 3. Facturen van dit contract */}
      {s && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Kaart label="Contractwaarde" waarde={s.contractwaarde === null ? '—' : formatEuro(s.contractwaarde)} sub={s.contractwaarde === null ? 'aantal × bedrag ontbreekt' : 'oorspronkelijk, excl. btw'} />
            <Kaart label="Bevestigd te factureren" waarde={formatEuro(s.bevestigd)} sub={`${s.aantal.totaal} factu${s.aantal.totaal === 1 ? 'ur' : 'ren'}${s.inVoorstel > 0 ? ` · ${formatEuro(s.inVoorstel)} nog in voorstel` : ''}`} />
            <Kaart label="Extra kosten" waarde={formatEuro(s.extraKosten)} sub="bovenop het contract" />
            <Kaart label="Verstuurd" waarde={formatEuro(s.verstuurd)} sub={`${s.aantal.verstuurd} van ${s.aantal.totaal} facturen verstuurd`} kleur="text-green-700" />
            <Kaart label="Effectief ontvangen" waarde={formatEuro(s.ontvangen)} sub="enkel betaalde bedragen" kleur="text-emerald-700" />
            <Kaart label="Nog te versturen" waarde={formatEuro(s.nogTeVersturen)} sub={`${s.aantal.teVersturen} factu${s.aantal.teVersturen === 1 ? 'ur' : 'ren'} resterend`} />
            <Kaart label="Nog te ontvangen" waarde={formatEuro(s.nogTeOntvangen)} sub="verstuurd, nog niet betaald" />
            <div className="rounded-xl border border-gray-100 p-3">
              <div className="text-[11px] text-gray-500">Voortgang</div>
              <div className="mt-1 text-lg font-bold">{s.voortgangPct}%</div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1"><div className="h-full bg-[#fff848] rounded-full" style={{ width: `${s.voortgangPct}%` }} /></div>
              <div className="text-[10px] text-gray-400 mt-1">{s.aantal.verstuurd} van {s.aantal.totaal} verstuurd{s.aantal.geannuleerd ? ` · ${s.aantal.geannuleerd} geannuleerd/gecrediteerd` : ''}</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="font-semibold text-sm flex items-center gap-1.5"><Receipt className="h-4 w-4 text-gray-400" />Facturen van dit contract</h3>
            <div className="flex items-center gap-2 text-[11px] text-gray-600">
              <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={toonAfgesloten} onChange={(e) => setToonAfgesloten(e.target.checked)} />Toon geannuleerd/gecrediteerd</label>
              {facturen.some((f) => normaliseerVerzendstatus(f.status) === 'te_versturen') && data?.contract?.status !== 'cancelled' && (
                <button type="button" onClick={() => setVraagStop(true)} className={`${knop} bg-white border-gray-200 text-gray-600 hover:text-red-600 hover:border-red-300`}><Ban className="h-3 w-3" />Contract vroegtijdig stoppen</button>
              )}
            </div>
          </div>
          {zichtbareFacturen.length === 0 ? (
            <p className="text-sm text-gray-400">{facturen.length === 0 ? 'Nog geen facturen. Bevestig het voorstel of maak een losse factuur.' : 'Alle facturen van dit contract zijn geannuleerd of gecrediteerd.'}</p>
          ) : (
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-xs min-w-[1000px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-gray-500 bg-gray-50">
                    <th className="px-2 py-1.5 text-left">Referentie</th><th className="px-2 py-1.5 text-left">Periode</th><th className="px-2 py-1.5 text-left">Gepland</th><th className="px-2 py-1.5 text-left">Verstuurd op</th><th className="px-2 py-1.5 text-left">Omschrijving</th>
                    <th className="px-2 py-1.5 text-right">Contractueel</th><th className="px-2 py-1.5 text-right">Extra</th><th className="px-2 py-1.5 text-right">Totaal excl.</th><th className="px-2 py-1.5 text-right">Incl.</th>
                    <th className="px-2 py-1.5 text-left">Verzending</th><th className="px-2 py-1.5 text-left">Betaling</th><th className="px-2 py-1.5 text-right">Acties</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {zichtbareFacturen.map((f) => {
                    const st = normaliseerVerzendstatus(f.status)
                    return (
                      <tr key={f.id} onClick={() => setFactuurId(f.id)} className={`cursor-pointer hover:bg-gray-50 ${isAfgesloten(st) ? 'opacity-60' : ''}`}>
                        <td className="px-2 py-1.5 font-mono text-[11px]">{f.reference || `F-${f.id.slice(0, 8).toUpperCase()}`}</td>
                        <td className="px-2 py-1.5">{f.periode ?? f.invoice_month ?? '—'}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{d(f.invoice_date)}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">{f.sent_at ? d(f.sent_at.slice(0, 10)) : '—'}</td>
                        <td className="px-2 py-1.5 max-w-[240px] truncate" title={f.description ?? ''}>{f.description ?? '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatEuro(f.contract_bedrag_excl ?? f.amount_excl)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-amber-800">{f.extra_excl > 0 ? formatEuro(f.extra_excl) : '—'}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatEuro(f.amount_excl)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-gray-500">{formatEuro(f.amount_incl)}</td>
                        <td className="px-2 py-1.5"><StatusChip status={st} klein /></td>
                        <td className="px-2 py-1.5"><BetaalChip status={f.betaalstatus} klein /></td>
                        <td className="px-2 py-1.5 text-right"><button type="button" className={`${knop} bg-white border-gray-200`} onClick={(e) => { e.stopPropagation(); setFactuurId(f.id) }}><Pencil className="h-3 w-3" />Openen</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Dialogen */}
      {bewerk && <VoorstelDialoog voorstel={bewerk} bezig={!!bezig} onSluit={() => setBewerk(null)} onOpslaan={async (velden) => { const r = await actie({ action: 'bewerk', opdracht_id: bewerk.id, ...velden }, bewerk.id, 'Voorstel opgeslagen.'); if (r.ok) setBewerk(null) }} onGecontroleerd={async () => { const r = await actie({ action: 'gecontroleerd', opdracht_id: bewerk.id }, bewerk.id, 'Gemarkeerd als gecontroleerd.'); if (r.ok) setBewerk(null) }} />}
      {factuurId && <FactuurEditor invoiceId={factuurId} onClose={() => setFactuurId(null)} onSaved={() => { laad(); router.refresh() }} />}
      {nieuweFactuur && <FactuurEditor standaard={{ client_id: clientId, contract_id: contractId, description: contractTitle }} onClose={() => setNieuweFactuur(false)} onSaved={() => { laad(); router.refresh() }} />}
      {vraagGenereer && (
        <Bevestig titel="Voorstel vervangen?" gevaarlijk bezig={bezig === 'genereer'} bevestigLabel="Ja, opnieuw genereren"
          tekst={<>{vraagGenereer} Handmatige aanpassingen aan onbevestigde voorstellen gaan daarbij verloren; bevestigde facturen blijven staan.</>}
          onAnnuleer={() => setVraagGenereer(null)} onBevestig={async () => { const r = await actie({ action: 'genereer', vervang: true }, 'genereer', 'Factuurplanning opnieuw gegenereerd.'); if (r.ok) setVraagGenereer(null) }} />
      )}
      {vraagBevestig && (
        <Bevestig titel="Alle facturen bevestigen" bezig={bezig === 'bevestig'} bevestigLabel={`Ja, ${bevestigbaar.length} factu${bevestigbaar.length === 1 ? 'ur' : 'ren'} aanmaken`}
          tekst={<div className="space-y-2">
            <p>Je maakt <b>{bevestigbaar.length}</b> factu{bevestigbaar.length === 1 ? 'ur' : 'ren'} aan voor <b>{data?.contract?.klant_naam ?? 'deze klant'}</b>, samen <b>{formatEuro(bevestigbaar.reduce((t, v) => t + (v.bedrag.excl ?? 0), 0))}</b> excl. btw ({formatEuro(bevestigbaar.reduce((t, v) => t + (v.bedrag.incl ?? 0), 0))} incl.).</p>
            <ul className="text-xs text-gray-600 max-h-40 overflow-y-auto divide-y divide-gray-100 rounded-lg border border-gray-100">{bevestigbaar.map((v) => <li key={v.id} className="px-2 py-1 flex justify-between gap-2"><span>{d(v.factuurdatum)} · {v.omschrijving}</span><span className="tabular-nums">{formatEuro(v.bedrag.excl ?? 0)}</span></li>)}</ul>
            <p className="text-xs text-gray-500">Ze krijgen de status <b>Te versturen</b>, verschijnen in Facturen en op hun datum in de planner, en worden aan dit contract gekoppeld. Dit gebeurt in één keer of helemaal niet; een dubbele klik maakt geen dubbele facturen.</p>
          </div>}
          onAnnuleer={() => setVraagBevestig(false)} onBevestig={async () => { const r = await actie({ action: 'bevestig' }, 'bevestig'); if (r.ok) { setVraagBevestig(false); toast.success(`${(r.j?.aangemaakt as number) ?? 0} factu${r.j?.aangemaakt === 1 ? 'ur' : 'ren'} aangemaakt.`) } }} />
      )}
      {vraagStop && data && <StopDialoog voorstellen={voorstellen} facturen={facturen.filter((f) => normaliseerVerzendstatus(f.status) === 'te_versturen')} bezig={bezig === 'stop'} onSluit={() => setVraagStop(false)} onBevestig={async (k) => { const r = await actie({ action: 'stop', ...k }, 'stop', 'Contract gestopt; de gekozen facturen en voorstellen zijn geannuleerd.'); if (r.ok) setVraagStop(false) }} />}
    </div>
  )
}

function Kaart({ label, waarde, sub, kleur }: { label: string; waarde: string; sub?: string; kleur?: string }) {
  return <div className="rounded-xl border border-gray-100 p-3"><div className="text-[11px] text-gray-500">{label}</div><div className={`mt-1 text-lg font-bold tabular-nums ${kleur ?? ''}`}>{waarde}</div>{sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}</div>
}

/** Eén voorgestelde factuur bewerken: datum, periode, omschrijving, btw, termijn en de factuurregels. */
function VoorstelDialoog({ voorstel: v, bezig, onSluit, onOpslaan, onGecontroleerd }: { voorstel: Voorstel; bezig: boolean; onSluit: () => void; onOpslaan: (velden: Record<string, unknown>) => Promise<void>; onGecontroleerd: () => Promise<void> }) {
  const btw = Number(v.btw_pct) || DEFAULT_VAT
  const [factuurdatum, setDatum] = useState(v.factuurdatum)
  const [periode, setPeriode] = useState(v.periode ?? '')
  const [omschrijving, setOmschrijving] = useState(v.omschrijving ?? '')
  const [btwPct, setBtw] = useState(String(btw))
  const [termijn, setTermijn] = useState(v.betalingstermijn_dagen === null ? '' : String(v.betalingstermijn_dagen))
  const [regels, setRegels] = useState<FactuurRegel[]>(v.regels.length ? v.regels : (n(v.bedrag_excl) !== null ? [nieuweRegel({ artikel: (v.omschrijving ?? '').slice(0, 120), omschrijving: v.omschrijving ?? '', eenheid: 'forfait', prijs_excl: n(v.bedrag_excl) ?? 0 }, btw)] : []))
  const t = berekenTotalen(regels)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div><div className="text-[11px] uppercase tracking-wide text-gray-400">Voorgestelde factuur {v.volgnr}/{v.aantal} · {TYPE_LABEL[v.type] ?? v.type}</div><h3 className="font-semibold">Voorstel bewerken</h3></div>
          <button type="button" onClick={onSluit} className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {v.ontbrekend.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"><b>Controle vereist:</b> {v.ontbrekend.join(' · ')}</div>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Geplande factuurdatum</label><input type="date" className={INP} value={factuurdatum} onChange={(e) => setDatum(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Factuurperiode</label><input className={INP} value={periode} onChange={(e) => setPeriode(e.target.value)} placeholder="2026-09" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Btw-tarief %</label><input className={INP} inputMode="decimal" value={btwPct} onChange={(e) => setBtw(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Betaaltermijn (dagen)</label><input className={INP} inputMode="numeric" value={termijn} onChange={(e) => setTermijn(e.target.value)} placeholder="30" /></div>
            <div className="col-span-2 md:col-span-4"><label className="block text-xs font-medium text-gray-600 mb-1">Omschrijving</label><input className={INP} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} /></div>
          </div>
          <div className="text-[11px] text-gray-500">Bron van de gegevens: datum {BRON_LABEL[v.bron_velden?.factuurdatum ?? 'afgeleid']}, bedrag {BRON_LABEL[v.bron_velden?.bedrag_excl ?? 'afgeleid']}. Wat je hier opslaat, wordt als handmatig gemarkeerd.</div>
          <div><div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Factuurregels</div><RegelsEditor regels={regels} onChange={setRegels} btw={Number(btwPct) || btw} /></div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center gap-2 flex-wrap bg-gray-50/60">
          <div className="text-xs text-gray-600 mr-auto tabular-nums">Totaal: <b>{formatEuro(t.excl)}</b> excl. · <b>{formatEuro(t.incl)}</b> incl.</div>
          {v.status === 'controle_vereist' && <button type="button" disabled={bezig} onClick={onGecontroleerd} className="btn-secondary text-sm" title="Nadat je de gegevens hebt nagekeken en opgeslagen"><CheckCircle2 className="h-4 w-4" />Gecontroleerd</button>}
          <button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button>
          <button type="button" disabled={bezig} onClick={() => onOpslaan({ factuurdatum, periode, omschrijving, btw_pct: btwPct, betalingstermijn_dagen: termijn === '' ? null : termijn, regels })} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Voorstel opslaan</button>
        </div>
      </div>
    </div>
  )
}

/** Contract stopt vroegtijdig: per resterend item kiezen wat ermee gebeurt. */
function StopDialoog({ voorstellen, facturen, bezig, onSluit, onBevestig }: { voorstellen: Voorstel[]; facturen: FactuurRij[]; bezig: boolean; onSluit: () => void; onBevestig: (k: { voorstellen_annuleren: string[]; facturen_annuleren: string[]; reden: string; einddatum: string | null }) => Promise<void> }) {
  const [vSel, setVSel] = useState<Set<string>>(() => new Set(voorstellen.map((v) => v.id)))
  const [fSel, setFSel] = useState<Set<string>>(() => new Set(facturen.map((f) => f.id)))
  const [reden, setReden] = useState('')
  const [einddatum, setEinddatum] = useState('')
  const toggle = (set: Set<string>, id: string, zet: (s: Set<string>) => void) => { const nw = new Set(set); if (nw.has(id)) nw.delete(id); else nw.add(id); zet(nw) }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100"><h3 className="font-semibold">Contract vroegtijdig stoppen</h3><p className="text-xs text-gray-500 mt-0.5">Kies per resterend item of het behouden of geannuleerd wordt. Verstuurde en betaalde facturen blijven altijd staan.</p></div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm">
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Einddatum</label><input type="date" className={INP} value={einddatum} onChange={(e) => setEinddatum(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Reden</label><input className={INP} value={reden} onChange={(e) => setReden(e.target.value)} placeholder="Bv. klant zegt op per 1 december" /></div>
          </div>
          {facturen.length > 0 && (
            <div><div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Nog te versturen facturen</div>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 text-xs">{facturen.map((f) => <li key={f.id} className="px-2 py-1.5 flex items-center gap-2"><input type="checkbox" checked={fSel.has(f.id)} onChange={() => toggle(fSel, f.id, setFSel)} /><span className="flex-1">{d(f.invoice_date)} · {f.description ?? 'Factuur'}</span><span className="tabular-nums">{formatEuro(f.amount_excl)}</span><span className={fSel.has(f.id) ? 'text-red-600' : 'text-gray-500'}>{fSel.has(f.id) ? 'annuleren' : 'behouden'}</span></li>)}</ul>
            </div>
          )}
          {voorstellen.length > 0 && (
            <div><div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1">Onbevestigde voorstellen</div>
              <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 text-xs">{voorstellen.map((v) => <li key={v.id} className="px-2 py-1.5 flex items-center gap-2"><input type="checkbox" checked={vSel.has(v.id)} onChange={() => toggle(vSel, v.id, setVSel)} /><span className="flex-1">{d(v.factuurdatum)} · {v.omschrijving ?? 'Voorstel'}</span><span className="tabular-nums">{v.bedrag.excl === null ? '—' : formatEuro(v.bedrag.excl)}</span><span className={vSel.has(v.id) ? 'text-red-600' : 'text-gray-500'}>{vSel.has(v.id) ? 'annuleren' : 'behouden'}</span></li>)}</ul>
            </div>
          )}
          <p className="text-xs text-gray-500">Wil je een factuur aanpassen in plaats van annuleren? Laat ze hier op behouden staan en open ze daarna in het overzicht.</p>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button>
          <button type="button" disabled={bezig || !reden.trim()} onClick={() => onBevestig({ voorstellen_annuleren: [...vSel], facturen_annuleren: [...fSel], reden: reden.trim(), einddatum: einddatum || null })} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />}Contract stoppen</button>
        </div>
      </div>
    </div>
  )
}

// serviceSlug wordt bewaard voor latere uitbreiding (dienst op de losse factuur); voorkomt een ongebruikte-parameterwaarschuwing.
void (0 as unknown as typeof ContractFacturatie)
