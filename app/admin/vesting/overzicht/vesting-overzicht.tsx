'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Ban, ChevronDown, ChevronUp, Loader2, PenLine, Plus, RotateCcw } from 'lucide-react'
import { isGetekend, type KandidaatContract } from '@/lib/vesting-snel'
import type { ContractWeergave, KostWeergave, VestingWeergave } from '@/lib/vesting-weergave'
import { PrijsToevoegen } from '../prijs-toevoegen'
import { TekenStand, api, datumKort, eur, pct } from './delen'
import { ContractVenster } from './contract-venster'
import { BeoordeelVenster } from './beoordeel-venster'
import { KostForm, KostVenster } from './kost-venster'

type Tab = 'contracten' | 'beoordelen' | 'kosten'
type Open = { soort: 'contract' | 'kost'; id: string } | null

const STATUS_KLANT: Record<string, string> = { draft: 'Concept', sent: 'Bij de klant', viewed: 'Bekeken door de klant', signed: 'Getekend', getekend: 'Getekend' }

/**
 * Vesting in één scherm: hoeveel aandelen iedereen nu heeft, hoe Marco daaraan
 * komt, welke contracten meetellen (met kosten en wie tekende), wat nog
 * beoordeeld moet worden en de algemene kosten. De berekening zelf staat in
 * lib/vesting.ts; alles komt uitgerekend van de server.
 */
export function VestingOverzicht({ data, tekenen }: { data: VestingWeergave; tekenen: boolean }) {
  const router = useRouter()
  const [, start] = useTransition()
  const vernieuw = useCallback(() => start(() => router.refresh()), [router])
  const ik = data.ik.vennoot

  const [tab, setTab] = useState<Tab>(data.teBeoordelen.length && !tekenen ? 'beoordelen' : 'contracten')
  const [open, setOpen] = useState<Open>(null)
  const [beoordeel, setBeoordeel] = useState<KandidaatContract | null>(null)
  const [laatste, setLaatste] = useState<string | null>(null)
  const [alleenOpen, setAlleenOpen] = useState(tekenen && !!ik)
  const [nieuwContract, setNieuwContract] = useState(false)
  const [nieuweKost, setNieuweKost] = useState(false)

  const mijnOpen = useMemo(() => (ik ? {
    contracten: data.contracten.filter((c) => c.akkoord.stand.per[ik].stand !== 'getekend'),
    kosten: data.kosten.filter((k) => k.akkoord.stand.per[ik].stand !== 'getekend'),
  } : { contracten: [], kosten: [] }), [data, ik])
  const aantalOpen = mijnOpen.contracten.length + mijnOpen.kosten.length

  // Tekenronde: open meteen het eerste item dat op jou wacht.
  useEffect(() => {
    if (tekenen && ik && aantalOpen && !open) {
      const eerste = mijnOpen.contracten[0] ? { soort: 'contract' as const, id: mijnOpen.contracten[0].id } : mijnOpen.kosten[0] ? { soort: 'kost' as const, id: mijnOpen.kosten[0].id } : null
      setOpen(eerste)
    }
    // Enkel bij het openen van de pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const volgendeOpen = (huidig: string): Open => {
    const lijst = [...mijnOpen.contracten.map((c) => ({ soort: 'contract' as const, id: c.id })), ...mijnOpen.kosten.map((k) => ({ soort: 'kost' as const, id: k.id }))]
    const rest = lijst.filter((x) => x.id !== huidig)
    return rest[0] ?? null
  }

  const contract = open?.soort === 'contract' ? data.contracten.find((c) => c.id === open.id) ?? null : null
  const kost = open?.soort === 'kost' ? data.kosten.find((k) => k.id === open.id) ?? null : null
  const zichtbareContracten = alleenOpen && ik ? mijnOpen.contracten : data.contracten
  const a = data.aandelen

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Vesting</h1>
          <p className="text-sm text-gray-500 mt-0.5">Welke contracten meetellen voor Marco, wat eraf gaat, en wie getekend heeft.</p>
        </div>
        <Link href="/admin/vesting?weergave=uitgebreid" className="btn-secondary text-sm">Uitgebreide weergave</Link>
      </div>

      {ik && aantalOpen > 0 && (
        <div className="rounded-lg bg-gray-900 text-white p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold">{aantalOpen === 1 ? 'Eén item wacht' : `${aantalOpen} items wachten`} op jouw handtekening</div>
            <div className="text-sm text-gray-300">Kijk de cijfers na en teken. Verandert er later iets, dan teken je opnieuw.</div>
          </div>
          <button type="button" onClick={() => { setAlleenOpen(true); setTab(mijnOpen.contracten.length ? 'contracten' : 'kosten'); setOpen(mijnOpen.contracten[0] ? { soort: 'contract', id: mijnOpen.contracten[0].id } : mijnOpen.kosten[0] ? { soort: 'kost', id: mijnOpen.kosten[0].id } : null) }}
            className="inline-flex items-center gap-2 rounded-md bg-white text-gray-900 px-3.5 py-2 text-sm font-medium hover:bg-gray-100">
            <PenLine className="h-4 w-4" />Nu tekenen
          </button>
        </div>
      )}

      {/* Aandelen */}
      <section className="card-base">
        <div className="grid grid-cols-3 gap-3">
          {([
            ['Bram', a.bram, 'krijgt wat Marco niet verwerft'],
            ['Chiara', a.chiara, 'vast'],
            ['Marco', a.marco, `van maximaal ${pct(a.maxMarco)}`],
          ] as const).map(([naam, waarde, sub]) => (
            <div key={naam}>
              <div className="text-xs text-gray-500">{naam}</div>
              <div className="text-2xl sm:text-3xl font-semibold tabular-nums text-gray-900">{pct(waarde)}</div>
              <div className="text-[11px] text-gray-500 leading-tight">{sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 h-2.5 rounded-full overflow-hidden flex bg-gray-100" aria-hidden>
          <div className="bg-gray-900" style={{ width: `${a.bram * 100}%` }} />
          <div className="bg-gray-400" style={{ width: `${a.chiara * 100}%` }} />
          <div className="bg-[#fff848] border-l border-white" style={{ width: `${a.marco * 100}%` }} />
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Op basis van wat nu meetelt. Enkel met contracten die alle drie tekenden: Marco {pct(a.marcoGetekend)}
          {' '}({a.getekend.volledig} van {a.getekend.totaal} contracten getekend). Hele procenten, afgerond naar beneden.
        </p>
      </section>

      {/* Hoe Marco aan zijn aandeel komt */}
      <section className="card-base">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Hoe Marco aan {pct(a.marco)} komt</h2>
        <dl className="text-sm tabular-nums divide-y divide-gray-100">
          <Lijn label="WAM-portefeuille (zijn vorige zaak), ontvangen" waarde={eur(a.wam.ontvangen)} />
          {a.algemeneKosten.totaal > 0 && <Lijn label="Algemene kosten, zoals de afsluiting van WAM" waarde={`− ${eur(a.algemeneKosten.totaal)}`} zacht={false} />}
          <Lijn label={`Contracten die meetellen (${data.contracten.filter((c) => c.telt).length})`} waarde={eur(a.contracten.teltMee)} />
          <Lijn label="Telt mee voor Marco" waarde={eur(a.meetellend)} sterk />
        </dl>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-600">
          <div className="rounded-md bg-gray-50 px-3 py-2"><div className="text-gray-500">Via WAM</div><div className="text-sm font-semibold text-gray-900">{pct(a.wam.aandeel)}</div><div>elke {eur(a.wam.bedragPerPct)} netto = 1%, tot {pct(a.wam.max)}</div></div>
          <div className="rounded-md bg-gray-50 px-3 py-2"><div className="text-gray-500">Via contracten</div><div className="text-sm font-semibold text-gray-900">{pct(a.contracten.aandeel)}</div><div>tarief volgens het jaar van ondertekening</div></div>
          <div className="rounded-md bg-gray-50 px-3 py-2 col-span-2 sm:col-span-1"><div className="text-gray-500">Tot de volgende procent</div><div className="text-sm font-semibold text-gray-900">{a.volgendeProcent ? eur(a.volgendeProcent.nodig) : 'Maximum bereikt'}</div>{a.volgendeProcent && <div>aan {eur(a.volgendeProcent.tarief)} per procent</div>}</div>
        </div>
        {a.algemeneKosten.vanContracten > 0 && <p className="mt-2 text-xs text-gray-500">WAM bracht minder op dan de kosten: {eur(a.algemeneKosten.vanContracten)} gaat van de contracten af.</p>}
      </section>

      {/* Lijsten */}
      <div>
        <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
          {([
            ['contracten', `Contracten (${data.contracten.length})`],
            ['beoordelen', `Te beoordelen (${data.teBeoordelen.length})`],
            ['kosten', `Algemene kosten (${data.kosten.length})`],
          ] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === k ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {l}
              {k === 'beoordelen' && data.teBeoordelen.length > 0 && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gray-900 align-middle" />}
            </button>
          ))}
        </div>

        {tab === 'contracten' && (
          <div className="pt-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              {ik ? (
                <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={alleenOpen} onChange={(e) => setAlleenOpen(e.target.checked)} className="h-4 w-4 accent-gray-900" />
                  Enkel wat ik nog moet tekenen ({mijnOpen.contracten.length})
                </label>
              ) : <span />}
              <button type="button" onClick={() => setNieuwContract(true)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Plus className="h-3.5 w-3.5" />Contract buiten Contracten</button>
            </div>
            {zichtbareContracten.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">{alleenOpen ? 'Alles getekend. Niets meer te doen.' : 'Nog geen contracten.'}</p>}
            <ul className="space-y-2">
              {zichtbareContracten.map((c) => <ContractKaart key={c.id} c={c} vennoten={data.vennoten} onOpen={() => setOpen({ soort: 'contract', id: c.id })} />)}
            </ul>
          </div>
        )}

        {tab === 'beoordelen' && <Beoordelen lijst={data.teBeoordelen} nietMee={data.nietMee} onTeltMee={setBeoordeel} onVernieuw={vernieuw} />}

        {tab === 'kosten' && (
          <div className="pt-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <p className="text-sm text-gray-500 max-w-xl">Kosten die van Marco&apos;s totaal afgaan, zoals de afsluiting van WAM. Ze gaan eerst af van wat WAM opbracht; wat overblijft van de contracten.</p>
              {!nieuweKost && <button type="button" onClick={() => setNieuweKost(true)} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Kost toevoegen</button>}
            </div>
            {nieuweKost && <div className="card-base"><KostForm k={null} onKlaar={() => { setNieuweKost(false); vernieuw() }} onAnnuleer={() => setNieuweKost(false)} /></div>}
            {data.kosten.length === 0 && !nieuweKost && <p className="text-sm text-gray-500 py-6 text-center">Geen algemene kosten.</p>}
            <ul className="space-y-2">
              {data.kosten.map((k) => <KostKaart key={k.id} k={k} vennoten={data.vennoten} onOpen={() => setOpen({ soort: 'kost', id: k.id })} />)}
            </ul>
          </div>
        )}
      </div>

      {contract && (
        <ContractVenster c={contract} vennoten={data.vennoten} ik={ik} laatste={laatste} onLaatste={setLaatste}
          onClose={() => setOpen(null)} onVernieuw={vernieuw}
          volgende={alleenOpen && ik && volgendeOpen(contract.id) ? () => setOpen(volgendeOpen(contract.id)) : null} />
      )}
      {kost && (
        <KostVenster k={kost} vennoten={data.vennoten} ik={ik} laatste={laatste} onLaatste={setLaatste}
          onClose={() => setOpen(null)} onVernieuw={vernieuw}
          volgende={alleenOpen && ik && volgendeOpen(kost.id) ? () => setOpen(volgendeOpen(kost.id)) : null} />
      )}
      {beoordeel && (
        <BeoordeelVenster k={beoordeel} klanten={data.klanten} onClose={() => setBeoordeel(null)}
          onToegevoegd={(id) => { setBeoordeel(null); setTab('contracten'); vernieuw(); if (id) setOpen({ soort: 'contract', id }) }} />
      )}
      {nieuwContract && (
        <PrijsToevoegen kandidaat={null} kandidaten={[]} klanten={data.klanten} onClose={() => setNieuwContract(false)}
          onBewaard={() => { setNieuwContract(false); setTab('contracten'); vernieuw() }}
          onUitgebreid={() => { setNieuwContract(false); router.push('/admin/vesting?weergave=uitgebreid') }} />
      )}
    </div>
  )
}

function Lijn({ label, waarde, sterk, zacht }: { label: string; waarde: string; sterk?: boolean; zacht?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2 ${sterk ? 'font-semibold text-gray-900' : zacht ? 'text-gray-500' : 'text-gray-700'}`}>
      <dt>{label}</dt><dd className="shrink-0">{waarde}</dd>
    </div>
  )
}

function ContractKaart({ c, vennoten, onOpen }: { c: ContractWeergave; vennoten: VestingWeergave['vennoten']; onOpen: () => void }) {
  const rollen = [c.afspraak && 'afspraak', c.closing && 'closing'].filter(Boolean).join(' + ') || 'geen rol'
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full text-left rounded-lg border border-gray-200 bg-white p-3.5 sm:p-4 hover:border-gray-400 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 truncate">{c.klant}</div>
            <div className="text-xs text-gray-500 truncate">{c.titel ?? c.nr} · {c.wachtOpKlant ? 'klant tekende nog niet' : datumKort(c.ondertekend_op)}</div>
          </div>
          <div className="text-right shrink-0">
            <div className={`font-semibold tabular-nums ${c.wachtOpKlant ? 'text-gray-400' : c.telt ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{eur(c.teltMee)}</div>
            <div className="text-[11px] text-gray-500">{c.wachtOpKlant ? 'na ondertekening' : c.telt ? 'telt mee' : 'telt niet'}</div>
          </div>
        </div>
        <div className="mt-2 text-xs text-gray-600 tabular-nums">
          {c.status === 'stopgezet' && c.akkoord.inhoud.soort === 'contract' && c.akkoord.inhoud.betaald_bij_stop !== null
            ? <>gestopt: {eur(c.akkoord.inhoud.betaald_bij_stop)} betaald × {Math.round(c.factor * 100)}%</>
            : c.status === 'niet_betaler' ? <>niet-betaler: telt voor € 0</>
            : <>{eur(c.totaal)}{c.kostenAftrek > 0 && <> − {eur(c.kostenAftrek)} kosten</>} = {eur(c.netto)} × {Math.round(c.factor * 100)}%</>}
          {' '}<span className="text-gray-400">({rollen})</span>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
          <TekenStand akkoord={c.akkoord} vennoten={vennoten} />
          <div className="flex gap-1.5">
            {c.status === 'stopgezet' && <Tag>Vroegtijdig stopgezet</Tag>}
            {c.status === 'niet_betaler' && <Tag>Niet-betaler</Tag>}
            {c.wachtOpKlant && <Tag>Wacht op de klant</Tag>}
            {c.definitief && c.status !== 'stopgezet' && <Tag>Betaald</Tag>}
          </div>
        </div>
      </button>
    </li>
  )
}

function KostKaart({ k, vennoten, onOpen }: { k: KostWeergave; vennoten: VestingWeergave['vennoten']; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full text-left rounded-lg border border-gray-200 bg-white p-3.5 sm:p-4 hover:border-gray-400 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 truncate">{k.omschrijving}</div>
            <div className="text-xs text-gray-500">{datumKort(k.datum)}</div>
          </div>
          <div className="font-semibold tabular-nums shrink-0">− {eur(k.bedrag)}</div>
        </div>
        <div className="mt-2.5"><TekenStand akkoord={k.akkoord} vennoten={vennoten} /></div>
      </button>
    </li>
  )
}

const Tag = ({ children }: { children: React.ReactNode }) => <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{children}</span>

/** Elk contract uit Contracten/Projecten: telt het mee voor Marco of niet? */
function Beoordelen({ lijst, nietMee, onTeltMee, onVernieuw }: { lijst: KandidaatContract[]; nietMee: KandidaatContract[]; onTeltMee: (k: KandidaatContract) => void; onVernieuw: () => void }) {
  const [bezig, setBezig] = useState<string | null>(null)
  const [toonNiet, setToonNiet] = useState(false)

  const zet = async (k: KandidaatContract, actie: 'telt_niet' | 'herstel') => {
    setBezig(k.id)
    try {
      await api('/api/admin/vesting/beoordeel', { method: 'POST', body: JSON.stringify({ contract_id: k.id, actie }) })
      if (actie === 'telt_niet') {
        toast.success(`${k.klant ?? k.titel} telt niet mee.`, {
          action: { label: 'Ongedaan maken', onClick: async () => { await api('/api/admin/vesting/beoordeel', { method: 'POST', body: JSON.stringify({ contract_id: k.id, actie: 'herstel' }) }).catch(() => {}); onVernieuw() } },
        })
      } else toast.success('Staat terug bij Te beoordelen.')
      onVernieuw()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  return (
    <div className="pt-4 space-y-3">
      <p className="text-sm text-gray-500 max-w-2xl">Elk contract dat in de app aangemaakt wordt, komt hier. Heeft Marco de afspraak gezet of de klant geclosed? Dan telt het mee. Anders niet.</p>
      {lijst.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">Alles beoordeeld.</p>}
      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
        {lijst.map((k) => (
          <li key={k.id} className="flex items-center gap-3 px-3.5 py-3 flex-wrap sm:flex-nowrap">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-gray-900 truncate">{k.klant ?? '—'}</div>
              <div className="text-xs text-gray-500 truncate">{k.titel} · {isGetekend(k.status) ? `getekend ${datumKort(k.signed_at)}` : (STATUS_KLANT[k.status] ?? k.status)}</div>
            </div>
            <div className="text-sm tabular-nums text-gray-700 shrink-0">{k.waarde ? eur(k.waarde) : <span className="text-gray-400">geen waarde</span>}</div>
            <div className="flex gap-1.5 shrink-0">
              <button type="button" onClick={() => onTeltMee(k)} className="btn-primary text-xs h-8">Telt mee</button>
              <button type="button" onClick={() => zet(k, 'telt_niet')} disabled={bezig === k.id} className="btn-secondary text-xs h-8">
                {bezig === k.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}Telt niet mee
              </button>
            </div>
          </li>
        ))}
      </ul>
      {nietMee.length > 0 && (
        <div>
          <button type="button" onClick={() => setToonNiet((x) => !x)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black">
            {toonNiet ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}Telt niet mee ({nietMee.length})
          </button>
          {toonNiet && (
            <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
              {nietMee.map((k) => (
                <li key={k.id} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-gray-700 truncate">{k.klant ?? '—'}</div>
                    <div className="text-xs text-gray-500 truncate">{k.titel}</div>
                  </div>
                  <button type="button" onClick={() => zet(k, 'herstel')} disabled={bezig === k.id} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black shrink-0">
                    {bezig === k.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}Terugzetten
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
