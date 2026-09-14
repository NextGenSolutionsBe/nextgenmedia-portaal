'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import Link from 'next/link'
import {
  Loader2, Plus, X, Trash2, Pencil, Rocket, Users, Layers, Briefcase, Settings2, CalendarRange, AlertTriangle, Archive,
  Link2, Receipt, CheckCircle2, ExternalLink, Ban, Undo2, ChevronDown, ChevronRight,
} from 'lucide-react'
import { formatEuro, formatDate } from '@/lib/utils'
import { ExportKnop } from '@/components/admin/export-knop'
import { vestingWerkmap } from '@/lib/excel/rapporten/vesting'
import {
  berekenVesting, leesInstellingen, pct, totaalwaarde, duurUitData, toerekeningsfactor, wamSchema,
  STATUS_LABEL, ERKENNING_LABEL, JAAR_LABEL, DIENSTEN, FREQUENTIES, TERMIJN_LABEL,
  type Contract, type WamRij, type WamKost, type WamTermijn, type WamRijBerekend, type TermijnStatus, type Frequentie,
  type ContractBerekend, type ContractStatus, type Erkenning, type VestingInstellingen,
} from '@/lib/vesting'

/** Een contract uit de Contractenmodule, zoals de picker het toont. */
type ModuleContract = { id: string; titel: string; status: string; client_id: string | null; klant: string | null; start_date: string | null; end_date: string | null; signed_at: string | null; service_slug: string | null }
type Klant = { id: string; naam: string }

const TERMIJN_STIJL: Record<TermijnStatus, string> = {
  gepland: 'bg-gray-100 text-gray-700', gefactureerd: 'bg-blue-100 text-blue-800', betaald: 'bg-green-100 text-green-800', geannuleerd: 'bg-red-100 text-red-700',
}
const CONTRACT_STATUS_LABEL: Record<string, string> = { draft: 'Concept', sent: 'Verstuurd', viewed: 'Bekeken', signed: 'Ondertekend' }

type Tab = 'overzicht' | 'contracten' | 'wam' | 'jaren' | 'instellingen'

const n = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const x = Number(v); return Number.isFinite(x) ? x : null }
const d = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null)

/** Databankrijen (tekstgetallen, nulls) naar het type van de rekenkern. */
function naarContract(r: Record<string, unknown>): Contract {
  return {
    id: String(r.id), nr: String(r.nr ?? ''), klant: String(r.klant ?? ''),
    ondertekend_op: d(r.ondertekend_op) ?? '', start_dienst: d(r.start_dienst), einde_dienst: d(r.einde_dienst),
    dienst: (r.dienst as string | null) ?? null,
    facturatiemodel: r.facturatiemodel === 'eenmalig' ? 'eenmalig' : 'maandcontract',
    maandbedrag: n(r.maandbedrag), duur_maanden: n(r.duur_maanden), handmatige_totaalwaarde: n(r.handmatige_totaalwaarde),
    uitgesloten_kosten: n(r.uitgesloten_kosten) ?? 0,
    status: (['actief', 'voltooid', 'stopgezet', 'niet_betaler'].includes(String(r.status)) ? r.status : 'actief') as ContractStatus,
    betalingen_op_schema: r.betalingen_op_schema !== false,
    appointment_door_marco: r.appointment_door_marco === true,
    closed_door_marco: r.closed_door_marco === true,
    laatste_betaalde_maand: d(r.laatste_betaalde_maand), reden_stop: (r.reden_stop as string | null) ?? null,
    notitie: (r.notitie as string | null) ?? null,
    contract_id: (r.contract_id as string | null) ?? null,
  }
}
function naarWam(r: Record<string, unknown>): WamRij {
  const freq = FREQUENTIES.find((f) => f.key === r.frequentie)?.key ?? null
  return {
    id: String(r.id), nr: String(r.nr ?? ''), klant: String(r.klant ?? ''),
    client_id: (r.client_id as string | null) ?? null,
    contractwaarde: n(r.contractwaarde) ?? 0, netto_ontvangen: n(r.netto_ontvangen) ?? 0,
    status: (['actief', 'voltooid', 'stopgezet', 'niet_betaler'].includes(String(r.status)) ? r.status : 'actief') as ContractStatus,
    betalingen_op_schema: r.betalingen_op_schema !== false, notitie: (r.notitie as string | null) ?? null,
    start_datum: d(r.start_datum), contract_maanden: n(r.contract_maanden), bedrag_per_factuur: n(r.bedrag_per_factuur),
    frequentie: freq, btw_pct: n(r.btw_pct) ?? 21, omschrijving: (r.omschrijving as string | null) ?? null,
  }
}
function naarTermijn(r: Record<string, unknown>): WamTermijn {
  return {
    id: String(r.id), wam_id: String(r.wam_id), volgnr: n(r.volgnr) ?? 0, periode: String(r.periode ?? '').slice(0, 7),
    factuurdatum: d(r.factuurdatum) ?? '', bedrag_excl: n(r.bedrag_excl) ?? 0, btw_pct: n(r.btw_pct) ?? 21,
    status: (['gepland', 'gefactureerd', 'betaald', 'geannuleerd'].includes(String(r.status)) ? r.status : 'gepland') as TermijnStatus,
    betaald_op: d(r.betaald_op), invoice_id: (r.invoice_id as string | null) ?? null,
    clickup_task_id: (r.clickup_task_id as string | null) ?? null, notitie: (r.notitie as string | null) ?? null,
  }
}
function naarModuleContract(r: Record<string, unknown>): ModuleContract {
  const c = r.clients as { company_name?: string | null } | { company_name?: string | null }[] | null | undefined
  const klant = Array.isArray(c) ? (c[0]?.company_name ?? null) : (c?.company_name ?? null)
  return {
    id: String(r.id), titel: String(r.title ?? 'Contract'), status: String(r.status ?? 'draft'),
    client_id: (r.client_id as string | null) ?? null, klant: klant ?? null,
    start_date: d(r.start_date), end_date: d(r.end_date), signed_at: d(r.signed_at), service_slug: (r.service_slug as string | null) ?? null,
  }
}
function naarKost(r: Record<string, unknown>): WamKost {
  return { id: String(r.id), datum: d(r.datum), omschrijving: String(r.omschrijving ?? ''), bedrag: n(r.bedrag) ?? 0 }
}

const ERKENNING_STIJL: Record<Erkenning, string> = {
  voorlopig: 'bg-amber-100 text-amber-800', definitief: 'bg-green-100 text-green-800',
  uitgesloten: 'bg-red-100 text-red-700', onvolledig: 'bg-gray-100 text-gray-600',
}

export function VestingClient({ instellingenRij, contractRijen, wamRijen, kostRijen, oudeRegistraties, termijnRijen = [], moduleContracten = [], klanten = [] }: {
  instellingenRij: Record<string, unknown> | null
  contractRijen: Record<string, unknown>[]
  wamRijen: Record<string, unknown>[]
  kostRijen: Record<string, unknown>[]
  oudeRegistraties: Record<string, unknown>[]
  termijnRijen?: Record<string, unknown>[]
  moduleContracten?: Record<string, unknown>[]
  klanten?: Klant[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overzicht')
  const [contractDialoog, setContractDialoog] = useState<Contract | 'nieuw' | null>(null)
  const [wamDialoog, setWamDialoog] = useState<WamRij | 'nieuw' | null>(null)
  const [kostDialoog, setKostDialoog] = useState<WamKost | 'nieuw' | null>(null)
  const [openWam, setOpenWam] = useState<string | null>(null)
  const [extraTermijn, setExtraTermijn] = useState<WamRij | null>(null)

  const inst = useMemo(() => leesInstellingen(instellingenRij), [instellingenRij])
  const contracten = useMemo(() => contractRijen.map(naarContract), [contractRijen])
  const wam = useMemo(() => wamRijen.map(naarWam), [wamRijen])
  const kosten = useMemo(() => kostRijen.map(naarKost), [kostRijen])
  const termijnen = useMemo(() => termijnRijen.map(naarTermijn), [termijnRijen])
  const module = useMemo(() => moduleContracten.map(naarModuleContract), [moduleContracten])
  const modulePerId = useMemo(() => new Map(module.map((m) => [m.id, m])), [module])
  const v = useMemo(() => berekenVesting(contracten, wam, kosten, inst, termijnen), [contracten, wam, kosten, inst, termijnen])

  const verwijder = async (resource: 'contract' | 'wam' | 'kost', id: string, naam: string) => {
    if (!confirm(`"${naam}" verwijderen? Dit is niet terug te draaien.`)) return
    const r = await fetch(`/api/admin/vesting?resource=${resource}&id=${id}`, { method: 'DELETE' })
    const j = await r.json()
    if (!r.ok) { toast.error(j.error ?? 'Verwijderen mislukt'); return }
    toast.success('Verwijderd.')
    router.refresh()
  }

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'overzicht', label: 'Overzicht', icon: Rocket },
    { key: 'contracten', label: `Contracten (${contracten.length})`, icon: Briefcase },
    { key: 'wam', label: 'WAM-portefeuille', icon: Layers },
    { key: 'jaren', label: 'Per contractjaar', icon: CalendarRange },
    { key: 'instellingen', label: 'Instellingen', icon: Settings2 },
  ]

  const balk = Math.min(100, (v.marcoVoorlopig / inst.max_aandeel_marco) * 100)
  const balkDef = Math.min(100, (v.marcoDefinitief / inst.max_aandeel_marco) * 100)

  // Oude registraties die niet in het register terugkomen. Ze tellen niet mee;
  // de klantnaam is de enige brug, dus dit is een hint en geen zekerheid.
  // "TM Technics BV" en "TM Technics" zijn hetzelfde bedrijf: rechtsvorm en
  // leestekens tellen niet mee bij het vergelijken.
  const kern = (naam: string) => naam.toLowerCase()
    .replace(/\b(bvba|bv|nv|vof|comm\.?v|cv|srl|sprl|sa|gcv|vzw)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim()
  const klantenInRegister = new Set(contracten.map((c) => kern(c.klant)))
  const nietOvergenomen = oudeRegistraties.filter((r) => !klantenInRegister.has(kern(String(r.client_name ?? ''))))

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Vesting</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Het vestigingsprincipe uit de samenwerkingsovereenkomst — uitsluitend informatief, wijzigt geen aandelen.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <ExportKnop werkmap={() => vestingWerkmap({ v, inst, kosten, tab: TABS.find((t) => t.key === tab)?.label })} />
          <button onClick={() => { setTab('contracten'); setContractDialoog('nieuw') }} className="btn-primary text-sm">
            <Plus className="h-4 w-4" />Contract toevoegen
          </button>
        </div>
      </div>

      <div className="border-b border-gray-200 -mb-px overflow-x-auto">
        <div className="flex gap-1 min-w-max">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                tab === t.key ? 'border-black text-black' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              <t.icon className="h-3.5 w-3.5" />{t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══ OVERZICHT ══════════════════════════════════════════════════════ */}
      {tab === 'overzicht' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi label="Meetellende contractwaarde" value={formatEuro(v.meetellendeWaarde)} sub="WAM netto + contracten" />
            <Kpi label="Marco voorlopig" value={pct(v.marcoVoorlopig)} sub={`van maximaal ${pct(inst.max_aandeel_marco)}`} color="text-amber-700" />
            <Kpi label="Marco definitief" value={pct(v.marcoDefinitief)} sub="enkel voltooide contracten" color="text-green-700" />
            <Kpi label="Uitgevallen waarde" value={formatEuro(v.uitgevallenWaarde)} sub="stopgezet, niet betaald, WAM-kosten" color="text-red-600" />
          </div>

          {/* Aandeelhouders */}
          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Actuele aandelenverdeling (voorlopig)</div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="stat-card"><div className="font-semibold mb-1">Bram Reinquin</div><div className="text-2xl font-bold">{pct(v.bram)}</div><div className="text-xs text-gray-400 mt-1">start {pct(inst.startaandeel_bram)} · krijgt wat Marco niet verwerft</div></div>
              <div className="stat-card"><div className="font-semibold mb-1">Chiara Walmagh</div><div className="text-2xl font-bold">{pct(v.chiara)}</div><div className="text-xs text-gray-400 mt-1">vast — wijzigt nooit</div></div>
              <div className="stat-card border-[#fff848]"><div className="font-semibold mb-1">Marco Castermans</div><div className="text-2xl font-bold">{pct(v.marcoVoorlopig)}</div><div className="text-xs text-gray-400 mt-1">definitief {pct(v.marcoDefinitief)} · maximum {pct(inst.max_aandeel_marco)}</div></div>
            </div>
          </div>

          {/* Voortgang */}
          <div className="card-base">
            <h2 className="font-semibold mb-1 flex items-center gap-2"><Rocket className="h-4 w-4 text-[#c5b800]" />Vestigingsprogressie Marco</h2>
            <p className="text-xs text-gray-400 mb-4">
              WAM {pct(v.wam.voorlopig)} + contracten {pct(Math.max(0, v.marcoVoorlopig - v.wam.voorlopig))}. Hele procenten, afgekapt — zo staat het in de overeenkomst.
            </p>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden relative">
              <div className="h-full bg-[#fff848] rounded-full absolute left-0 top-0" style={{ width: `${balk}%` }} />
              <div className="h-full bg-green-500 rounded-full absolute left-0 top-0" style={{ width: `${balkDef}%` }} />
            </div>
            <div className="flex justify-between text-[11px] text-gray-400 mt-1"><span>0%</span><span>{pct(inst.max_aandeel_marco)}</span></div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <Box label="Voorlopig" value={pct(v.marcoVoorlopig)} />
              <Box label="Definitief" value={pct(v.marcoDefinitief)} color="text-green-700" />
              <Box label="Nog te verwerven" value={pct(Math.max(0, inst.max_aandeel_marco - v.marcoVoorlopig))} />
              <Box label="Tot de volgende %"
                value={v.volgendeProcent ? formatEuro(v.volgendeProcent.nodig) : 'Maximum'}
                sub={v.volgendeProcent ? `aan ${formatEuro(v.volgendeProcent.tarief)} per %` : undefined} color="text-amber-700" />
            </div>
            <p className="text-[11px] text-gray-500 mt-3">
              Legenda: groen = definitief (voltooide contracten), geel = voorlopig (actieve contracten erbij).
            </p>
          </div>

          {/* Per contractjaar, kort */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-base">
              <h2 className="font-semibold mb-3">Samenvatting per contractjaar</h2>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-gray-100">
                  <th className="table-th">Jaar</th><th className="table-th text-right">Meetellend</th><th className="table-th text-right">Tarief &gt;{pct(inst.einde_goedkope_schijf)}</th><th className="table-th text-right">Ruwe vesting</th><th className="table-th text-right">#</th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {v.perJaar.map((j) => (
                    <tr key={j.jaar}>
                      <td className="table-td font-medium">{j.label}</td>
                      <td className="table-td text-right tabular">{formatEuro(j.meetellend)}</td>
                      <td className="table-td text-right tabular text-gray-500">{j.tarief ? formatEuro(j.tarief) : '—'}</td>
                      <td className="table-td text-right tabular">{pct(j.ruweVesting, 2)}</td>
                      <td className="table-td text-right tabular">{j.aantal}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="card-base">
              <h2 className="font-semibold mb-3">WAM-portefeuille</h2>
              <div className="grid grid-cols-2 gap-3">
                <Box label="Prognose omzet" value={formatEuro(v.wam.prognose)} sub={v.wam.openstaand > 0 ? `${formatEuro(v.wam.openstaand)} openstaand` : undefined} />
                <Box label="Effectief ontvangen" value={formatEuro(v.wam.nettoOntvangen)} color="text-green-700" />
                <Box label="Kosten bij WAM" value={formatEuro(v.wam.kosten)} color="text-red-600" />
                <Box label="Netto meetellend" value={formatEuro(v.wam.nettoMeetellend)} />
                <Box label="Aandeel via WAM" value={`${pct(v.wam.voorlopig)} · def. ${pct(v.wam.definitief)}`} />
              </div>
              <p className="text-[11px] text-gray-500 mt-3">
                Elke volle {formatEuro(inst.wam_bedrag_per_pct)} netto = 1%, tot {pct(inst.wam_max_aandeel)}.{' '}
                {v.wam.volgendeDrempel !== null
                  ? <>Volgende drempel: {formatEuro(v.wam.volgendeDrempel)} netto.</>
                  : <>Maximum bereikt.</>}
              </p>
            </div>
          </div>

          {/* Oude registraties */}
          {nietOvergenomen.length > 0 && (
            <div className="card-base border-amber-200 bg-amber-50/40">
              <h2 className="font-semibold mb-1 flex items-center gap-2 text-amber-900"><Archive className="h-4 w-4" />Oude registraties die niet in het contractenregister staan</h2>
              <p className="text-xs text-amber-800 mb-3">
                Uit de vorige versie van dit scherm. Ze tellen <b>niet</b> mee. Hoort er een thuis in het register, voeg hem dan toe als contract met de juiste ondertekeningsdatum en status.
              </p>
              <table className="w-full text-sm">
                <thead><tr className="border-b border-amber-200/60">
                  <th className="table-th">Datum</th><th className="table-th">Klant</th><th className="table-th">Dienst</th><th className="table-th text-right">Omzet</th><th className="table-th text-right">Toerekening</th>
                </tr></thead>
                <tbody className="divide-y divide-amber-100">
                  {nietOvergenomen.map((r) => (
                    <tr key={String(r.id)}>
                      <td className="table-td text-gray-500">{formatDate(String(r.entry_date ?? ''))}</td>
                      <td className="table-td font-medium">{String(r.client_name ?? '—')}</td>
                      <td className="table-td text-gray-500">{String(r.service_slug ?? '—')}</td>
                      <td className="table-td text-right tabular">{formatEuro(Number(r.net_revenue ?? 0))}</td>
                      <td className="table-td text-right tabular">{Number(r.attribution_pct ?? 0)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="card-base bg-amber-50/40 border-amber-200/60">
            <p className="text-sm text-amber-800"><strong>Disclaimer.</strong> Dit scherm is uitsluitend informatief en wijzigt geen echte aandelen. Het toont enkel de berekening van het vestigingsprincipe uit de samenwerkingsovereenkomst.</p>
          </div>
        </div>
      )}

      {/* ══ CONTRACTEN ═════════════════════════════════════════════════════ */}
      {tab === 'contracten' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            De ondertekeningsdatum bepaalt het contractjaar en vergrendelt het tarief. Actief = voorlopig; voltooid = definitief;
            vroegtijdig stopgezet of niet-betaler = €0. De goedkope schijf wordt chronologisch opgebruikt.
          </p>
          <div className="card-base p-0 overflow-hidden">
            {v.contracten.length === 0 ? (
              <div className="empty-state text-sm">Nog geen contracten.</div>
            ) : (
              <div className="table-wrap">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100">
                    <th className="table-th">Contract</th>
                    <th className="table-th">Ondertekend</th>
                    <th className="table-th">Dienst</th>
                    <th className="table-th text-right">Netto</th>
                    <th className="table-th text-right">Factor</th>
                    <th className="table-th text-right">Meetellend</th>
                    <th className="table-th text-right">Vesting</th>
                    <th className="table-th">Status</th>
                    <th className="table-th w-16"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {v.contracten.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setContractDialoog(c)}>
                        <td className="table-td">
                          <div className="font-medium">{c.klant}</div>
                          <div className="text-[11px] text-gray-500 font-mono">{c.nr}</div>
                          {c.contract_id && (
                            <Link href={`/admin/contracts/${c.contract_id}`} onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[11px] text-blue-700 hover:underline mt-0.5" title="Open in de Contractenmodule">
                              <Link2 className="h-3 w-3" />{modulePerId.get(c.contract_id)?.titel ?? 'Contract'}
                              {modulePerId.get(c.contract_id)?.status && <span className="text-gray-400">· {CONTRACT_STATUS_LABEL[modulePerId.get(c.contract_id)!.status] ?? modulePerId.get(c.contract_id)!.status}</span>}
                            </Link>
                          )}
                        </td>
                        <td className="table-td">
                          <div className="text-gray-700 whitespace-nowrap">{formatDate(c.ondertekend_op)}</div>
                          <span className={`status-badge mt-0.5 ${c.jaar === 'buiten' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{JAAR_LABEL[c.jaar]}</span>
                        </td>
                        <td className="table-td text-gray-600">
                          {c.dienst ?? '—'}
                          <div className="text-[11px] text-gray-400 whitespace-nowrap">
                            {c.facturatiemodel === 'maandcontract' ? `${formatEuro(c.maandbedrag ?? 0)} × ${c.duur ?? '?'} mnd` : 'eenmalig'}
                          </div>
                        </td>
                        <td className="table-td text-right tabular whitespace-nowrap">
                          {c.netto === null ? <span className="text-red-600">ontbreekt</span> : formatEuro(c.netto)}
                          {c.totaal !== null && c.netto !== null && c.totaal !== c.netto && (
                            <div className="text-[11px] text-gray-400">van {formatEuro(c.totaal)}</div>
                          )}
                        </td>
                        <td className="table-td text-right tabular">{Math.round(c.factor * 100)}%</td>
                        <td className="table-td text-right tabular font-semibold whitespace-nowrap"
                          title={`Goedkope schijf ${formatEuro(c.goedkopeSchijf)} · jaarschijf ${formatEuro(c.jaarschijf)} · cumulatief vóór dit contract ${formatEuro(c.cumulatiefVoor)}`}>
                          {formatEuro(c.meetellend)}
                          {c.jaarschijf > 0 && <div className="text-[11px] text-gray-400 font-normal">{formatEuro(c.jaarschijf)} aan jaartarief</div>}
                        </td>
                        <td className="table-td text-right tabular">{pct(c.ruweVesting, 2)}</td>
                        <td className="table-td">
                          <span className={`status-badge ${ERKENNING_STIJL[c.erkenning]}`}>{ERKENNING_LABEL[c.erkenning]}</span>
                          <div className="text-[11px] text-gray-500 mt-0.5">{STATUS_LABEL[c.status]}{!c.betalingen_op_schema && ' · betalingen achter'}</div>
                          {c.status !== 'actief' && c.status !== 'voltooid' && c.uitgevallen > 0 && (
                            <div className="text-[11px] text-red-600">{formatEuro(c.uitgevallen)} uitgevallen{c.betaaldeMaanden !== null ? ` · ${c.betaaldeMaanden} mnd betaald` : ' · stopinfo ontbreekt'}</div>
                          )}
                        </td>
                        <td className="table-td" onClick={(e) => e.stopPropagation()}>
                          <div className="flex gap-1 justify-end">
                            <button onClick={() => setContractDialoog(c)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Wijzigen"><Pencil className="h-3.5 w-3.5" /></button>
                            <button onClick={() => verwijder('contract', c.id, `${c.nr} ${c.klant}`)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ WAM ════════════════════════════════════════════════════════════ */}
      {tab === 'wam' && (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-sm text-gray-500 max-w-2xl">
              Marco's eigen klanten van vóór de samenwerking. Elke volledige {formatEuro(inst.wam_bedrag_per_pct)} netto ontvangen levert 1% op,
              met maximaal {pct(inst.wam_max_aandeel)}. Kosten bij WAM worden hiervan afgetrokken.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setKostDialoog('nieuw')} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Kost</button>
              <button onClick={() => setWamDialoog('nieuw')} className="btn-primary text-sm"><Plus className="h-4 w-4" />WAM-klant</button>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Box label="Prognose omzet" value={formatEuro(v.wam.prognose)} sub="historiek + alle termijnen" />
            <Box label="Gefactureerd" value={formatEuro(v.wam.gefactureerd)} sub="termijnen met een factuur" color="text-blue-700" />
            <Box label="Effectief ontvangen" value={formatEuro(v.wam.nettoOntvangen)} sub="historiek + betaalde termijnen — dit telt" color="text-green-700" />
            <Box label="Openstaand" value={formatEuro(v.wam.openstaand)} sub="gefactureerd, nog niet betaald" color={v.wam.openstaand > 0 ? 'text-amber-700' : undefined} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Box label="Kosten bij WAM" value={formatEuro(v.wam.kosten)} color="text-red-600" />
            <Box label="Netto meetellend" value={formatEuro(v.wam.nettoMeetellend)} />
            <Box label="Voorlopig aandeel" value={pct(v.wam.voorlopig)} color="text-amber-700" />
            <Box label="Definitief aandeel" value={pct(v.wam.definitief)} color="text-green-700" />
            <Box label="Volgende drempel" value={v.wam.volgendeDrempel === null ? 'Maximum' : formatEuro(v.wam.volgendeDrempel)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card-base p-0 overflow-hidden lg:col-span-2">
              <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold flex items-center justify-between">
                <span>Klanten</span>
                <span className="text-[11px] font-normal text-gray-400">Klik een klant open voor de termijnen en facturen.</span>
              </div>
              {v.wam.rijen.length === 0 ? <div className="empty-state text-sm">Nog geen WAM-klanten.</div> : (
                <div className="table-wrap"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100">
                    <th className="table-th w-6"></th><th className="table-th">Klant</th><th className="table-th text-right">Prognose</th><th className="table-th text-right">Gefactureerd</th><th className="table-th text-right">Ontvangen</th><th className="table-th text-right">Meetellend</th><th className="table-th">Status</th><th className="table-th w-16"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {v.wam.rijen.map((r) => {
                      const open = openWam === r.id
                      const freq = FREQUENTIES.find((f) => f.key === r.frequentie)
                      return (
                        <WamRijen key={r.id}>
                          <tr className={`cursor-pointer ${open ? 'bg-[#fff848]/20' : 'hover:bg-gray-50'}`} onClick={() => setOpenWam(open ? null : r.id)}>
                            <td className="table-td text-gray-400">{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                            <td className="table-td">
                              <div className="font-medium">{r.klant}</div>
                              <div className="text-[11px] text-gray-500">
                                <span className="font-mono">{r.nr}</span>
                                {freq && r.bedrag_per_factuur ? <> · {formatEuro(r.bedrag_per_factuur)} {freq.label.toLowerCase()}{r.contract_maanden ? ` · ${r.contract_maanden} mnd` : ''}</> : <> · geen facturatieschema</>}
                              </div>
                            </td>
                            <td className="table-td text-right tabular">{formatEuro(r.prognose > 0 ? r.prognose : r.contractwaarde)}</td>
                            <td className="table-td text-right tabular text-blue-800">{formatEuro(r.gefactureerd)}{r.openstaand > 0 && <div className="text-[11px] text-amber-700">{formatEuro(r.openstaand)} open</div>}</td>
                            <td className="table-td text-right tabular text-green-800">{formatEuro(r.ontvangen)}{r.netto_ontvangen > 0 && r.betaald > 0 && <div className="text-[11px] text-gray-400">waarvan {formatEuro(r.netto_ontvangen)} historiek</div>}</td>
                            <td className="table-td text-right tabular font-semibold">{formatEuro(r.meetellend)}</td>
                            <td className="table-td"><span className={`status-badge ${ERKENNING_STIJL[r.erkenning]}`}>{ERKENNING_LABEL[r.erkenning]}</span><div className="text-[11px] text-gray-500 mt-0.5">{STATUS_LABEL[r.status]}</div></td>
                            <td className="table-td" onClick={(e) => e.stopPropagation()}>
                              <div className="flex gap-1 justify-end">
                                <button onClick={() => setWamDialoog(r)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Wijzigen"><Pencil className="h-3.5 w-3.5" /></button>
                                <button onClick={() => verwijder('wam', r.id, `${r.nr} ${r.klant}`)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                              </div>
                            </td>
                          </tr>
                        </WamRijen>
                      )
                    })}
                  </tbody>
                </table></div>
              )}
            </div>
            <div className="card-base p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold">Kosten bij WAM</div>
              {kosten.length === 0 ? <div className="empty-state text-sm">Geen kosten.</div> : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-50">
                    {kosten.map((k) => (
                      <tr key={k.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setKostDialoog(k)}>
                        <td className="table-td"><div>{k.omschrijving}</div><div className="text-[11px] text-gray-500">{k.datum ? formatDate(k.datum) : '—'}</div></td>
                        <td className="table-td text-right tabular text-red-600">{formatEuro(k.bedrag)}</td>
                        <td className="table-td" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => verwijder('kost', k.id, k.omschrijving)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {openWam && (() => {
            const r = v.wam.rijen.find((x) => x.id === openWam)
            return r ? (
              <div className="card-base">
                <Termijnen rij={r} onExtra={() => setExtraTermijn(r)} />
              </div>
            ) : null
          })()}
        </div>
      )}

      {/* ══ PER CONTRACTJAAR ═══════════════════════════════════════════════ */}
      {tab === 'jaren' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            De ondertekeningsdatum bepaalt definitief onder welk jaar een opdracht valt. De uitvoerings- of facturatiedatum verandert het tarief niet.
          </p>
          <div className="card-base p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100">
                <th className="table-th">Contractjaar</th><th className="table-th">Periode ondertekening</th><th className="table-th text-right">Tarief boven {pct(inst.einde_goedkope_schijf)}</th><th className="table-th text-right">Meetellende omzet</th><th className="table-th text-right">Ruwe vesting</th><th className="table-th text-right">Contracten</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {v.perJaar.map((j) => (
                  <tr key={j.jaar}>
                    <td className="table-td font-medium">{j.label}</td>
                    <td className="table-td text-gray-600">{j.periode ? `${formatDate(j.periode.van)} t.e.m. ${formatDate(j.periode.tot)}` : '—'}</td>
                    <td className="table-td text-right tabular">{j.tarief ? formatEuro(j.tarief) : '—'}</td>
                    <td className="table-td text-right tabular font-semibold">{formatEuro(j.meetellend)}</td>
                    <td className="table-td text-right tabular">{pct(j.ruweVesting, 2)}</td>
                    <td className="table-td text-right tabular">{j.aantal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="card-base p-0 overflow-hidden">
            <div className="table-wrap"><table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100">
                <th className="table-th">Nr.</th><th className="table-th">Klant</th><th className="table-th">Ondertekend</th><th className="table-th">Jaar</th><th className="table-th">Dienst</th><th className="table-th">Model</th><th className="table-th text-right">Maandbedrag</th><th className="table-th text-right">Duur</th><th className="table-th text-right">Totaal</th><th className="table-th text-right">Factor</th><th className="table-th text-right">Meetellend</th><th className="table-th">Erkenning</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {v.contracten.map((c) => (
                  <tr key={c.id}>
                    <td className="table-td font-mono text-xs">{c.nr}</td><td className="table-td font-medium">{c.klant}</td>
                    <td className="table-td text-gray-600">{formatDate(c.ondertekend_op)}</td><td className="table-td">{JAAR_LABEL[c.jaar]}</td>
                    <td className="table-td text-gray-600">{c.dienst ?? '—'}</td><td className="table-td text-gray-600">{c.facturatiemodel === 'maandcontract' ? 'Maandcontract' : 'Eenmalig project'}</td>
                    <td className="table-td text-right tabular">{c.maandbedrag !== null ? formatEuro(c.maandbedrag) : '—'}</td>
                    <td className="table-td text-right tabular">{c.duur ?? '—'}</td>
                    <td className="table-td text-right tabular">{c.totaal !== null ? formatEuro(c.totaal) : '—'}</td>
                    <td className="table-td text-right tabular">{Math.round(c.factor * 100)}%</td>
                    <td className="table-td text-right tabular font-semibold">{formatEuro(c.meetellend)}</td>
                    <td className="table-td"><span className={`status-badge ${ERKENNING_STIJL[c.erkenning]}`}>{ERKENNING_LABEL[c.erkenning]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </div>
      )}

      {/* ══ INSTELLINGEN ═══════════════════════════════════════════════════ */}
      {tab === 'instellingen' && <Instellingen inst={inst} />}

      {contractDialoog && (
        <ContractDialoog contract={contractDialoog === 'nieuw' ? null : contractDialoog} inst={inst} module={module}
          onClose={() => setContractDialoog(null)} />
      )}
      {wamDialoog && <WamDialoog rij={wamDialoog === 'nieuw' ? null : wamDialoog} klanten={klanten} onClose={() => setWamDialoog(null)} />}
      {extraTermijn && <ExtraTermijnDialoog rij={extraTermijn} onClose={() => setExtraTermijn(null)} />}
      {kostDialoog && <KostDialoog rij={kostDialoog === 'nieuw' ? null : kostDialoog} onClose={() => setKostDialoog(null)} />}
    </div>
  )
}

// ── Contractformulier ────────────────────────────────────────────────────────

function ContractDialoog({ contract, inst, module, onClose }: { contract: Contract | null; inst: VestingInstellingen; module: ModuleContract[]; onClose: () => void }) {
  const sluit = useSluitNaVerversen(onClose)
  const vandaag = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({
    nr: contract?.nr ?? '', klant: contract?.klant ?? '', contract_id: contract?.contract_id ?? '',
    ondertekend_op: contract?.ondertekend_op ?? vandaag,
    start_dienst: contract?.start_dienst ?? '', einde_dienst: contract?.einde_dienst ?? '',
    dienst: contract?.dienst ?? 'Social media management',
    facturatiemodel: contract?.facturatiemodel ?? 'maandcontract',
    maandbedrag: contract?.maandbedrag?.toString() ?? '', duur_maanden: contract?.duur_maanden?.toString() ?? '',
    handmatige_totaalwaarde: contract?.handmatige_totaalwaarde?.toString() ?? '',
    uitgesloten_kosten: contract?.uitgesloten_kosten?.toString() ?? '0',
    status: contract?.status ?? 'actief',
    betalingen_op_schema: contract?.betalingen_op_schema ?? true,
    appointment_door_marco: contract?.appointment_door_marco ?? true,
    closed_door_marco: contract?.closed_door_marco ?? false,
    laatste_betaalde_maand: contract?.laatste_betaalde_maand ?? '',
    reden_stop: contract?.reden_stop ?? '', notitie: contract?.notitie ?? '',
  })
  const [bezig, setBezig] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))

  // Meelezen: wat wordt dit contract waard, en hoeveel telt er mee?
  const totaal = totaalwaarde({
    facturatiemodel: f.facturatiemodel as 'maandcontract' | 'eenmalig',
    maandbedrag: n(f.maandbedrag), duur_maanden: n(f.duur_maanden), handmatige_totaalwaarde: n(f.handmatige_totaalwaarde),
    start_dienst: f.start_dienst || null, einde_dienst: f.einde_dienst || null,
  })
  const factor = toerekeningsfactor({ appointment_door_marco: f.appointment_door_marco, closed_door_marco: f.closed_door_marco })
  const netto = totaal === null ? null : Math.max(0, totaal - (n(f.uitgesloten_kosten) ?? 0))
  const afgeleideDuur = duurUitData(f.start_dienst || null, f.einde_dienst || null)
  const gestopt = f.status === 'stopgezet' || f.status === 'niet_betaler'
  const gekoppeld = module.find((m) => m.id === f.contract_id) ?? null

  // Koppelen aan een contract uit de Contractenmodule: wat daar al ingevuld is,
  // nemen we over — maar nooit over iets heen dat hier al is ingetypt.
  const koppel = (id: string) => {
    const m = module.find((x) => x.id === id)
    setF((p) => ({
      ...p, contract_id: id,
      klant: p.klant || m?.klant || '',
      ondertekend_op: m?.signed_at && (!contract || !p.ondertekend_op || p.ondertekend_op === vandaag) ? m.signed_at : p.ondertekend_op,
      start_dienst: p.start_dienst || m?.start_date || '',
      einde_dienst: p.einde_dienst || m?.end_date || '',
    }))
  }
  const moduleOpties = [{ v: '', l: '— Geen koppeling —' }, ...module
    .slice().sort((a, b) => (a.klant ?? '').localeCompare(b.klant ?? '') || a.titel.localeCompare(b.titel))
    .map((m) => ({ v: m.id, l: `${m.klant ? m.klant + ' · ' : ''}${m.titel} (${CONTRACT_STATUS_LABEL[m.status] ?? m.status}${m.signed_at ? `, ${formatDate(m.signed_at)}` : ''})` }))]

  const bewaar = async () => {
    setBezig(true)
    try {
      const body: Record<string, unknown> = { resource: 'contract', ...f }
      if (!body.nr) delete body.nr
      if (contract) body.id = contract.id
      const r = await fetch('/api/admin/vesting', { method: contract ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(contract ? 'Contract bijgewerkt.' : 'Contract toegevoegd.')
      sluit()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt'); setBezig(false) }
  }

  return (
    <Dialoog titel={contract ? `${contract.nr} — ${contract.klant}` : 'Nieuw contract'} onClose={onClose} onSave={bewaar} bezig={bezig} breed>
      <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3 space-y-2">
        <Keuze label="Contract uit de Contractenmodule" value={f.contract_id} onChange={koppel} opties={moduleOpties} />
        <p className="text-[11px] text-gray-500 flex items-center gap-1.5 flex-wrap">
          <Link2 className="h-3 w-3" />
          {gekoppeld ? (
            <>Gekoppeld aan <Link href={`/admin/contracts/${gekoppeld.id}`} className="text-blue-700 hover:underline inline-flex items-center gap-0.5">{gekoppeld.titel}<ExternalLink className="h-3 w-3" /></Link>
              {gekoppeld.klant ? ` van ${gekoppeld.klant}` : ''} — klant, ondertekening en looptijd worden overgenomen als ze hier nog leeg zijn.</>
          ) : <>Koppel dit vestingcontract aan het echte contract, zodat status, ondertekening en facturen op één plek te volgen zijn.</>}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Veld label="Klant *" value={f.klant} onChange={(v) => set('klant', v)} />
        <Veld label="Contractnr." value={f.nr} onChange={(v) => set('nr', v)} placeholder="automatisch" />
        <Veld label="Ondertekend op *" type="date" value={f.ondertekend_op} onChange={(v) => set('ondertekend_op', v)}
          hint="Bepaalt het contractjaar en vergrendelt het tarief." />
        <Keuze label="Dienst" value={f.dienst} onChange={(v) => set('dienst', v)} opties={DIENSTEN.map((x) => ({ v: x, l: x }))} />
        <Veld label="Start dienst" type="date" value={f.start_dienst} onChange={(v) => set('start_dienst', v)} />
        <Veld label="Einde dienst" type="date" value={f.einde_dienst} onChange={(v) => set('einde_dienst', v)} />
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 space-y-3">
        <Schakel label="Facturatiemodel" value={f.facturatiemodel}
          opties={[{ v: 'maandcontract', l: 'Maandcontract' }, { v: 'eenmalig', l: 'Eenmalig project' }]}
          onChange={(v) => set('facturatiemodel', v as 'maandcontract' | 'eenmalig')} />
        {f.facturatiemodel === 'maandcontract' ? (
          <div className="grid grid-cols-2 gap-3">
            <Veld label="Maandbedrag (€ excl. btw)" value={f.maandbedrag} onChange={(v) => set('maandbedrag', v)} inputMode="decimal" />
            <Veld label="Duur (maanden)" value={f.duur_maanden} onChange={(v) => set('duur_maanden', v)} inputMode="decimal"
              placeholder={afgeleideDuur !== null ? `${afgeleideDuur} uit de data` : ''} hint="Leeg = afgeleid uit start en einde." />
          </div>
        ) : (
          <Veld label="Totaalwaarde (€ excl. btw)" value={f.handmatige_totaalwaarde} onChange={(v) => set('handmatige_totaalwaarde', v)} inputMode="decimal" />
        )}
        <Veld label="Uitgesloten kosten (€)" value={f.uitgesloten_kosten} onChange={(v) => set('uitgesloten_kosten', v)} inputMode="decimal"
          hint="Doorgerekende kosten die niet als omzet tellen." />
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 space-y-3">
        <div className="text-xs font-semibold text-gray-700">Aandeel van Marco in het binnenhalen</div>
        <div className="grid grid-cols-2 gap-3">
          <JaNee label="Appointment door Marco?" value={f.appointment_door_marco} onChange={(v) => set('appointment_door_marco', v)} />
          <JaNee label="Closed door Marco?" value={f.closed_door_marco} onChange={(v) => set('closed_door_marco', v)} />
        </div>
        <p className="text-[11px] text-gray-500">Toerekeningsfactor: <b>{Math.round(factor * 100)}%</b> — 50% voor de afspraak, 50% voor het closen.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Keuze label="Status contract" value={f.status} onChange={(v) => set('status', v as ContractStatus)}
          opties={(Object.keys(STATUS_LABEL) as ContractStatus[]).map((k) => ({ v: k, l: STATUS_LABEL[k] }))} />
        <JaNee label="Betalingen op schema?" value={f.betalingen_op_schema} onChange={(v) => set('betalingen_op_schema', v)} />
      </div>
      {gestopt && (
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-3 space-y-3">
          <div className="text-xs font-semibold text-red-800 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Stopinfo — de waarde wordt €0 in de aandelenpot</div>
          <div className="grid grid-cols-2 gap-3">
            <Veld label="Laatste betaalde maand" type="date" value={f.laatste_betaalde_maand} onChange={(v) => set('laatste_betaalde_maand', v)} hint="Bepaalt wat er werkelijk ontvangen is vóór de stop." />
            <Veld label="Reden stop / wanbetaling" value={f.reden_stop} onChange={(v) => set('reden_stop', v)} />
          </div>
        </div>
      )}
      <Veld label="Notitie" value={f.notitie} onChange={(v) => set('notitie', v)} />

      {/* Wat dit contract oplevert, live. */}
      <div className="rounded-xl bg-[#fff848]/20 border border-yellow-300 p-3 text-sm grid grid-cols-3 gap-3">
        <div><div className="text-[11px] text-gray-500">Totaal</div><div className="font-semibold">{totaal === null ? '—' : formatEuro(totaal)}</div></div>
        <div><div className="text-[11px] text-gray-500">Netto kwalificerend</div><div className="font-semibold">{netto === null ? '—' : formatEuro(netto)}</div></div>
        <div><div className="text-[11px] text-gray-500">Meetellend</div><div className="font-semibold">{netto === null ? '—' : gestopt || !f.betalingen_op_schema ? formatEuro(0) : formatEuro(netto * factor)}</div></div>
      </div>
      <p className="text-[11px] text-gray-500">Jaartarieven: Jaar 1 {formatEuro(inst.jaar1_tarief)}, Jaar 2 {formatEuro(inst.jaar2_tarief)}, Jaar 3 {formatEuro(inst.jaar3_tarief)} per procent boven {pct(inst.einde_goedkope_schijf)}.</p>
    </Dialoog>
  )
}

function WamDialoog({ rij, klanten, onClose }: { rij: WamRij | null; klanten: Klant[]; onClose: () => void }) {
  const sluit = useSluitNaVerversen(onClose)
  const [f, setF] = useState({
    nr: rij?.nr ?? '', klant: rij?.klant ?? '', client_id: rij?.client_id ?? '',
    contractwaarde: rij?.contractwaarde?.toString() ?? '',
    netto_ontvangen: rij?.netto_ontvangen?.toString() ?? '', status: rij?.status ?? 'actief',
    betalingen_op_schema: rij?.betalingen_op_schema ?? true, notitie: rij?.notitie ?? '',
    start_datum: rij?.start_datum ?? '', contract_maanden: rij?.contract_maanden?.toString() ?? '',
    bedrag_per_factuur: rij?.bedrag_per_factuur?.toString() ?? '', frequentie: (rij?.frequentie ?? 'maandelijks') as Frequentie,
    btw_pct: rij?.btw_pct?.toString() ?? '21', omschrijving: rij?.omschrijving ?? '',
  })
  const [bezig, setBezig] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))

  // Klant uit het klantenbestand kiezen vult de naam in; een vrije naam mag ook.
  const kiesKlant = (id: string) => {
    const k = klanten.find((x) => x.id === id)
    setF((p) => ({ ...p, client_id: id, klant: k ? k.naam : p.klant }))
  }

  // Meelezen: hoeveel termijnen levert dit schema op, en wat is de prognose?
  const schema = wamSchema({
    start_datum: f.start_datum || null, contract_maanden: n(f.contract_maanden), bedrag_per_factuur: n(f.bedrag_per_factuur),
    frequentie: f.frequentie, btw_pct: n(f.btw_pct) ?? 21,
  })
  const prognoseSchema = schema.reduce((t, x) => t + x.bedrag_excl, 0)
  const historiek = n(f.netto_ontvangen) ?? 0
  const gefactureerdeTermijnen = rij ? null : 0 // enkel informatief bij nieuw

  const bewaar = async () => {
    setBezig(true)
    try {
      const body: Record<string, unknown> = { resource: 'wam', ...f }
      if (!body.nr) delete body.nr
      if (!body.client_id) body.client_id = null
      // Zonder schema geen prognose: contractwaarde = wat het schema oplevert, tenzij bewust anders ingevuld.
      if (!body.contractwaarde && prognoseSchema > 0) body.contractwaarde = prognoseSchema + historiek
      if (rij) body.id = rij.id
      const r = await fetch('/api/admin/vesting', { method: rij ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(rij ? 'WAM-klant bijgewerkt — de geplande termijnen volgen het schema.' : 'WAM-klant toegevoegd met facturatieschema.')
      sluit()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt'); setBezig(false) }
  }
  return (
    <Dialoog titel={rij ? `${rij.nr} — ${rij.klant}` : 'Nieuwe WAM-klant'} onClose={onClose} onSave={bewaar} bezig={bezig} breed>
      <div className="grid grid-cols-2 gap-3">
        <Keuze label="Klant uit het klantenbestand" value={f.client_id} onChange={kiesKlant}
          opties={[{ v: '', l: '— Niet gekoppeld —' }, ...klanten.map((k) => ({ v: k.id, l: k.naam }))]} />
        <Veld label="Naam op de factuur *" value={f.klant} onChange={(v) => set('klant', v)} hint="Wordt ingevuld vanuit het klantenbestand; vrij aanpasbaar." />
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 space-y-3">
        <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5" />Facturatieschema</div>
        <div className="grid grid-cols-2 gap-3">
          <Veld label="Start facturatie" type="date" value={f.start_datum} onChange={(v) => set('start_datum', v)} hint="Datum van de eerste factuur." />
          <Veld label="Lengte contract (maanden)" value={f.contract_maanden} onChange={(v) => set('contract_maanden', v)} inputMode="decimal" placeholder={f.frequentie === 'eenmalig' ? 'n.v.t.' : 'bv. 12'} />
          <Veld label="Prijs per factuur (€ excl. btw)" value={f.bedrag_per_factuur} onChange={(v) => set('bedrag_per_factuur', v)} inputMode="decimal" />
          <Keuze label="Frequentie facturatie" value={f.frequentie} onChange={(v) => set('frequentie', v as Frequentie)} opties={FREQUENTIES.map((x) => ({ v: x.key, l: x.label }))} />
          <Veld label="Btw %" value={f.btw_pct} onChange={(v) => set('btw_pct', v)} inputMode="decimal" />
          <Veld label="Omschrijving op de factuur" value={f.omschrijving} onChange={(v) => set('omschrijving', v)} placeholder="bv. Websitebeheer" />
        </div>
        <div className="rounded-lg bg-white border border-gray-200 p-2.5 text-xs text-gray-600">
          {schema.length === 0 ? (
            <>Vul start, prijs en frequentie in (en de looptijd, tenzij eenmalig) — dan maakt de app de termijnen aan.</>
          ) : (
            <><b>{schema.length}</b> {schema.length === 1 ? 'termijn' : 'termijnen'} van {formatEuro(schema[0].bedrag_excl)} excl. btw, van {formatDate(schema[0].factuurdatum)} t.e.m. {formatDate(schema[schema.length - 1].factuurdatum)} — prognose <b>{formatEuro(prognoseSchema)}</b>{historiek > 0 ? <> + {formatEuro(historiek)} historiek = <b>{formatEuro(prognoseSchema + historiek)}</b></> : null}.
              {rij && <span className="block text-gray-400 mt-1">Termijnen die al gefactureerd of betaald zijn, blijven ongewijzigd.</span>}</>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Veld label="Al ontvangen vóór de app (€)" value={f.netto_ontvangen} onChange={(v) => set('netto_ontvangen', v)} inputMode="decimal" hint="Historiek: betalingen van vóór de facturatie via de app. Telt mee voor het aandeel." />
        <Veld label="Contractwaarde (€)" value={f.contractwaarde} onChange={(v) => set('contractwaarde', v)} inputMode="decimal" placeholder={prognoseSchema > 0 ? `${Math.round(prognoseSchema + historiek)} uit het schema` : ''} hint="Leeg = afgeleid uit het schema." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Keuze label="Status" value={f.status} onChange={(v) => set('status', v as ContractStatus)}
          opties={(Object.keys(STATUS_LABEL) as ContractStatus[]).map((k) => ({ v: k, l: STATUS_LABEL[k] }))} />
        <JaNee label="Betalingen op schema?" value={f.betalingen_op_schema} onChange={(v) => set('betalingen_op_schema', v)} />
      </div>
      <Veld label="Notitie" value={f.notitie} onChange={(v) => set('notitie', v)} />
      {gefactureerdeTermijnen === 0 && null}
    </Dialoog>
  )
}

/** De termijnen van één WAM-klant: factuur aanmaken, betaald zetten, annuleren. */
function Termijnen({ rij, onExtra }: { rij: WamRijBerekend; onExtra: () => void }) {
  const router = useRouter()
  const [bezig, setBezig] = useState<string | null>(null)
  // De pagina ververst server-side; dat duurt even. De knop blijft draaien
  // tot de nieuwe data er echt staat, anders lijkt de klik niets te doen.
  const [ververst, startVerversen] = useTransition()
  useEffect(() => { if (!ververst) setBezig(null) }, [ververst])

  const klaar = () => startVerversen(() => router.refresh())
  const patch = async (t: WamTermijn, body: Record<string, unknown>, melding: string) => {
    setBezig(t.id)
    try {
      const r = await fetch('/api/admin/vesting', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'termijn', id: t.id, ...body }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(melding); klaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); setBezig(null) }
  }
  const factureer = async (t: WamTermijn) => {
    if (!confirm(`Factuur aanmaken voor ${rij.klant} — termijn ${t.volgnr} (${t.periode}, ${formatEuro(t.bedrag_excl)} excl. btw)?\n\nDe factuur komt in Facturen en er wordt een ClickUp-taak aangemaakt.`)) return
    setBezig(t.id)
    try {
      const r = await fetch('/api/admin/vesting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'termijn', action: 'factuur', id: t.id }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      if (j.warning) toast.warning(j.warning)
      toast.success('Factuur aangemaakt — staat in Facturen en in ClickUp.'); klaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Factuur aanmaken mislukt'); setBezig(null) }
  }
  const verwijder = async (t: WamTermijn) => {
    if (!confirm(`Termijn ${t.volgnr} (${t.periode}) verwijderen?`)) return
    setBezig(t.id)
    try {
      const r = await fetch(`/api/admin/vesting?resource=termijn&id=${t.id}`, { method: 'DELETE' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Termijn verwijderd.'); klaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); setBezig(null) }
  }

  const knop = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-50'
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-semibold text-gray-900">Termijnen — {rij.klant}</div>
        <div className="flex items-center gap-3 text-[11px] text-gray-500">
          <span>Prognose <b className="text-gray-800">{formatEuro(rij.prognose)}</b></span>
          <span>Gefactureerd <b className="text-blue-800">{formatEuro(rij.gefactureerd)}</b></span>
          <span>Betaald <b className="text-green-800">{formatEuro(rij.betaald)}</b></span>
          {rij.openstaand > 0 && <span>Open <b className="text-amber-700">{formatEuro(rij.openstaand)}</b></span>}
          <button onClick={onExtra} className={`${knop} bg-white border-gray-200 text-gray-700 hover:border-gray-400`}><Plus className="h-3 w-3" />Extra termijn</button>
        </div>
      </div>
      {rij.termijnen.length === 0 ? (
        <div className="text-xs text-gray-500 py-2">Nog geen termijnen. Vul het facturatieschema in bij <button onClick={onExtra} className="underline">een losse termijn</button> of via <b>Wijzigen</b>.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100">
              <th className="table-th">#</th><th className="table-th whitespace-nowrap">Periode</th><th className="table-th whitespace-nowrap">Factuurdatum</th><th className="table-th text-right whitespace-nowrap">Excl. btw</th><th className="table-th text-right whitespace-nowrap">Incl. btw</th><th className="table-th">Status</th><th className="table-th">Factuur</th><th className="table-th text-right">Actie</th>
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {rij.termijnen.map((t) => {
                const incl = Math.round(t.bedrag_excl * (1 + t.btw_pct / 100) * 100) / 100
                const b = bezig === t.id
                return (
                  <tr key={t.id} className={t.status === 'geannuleerd' ? 'opacity-60' : ''}>
                    <td className="table-td font-mono">{t.volgnr}</td>
                    <td className="table-td whitespace-nowrap">{t.periode}</td>
                    <td className="table-td whitespace-nowrap">{formatDate(t.factuurdatum)}</td>
                    <td className="table-td text-right tabular">{formatEuro(t.bedrag_excl)}</td>
                    <td className="table-td text-right tabular text-gray-500">{formatEuro(incl)}</td>
                    <td className="table-td">
                      <span className={`status-badge ${TERMIJN_STIJL[t.status]}`}>{TERMIJN_LABEL[t.status]}</span>
                      {t.status === 'betaald' && t.betaald_op && <div className="text-[10px] text-gray-400 mt-0.5">op {formatDate(t.betaald_op)}</div>}
                    </td>
                    <td className="table-td">
                      {t.invoice_id ? (
                        <div className="flex items-center gap-2">
                          <Link href={`/admin/invoices?maand=${t.periode}`} className="text-blue-700 hover:underline inline-flex items-center gap-0.5"><Receipt className="h-3 w-3" />Facturen</Link>
                          {t.clickup_task_id && <a href={`https://app.clickup.com/t/${t.clickup_task_id}`} target="_blank" rel="noreferrer" className="text-gray-500 hover:underline inline-flex items-center gap-0.5">ClickUp<ExternalLink className="h-3 w-3" /></a>}
                        </div>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="table-td whitespace-nowrap">
                      <div className="flex gap-1 justify-end items-center">
                        {b && <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />}
                        {t.status === 'gepland' && (
                          <>
                            <button disabled={b} onClick={() => factureer(t)} className={`${knop} bg-black text-white border-black hover:bg-gray-800`}><Receipt className="h-3 w-3" />Factuur</button>
                            <button disabled={b} onClick={() => patch(t, { status: 'betaald' }, 'Termijn als betaald gemarkeerd.')} className={`${knop} bg-white border-gray-200 text-gray-600 hover:border-green-500 hover:text-green-700`} title="Betaald zonder factuur via de app (bv. al gefactureerd buiten de app)"><CheckCircle2 className="h-3 w-3" />Betaald</button>
                            <button disabled={b} onClick={() => verwijder(t)} className={`${knop} bg-white border-gray-200 text-gray-400 hover:text-red-600 hover:border-red-300`} title="Verwijderen"><Trash2 className="h-3 w-3" /></button>
                          </>
                        )}
                        {t.status === 'gefactureerd' && (
                          <>
                            <button disabled={b} onClick={() => patch(t, { status: 'betaald' }, 'Termijn als betaald gemarkeerd.')} className={`${knop} bg-green-600 text-white border-green-600 hover:bg-green-700`}><CheckCircle2 className="h-3 w-3" />Betaald</button>
                            <button disabled={b} onClick={() => { if (confirm('Termijn annuleren? De factuur wordt mee geannuleerd.')) patch(t, { status: 'geannuleerd' }, 'Termijn en factuur geannuleerd.') }} className={`${knop} bg-white border-gray-200 text-gray-500 hover:text-red-600 hover:border-red-300`}><Ban className="h-3 w-3" />Annuleer</button>
                          </>
                        )}
                        {t.status === 'betaald' && (
                          <button disabled={b} onClick={() => patch(t, { status: t.invoice_id ? 'gefactureerd' : 'gepland' }, 'Betaling teruggedraaid.')} className={`${knop} bg-white border-gray-200 text-gray-500 hover:border-gray-400`}><Undo2 className="h-3 w-3" />Toch niet betaald</button>
                        )}
                        {t.status === 'geannuleerd' && (
                          <button disabled={b} onClick={() => patch(t, { status: t.invoice_id ? 'gefactureerd' : 'gepland' }, 'Termijn hersteld.')} className={`${knop} bg-white border-gray-200 text-gray-500 hover:border-gray-400`}><Undo2 className="h-3 w-3" />Herstel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Een losse termijn buiten het schema (bv. een extra prestatie). */
function ExtraTermijnDialoog({ rij, onClose }: { rij: WamRij; onClose: () => void }) {
  const sluit = useSluitNaVerversen(onClose)
  const [f, setF] = useState({ factuurdatum: new Date().toISOString().slice(0, 10), bedrag_excl: rij.bedrag_per_factuur?.toString() ?? '', btw_pct: rij.btw_pct.toString(), notitie: '' })
  const [bezig, setBezig] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/vesting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'termijn', wam_id: rij.id, ...f, periode: f.factuurdatum.slice(0, 7) }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Termijn toegevoegd.'); sluit()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt'); setBezig(false) }
  }
  return (
    <Dialoog titel={`Extra termijn — ${rij.klant}`} onClose={onClose} onSave={bewaar} bezig={bezig}>
      <Veld label="Factuurdatum *" type="date" value={f.factuurdatum} onChange={(v) => set('factuurdatum', v)} />
      <div className="grid grid-cols-2 gap-3">
        <Veld label="Bedrag (€ excl. btw) *" value={f.bedrag_excl} onChange={(v) => set('bedrag_excl', v)} inputMode="decimal" />
        <Veld label="Btw %" value={f.btw_pct} onChange={(v) => set('btw_pct', v)} inputMode="decimal" />
      </div>
      <Veld label="Notitie" value={f.notitie} onChange={(v) => set('notitie', v)} placeholder="bv. extra pagina's" />
    </Dialoog>
  )
}

/** Fragment-wrapper zodat een klant twee tabelrijen mag zijn (rij + termijnen). */
function WamRijen({ children }: { children: React.ReactNode }) { return <>{children}</> }

function KostDialoog({ rij, onClose }: { rij: WamKost | null; onClose: () => void }) {
  const sluit = useSluitNaVerversen(onClose)
  const [f, setF] = useState({ datum: rij?.datum ?? new Date().toISOString().slice(0, 10), omschrijving: rij?.omschrijving ?? '', bedrag: rij?.bedrag?.toString() ?? '' })
  const [bezig, setBezig] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const bewaar = async () => {
    setBezig(true)
    try {
      const body: Record<string, unknown> = { resource: 'kost', ...f }
      if (rij) body.id = rij.id
      const r = await fetch('/api/admin/vesting', { method: rij ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Opgeslagen.'); sluit()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt'); setBezig(false) }
  }
  return (
    <Dialoog titel={rij ? 'Kost wijzigen' : 'Kost bij WAM'} onClose={onClose} onSave={bewaar} bezig={bezig}>
      <Veld label="Datum" type="date" value={f.datum} onChange={(v) => set('datum', v)} />
      <Veld label="Omschrijving *" value={f.omschrijving} onChange={(v) => set('omschrijving', v)} placeholder="bv. Afsluitkosten boekhouding" />
      <Veld label="Bedrag (€)" value={f.bedrag} onChange={(v) => set('bedrag', v)} inputMode="decimal" />
    </Dialoog>
  )
}

function Instellingen({ inst }: { inst: VestingInstellingen }) {
  const router = useRouter()
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(Object.entries(inst).map(([k, v]) => [k, String(v)])))
  const [bezig, setBezig] = useState(false)
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))
  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/vesting', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'instellingen', ...f }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Instellingen opgeslagen.'); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }
  const P = (k: string, label: string, hint?: string) => (
    <Veld label={label} value={f[k]} onChange={(v) => set(k, v)} inputMode="decimal" hint={hint} />
  )
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="card-base space-y-3">
          <h2 className="font-semibold">Aandelen</h2>
          <div className="grid grid-cols-2 gap-3">
            {P('max_aandeel_marco', 'Maximaal aandeel Marco (fractie)', '0,33 = 33%')}
            {P('vast_aandeel_chiara', 'Vast aandeel Chiara')}
            {P('startaandeel_marco', 'Startaandeel Marco')}
            {P('startaandeel_bram', 'Startaandeel Bram')}
          </div>
        </div>
        <div className="card-base space-y-3">
          <h2 className="font-semibold">Tarieven</h2>
          <div className="grid grid-cols-2 gap-3">
            {P('wam_bedrag_per_pct', 'WAM: € netto per 1%')}
            {P('wam_max_aandeel', 'Maximaal aandeel via WAM (fractie)')}
            {P('regulier_tarief', 'Regulier tarief (€ per 1%)', 'Geldt tot het totaal hieronder.')}
            {P('einde_goedkope_schijf', 'Einde goedkope schijf (fractie)', '0,10 = tot 10% in totaal, WAM inbegrepen.')}
          </div>
        </div>
        <div className="card-base space-y-3">
          <h2 className="font-semibold">Contractjaren — tarief boven de goedkope schijf</h2>
          {(['jaar1', 'jaar2', 'jaar3'] as const).map((j, i) => (
            <div key={j} className="grid grid-cols-3 gap-3">
              <Veld label={`Jaar ${i + 1} — van`} type="date" value={f[`${j}_start`]} onChange={(v) => set(`${j}_start`, v)} />
              <Veld label="t.e.m." type="date" value={f[`${j}_eind`]} onChange={(v) => set(`${j}_eind`, v)} />
              {P(`${j}_tarief`, '€ omzet per 1%')}
            </div>
          ))}
        </div>
        <button onClick={bewaar} disabled={bezig} className="btn-primary text-sm">
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Instellingen opslaan
        </button>
      </div>
      <div className="card-base text-sm text-gray-700 space-y-2">
        <h2 className="font-semibold">Contractregels</h2>
        <ol className="list-decimal pl-4 space-y-1.5">
          <li>Het contractjaar wordt bepaald door de datum waarop het contract wordt ondertekend.</li>
          <li>Een contract uit Jaar 1 behoudt het tarief van Jaar 1, ook als de dienst in Jaar 2 wordt uitgevoerd.</li>
          <li>De volledige netto contractwaarde telt voorlopig mee zolang het contract actief is en betalingen op schema zijn.</li>
          <li>Bij status ‘Vroegtijdig stopgezet’ of ‘Niet-betaler’ wordt de volledige waarde automatisch €0.</li>
          <li>Bij ‘Voltooid’ wordt de meetellende waarde definitief. ‘Actief’ blijft zichtbaar als voorlopig.</li>
          <li>De goedkope schijf wordt chronologisch op ondertekeningsdatum toegewezen — de app sorteert dat zelf.</li>
        </ol>
      </div>
    </div>
  )
}

// ── Bouwstenen ───────────────────────────────────────────────────────────────

/**
 * Sluit een dialoogvenster pas wanneer de server-side verversing binnen is.
 * De pagina rendert op de server; dat duurt een paar seconden. Zou het venster
 * meteen dichtgaan, dan staart de gebruiker even naar oude cijfers. Binnen één
 * transition houdt React het oude scherm vast tot de nieuwe data er is, en
 * verdwijnt het venster samen met het verschijnen van de nieuwe cijfers.
 */
function useSluitNaVerversen(onClose: () => void) {
  const router = useRouter()
  const [, start] = useTransition()
  return () => start(() => { router.refresh(); onClose() })
}

function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="stat-card">
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-2">{label}</div>
      <div className={`text-2xl font-bold ${color ?? ''}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  )
}
function Box({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      <div className={`text-base font-bold ${color ?? 'text-gray-900'}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  )
}
function Veld({ label, value, onChange, type = 'text', placeholder, hint, inputMode }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; hint?: string
  inputMode?: 'decimal' | 'text'
}) {
  return (
    <label className="block text-xs font-medium text-gray-600">
      {label}
      <input type={type} className="input-base mt-1" value={value} placeholder={placeholder} inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)} />
      {hint && <span className="block text-[11px] text-gray-400 font-normal mt-0.5">{hint}</span>}
    </label>
  )
}
function Keuze({ label, value, onChange, opties }: { label: string; value: string; onChange: (v: string) => void; opties: { v: string; l: string }[] }) {
  return (
    <label className="block text-xs font-medium text-gray-600">
      {label}
      <select className="input-base mt-1" value={value} onChange={(e) => onChange(e.target.value)}>
        {opties.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  )
}
function Schakel({ label, value, onChange, opties }: { label: string; value: string; onChange: (v: string) => void; opties: { v: string; l: string }[] }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-600 mb-1">{label}</div>
      <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-white">
        {opties.map((o) => (
          <button key={o.v} type="button" onClick={() => onChange(o.v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md ${value === o.v ? 'bg-black text-white' : 'text-gray-600 hover:text-black'}`}>{o.l}</button>
        ))}
      </div>
    </div>
  )
}
function JaNee({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div>
      <div className="text-xs font-medium text-gray-600 mb-1">{label}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {[{ v: true, l: 'Ja' }, { v: false, l: 'Nee' }].map((o) => (
          <button key={String(o.v)} type="button" onClick={() => onChange(o.v)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${value === o.v ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`}>{o.l}</button>
        ))}
      </div>
    </div>
  )
}
function Dialoog({ titel, children, onClose, onSave, bezig, breed }: {
  titel: string; children: React.ReactNode; onClose: () => void; onSave: () => void; bezig: boolean; breed?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className={`bg-white rounded-2xl shadow-xl w-full ${breed ? 'max-w-2xl' : 'max-w-md'} max-h-[92dvh] flex flex-col overflow-hidden`}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{titel}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">{children}</div>
        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={onSave} disabled={bezig} className="btn-primary flex-1">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Opslaan
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}

// Onbenut maar bewust geëxporteerd: het type dat de tabellen tonen.
export type { ContractBerekend }
