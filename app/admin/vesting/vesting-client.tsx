'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Loader2, Plus, X, Trash2, Pencil, Rocket, Users, Layers, Briefcase, Settings2, CalendarRange, AlertTriangle, Archive,
} from 'lucide-react'
import { formatEuro, formatDate } from '@/lib/utils'
import {
  berekenVesting, leesInstellingen, pct, totaalwaarde, duurUitData, toerekeningsfactor,
  STATUS_LABEL, ERKENNING_LABEL, JAAR_LABEL, DIENSTEN,
  type Contract, type WamRij, type WamKost, type ContractBerekend, type ContractStatus, type Erkenning,
  type VestingInstellingen,
} from '@/lib/vesting'

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
  }
}
function naarWam(r: Record<string, unknown>): WamRij {
  return {
    id: String(r.id), nr: String(r.nr ?? ''), klant: String(r.klant ?? ''),
    contractwaarde: n(r.contractwaarde) ?? 0, netto_ontvangen: n(r.netto_ontvangen) ?? 0,
    status: (['actief', 'voltooid', 'stopgezet', 'niet_betaler'].includes(String(r.status)) ? r.status : 'actief') as ContractStatus,
    betalingen_op_schema: r.betalingen_op_schema !== false, notitie: (r.notitie as string | null) ?? null,
  }
}
function naarKost(r: Record<string, unknown>): WamKost {
  return { id: String(r.id), datum: d(r.datum), omschrijving: String(r.omschrijving ?? ''), bedrag: n(r.bedrag) ?? 0 }
}

const ERKENNING_STIJL: Record<Erkenning, string> = {
  voorlopig: 'bg-amber-100 text-amber-800', definitief: 'bg-green-100 text-green-800',
  uitgesloten: 'bg-red-100 text-red-700', onvolledig: 'bg-gray-100 text-gray-600',
}

export function VestingClient({ instellingenRij, contractRijen, wamRijen, kostRijen, oudeRegistraties }: {
  instellingenRij: Record<string, unknown> | null
  contractRijen: Record<string, unknown>[]
  wamRijen: Record<string, unknown>[]
  kostRijen: Record<string, unknown>[]
  oudeRegistraties: Record<string, unknown>[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overzicht')
  const [contractDialoog, setContractDialoog] = useState<Contract | 'nieuw' | null>(null)
  const [wamDialoog, setWamDialoog] = useState<WamRij | 'nieuw' | null>(null)
  const [kostDialoog, setKostDialoog] = useState<WamKost | 'nieuw' | null>(null)

  const inst = useMemo(() => leesInstellingen(instellingenRij), [instellingenRij])
  const contracten = useMemo(() => contractRijen.map(naarContract), [contractRijen])
  const wam = useMemo(() => wamRijen.map(naarWam), [wamRijen])
  const kosten = useMemo(() => kostRijen.map(naarKost), [kostRijen])
  const v = useMemo(() => berekenVesting(contracten, wam, kosten, inst), [contracten, wam, kosten, inst])

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
  const klantenInRegister = new Set(contracten.map((c) => c.klant.trim().toLowerCase()))
  const nietOvergenomen = oudeRegistraties.filter((r) => !klantenInRegister.has(String(r.client_name ?? '').trim().toLowerCase()))

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Vesting</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Het vestigingsprincipe uit de samenwerkingsovereenkomst — uitsluitend informatief, wijzigt geen aandelen.
          </p>
        </div>
        <button onClick={() => { setTab('contracten'); setContractDialoog('nieuw') }} className="btn-primary text-sm">
          <Plus className="h-4 w-4" />Contract toevoegen
        </button>
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
                <Box label="Netto ontvangen" value={formatEuro(v.wam.nettoOntvangen)} />
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
                <table className="w-full text-sm min-w-[1100px]">
                  <thead><tr className="border-b border-gray-100">
                    <th className="table-th">Nr.</th><th className="table-th">Klant</th><th className="table-th">Ondertekend</th><th className="table-th">Jaar</th>
                    <th className="table-th">Dienst</th><th className="table-th text-right">Totaal</th><th className="table-th text-right">Netto</th>
                    <th className="table-th text-right">Factor</th><th className="table-th text-right">Meetellend</th>
                    <th className="table-th text-right">Goedkoop / jaar</th><th className="table-th text-right">Vesting</th>
                    <th className="table-th">Status</th><th className="table-th"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {v.contracten.map((c) => (
                      <tr key={c.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setContractDialoog(c)}>
                        <td className="table-td font-mono text-xs">{c.nr}</td>
                        <td className="table-td">
                          <div className="font-medium">{c.klant}</div>
                          {c.notitie && <div className="text-[11px] text-gray-500 truncate max-w-[16rem]" title={c.notitie}>{c.notitie}</div>}
                        </td>
                        <td className="table-td text-gray-600">{formatDate(c.ondertekend_op)}</td>
                        <td className="table-td">
                          <span className={`status-badge ${c.jaar === 'buiten' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}`}>{JAAR_LABEL[c.jaar]}</span>
                        </td>
                        <td className="table-td text-gray-600">
                          {c.dienst ?? '—'}
                          <div className="text-[11px] text-gray-400">{c.facturatiemodel === 'maandcontract' ? `${formatEuro(c.maandbedrag ?? 0)} × ${c.duur ?? '?'} mnd` : 'eenmalig'}</div>
                        </td>
                        <td className="table-td text-right tabular">{c.totaal === null ? <span className="text-red-600">ontbreekt</span> : formatEuro(c.totaal)}</td>
                        <td className="table-td text-right tabular">{c.netto === null ? '—' : formatEuro(c.netto)}</td>
                        <td className="table-td text-right tabular">{Math.round(c.factor * 100)}%</td>
                        <td className="table-td text-right tabular font-semibold">{formatEuro(c.meetellend)}</td>
                        <td className="table-td text-right tabular text-gray-500">{formatEuro(c.goedkopeSchijf)} / {formatEuro(c.jaarschijf)}</td>
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

          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <Box label="Netto ontvangen" value={formatEuro(v.wam.nettoOntvangen)} />
            <Box label="Kosten bij WAM" value={formatEuro(v.wam.kosten)} color="text-red-600" />
            <Box label="Netto meetellend" value={formatEuro(v.wam.nettoMeetellend)} />
            <Box label="Voorlopig aandeel" value={pct(v.wam.voorlopig)} color="text-amber-700" />
            <Box label="Definitief aandeel" value={pct(v.wam.definitief)} color="text-green-700" />
            <Box label="Volgende drempel" value={v.wam.volgendeDrempel === null ? 'Maximum' : formatEuro(v.wam.volgendeDrempel)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card-base p-0 overflow-hidden lg:col-span-2">
              <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold">Klanten</div>
              {v.wam.rijen.length === 0 ? <div className="empty-state text-sm">Nog geen WAM-klanten.</div> : (
                <div className="table-wrap"><table className="w-full text-sm">
                  <thead><tr className="border-b border-gray-100">
                    <th className="table-th">Nr.</th><th className="table-th">Klant</th><th className="table-th text-right">Contractwaarde</th><th className="table-th text-right">Netto ontvangen</th><th className="table-th text-right">Meetellend</th><th className="table-th">Status</th><th className="table-th"></th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-50">
                    {v.wam.rijen.map((r) => (
                      <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setWamDialoog(r)}>
                        <td className="table-td font-mono text-xs">{r.nr}</td>
                        <td className="table-td"><div className="font-medium">{r.klant}</div>{r.notitie && <div className="text-[11px] text-gray-500">{r.notitie}</div>}</td>
                        <td className="table-td text-right tabular">{formatEuro(r.contractwaarde)}</td>
                        <td className="table-td text-right tabular">{formatEuro(r.netto_ontvangen)}</td>
                        <td className="table-td text-right tabular font-semibold">{formatEuro(r.meetellend)}</td>
                        <td className="table-td"><span className={`status-badge ${ERKENNING_STIJL[r.erkenning]}`}>{ERKENNING_LABEL[r.erkenning]}</span></td>
                        <td className="table-td" onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => verwijder('wam', r.id, `${r.nr} ${r.klant}`)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                        </td>
                      </tr>
                    ))}
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
            <div className="table-wrap"><table className="w-full text-sm min-w-[900px]">
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
        <ContractDialoog contract={contractDialoog === 'nieuw' ? null : contractDialoog} inst={inst}
          onClose={() => setContractDialoog(null)} />
      )}
      {wamDialoog && <WamDialoog rij={wamDialoog === 'nieuw' ? null : wamDialoog} onClose={() => setWamDialoog(null)} />}
      {kostDialoog && <KostDialoog rij={kostDialoog === 'nieuw' ? null : kostDialoog} onClose={() => setKostDialoog(null)} />}
    </div>
  )
}

// ── Contractformulier ────────────────────────────────────────────────────────

function ContractDialoog({ contract, inst, onClose }: { contract: Contract | null; inst: VestingInstellingen; onClose: () => void }) {
  const router = useRouter()
  const vandaag = new Date().toISOString().slice(0, 10)
  const [f, setF] = useState({
    nr: contract?.nr ?? '', klant: contract?.klant ?? '',
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

  const bewaar = async () => {
    setBezig(true)
    try {
      const body: Record<string, unknown> = { resource: 'contract', ...f }
      if (!body.nr) delete body.nr
      if (contract) body.id = contract.id
      const r = await fetch('/api/admin/vesting', { method: contract ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(contract ? 'Contract bijgewerkt.' : 'Contract toegevoegd.')
      router.refresh(); onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  return (
    <Dialoog titel={contract ? `${contract.nr} — ${contract.klant}` : 'Nieuw contract'} onClose={onClose} onSave={bewaar} bezig={bezig} breed>
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

function WamDialoog({ rij, onClose }: { rij: WamRij | null; onClose: () => void }) {
  const router = useRouter()
  const [f, setF] = useState({
    nr: rij?.nr ?? '', klant: rij?.klant ?? '', contractwaarde: rij?.contractwaarde?.toString() ?? '',
    netto_ontvangen: rij?.netto_ontvangen?.toString() ?? '', status: rij?.status ?? 'actief',
    betalingen_op_schema: rij?.betalingen_op_schema ?? true, notitie: rij?.notitie ?? '',
  })
  const [bezig, setBezig] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const bewaar = async () => {
    setBezig(true)
    try {
      const body: Record<string, unknown> = { resource: 'wam', ...f }
      if (!body.nr) delete body.nr
      if (rij) body.id = rij.id
      const r = await fetch('/api/admin/vesting', { method: rij ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Opgeslagen.'); router.refresh(); onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel={rij ? `${rij.nr} — ${rij.klant}` : 'Nieuwe WAM-klant'} onClose={onClose} onSave={bewaar} bezig={bezig}>
      <Veld label="Klant *" value={f.klant} onChange={(v) => set('klant', v)} />
      <Veld label="Nr." value={f.nr} onChange={(v) => set('nr', v)} placeholder="automatisch" />
      <div className="grid grid-cols-2 gap-3">
        <Veld label="Contractwaarde (€)" value={f.contractwaarde} onChange={(v) => set('contractwaarde', v)} inputMode="decimal" />
        <Veld label="Netto ontvangen (€)" value={f.netto_ontvangen} onChange={(v) => set('netto_ontvangen', v)} inputMode="decimal" hint="Dit telt; niet de contractwaarde." />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Keuze label="Status" value={f.status} onChange={(v) => set('status', v as ContractStatus)}
          opties={(Object.keys(STATUS_LABEL) as ContractStatus[]).map((k) => ({ v: k, l: STATUS_LABEL[k] }))} />
        <JaNee label="Betalingen op schema?" value={f.betalingen_op_schema} onChange={(v) => set('betalingen_op_schema', v)} />
      </div>
      <Veld label="Notitie" value={f.notitie} onChange={(v) => set('notitie', v)} />
    </Dialoog>
  )
}

function KostDialoog({ rij, onClose }: { rij: WamKost | null; onClose: () => void }) {
  const router = useRouter()
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
      toast.success('Opgeslagen.'); router.refresh(); onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
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
