'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ExternalLink, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { leesGetal } from '@/lib/getal'
import { leadInfo } from '@/lib/vesting'
import { GestoptBlok } from './gestopt'
import { KOST_SOORTEN, kostSoortLabel, type KostSoort, type Vennoot } from '@/lib/vesting-akkoord'
import type { ContractWeergave } from '@/lib/vesting-weergave'
import { Akkoord, LeadKiezer, Paneel, Rekensom, RolKnop, api, datumKort, eur, pct, procentUitleg } from './delen'
import { BewijsKiezer, BewijsLink, FactuurToevoegen, type BewijsWaarde } from './bewijs-kiezer'

const INP = 'input-base'

/**
 * Eén contract: wat deed Marco (afspraak 50%, closing 50%), de contractwaarde,
 * de kosten die eraf gaan, de rekensom en het akkoord van de drie vennoten.
 * Elke wijziging bewaart meteen; wie al tekende, tekent dan opnieuw.
 */
export function ContractVenster({ c, vennoten, ik, laatste, onLaatste, onClose, onVernieuw, volgende }: {
  c: ContractWeergave
  vennoten: Record<Vennoot, string>
  ik: Vennoot | null
  laatste: string | null
  onLaatste: (png: string) => void
  onClose: () => void
  onVernieuw: () => void
  /** In de tekenronde: naar het volgende contract dat op jou wacht. */
  volgende?: (() => void) | null
}) {
  const [bezig, setBezig] = useState<string | null>(null)
  const [waardeOpen, setWaardeOpen] = useState(false)

  const patch = async (velden: Record<string, unknown>, sleutel: string): Promise<boolean> => {
    setBezig(sleutel)
    try {
      await api('/api/admin/vesting', { method: 'PATCH', body: JSON.stringify({ resource: 'contract', id: c.id, ...velden }) })
      onVernieuw()
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); return false } finally { setBezig(null) }
  }

  const eigenVerdeling = c.toerekening_pct !== null
  const regels = c.vast !== null ? [
    ...(c.totaal !== null ? [{ label: 'Contractwaarde', waarde: eur(c.totaal, true) }] : []),
    { label: 'Klant vroeger gestopt: vastgelegd bedrag', waarde: eur(c.vast, true) },
    { label: 'Telt mee voor Marco', waarde: eur(c.teltMee, true), sterk: true },
    ...(c.algemeneKostenAftrek > 0 ? [{ label: 'Waarvan naar algemene kosten', waarde: `− ${eur(c.algemeneKostenAftrek, true)}`, zacht: true }] : []),
    ...(c.telt && !c.wachtOpKlant ? [{ label: 'Levert Marco op', waarde: pct(c.ruweVesting, 2), sterk: true }] : []),
  ] : [
    { label: 'Contractwaarde', waarde: eur(c.totaal, true) },
    { label: c.kostLijnen.length || c.kostenAftrek ? 'Kosten' : 'Kosten (geen)', waarde: c.kostenAftrek ? `− ${eur(c.kostenAftrek, true)}` : eur(0) },
    { label: 'Netto', waarde: eur(c.netto, true) },
    ...(c.status === 'stopgezet' ? [{ label: 'Vroegtijdig stopgezet: wat de klant betaalde', waarde: c.akkoord.inhoud.soort === 'contract' && c.akkoord.inhoud.betaald_bij_stop !== null ? eur(c.akkoord.inhoud.betaald_bij_stop, true) : 'nog in te vullen' }] : []),
    ...(c.status === 'niet_betaler' ? [{ label: 'Niet-betaler', waarde: '€ 0' }] : []),
    { label: `Deel van Marco${eigenVerdeling ? ' (eigen verdeling)' : c.lead_soort ? ` (${leadInfo(c.lead_soort)?.kort})` : ''}`, waarde: `× ${Math.round(c.factor * 100)}%` },
    // De kosten tellen tegen hetzelfde percentage als het contract: (waarde − kosten) × deel.
    ...(c.kostenAftrek > 0 && c.status !== 'stopgezet' && c.status !== 'niet_betaler' ? [{ label: `Kosten voor Marco (${Math.round(c.factor * 100)}% van ${eur(c.kostenAftrek)})`, waarde: `− ${eur(Math.round(c.kostenAftrek * c.factor * 100) / 100, true)}`, zacht: true }] : []),
    { label: 'Telt mee voor Marco', waarde: eur(c.teltMee, true), sterk: true },
    ...(c.algemeneKostenAftrek > 0 ? [{ label: 'Waarvan naar algemene kosten', waarde: `− ${eur(c.algemeneKostenAftrek, true)}`, zacht: true }] : []),
    ...(c.telt && !c.wachtOpKlant ? [{ label: 'Levert Marco op', waarde: pct(c.ruweVesting, 2), sterk: true }] : []),
  ]

  return (
    <Paneel
      titel={c.klant}
      sub={<span>{c.nr}{c.titel ? ` · ${c.titel}` : ''} · {c.wachtOpKlant ? 'de klant tekende nog niet' : `getekend ${datumKort(c.ondertekend_op)}`}</span>}
      onClose={onClose}
      voet={
        <div className="flex items-center gap-2 flex-wrap">
          {c.contract_id && <Link href={`/admin/contracts/${c.contract_id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black">Contract openen<ExternalLink className="h-3 w-3" /></Link>}
          <Link href="/admin/vesting?weergave=uitgebreid" className="text-xs text-gray-500 hover:text-black">Status, facturen en termijnen</Link>
          {volgende && <button type="button" onClick={volgende} className="btn-secondary text-sm ml-auto">Volgende</button>}
        </div>
      }
    >
      {c.wachtOpKlant && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          De klant tekende dit contract nog niet. Het telt mee vanaf de ondertekening; de datum komt dan vanzelf uit Contracten.
        </p>
      )}

      {c.vast === null && <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Hoe kwam de opdracht binnen?</h3>
        {!c.herkomst && (
          <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Nog niet aangeduid. Tot dan rekent dit contract zoals nu: met de afspraak en closing hieronder.
          </p>
        )}
        <LeadKiezer waarde={c.herkomst} bezig={bezig === 'lead'} onChange={(v) => patch({ lead_soort: v }, 'lead')} />
        {eigenVerdeling && (
          <p className="mt-2 text-xs text-amber-800">
            Voor dit contract geldt een eigen verdeling van {c.toerekening_pct}%. Die gaat voor op de regels.{' '}
            <button type="button" className="underline" onClick={() => patch({ toerekening_pct: null }, 'verdeling')}>Terug naar de regels</button>
          </p>
        )}
      </section>}

      {c.vast === null && !c.lead_soort && <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Wat deed Marco?</h3>
        <div className="flex flex-wrap gap-2">
          <RolKnop aan={c.afspraak} label="Afspraak gezet" bezig={bezig === 'afspraak'} onClick={() => patch({ appointment_door_marco: !c.afspraak }, 'afspraak')} />
          <RolKnop aan={c.closing} label="Klant geclosed" bezig={bezig === 'closing'} onClick={() => patch({ closed_door_marco: !c.closing }, 'closing')} />
        </div>
      </section>}

      <section>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Contractwaarde</h3>
          {!waardeOpen && <button type="button" onClick={() => setWaardeOpen(true)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Pencil className="h-3 w-3" />Aanpassen</button>}
        </div>
        {waardeOpen
          ? <WaardeForm c={c} onBewaar={async (v) => { await patch(v, 'waarde'); setWaardeOpen(false) }} onAnnuleer={() => setWaardeOpen(false)} bezig={bezig === 'waarde'} />
          : <div className="text-sm text-gray-700 tabular-nums">
              {c.totaal === null ? <span className="text-amber-700">Nog geen waarde ingevuld.</span>
                : c.facturatiemodel === 'maandcontract' && c.maandbedrag !== null && c.duur !== null
                  ? <>{eur(c.maandbedrag, true)} per maand × {c.duur.toLocaleString('nl-BE')} maanden = <b>{eur(c.totaal, true)}</b></>
                  : <b>{eur(c.totaal, true)}</b>}
              <span className="text-gray-400"> excl. btw</span>
            </div>}
      </section>

      {(c.vast === null || c.kostLijnen.length > 0) && <Kosten c={c} onVernieuw={onVernieuw} />}

      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Klant gestopt?</h3>
        <GestoptBlok c={c} bezig={bezig === 'gestopt'} onPatch={patch} />
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Wat telt mee</h3>
        <Rekensom regels={regels} />
        {c.telt && !c.wachtOpKlant && <p className="mt-2 text-xs text-gray-500">{procentUitleg(c)}</p>}
        {c.wachtOpKlant && <p className="mt-2 text-xs text-gray-500">Het percentage volgt zodra de klant tekent: het tarief hangt af van het jaar van ondertekening.</p>}
      </section>

      <Akkoord onderwerp="contract" id={c.id} akkoord={c.akkoord} certificaat={c.certificaat} vennoten={vennoten} ik={ik} laatste={laatste} onLaatste={onLaatste}
        onGetekend={onVernieuw}
        uitleg={c.vast !== null
          ? `Je tekent dat ${eur(c.teltMee, true)} van dit contract meetelt voor de vesting van Marco. De klant stopte vroeger; dit bedrag werd vastgelegd met de beschrijving hierboven.`
          : `Je tekent dat ${eur(c.teltMee, true)} van dit contract meetelt voor de vesting van Marco: ${eur(c.totaal)} min ${eur(c.kostenAftrek)} kosten, ${Math.round(c.factor * 100)}% voor Marco.`} />
    </Paneel>
  )
}

function WaardeForm({ c, onBewaar, onAnnuleer, bezig }: { c: ContractWeergave; onBewaar: (v: Record<string, unknown>) => void; onAnnuleer: () => void; bezig: boolean }) {
  const [soort, setSoort] = useState<'eenmalig' | 'maand'>(c.facturatiemodel === 'maandcontract' ? 'maand' : 'eenmalig')
  const [prijs, setPrijs] = useState(String((soort === 'maand' ? c.maandbedrag : c.totaal) ?? '').replace('.', ','))
  const [maanden, setMaanden] = useState(c.duur ? String(Math.round(c.duur)) : '')
  const p = leesGetal(prijs)
  const m = leesGetal(maanden)
  const totaal = p === null ? null : soort === 'eenmalig' ? p : m ? p * m : null
  const ok = p !== null && p > 0 && (soort === 'eenmalig' || (m !== null && Number.isInteger(m) && m > 0 && m <= 120))
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
          <input className={`${INP} pl-7`} inputMode="decimal" value={prijs} onChange={(e) => setPrijs(e.target.value)} autoFocus aria-label="Bedrag excl. btw" />
        </div>
        <div className="inline-flex rounded-md border border-gray-200 p-0.5 shrink-0">
          {(['eenmalig', 'maand'] as const).map((s) => (
            <button key={s} type="button" onClick={() => setSoort(s)} className={`px-2.5 rounded text-xs ${soort === s ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>{s === 'eenmalig' ? 'totaal' : 'per maand'}</button>
          ))}
        </div>
      </div>
      {soort === 'maand' && (
        <div className="flex items-center gap-2 text-sm"><input className={`${INP} w-20`} inputMode="numeric" value={maanden} onChange={(e) => setMaanden(e.target.value.replace(/\D/g, ''))} aria-label="Maanden" /><span className="text-gray-600">maanden {totaal !== null && <>= <b className="tabular-nums">{eur(totaal, true)}</b></>}</span></div>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-primary text-sm" disabled={!ok || bezig}
          onClick={() => onBewaar(soort === 'eenmalig'
            ? { facturatiemodel: 'eenmalig', handmatige_totaalwaarde: p, maandbedrag: null, duur_maanden: null }
            : { facturatiemodel: 'maandcontract', maandbedrag: p, duur_maanden: m, handmatige_totaalwaarde: null })}>
          {bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren
        </button>
        <button type="button" className="btn-secondary text-sm" onClick={onAnnuleer}>Annuleren</button>
      </div>
    </div>
  )
}

/**
 * De kosten die van de contractwaarde afgaan (hosting, onderaanneming,
 * advertentiebudget …). Een kost toevoegen kan altijd, ook achteraf en zonder
 * factuur (die voeg je later toe); aanpassen en weghalen ook. Elke wijziging
 * verandert de getekende cijfers, dus daarna tekent iedereen opnieuw.
 */
export function Kosten({ c, onVernieuw }: { c: ContractWeergave; onVernieuw: () => void }) {
  const [open, setOpen] = useState<string | 'nieuw' | null>(null)
  const [weg, setWeg] = useState<string | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const som = c.kostLijnen.reduce((s, l) => s + l.bedrag, 0)

  const verwijder = async (id: string) => {
    setBezig(id)
    try {
      await api(`/api/admin/vesting/kosten?id=${id}`, { method: 'DELETE' })
      toast.success('Kost weggehaald. Iedereen tekent het contract opnieuw.')
      setWeg(null)
      onVernieuw()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Weghalen mislukt') } finally { setBezig(null) }
  }

  return (
    <section>
      <h3 className="text-sm font-semibold text-gray-900 mb-2">Kosten verbonden aan dit contract</h3>
      {c.kostLijnen.length === 0 && open !== 'nieuw' && <p className="text-sm text-gray-500 mb-2">Nog geen kosten. Hosting, onderaanneming of advertentiebudget? Voeg ze toe, dan gaan ze van de waarde af.</p>}
      {c.kostLijnen.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
          {c.kostLijnen.map((l) => (
            <li key={l.id} className="px-3 py-2.5">
              {open === l.id
                ? <KostForm contractId={c.id} lijn={l} onKlaar={() => { setOpen(null); onVernieuw() }} onAnnuleer={() => setOpen(null)} />
                : (
                  <>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-gray-900">{kostSoortLabel(l.soort)}{l.omschrijving && <span className="text-gray-500"> · {l.omschrijving}</span>}</div>
                        {l.verantwoording && <div className="text-xs text-gray-500 whitespace-pre-wrap">{l.verantwoording}</div>}
                        <div className="mt-1">{l.bewijs ? <BewijsLink bewijs={l.bewijs} klein /> : <FactuurToevoegen klein onBewaar={async (bewijs) => { await api('/api/admin/vesting/kosten', { method: 'PATCH', body: JSON.stringify({ id: l.id, bewijs }) }); onVernieuw() }} />}</div>
                      </div>
                      <span className="tabular-nums font-medium">− {eur(l.bedrag, true)}</span>
                      <button type="button" onClick={() => { setWeg(null); setOpen(l.id) }} className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:text-black hover:bg-gray-100" aria-label="Kost aanpassen" title="Aanpassen"><Pencil className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => setWeg(weg === l.id ? null : l.id)} className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50" aria-label="Kost weghalen" title="Weghalen"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                    {weg === l.id && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-900">
                        <span className="flex-1 min-w-[160px]">{kostSoortLabel(l.soort)} van {eur(l.bedrag, true)} weghalen? Het telt dan niet meer mee.</span>
                        <button type="button" onClick={() => verwijder(l.id)} disabled={bezig === l.id} className="btn-danger text-xs h-7">{bezig === l.id && <Loader2 className="h-3 w-3 animate-spin" />}Ja, weghalen</button>
                        <button type="button" onClick={() => setWeg(null)} className="btn-secondary text-xs h-7">Nee</button>
                      </div>
                    )}
                  </>
                )}
            </li>
          ))}
          {c.kostLijnen.length > 1 && <li className="flex justify-between px-3 py-2 text-gray-600"><span>Samen</span><span className="tabular-nums font-medium">− {eur(som, true)}</span></li>}
        </ul>
      )}
      {c.kostenFacturen !== null && c.kostenFacturen > som + 0.005 && (
        <p className="mt-2 text-xs text-gray-600">Op de facturen van dit contract staan {eur(c.kostenFacturen, true)} directe kosten. Het hoogste bedrag gaat eraf.</p>
      )}
      {open === 'nieuw'
        ? <div className="mt-2 rounded-lg border border-gray-200 p-3"><KostForm contractId={c.id} onKlaar={() => { setOpen(null); onVernieuw() }} onAnnuleer={() => setOpen(null)} /></div>
        : <button type="button" onClick={() => { setWeg(null); setOpen('nieuw') }} className="btn-secondary text-sm mt-2"><Plus className="h-4 w-4" />{c.kostLijnen.length ? 'Nog een kost toevoegen' : 'Kost toevoegen'}</button>}
    </section>
  )
}

function KostForm({ contractId, lijn, onKlaar, onAnnuleer }: { contractId: string; lijn?: ContractWeergave['kostLijnen'][number]; onKlaar: () => void; onAnnuleer: () => void }) {
  const [soort, setSoort] = useState<KostSoort>(lijn?.soort ?? 'hosting')
  const [omschrijving, setOmschrijving] = useState(lijn?.omschrijving ?? '')
  const [bedrag, setBedrag] = useState(lijn ? String(lijn.bedrag).replace('.', ',') : '')
  const [verantwoording, setVerantwoording] = useState(lijn?.verantwoording ?? '')
  const [bewijs, setBewijs] = useState<BewijsWaarde>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const b = leesGetal(bedrag)

  const bewaar = async () => {
    // Nooit een grijze knop zonder uitleg: zeg wat er ontbreekt.
    if (b === null || b <= 0) { setFout('Vul het bedrag in (excl. btw), bv. 1500 of 1.500,50.'); return }
    setFout(null)
    setBezig(true)
    try {
      const velden = { soort, omschrijving: omschrijving.trim(), bedrag: b, verantwoording: verantwoording.trim(), ...(bewijs ? { bewijs } : {}) }
      if (lijn) await api('/api/admin/vesting/kosten', { method: 'PATCH', body: JSON.stringify({ id: lijn.id, ...velden }) })
      else await api('/api/admin/vesting/kosten', { method: 'POST', body: JSON.stringify({ vesting_contract_id: contractId, ...velden }) })
      toast.success(lijn ? 'Kost aangepast. Iedereen tekent het contract opnieuw.' : `Kost toegevoegd: ${eur(b, true)} gaat van de waarde af.${bewijs ? '' : ' De factuur voeg je later toe.'}`)
      onKlaar()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Soort kost</label>
          <select className={INP} value={soort} onChange={(e) => setSoort(e.target.value as KostSoort)}>
            {KOST_SOORTEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Bedrag (excl. btw)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
            <input className={`${INP} pl-7`} inputMode="decimal" value={bedrag} onChange={(e) => { setBedrag(e.target.value); setFout(null) }} onKeyDown={(e) => { if (e.key === 'Enter') bewaar() }} placeholder="0" autoFocus />
          </div>
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Omschrijving <span className="font-normal text-gray-400">(optioneel)</span></label>
        <input className={INP} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} placeholder="Bv. hosting 12 maanden" maxLength={200} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Waarom gaat dit eraf? <span className="font-normal text-gray-400">(optioneel)</span></label>
        <textarea className={`${INP} min-h-[56px]`} value={verantwoording} onChange={(e) => setVerantwoording(e.target.value)} placeholder="Bv. extra developer ingehuurd na de oplevering." maxLength={1000} />
      </div>
      <BewijsKiezer waarde={bewijs} onChange={setBewijs} bestaand={lijn?.bewijs ?? null} label="Factuur of contract van de kost" later={!lijn?.bewijs} />
      {fout && <p className="text-xs text-red-700">{fout}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{lijn ? 'Bewaren' : 'Kost toevoegen'}</button>
        <button type="button" onClick={onAnnuleer} className="btn-secondary text-sm">Annuleren</button>
      </div>
    </div>
  )
}
