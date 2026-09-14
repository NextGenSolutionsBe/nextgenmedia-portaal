'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Plus, X, Trash2, Pencil, Scale, Receipt, PieChart, Calculator, Settings2, Info } from 'lucide-react'
import { formatEuro, formatDate } from '@/lib/utils'
import {
  PERSONEN, PERSOON_LABEL, RECHT_TYPES, KOST_CATEGORIEEN, BETAALD_DOOR_LABEL, STATUUT_LABEL, STANDAARD_AANNAMES,
  rechtenPerPersoon, kerncijfers, berekenVerdeling, berekenEz, leesAannames, rechtEffect, kostEffect, kostBtw, kostIncl,
  type Recht, type Kost, type Winstverdeling, type Persoon, type RechtType, type BetaaldDoor, type Statuut, type EzInvoer, type Aannames,
} from '@/lib/bv-transitie'

type Tab = 'overzicht' | 'rechten' | 'kosten' | 'verdeling' | 'ez' | 'aannames'

const n = (v: unknown, standaard = 0): number => { const x = Number(v); return Number.isFinite(x) ? x : standaard }
const persoonVan = (v: unknown): Persoon => ((PERSONEN as string[]).includes(String(v)) ? (v as Persoon) : 'bram')

function naarRecht(r: Record<string, unknown>): Recht {
  return {
    id: String(r.id), datum: String(r.datum ?? '').slice(0, 10), persoon: persoonVan(r.persoon),
    type: (RECHT_TYPES.some((t) => t.type === r.type) ? r.type : 'correctie') as RechtType,
    omschrijving: (r.omschrijving as string | null) ?? null, bedrag_excl: n(r.bedrag_excl),
    richting: Number(r.richting) === -1 ? -1 : 1, bewijs: (r.bewijs as string | null) ?? null, notitie: (r.notitie as string | null) ?? null,
  }
}
function naarKost(r: Record<string, unknown>): Kost {
  return {
    id: String(r.id), datum: String(r.datum ?? '').slice(0, 10), leverancier: (r.leverancier as string | null) ?? null,
    categorie: (r.categorie as string | null) ?? null, omschrijving: (r.omschrijving as string | null) ?? null,
    bedrag_excl: n(r.bedrag_excl), btw_pct: n(r.btw_pct, 21),
    betaald_door: (['bv', 'bram_prive', 'chiara_prive', 'marco_prive'].includes(String(r.betaald_door)) ? r.betaald_door : 'bv') as BetaaldDoor,
    verrekenen_met: (PERSONEN as string[]).includes(String(r.verrekenen_met)) ? (r.verrekenen_met as Persoon) : null,
  }
}
function naarVerdeling(r: Record<string, unknown>): Winstverdeling {
  return {
    persoon: persoonVan(r.persoon), ontvangen_op_rekening: n(r.ontvangen_op_rekening), nog_te_ontvangen: n(r.nog_te_ontvangen),
    zakelijke_kosten_betaald: n(r.zakelijke_kosten_betaald), prive_gebruikt: n(r.prive_gebruikt), al_ontvangen: n(r.al_ontvangen),
  }
}
function naarEz(r: Record<string, unknown> | undefined, persoon: Persoon): EzInvoer {
  return {
    persoon, winst: n(r?.winst), andere_inkomsten: n(r?.andere_inkomsten), aftrekken: n(r?.aftrekken),
    statuut: (['hoofdberoep', 'bijberoep', 'primostarter'].includes(String(r?.statuut)) ? r?.statuut : 'bijberoep') as Statuut,
    kwartalen: n(r?.kwartalen, 4),
  }
}

const geld = (v: number) => formatEuro(v)
const kleur = (v: number) => (v < 0 ? 'text-red-600' : v > 0 ? 'text-green-700' : 'text-gray-900')

export function BvClient({ jaar, rechtenRijen, kostenRijen, verdelingRijen, ezRijen, aannamesRij }: {
  jaar: number
  rechtenRijen: Record<string, unknown>[]
  kostenRijen: Record<string, unknown>[]
  verdelingRijen: Record<string, unknown>[]
  ezRijen: Record<string, unknown>[]
  aannamesRij: Record<string, unknown> | null
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('overzicht')
  const [rechtDialoog, setRechtDialoog] = useState<Recht | 'nieuw' | null>(null)
  const [kostDialoog, setKostDialoog] = useState<Kost | 'nieuw' | null>(null)

  const rechten = useMemo(() => rechtenRijen.map(naarRecht), [rechtenRijen])
  const kosten = useMemo(() => kostenRijen.map(naarKost), [kostenRijen])
  const verdeling = useMemo(() => verdelingRijen.map(naarVerdeling), [verdelingRijen])
  const aannames = useMemo(() => leesAannames(jaar, aannamesRij), [jaar, aannamesRij])
  const ezInvoer = useMemo(() => PERSONEN.map((p) => naarEz(ezRijen.find((r) => r.persoon === p), p)), [ezRijen])

  const perPersoon = useMemo(() => rechtenPerPersoon(rechten, kosten), [rechten, kosten])
  const kern = useMemo(() => kerncijfers(rechten, kosten), [rechten, kosten])
  const vd = useMemo(() => berekenVerdeling(verdeling), [verdeling])
  const ez = useMemo(() => ezInvoer.map((i) => berekenEz(i, aannames)), [ezInvoer, aannames])

  const verwijder = async (resource: 'recht' | 'kost', id: string) => {
    if (!confirm('Deze regel verwijderen?')) return
    const r = await fetch(`/api/admin/bv-transitie?resource=${resource}&id=${id}`, { method: 'DELETE' })
    const j = await r.json(); if (!r.ok) { toast.error(j.error ?? 'Mislukt'); return }
    toast.success('Verwijderd.'); router.refresh()
  }

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'overzicht', label: 'Overzicht', icon: PieChart },
    { key: 'rechten', label: `Rechtenbalans (${rechten.length})`, icon: Scale },
    { key: 'kosten', label: `BV-kosten (${kosten.length})`, icon: Receipt },
    { key: 'verdeling', label: 'Winstverdeling', icon: PieChart },
    { key: 'ez', label: `EZ-raming ${jaar}`, icon: Calculator },
    { key: 'aannames', label: 'Aannames', icon: Settings2 },
  ]

  return (
    <div className="space-y-6">
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
          <div className="card-base p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold">Per persoon</div>
            <div className="table-wrap"><table className="w-full text-sm min-w-[900px]">
              <thead><tr className="border-b border-gray-100">
                <th className="table-th">Persoon</th>
                <th className="table-th text-right">Bruto rechten</th>
                <th className="table-th text-right">Privé voordelen via BV</th>
                <th className="table-th text-right">Netto recht in BV</th>
                <th className="table-th text-right">EZ-winst</th>
                <th className="table-th text-right">Sociale bijdrage</th>
                <th className="table-th text-right">EZ-belasting</th>
                <th className="table-th text-right">Netto na reservering</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {perPersoon.map((p, i) => (
                  <tr key={p.persoon}>
                    <td className="table-td font-medium">{PERSOON_LABEL[p.persoon]}</td>
                    <td className="table-td text-right tabular">{geld(p.bruto)}</td>
                    <td className={`table-td text-right tabular ${kleur(p.priveVoordelen)}`}>{geld(p.priveVoordelen)}</td>
                    <td className={`table-td text-right tabular font-semibold ${kleur(p.netto)}`}>{geld(p.netto)}</td>
                    <td className="table-td text-right tabular">{geld(ez[i].winst)}</td>
                    <td className="table-td text-right tabular text-gray-600">{geld(ez[i].socialeBijdragen)}</td>
                    <td className="table-td text-right tabular text-gray-600">{geld(ez[i].ezBelasting)}</td>
                    <td className="table-td text-right tabular font-semibold">{geld(ez[i].netto)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>

          <div>
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Kerncijfers BV</div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi label="Totaal persoonlijke rechten" value={geld(kern.totaalRechten)} color={kleur(kern.totaalRechten)} />
              <Kpi label="BV-opstartkosten excl. btw" value={geld(kern.opstartkosten)} sub="categorie Oprichtingskost" />
              <Kpi label="Privé verrekende BV-kosten" value={geld(kern.priveVerrekend)} />
              <Kpi label="Nog te bespreken / niet toegewezen" value={geld(kern.nietToegewezen)} sub="kosten zonder 'verrekenen met'" />
            </div>
          </div>

          <div className="card-base text-sm text-gray-700 space-y-2">
            <h2 className="font-semibold flex items-center gap-2"><Info className="h-4 w-4 text-gray-400" />Werkwijze</h2>
            <p>Registreer elke BV-factuur aan een eenmanszaak als <b>+</b> in de rechtenbalans. Registreer elke privé-uitgave die de BV voor iemand draagt als <b>−</b>, of boek ze bij BV-kosten met “verrekenen met”. De samenvatting toont per persoon wat nog te goed staat.</p>
            <p>Vul op de EZ-tab alleen de boekhoudkundige winst en persoonlijke gegevens in; de fiscale uitkomst is een reserve-inschatting, geen aangifte. Laat de boekhouder bevestigen of dit via rekening-courant, lening, loon/dividend of een andere boeking verwerkt wordt.</p>
          </div>
        </div>
      )}

      {/* ══ RECHTENBALANS ══════════════════════════════════════════════════ */}
      {tab === 'rechten' && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-sm text-gray-500 max-w-2xl">Wat staat er per persoon nog te goed in de BV. Eén regel per factuur of verrekening, met bewijs of factuurnummer.</p>
            <button onClick={() => setRechtDialoog('nieuw')} className="btn-primary text-sm"><Plus className="h-4 w-4" />Regel toevoegen</button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {perPersoon.map((p) => <Box key={p.persoon} label={`${PERSOON_LABEL[p.persoon]} — bruto recht`} value={geld(p.bruto)} color={kleur(p.bruto)} />)}
          </div>
          <div className="card-base p-0 overflow-hidden">
            {rechten.length === 0 ? <div className="empty-state text-sm">Nog geen regels.</div> : (
              <div className="table-wrap"><table className="w-full text-sm min-w-[900px]">
                <thead><tr className="border-b border-gray-100">
                  <th className="table-th">Datum</th><th className="table-th">Persoon</th><th className="table-th">Type</th><th className="table-th">Omschrijving</th>
                  <th className="table-th text-right">Bedrag excl.</th><th className="table-th text-right">Richting</th><th className="table-th text-right">Effect</th><th className="table-th">Bewijs</th><th className="table-th"></th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {rechten.map((r) => (
                    <tr key={r.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setRechtDialoog(r)}>
                      <td className="table-td text-gray-600">{formatDate(r.datum)}</td>
                      <td className="table-td font-medium">{PERSOON_LABEL[r.persoon]}</td>
                      <td className="table-td text-gray-600">{RECHT_TYPES.find((t) => t.type === r.type)?.label}</td>
                      <td className="table-td"><div>{r.omschrijving ?? '—'}</div>{r.notitie && <div className="text-[11px] text-gray-500 truncate max-w-[20rem]" title={r.notitie}>{r.notitie}</div>}</td>
                      <td className="table-td text-right tabular">{geld(r.bedrag_excl)}</td>
                      <td className="table-td text-right tabular">{r.richting > 0 ? '+1' : '−1'}</td>
                      <td className={`table-td text-right tabular font-semibold ${kleur(rechtEffect(r))}`}>{geld(rechtEffect(r))}</td>
                      <td className="table-td text-gray-500">{r.bewijs ?? '—'}</td>
                      <td className="table-td" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setRechtDialoog(r)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => verwijder('recht', r.id)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
          <div className="card-base text-xs text-gray-600 space-y-1">
            {RECHT_TYPES.map((t) => <div key={t.type}><b>{t.label}</b> — {t.richting === null ? '' : t.richting > 0 ? '+1: ' : '−1: '}{t.uitleg}</div>)}
          </div>
        </div>
      )}

      {/* ══ BV-KOSTEN ══════════════════════════════════════════════════════ */}
      {tab === 'kosten' && (
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <p className="text-sm text-gray-500 max-w-2xl">Kosten van de BV en persoonlijke voordelen. “Verrekenen met” zet het bedrag als − op iemands recht.</p>
            <button onClick={() => setKostDialoog('nieuw')} className="btn-primary text-sm"><Plus className="h-4 w-4" />Kost toevoegen</button>
          </div>
          <div className="card-base p-0 overflow-hidden">
            {kosten.length === 0 ? <div className="empty-state text-sm">Nog geen kosten.</div> : (
              <div className="table-wrap"><table className="w-full text-sm min-w-[1000px]">
                <thead><tr className="border-b border-gray-100">
                  <th className="table-th">Datum</th><th className="table-th">Leverancier</th><th className="table-th">Categorie</th><th className="table-th">Omschrijving</th>
                  <th className="table-th text-right">Excl. btw</th><th className="table-th text-right">Btw</th><th className="table-th text-right">Incl. btw</th>
                  <th className="table-th">Betaald door</th><th className="table-th">Verrekenen met</th><th className="table-th text-right">Effect op recht</th><th className="table-th"></th>
                </tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {kosten.map((k) => (
                    <tr key={k.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setKostDialoog(k)}>
                      <td className="table-td text-gray-600">{formatDate(k.datum)}</td>
                      <td className="table-td font-medium">{k.leverancier ?? '—'}</td>
                      <td className="table-td text-gray-600">{k.categorie ?? '—'}</td>
                      <td className="table-td">{k.omschrijving ?? '—'}</td>
                      <td className="table-td text-right tabular">{geld(k.bedrag_excl)}</td>
                      <td className="table-td text-right tabular text-gray-500">{geld(kostBtw(k))}</td>
                      <td className="table-td text-right tabular">{geld(kostIncl(k))}</td>
                      <td className="table-td text-gray-600">{BETAALD_DOOR_LABEL[k.betaald_door]}</td>
                      <td className="table-td text-gray-600">{k.verrekenen_met ? PERSOON_LABEL[k.verrekenen_met] : 'Geen'}</td>
                      <td className={`table-td text-right tabular font-semibold ${kleur(kostEffect(k))}`}>{geld(kostEffect(k))}</td>
                      <td className="table-td" onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setKostDialoog(k)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => verwijder('kost', k.id)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {/* ══ WINSTVERDELING ═════════════════════════════════════════════════ */}
      {tab === 'verdeling' && <Verdeling rijen={verdeling} berekend={vd} />}

      {/* ══ EZ-RAMING ══════════════════════════════════════════════════════ */}
      {tab === 'ez' && <EzRaming jaar={jaar} invoer={ezInvoer} berekend={ez} />}

      {/* ══ AANNAMES ═══════════════════════════════════════════════════════ */}
      {tab === 'aannames' && <AannamesForm aannames={aannames} />}

      {rechtDialoog && <RechtDialoog recht={rechtDialoog === 'nieuw' ? null : rechtDialoog} onClose={() => setRechtDialoog(null)} />}
      {kostDialoog && <KostDialoog kost={kostDialoog === 'nieuw' ? null : kostDialoog} onClose={() => setKostDialoog(null)} />}
    </div>
  )
}

// ── Winstverdeling ───────────────────────────────────────────────────────────

function Verdeling({ rijen, berekend }: { rijen: Winstverdeling[]; berekend: ReturnType<typeof berekenVerdeling> }) {
  const router = useRouter()
  const [f, setF] = useState<Record<Persoon, Record<string, string>>>(() => Object.fromEntries(PERSONEN.map((p) => {
    const r = rijen.find((x) => x.persoon === p)
    return [p, {
      ontvangen_op_rekening: String(r?.ontvangen_op_rekening ?? 0), nog_te_ontvangen: String(r?.nog_te_ontvangen ?? 0),
      zakelijke_kosten_betaald: String(r?.zakelijke_kosten_betaald ?? 0), prive_gebruikt: String(r?.prive_gebruikt ?? 0), al_ontvangen: String(r?.al_ontvangen ?? 0),
    }]
  })) as unknown as Record<Persoon, Record<string, string>>)
  const [bezig, setBezig] = useState(false)

  // Live herrekenen op wat er in de vakjes staat, nog vóór het opgeslagen is.
  const live = berekenVerdeling(PERSONEN.map((p) => ({
    persoon: p, ontvangen_op_rekening: n(f[p].ontvangen_op_rekening), nog_te_ontvangen: n(f[p].nog_te_ontvangen),
    zakelijke_kosten_betaald: n(f[p].zakelijke_kosten_betaald), prive_gebruikt: n(f[p].prive_gebruikt), al_ontvangen: n(f[p].al_ontvangen),
  })))
  const gewijzigd = JSON.stringify(live.personen.map((p) => [p.nettoPot, p.prive_gebruikt, p.al_ontvangen]))
    !== JSON.stringify(berekend.personen.map((p) => [p.nettoPot, p.prive_gebruikt, p.al_ontvangen]))

  const bewaar = async () => {
    setBezig(true)
    try {
      for (const p of PERSONEN) {
        const r = await fetch('/api/admin/bv-transitie', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'verdeling', persoon: p, ...f[p] }) })
        const j = await r.json(); if (!r.ok) throw new Error(j.error)
      }
      toast.success('Verdeling opgeslagen.'); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  const KOL: { k: string; label: string }[] = [
    { k: 'ontvangen_op_rekening', label: 'Ontvangen op rekening' }, { k: 'nog_te_ontvangen', label: 'Nog te ontvangen' },
    { k: 'zakelijke_kosten_betaald', label: 'Zakelijke kosten betaald' }, { k: 'prive_gebruikt', label: 'Privé gebruikt' }, { k: 'al_ontvangen', label: 'Al ontvangen' },
  ]

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 max-w-2xl">
        Verdeling van de gezamenlijke winst van de overgangsmaanden (juni–oktober). Ieder heeft recht op een derde van de netto pot;
        “al ontvangen” is wat ieder al uit zijn aandeel kreeg.
      </p>
      <div className="card-base p-0 overflow-hidden">
        <div className="table-wrap"><table className="w-full text-sm min-w-[1000px]">
          <thead><tr className="border-b border-gray-100">
            <th className="table-th">Persoon</th>
            {KOL.map((c) => <th key={c.k} className="table-th text-right">{c.label}</th>)}
            <th className="table-th text-right">Netto pot</th><th className="table-th text-right">Recht (1/3)</th><th className="table-th text-right">Saldo</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {live.personen.map((p) => (
              <tr key={p.persoon}>
                <td className="table-td font-medium">{PERSOON_LABEL[p.persoon]}</td>
                {KOL.map((c) => (
                  <td key={c.k} className="table-td text-right">
                    <input className="input-base text-right w-28 ml-auto" inputMode="decimal" value={f[p.persoon][c.k]}
                      onChange={(e) => setF((prev) => ({ ...prev, [p.persoon]: { ...prev[p.persoon], [c.k]: e.target.value } }))} />
                  </td>
                ))}
                <td className="table-td text-right tabular">{geld(p.nettoPot)}</td>
                <td className="table-td text-right tabular">{geld(p.recht)}</td>
                <td className={`table-td text-right tabular font-semibold ${kleur(p.saldo)}`}>{geld(p.saldo)}</td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <td className="table-td">Totaal</td>
              {KOL.map((c) => <td key={c.k} className="table-td text-right tabular">{geld(live.personen.reduce((s, p) => s + n((p as unknown as Record<string, number>)[c.k]), 0))}</td>)}
              <td className="table-td text-right tabular">{geld(live.totaalPot)}</td>
              <td className="table-td text-right tabular">{geld(live.totaalPot)}</td>
              <td className="table-td text-right tabular">{geld(live.personen.reduce((s, p) => s + p.saldo, 0))}</td>
            </tr>
          </tbody>
        </table></div>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={bewaar} disabled={bezig || !gewijzigd} className="btn-primary text-sm">
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Verdeling opslaan
        </button>
        {gewijzigd && <span className="text-xs text-amber-700">Niet opgeslagen wijzigingen.</span>}
      </div>
      <div className="card-base">
        <h2 className="font-semibold mb-3">Eindafrekening</h2>
        <div className="grid grid-cols-3 gap-3">
          {live.personen.map((p) => (
            <Box key={p.persoon} label={PERSOON_LABEL[p.persoon]} value={geld(p.saldo)} sub={p.betekenis} color={kleur(p.saldo)} />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── EZ-raming ────────────────────────────────────────────────────────────────

function EzRaming({ jaar, invoer, berekend }: { jaar: number; invoer: EzInvoer[]; berekend: ReturnType<typeof berekenEz>[] }) {
  const router = useRouter()
  const [f, setF] = useState<Record<Persoon, Record<string, string>>>(() => Object.fromEntries(invoer.map((i) => [i.persoon, {
    winst: String(i.winst), andere_inkomsten: String(i.andere_inkomsten), aftrekken: String(i.aftrekken), statuut: i.statuut, kwartalen: String(i.kwartalen),
  }])) as unknown as Record<Persoon, Record<string, string>>)
  const [bezig, setBezig] = useState(false)

  const bewaar = async () => {
    setBezig(true)
    try {
      for (const p of PERSONEN) {
        const r = await fetch('/api/admin/bv-transitie', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'ez', persoon: p, jaar, ...f[p] }) })
        const j = await r.json(); if (!r.ok) throw new Error(j.error)
      }
      toast.success('Raming opgeslagen.'); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  const RIJEN: { label: string; get: (b: ReturnType<typeof berekenEz>) => string; vet?: boolean; pct?: boolean }[] = [
    { label: 'Sociale bijdragen (raming)', get: (b) => geld(b.socialeBijdragen) },
    { label: 'Belastbaar inkomen totaal', get: (b) => geld(b.belastbaar) },
    { label: 'Federale personenbelasting vóór belastingvrije som', get: (b) => geld(b.federaalVoorVrijstelling) },
    { label: 'Belastingvrije som — belastingkorting', get: (b) => geld(b.belastingkorting) },
    { label: 'Federale belasting na vrijstelling', get: (b) => geld(b.federaalNa) },
    { label: 'Gemeentebelasting', get: (b) => geld(b.gemeentebelasting) },
    { label: 'Totaal geschatte personenbelasting', get: (b) => geld(b.totaalPB) },
    { label: 'Belasting enkel door EZ (incrementeel)', get: (b) => geld(b.ezBelasting), vet: true },
    { label: 'Netto na sociale bijdragen & EZ-belasting', get: (b) => geld(b.netto), vet: true },
    { label: 'Te reserveren % van EZ-winst', get: (b) => `${(b.reserveren * 100).toLocaleString('nl-BE', { maximumFractionDigits: 2 })}%`, vet: true },
  ]

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 max-w-2xl">
        Vul per persoon de boekhoudkundige winst en het statuut in. De rest volgt uit de aannames voor {jaar}. Dit is een reserve-inschatting, geen aangifte.
      </p>
      <div className="card-base p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100">
            <th className="table-th w-1/3">Persoon</th>
            {PERSONEN.map((p) => <th key={p} className="table-th text-right">{PERSOON_LABEL[p]}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            <InvoerRij label="Boekhoudkundige winst vóór sociale bijdragen" k="winst" f={f} setF={setF} />
            <InvoerRij label="Andere belastbare inkomsten (na beroepskosten)" k="andere_inkomsten" f={f} setF={setF} />
            <InvoerRij label="Aftrekbare VAPZ / overige aftrekken" k="aftrekken" f={f} setF={setF} />
            <tr>
              <td className="table-td text-gray-700">Statuut</td>
              {PERSONEN.map((p) => (
                <td key={p} className="table-td text-right">
                  <select className="input-base w-36 ml-auto" value={f[p].statuut} onChange={(e) => setF((prev) => ({ ...prev, [p]: { ...prev[p], statuut: e.target.value } }))}>
                    {(Object.keys(STATUUT_LABEL) as Statuut[]).map((s) => <option key={s} value={s}>{STATUUT_LABEL[s]}</option>)}
                  </select>
                </td>
              ))}
            </tr>
            <InvoerRij label={`Aantal actieve kwartalen EZ in ${jaar}`} k="kwartalen" f={f} setF={setF} />
            {RIJEN.map((r) => (
              <tr key={r.label} className={r.vet ? 'bg-gray-50' : ''}>
                <td className={`table-td ${r.vet ? 'font-semibold' : 'text-gray-700'}`}>{r.label}</td>
                {berekend.map((b) => <td key={b.persoon} className={`table-td text-right tabular ${r.vet ? 'font-semibold' : ''}`}>{r.get(b)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={bewaar} disabled={bezig} className="btn-primary text-sm">
        {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Invoer opslaan
      </button>
      <div className="card-base bg-amber-50/40 border-amber-200/60 text-sm text-amber-800 space-y-1">
        <p><strong>Grenzen van deze raming.</strong> Ze gebruikt de schijven en de basisbelastingvrije som van {jaar} en een aanpasbare gemeentebelasting. Ze houdt geen rekening met gezinssituatie, voorafbetalingen, specifieke aftrekken of voordelen alle aard, tenzij je ze bij “andere inkomsten / aftrekken” invoert.</p>
        <p>Sociale bijdragen zijn een raming: het lage tarief op de volledige winst, plus beheerskost. De definitieve afrekening komt van het sociaal verzekeringsfonds; bij start of stop kan het inkomen geannualiseerd worden.</p>
      </div>
    </div>
  )
}

function InvoerRij({ label, k, f, setF }: {
  label: string; k: string
  f: Record<Persoon, Record<string, string>>
  setF: React.Dispatch<React.SetStateAction<Record<Persoon, Record<string, string>>>>
}) {
  return (
    <tr>
      <td className="table-td text-gray-700">{label}</td>
      {PERSONEN.map((p) => (
        <td key={p} className="table-td text-right">
          <input className="input-base text-right w-36 ml-auto bg-[#fff848]/15" inputMode="decimal" value={f[p][k]}
            onChange={(e) => setF((prev) => ({ ...prev, [p]: { ...prev[p], [k]: e.target.value } }))} />
        </td>
      ))}
    </tr>
  )
}

// ── Aannames ─────────────────────────────────────────────────────────────────

function AannamesForm({ aannames }: { aannames: Aannames }) {
  const router = useRouter()
  const [f, setF] = useState<Record<string, string>>(Object.fromEntries(Object.entries(aannames).filter(([k]) => k !== 'jaar').map(([k, v]) => [k, String(v)])))
  const [bezig, setBezig] = useState(false)
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }))
  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/bv-transitie', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resource: 'aannames', jaar: aannames.jaar, ...f }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Aannames opgeslagen.'); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }
  const RIJEN: { k: keyof typeof STANDAARD_AANNAMES; label: string; eenheid: '%' | 'EUR'; toel?: string }[] = [
    { k: 'gemeentebelasting', label: 'Gemeentebelasting', eenheid: '%', toel: 'Percentage van je woonplaats (standaard 7%).' },
    { k: 'beheerskost_fonds', label: 'Beheerskosten sociaal fonds', eenheid: '%', toel: 'Indicatief; controleer bij Liantis/Xerius/Acerta.' },
    { k: 'soc_laag', label: 'Sociale bijdrage laag tarief', eenheid: '%', toel: 'Op inkomen tot de eerste grens.' },
    { k: 'soc_hoog', label: 'Sociale bijdrage hoog tarief', eenheid: '%', toel: 'Op inkomen tussen beide grenzen. Niet gebruikt in de raming.' },
    { k: 'soc_grens1', label: 'Grens sociale bijdrage 1', eenheid: 'EUR' },
    { k: 'soc_grens2', label: 'Grens sociale bijdrage 2', eenheid: 'EUR' },
    { k: 'min_jaarbijdrage_hoofd', label: 'Minimum jaarbijdrage hoofdberoep', eenheid: 'EUR', toel: 'Excl. beheerskost; 4 × €890,42.' },
    { k: 'vrijstelling_bijberoep', label: 'Vrijstelling bijberoep', eenheid: 'EUR', toel: 'Daaronder geen bijdrage.' },
    { k: 'belastingvrije_som', label: 'Belastingvrije som', eenheid: 'EUR', toel: 'Basisbedrag; exclusief gezinscorrecties.' },
    { k: 'schijf1_grens', label: 'Schijf 1 bovengrens', eenheid: 'EUR' }, { k: 'schijf1_tarief', label: 'Schijf 1 tarief', eenheid: '%' },
    { k: 'schijf2_grens', label: 'Schijf 2 bovengrens', eenheid: 'EUR' }, { k: 'schijf2_tarief', label: 'Schijf 2 tarief', eenheid: '%' },
    { k: 'schijf3_grens', label: 'Schijf 3 bovengrens', eenheid: 'EUR' }, { k: 'schijf3_tarief', label: 'Schijf 3 tarief', eenheid: '%' },
    { k: 'schijf4_tarief', label: 'Schijf 4 tarief', eenheid: '%', toel: 'Boven schijf 3.' },
  ]
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500 max-w-2xl">Aannames {aannames.jaar} — aanpasbare fiscale raming. Percentages als fractie (0,25 = 25%).</p>
      <div className="card-base p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100"><th className="table-th">Parameter</th><th className="table-th text-right">Waarde</th><th className="table-th">Eenheid</th><th className="table-th">Toelichting</th></tr></thead>
          <tbody className="divide-y divide-gray-50">
            {RIJEN.map((r) => (
              <tr key={r.k}>
                <td className="table-td text-gray-700">{r.label}</td>
                <td className="table-td text-right"><input className="input-base text-right w-36 ml-auto" inputMode="decimal" value={f[r.k]} onChange={(e) => set(r.k, e.target.value)} /></td>
                <td className="table-td text-gray-500">{r.eenheid}</td>
                <td className="table-td text-gray-500 text-xs">{r.toel ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button onClick={bewaar} disabled={bezig} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Aannames opslaan</button>
      <p className="text-[11px] text-gray-500">Bronnen: FOD Financiën (personenbelasting) en RSVZ / sociaal fonds. Controleer de definitieve fiscale situatie steeds met de boekhouder.</p>
    </div>
  )
}

// ── Dialogen ─────────────────────────────────────────────────────────────────

function RechtDialoog({ recht, onClose }: { recht: Recht | null; onClose: () => void }) {
  const router = useRouter()
  const [f, setF] = useState({
    datum: recht?.datum ?? new Date().toISOString().slice(0, 10), persoon: recht?.persoon ?? 'bram',
    type: recht?.type ?? 'factuur_bv_ez', richting: String(recht?.richting ?? 1),
    omschrijving: recht?.omschrijving ?? '', bedrag_excl: recht?.bedrag_excl?.toString() ?? '', bewijs: recht?.bewijs ?? '', notitie: recht?.notitie ?? '',
  })
  const [bezig, setBezig] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const typeInfo = RECHT_TYPES.find((t) => t.type === f.type)
  const richting = typeInfo?.richting ?? (Number(f.richting) === -1 ? -1 : 1)
  const bewaar = async () => {
    setBezig(true)
    try {
      const body: Record<string, unknown> = { resource: 'recht', ...f }
      if (recht) body.id = recht.id
      const r = await fetch('/api/admin/bv-transitie', { method: recht ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Opgeslagen.'); router.refresh(); onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel={recht ? 'Regel wijzigen' : 'Regel toevoegen'} onClose={onClose} onSave={bewaar} bezig={bezig}>
      <div className="grid grid-cols-2 gap-3">
        <Veld label="Datum *" type="date" value={f.datum} onChange={(v) => set('datum', v)} />
        <Keuze label="Persoon *" value={f.persoon} onChange={(v) => set('persoon', v as Persoon)} opties={PERSONEN.map((p) => ({ v: p, l: PERSOON_LABEL[p] }))} />
      </div>
      <Keuze label="Type *" value={f.type} onChange={(v) => set('type', v as RechtType)} opties={RECHT_TYPES.map((t) => ({ v: t.type, l: t.label }))} />
      {typeInfo && <p className="text-[11px] text-gray-500 -mt-2">{typeInfo.uitleg}</p>}
      {f.type === 'correctie' && (
        <Keuze label="Richting" value={f.richting} onChange={(v) => set('richting', v)} opties={[{ v: '1', l: '+1 — recht erbij' }, { v: '-1', l: '−1 — recht eraf' }]} />
      )}
      <Veld label="Omschrijving" value={f.omschrijving} onChange={(v) => set('omschrijving', v)} />
      <div className="grid grid-cols-2 gap-3">
        <Veld label="Bedrag excl. btw *" value={f.bedrag_excl} onChange={(v) => set('bedrag_excl', v)} inputMode="decimal" />
        <Veld label="Bewijs / factuurnr." value={f.bewijs} onChange={(v) => set('bewijs', v)} />
      </div>
      <Veld label="Notitie" value={f.notitie} onChange={(v) => set('notitie', v)} />
      <p className="text-xs text-gray-600">Effect op het recht: <b className={kleur(n(f.bedrag_excl) * richting)}>{geld(n(f.bedrag_excl) * richting)}</b></p>
    </Dialoog>
  )
}

function KostDialoog({ kost, onClose }: { kost: Kost | null; onClose: () => void }) {
  const router = useRouter()
  const [f, setF] = useState({
    datum: kost?.datum ?? new Date().toISOString().slice(0, 10), leverancier: kost?.leverancier ?? '', categorie: kost?.categorie ?? 'Andere',
    omschrijving: kost?.omschrijving ?? '', bedrag_excl: kost?.bedrag_excl?.toString() ?? '', btw_pct: kost?.btw_pct?.toString() ?? '21',
    betaald_door: kost?.betaald_door ?? 'bv', verrekenen_met: kost?.verrekenen_met ?? '',
  })
  const [bezig, setBezig] = useState(false)
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))
  const bewaar = async () => {
    setBezig(true)
    try {
      const body: Record<string, unknown> = { resource: 'kost', ...f, verrekenen_met: f.verrekenen_met || null }
      if (kost) body.id = kost.id
      const r = await fetch('/api/admin/bv-transitie', { method: kost ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Opgeslagen.'); router.refresh(); onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }
  const excl = n(f.bedrag_excl), btw = excl * n(f.btw_pct) / 100
  return (
    <Dialoog titel={kost ? 'Kost wijzigen' : 'Kost toevoegen'} onClose={onClose} onSave={bewaar} bezig={bezig}>
      <div className="grid grid-cols-2 gap-3">
        <Veld label="Datum *" type="date" value={f.datum} onChange={(v) => set('datum', v)} />
        <Veld label="Leverancier / ontvanger" value={f.leverancier} onChange={(v) => set('leverancier', v)} />
      </div>
      <Keuze label="Categorie" value={f.categorie} onChange={(v) => set('categorie', v)} opties={KOST_CATEGORIEEN.map((c) => ({ v: c, l: c }))} />
      <Veld label="Omschrijving" value={f.omschrijving} onChange={(v) => set('omschrijving', v)} />
      <div className="grid grid-cols-2 gap-3">
        <Veld label="Bedrag excl. btw *" value={f.bedrag_excl} onChange={(v) => set('bedrag_excl', v)} inputMode="decimal" />
        <Veld label="Btw %" value={f.btw_pct} onChange={(v) => set('btw_pct', v)} inputMode="decimal" hint={`btw ${geld(btw)} · incl. ${geld(excl + btw)}`} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Keuze label="Betaald door" value={f.betaald_door} onChange={(v) => set('betaald_door', v as BetaaldDoor)}
          opties={(Object.keys(BETAALD_DOOR_LABEL) as BetaaldDoor[]).map((k) => ({ v: k, l: BETAALD_DOOR_LABEL[k] }))} />
        <Keuze label="Verrekenen met" value={f.verrekenen_met} onChange={(v) => set('verrekenen_met', v as Persoon | '')}
          opties={[{ v: '', l: 'Geen' }, ...PERSONEN.map((p) => ({ v: p, l: PERSOON_LABEL[p] }))]} />
      </div>
      <p className="text-xs text-gray-600">Effect op recht: <b className={kleur(f.verrekenen_met ? -excl : 0)}>{geld(f.verrekenen_met ? -excl : 0)}</b></p>
    </Dialoog>
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
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; hint?: string; inputMode?: 'decimal' | 'text'
}) {
  return (
    <label className="block text-xs font-medium text-gray-600">
      {label}
      <input type={type} className="input-base mt-1" value={value} placeholder={placeholder} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
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
function Dialoog({ titel, children, onClose, onSave, bezig }: {
  titel: string; children: React.ReactNode; onClose: () => void; onSave: () => void; bezig: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{titel}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">{children}</div>
        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={onSave} disabled={bezig} className="btn-primary flex-1">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Opslaan</button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}
