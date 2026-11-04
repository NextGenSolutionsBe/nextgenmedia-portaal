'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ExternalLink, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { leesGetal } from '@/lib/getal'
import { KOST_SOORTEN, kostSoortLabel, type KostSoort, type Vennoot } from '@/lib/vesting-akkoord'
import type { ContractWeergave } from '@/lib/vesting-weergave'
import { Akkoord, Paneel, Rekensom, RolKnop, api, datumKort, eur } from './delen'

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

  const patch = async (velden: Record<string, unknown>, sleutel: string) => {
    setBezig(sleutel)
    try {
      await api('/api/admin/vesting', { method: 'PATCH', body: JSON.stringify({ resource: 'contract', id: c.id, ...velden }) })
      onVernieuw()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(null) }
  }

  const eigenVerdeling = c.toerekening_pct !== null
  const regels = [
    { label: 'Contractwaarde', waarde: eur(c.totaal, true) },
    { label: c.kostLijnen.length || c.kostenAftrek ? 'Kosten' : 'Kosten (geen)', waarde: c.kostenAftrek ? `− ${eur(c.kostenAftrek, true)}` : eur(0) },
    { label: 'Netto', waarde: eur(c.netto, true) },
    ...(c.status === 'stopgezet' ? [{ label: 'Vroegtijdig stopgezet: wat de klant betaalde', waarde: c.akkoord.inhoud.soort === 'contract' && c.akkoord.inhoud.betaald_bij_stop !== null ? eur(c.akkoord.inhoud.betaald_bij_stop, true) : 'nog in te vullen' }] : []),
    ...(c.status === 'niet_betaler' ? [{ label: 'Niet-betaler', waarde: '€ 0' }] : []),
    { label: `Deel van Marco${eigenVerdeling ? ' (eigen verdeling)' : ''}`, waarde: `× ${Math.round(c.factor * 100)}%` },
    { label: 'Telt mee voor Marco', waarde: eur(c.teltMee, true), sterk: true },
    ...(c.algemeneKostenAftrek > 0 ? [{ label: 'Waarvan naar algemene kosten (afsluiting WAM)', waarde: `− ${eur(c.algemeneKostenAftrek, true)}`, zacht: true }] : []),
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

      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Wat deed Marco?</h3>
        <div className="flex flex-wrap gap-2">
          <RolKnop aan={c.afspraak} label="Afspraak gezet" bezig={bezig === 'afspraak'} onClick={() => patch({ appointment_door_marco: !c.afspraak }, 'afspraak')} />
          <RolKnop aan={c.closing} label="Klant geclosed" bezig={bezig === 'closing'} onClick={() => patch({ closed_door_marco: !c.closing }, 'closing')} />
        </div>
        {eigenVerdeling && (
          <p className="mt-2 text-xs text-amber-800">
            Voor dit contract geldt een eigen verdeling van {c.toerekening_pct}%.{' '}
            <button type="button" className="underline" onClick={() => patch({ toerekening_pct: null }, 'verdeling')}>Terug naar 50% + 50%</button>
          </p>
        )}
      </section>

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

      <Kosten c={c} onVernieuw={onVernieuw} />

      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Wat telt mee</h3>
        <Rekensom regels={regels} />
      </section>

      <Akkoord onderwerp="contract" id={c.id} akkoord={c.akkoord} vennoten={vennoten} ik={ik} laatste={laatste} onLaatste={onLaatste}
        onGetekend={onVernieuw}
        uitleg={`Je tekent dat ${eur(c.teltMee, true)} van dit contract meetelt voor de vesting van Marco: ${eur(c.totaal)} min ${eur(c.kostenAftrek)} kosten, ${Math.round(c.factor * 100)}% voor Marco.`} />
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

/** De kosten die van de contractwaarde afgaan: hosting, onderaanneming, advertentiebudget … */
function Kosten({ c, onVernieuw }: { c: ContractWeergave; onVernieuw: () => void }) {
  const [soort, setSoort] = useState<KostSoort>('hosting')
  const [omschrijving, setOmschrijving] = useState('')
  const [bedrag, setBedrag] = useState('')
  const [bezig, setBezig] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const som = c.kostLijnen.reduce((s, l) => s + l.bedrag, 0)

  const voegToe = async () => {
    setBezig('nieuw')
    try {
      await api('/api/admin/vesting/kosten', { method: 'POST', body: JSON.stringify({ vesting_contract_id: c.id, soort, omschrijving, bedrag: leesGetal(bedrag) }) })
      setOmschrijving(''); setBedrag(''); setOpen(false)
      onVernieuw()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(null) }
  }
  const verwijder = async (id: string) => {
    setBezig(id)
    try { await api(`/api/admin/vesting/kosten?id=${id}`, { method: 'DELETE' }); onVernieuw() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBezig(null) }
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-900">Kosten verbonden aan dit contract</h3>
        {!open && <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Plus className="h-3 w-3" />Kost toevoegen</button>}
      </div>
      {c.kostLijnen.length === 0 && !open && <p className="text-sm text-gray-500">Geen kosten. Hosting, onderaanneming of advertentiebudget? Voeg ze toe, dan gaan ze van de waarde af.</p>}
      {c.kostLijnen.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
          {c.kostLijnen.map((l) => (
            <li key={l.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="text-gray-900">{kostSoortLabel(l.soort)}</div>
                {l.omschrijving && <div className="text-xs text-gray-500 truncate">{l.omschrijving}</div>}
              </div>
              <span className="tabular-nums">{eur(l.bedrag, true)}</span>
              <button type="button" onClick={() => verwijder(l.id)} disabled={bezig === l.id} className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50" aria-label="Kost verwijderen">
                {bezig === l.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </li>
          ))}
          {c.kostLijnen.length > 1 && <li className="flex justify-between px-3 py-2 text-gray-600"><span>Samen</span><span className="tabular-nums font-medium">{eur(som, true)}</span></li>}
        </ul>
      )}
      {c.kostenFacturen !== null && c.kostenFacturen > som + 0.005 && (
        <p className="mt-2 text-xs text-gray-600">Op de facturen van dit contract staan {eur(c.kostenFacturen, true)} directe kosten. Het hoogste bedrag gaat eraf.</p>
      )}
      {open && (
        <div className="mt-2 rounded-lg border border-gray-200 p-3 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-2">
            <select className={INP} value={soort} onChange={(e) => setSoort(e.target.value as KostSoort)} aria-label="Soort kost">
              {KOST_SOORTEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
              <input className={`${INP} pl-7`} inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="0" aria-label="Bedrag excl. btw" autoFocus />
            </div>
          </div>
          <input className={INP} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} placeholder="Omschrijving (optioneel), bv. hosting 12 maanden" maxLength={200} />
          <div className="flex gap-2">
            <button type="button" onClick={voegToe} disabled={bezig === 'nieuw' || !(leesGetal(bedrag) ?? 0)} className="btn-primary text-sm">{bezig === 'nieuw' && <Loader2 className="h-4 w-4 animate-spin" />}Toevoegen</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-sm">Annuleren</button>
          </div>
        </div>
      )}
    </section>
  )
}
