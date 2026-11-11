'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Ban, ChevronDown, ChevronUp, FileText, Loader2, Minus, PenLine, Plus, RotateCcw } from 'lucide-react'
import { isGetekend, type KandidaatContract } from '@/lib/vesting-snel'
import type { ContractWeergave, RegistratieWeergave, VestingWeergave } from '@/lib/vesting-weergave'
import { PrijsToevoegen } from '../prijs-toevoegen'
import { TekenStand, api, datumKort, eur, pct } from './delen'
import { ContractVenster } from './contract-venster'
import { BeoordeelVenster } from './beoordeel-venster'
import { InkomstRegistreren, KostRegistreren, RegistratieVenster } from './registratie-venster'
import { Register } from './register'
import { RegelsKaart, RegelsKnop, RegelsVenster, type RegelsBegin } from '@/components/admin/regels-akkoord'
import type { RegelsData } from '@/lib/regels-akkoord'

type Tab = 'contracten' | 'beoordelen' | 'registraties' | 'register'
type Open = { soort: 'contract' | 'registratie'; id: string } | null

const STATUS_KLANT: Record<string, string> = { draft: 'Concept', sent: 'Bij de klant', viewed: 'Bekeken door de klant', signed: 'Getekend', getekend: 'Getekend' }

/**
 * Vesting in één scherm: hoeveel aandelen iedereen nu heeft, hoe Marco daaraan
 * komt, welke contracten meetellen (met kosten en wie tekende), wat nog
 * beoordeeld moet worden, de inkomsten en kosten met verantwoording en het
 * register van alle handtekeningen. Alles komt uitgerekend van de server.
 */
export function VestingOverzicht({ data, tekenen, regels, regelsOpen = false }: { data: VestingWeergave; tekenen: boolean; regels: RegelsData; regelsOpen?: boolean }) {
  const router = useRouter()
  const [, start] = useTransition()
  const vernieuw = useCallback(() => start(() => router.refresh()), [router])
  const ik = data.ik.vennoot

  const [tab, setTab] = useState<Tab>(data.teBeoordelen.length && !tekenen ? 'beoordelen' : 'contracten')
  const [open, setOpen] = useState<Open>(null)
  const [beoordeel, setBeoordeel] = useState<KandidaatContract | null>(null)
  const [laatste, setLaatste] = useState<string | null>(null)
  const [alleenOpen, setAlleenOpen] = useState(tekenen && !!ik)
  const [nieuw, setNieuw] = useState<'contract' | 'inkomst' | 'kost' | null>(null)
  const [regelsVenster, setRegelsVenster] = useState<RegelsBegin | null>(regelsOpen ? 'bekijk' : null)

  const mijnOpen = useMemo(() => (ik ? {
    contracten: data.contracten.filter((c) => c.akkoord.stand.per[ik].stand !== 'getekend'),
    registraties: data.registraties.filter((r) => r.akkoord.stand.per[ik].stand !== 'getekend'),
  } : { contracten: [], registraties: [] }), [data, ik])
  const aantalOpen = mijnOpen.contracten.length + mijnOpen.registraties.length
  const openLijst: NonNullable<Open>[] = useMemo(() => [
    ...mijnOpen.contracten.map((c) => ({ soort: 'contract' as const, id: c.id })),
    ...mijnOpen.registraties.map((r) => ({ soort: 'registratie' as const, id: r.id })),
  ], [mijnOpen])

  // Tekenronde: open meteen het eerste item dat op jou wacht.
  useEffect(() => {
    if (tekenen && ik && openLijst.length && !open) setOpen(openLijst[0])
    // Enkel bij het openen van de pagina.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const volgendeOpen = (huidig: string): Open => openLijst.find((x) => x.id !== huidig) ?? null
  const startTekenen = () => {
    setAlleenOpen(true)
    setTab(mijnOpen.contracten.length ? 'contracten' : 'registraties')
    setOpen(openLijst[0] ?? null)
  }

  const contract = open?.soort === 'contract' ? data.contracten.find((c) => c.id === open.id) ?? null : null
  const registratie = open?.soort === 'registratie' ? data.registraties.find((r) => r.id === open.id) ?? null : null
  const zichtbareContracten = alleenOpen && ik ? mijnOpen.contracten : data.contracten
  const zichtbareRegistraties = alleenOpen && ik ? mijnOpen.registraties : data.registraties
  const a = data.aandelen
  const inkomsten = data.registraties.filter((r) => r.soort === 'inkomst')
  const kosten = data.registraties.filter((r) => r.soort === 'kost')

  return (
    <div className="space-y-6 animate-fade-in max-w-5xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Vesting</h1>
          <p className="text-sm text-gray-500 mt-0.5">Wat meetelt voor Marco, wat eraf gaat, en wie getekend heeft.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <RegelsKnop set="vesting" data={regels} onOpen={setRegelsVenster} />
          <button type="button" onClick={() => setNieuw('inkomst')} className="btn-secondary text-sm"><Plus className="h-4 w-4" />Inkomst registreren</button>
          <button type="button" onClick={() => setNieuw('kost')} className="btn-secondary text-sm"><Minus className="h-4 w-4" />Kost registreren</button>
        </div>
      </div>

      {ik && aantalOpen > 0 && (
        <div className="rounded-lg bg-gray-900 text-white p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-semibold">{aantalOpen === 1 ? 'Eén kaart wacht' : `${aantalOpen} kaarten wachten`} op jouw handtekening</div>
            <div className="text-sm text-gray-300">Kijk de cijfers na en teken. Verandert er later iets, dan teken je opnieuw.</div>
          </div>
          <button type="button" onClick={startTekenen} className="inline-flex items-center gap-2 rounded-md bg-white text-gray-900 px-3.5 py-2 text-sm font-medium hover:bg-gray-100">
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
        <div className="mt-3 rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-600 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-medium text-gray-900">Volgens wat alle drie tekenden:</span>
          <span>Bram {pct(a.bramGetekend)}</span><span>Chiara {pct(a.chiara)}</span><span>Marco {pct(a.marcoGetekend)}</span>
          <span className="text-gray-500">· {a.getekend.volledig} van {a.getekend.totaal} kaarten volledig getekend</span>
        </div>
        <p className="mt-2 text-[11px] text-gray-500">Hele procenten, afgerond naar beneden. Bovenaan staat wat nu meetelt; het grijze vak telt enkel de laatste versie die Marco, Bram en Chiara alle drie tekenden.</p>
      </section>

      {/* Hoe Marco aan zijn aandeel komt */}
      <section className="card-base">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Hoe Marco aan {pct(a.marco)} komt</h2>
        <dl className="text-sm tabular-nums divide-y divide-gray-100">
          <Lijn label={`Inkomsten via WAM of een andere weg (${a.wam.aantal})`} waarde={eur(a.wam.ontvangen)} />
          {a.algemeneKosten.totaal > 0 && <Lijn label={`Algemene kosten (${kosten.filter((k) => !k.geschrapt).length})`} waarde={`− ${eur(a.algemeneKosten.totaal)}`} />}
          <Lijn label={`Contracten die meetellen (${a.contracten.aantal})`} waarde={eur(a.contracten.teltMee)} />
          <Lijn label="Telt mee voor Marco" waarde={eur(a.meetellend)} sterk />
        </dl>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-600">
          <div className="rounded-md bg-gray-50 px-3 py-2"><div className="text-gray-500">Via inkomsten (WAM)</div><div className="text-sm font-semibold text-gray-900">{pct(a.wam.aandeel)}</div><div>elke {eur(a.wam.bedragPerPct)} netto = 1%, tot {pct(a.wam.max)}</div></div>
          <div className="rounded-md bg-gray-50 px-3 py-2"><div className="text-gray-500">Via contracten</div><div className="text-sm font-semibold text-gray-900">{pct(a.contracten.aandeel)}</div><div>tarief volgens het jaar van ondertekening</div></div>
          <div className="rounded-md bg-gray-50 px-3 py-2 col-span-2 sm:col-span-1"><div className="text-gray-500">Tot de volgende procent</div><div className="text-sm font-semibold text-gray-900">{a.volgendeProcent ? eur(a.volgendeProcent.nodig) : 'Maximum bereikt'}</div>{a.volgendeProcent && <div>aan {eur(a.volgendeProcent.tarief)} per procent</div>}</div>
        </div>
        {a.algemeneKosten.vanContracten > 0 && <p className="mt-2 text-xs text-gray-500">De inkomsten dekken de algemene kosten niet: {eur(a.algemeneKosten.vanContracten)} gaat van de contracten af, vanaf het eerste.</p>}
      </section>

      {/* Lijsten */}
      <div>
        <div className="flex items-center gap-1 border-b border-gray-200 overflow-x-auto">
          {([
            ['contracten', `Contracten (${data.contracten.length})`],
            ['beoordelen', `Te beoordelen (${data.teBeoordelen.length})`],
            ['registraties', `Inkomsten en kosten (${data.registraties.length})`],
            ['register', 'Handtekeningen'],
          ] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${tab === k ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
              {l}
              {k === 'beoordelen' && data.teBeoordelen.length > 0 && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-gray-900 align-middle" />}
            </button>
          ))}
        </div>

        {(tab === 'contracten' || tab === 'registraties') && ik && (
          <label className="mt-4 inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={alleenOpen} onChange={(e) => setAlleenOpen(e.target.checked)} className="h-4 w-4 accent-gray-900" />
            Enkel wat ik nog moet tekenen ({tab === 'contracten' ? mijnOpen.contracten.length : mijnOpen.registraties.length})
          </label>
        )}

        {tab === 'contracten' && (
          <div className="pt-3 space-y-3">
            <div className="flex justify-end">
              <button type="button" onClick={() => setNieuw('contract')} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Plus className="h-3.5 w-3.5" />Contract buiten Contracten</button>
            </div>
            {zichtbareContracten.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">{alleenOpen ? 'Alles getekend. Niets meer te doen.' : 'Nog geen contracten.'}</p>}
            <ul className="space-y-2">
              {zichtbareContracten.map((c) => <ContractKaart key={c.id} c={c} vennoten={data.vennoten} onOpen={() => setOpen({ soort: 'contract', id: c.id })} />)}
            </ul>
          </div>
        )}

        {tab === 'beoordelen' && <Beoordelen lijst={data.teBeoordelen} nietMee={data.nietMee} onTeltMee={setBeoordeel} onVernieuw={vernieuw} />}

        {tab === 'registraties' && (
          <div className="pt-3 space-y-5">
            <p className="text-sm text-gray-500 max-w-2xl">
              Inkomsten die niet uit een gewoon klantcontract komen, zoals WAM dat voortaan via de BV gefactureerd wordt, en kosten die van Marco&apos;s totaal afgaan. Altijd met een verantwoording; elke registratie en elke aanpassing tekenen jullie alle drie.
            </p>
            {zichtbareRegistraties.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">{alleenOpen ? 'Alles getekend. Niets meer te doen.' : 'Nog niets geregistreerd.'}</p>}
            {(['inkomst', 'kost'] as const).map((soort) => {
              const lijst = zichtbareRegistraties.filter((r) => r.soort === soort)
              if (!lijst.length) return null
              return (
                <div key={soort}>
                  <h3 className="text-xs font-medium text-gray-500 mb-2">{soort === 'inkomst' ? `Inkomsten (${inkomsten.length})` : `Algemene kosten (${kosten.length})`}</h3>
                  <ul className="space-y-2">{lijst.map((r) => <RegistratieKaart key={r.id} r={r} vennoten={data.vennoten} onOpen={() => setOpen({ soort: 'registratie', id: r.id })} />)}</ul>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'register' && <Register vennoten={data.vennoten} />}
      </div>

      {contract && (
        <ContractVenster c={contract} vennoten={data.vennoten} ik={ik} laatste={laatste} onLaatste={setLaatste}
          onClose={() => setOpen(null)} onVernieuw={vernieuw}
          volgende={alleenOpen && ik && volgendeOpen(contract.id) ? () => setOpen(volgendeOpen(contract.id)) : null} />
      )}
      {registratie && (
        <RegistratieVenster r={registratie} vennoten={data.vennoten} ik={ik} laatste={laatste} onLaatste={setLaatste}
          onClose={() => setOpen(null)} onVernieuw={vernieuw}
          volgende={alleenOpen && ik && volgendeOpen(registratie.id) ? () => setOpen(volgendeOpen(registratie.id)) : null} />
      )}
      {beoordeel && (
        <BeoordeelVenster k={beoordeel} klanten={data.klanten} onClose={() => setBeoordeel(null)}
          onToegevoegd={(id) => { setBeoordeel(null); setTab('contracten'); vernieuw(); if (id) setOpen({ soort: 'contract', id }) }} />
      )}
      {nieuw === 'inkomst' && (
        <InkomstRegistreren onClose={() => setNieuw(null)}
          onKlaar={(id) => { setNieuw(null); setTab('registraties'); vernieuw(); if (id) setOpen({ soort: 'registratie', id }) }} />
      )}
      {nieuw === 'kost' && (
        <KostRegistreren contracten={data.contracten} onClose={() => setNieuw(null)}
          onKlaar={(o) => { setNieuw(null); vernieuw(); if (o) { setTab(o.soort === 'contract' ? 'contracten' : 'registraties'); setOpen(o.soort === 'contract' ? { soort: 'contract', id: o.id } : { soort: 'registratie', id: o.id }) } }} />
      )}
      {nieuw === 'contract' && (
        <PrijsToevoegen kandidaat={null} kandidaten={[]} klanten={data.klanten} onClose={() => setNieuw(null)}
          onBewaard={() => { setNieuw(null); setTab('contracten'); vernieuw() }}
          onUitgebreid={() => { setNieuw(null); router.push('/admin/vesting?weergave=uitgebreid') }} />
      )}

      <RegelsKaart set="vesting" data={regels} onOpen={setRegelsVenster} />
      {regelsVenster && (
        <RegelsVenster set="vesting" data={regels} begin={regelsVenster} onSluit={() => setRegelsVenster(null)}
          onKlaar={(m) => { toast.success(m); vernieuw() }} />
      )}

      <p className="text-xs text-gray-400">
        Status, facturen en termijnen per contract en de instellingen staan in de <Link href="/admin/vesting?weergave=uitgebreid" className="underline hover:text-black">uitgebreide weergave</Link>.
      </p>
    </div>
  )
}

function Lijn({ label, waarde, sterk }: { label: string; waarde: string; sterk?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-2 ${sterk ? 'font-semibold text-gray-900' : 'text-gray-700'}`}>
      <dt>{label}</dt><dd className="shrink-0">{waarde}</dd>
    </div>
  )
}

/** De rekensom van een contract in één regel: waarde − kosten = netto × deel = telt mee = %. */
function rekensomTekst(c: ContractWeergave): string {
  const rol = c.afspraak && c.closing ? 'afspraak gezet en geclosed' : c.afspraak ? 'afspraak gezet' : c.closing ? 'geclosed' : 'geen rol'
  const deel = `${Math.round(c.factor * 100)}% (${c.toerekening_pct !== null ? 'eigen verdeling' : rol})`
  const procent = c.telt && !c.wachtOpKlant ? ` = ${pct(c.ruweVesting, 2)}` : ''
  if (c.status === 'niet_betaler') return 'Niet-betaler: telt voor € 0'
  if (c.status === 'stopgezet' && c.akkoord.inhoud.soort === 'contract' && c.akkoord.inhoud.betaald_bij_stop !== null) {
    return `Gestopt: ${eur(c.akkoord.inhoud.betaald_bij_stop)} betaald × ${deel} = ${eur(c.teltMee)} telt mee${procent}`
  }
  const kosten = c.kostenAftrek > 0 ? ` − ${eur(c.kostenAftrek)} kosten = ${eur(c.netto)} netto` : ''
  return `Contractwaarde ${eur(c.totaal)}${kosten} × ${deel} = ${eur(c.teltMee)} telt mee${procent}`
}

function ContractKaart({ c, vennoten, onOpen }: { c: ContractWeergave; vennoten: VestingWeergave['vennoten']; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="w-full text-left rounded-lg border border-gray-200 bg-white p-3.5 sm:p-4 hover:border-gray-400 transition-colors">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 truncate">{c.klant}</div>
            <div className="text-xs text-gray-500 truncate">{c.titel ?? c.nr} · {c.wachtOpKlant ? 'klant tekende nog niet' : datumKort(c.ondertekend_op)}</div>
          </div>
          <div className="text-right shrink-0">
            <div className={`font-semibold tabular-nums ${c.wachtOpKlant ? 'text-gray-400' : c.telt ? 'text-gray-900' : 'text-gray-400 line-through'}`}>{c.telt && !c.wachtOpKlant ? pct(c.ruweVesting, 2) : eur(c.teltMee)}</div>
            <div className="text-[11px] text-gray-500">{c.wachtOpKlant ? 'na ondertekening' : c.telt ? `${eur(c.teltMee)} telt mee` : 'telt niet'}</div>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-gray-500 tabular-nums leading-snug">{rekensomTekst(c)}</div>
        <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
          <TekenStand akkoord={c.akkoord} vennoten={vennoten} />
          <div className="flex gap-1.5">
            {c.status === 'stopgezet' && <Tag>Vroegtijdig stopgezet</Tag>}
            {c.status === 'niet_betaler' && <Tag>Niet-betaler</Tag>}
            {c.wachtOpKlant && <Tag>Wacht op de klant</Tag>}
            {c.definitief && c.status !== 'stopgezet' && <Tag>Betaald</Tag>}
            {c.certificaat?.huidig && <Tag>Certificaat {c.certificaat.nummer}</Tag>}
          </div>
        </div>
      </button>
    </li>
  )
}

function RegistratieKaart({ r, vennoten, onOpen }: { r: RegistratieWeergave; vennoten: VestingWeergave['vennoten']; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className={`w-full text-left rounded-lg border bg-white p-3.5 sm:p-4 hover:border-gray-400 transition-colors ${r.geschrapt ? 'border-dashed border-gray-300 opacity-70' : 'border-gray-200'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-medium text-gray-900 truncate">{r.geschrapt && <span className="text-red-700">Geschrapt · </span>}{r.omschrijving}</div>
            <div className="text-xs text-gray-500 truncate">{datumKort(r.datum)}{r.referentie ? ` · ${r.referentie}` : ''}</div>
          </div>
          <div className={`font-semibold tabular-nums shrink-0 ${r.geschrapt ? 'line-through text-gray-400' : ''}`}>{r.soort === 'kost' ? '− ' : '+ '}{eur(r.bedrag)}</div>
        </div>
        {r.verantwoording && <div className="mt-1.5 text-[11px] text-gray-500 line-clamp-2">{r.verantwoording}</div>}
        <div className="mt-1 text-[11px]">{r.bewijs ? <span className="inline-flex items-center gap-1 text-gray-500"><FileText className="h-3 w-3" />{r.bewijs.naam}</span> : <span className="text-amber-700">Nog geen document</span>}</div>
        <div className="mt-2.5 flex items-center justify-between gap-2 flex-wrap">
          <TekenStand akkoord={r.akkoord} vennoten={vennoten} />
          {r.certificaat?.huidig && <Tag>Certificaat {r.certificaat.nummer}</Tag>}
        </div>
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
      {lijst.length > 0 && (
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
      )}
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
