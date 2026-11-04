'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { leesGetal } from '@/lib/getal'
import { KOST_SOORTEN, type KostSoort, type RegistratieSoort, type Vennoot } from '@/lib/vesting-akkoord'
import type { ContractWeergave, RegistratieWeergave } from '@/lib/vesting-weergave'
import { Akkoord, Paneel, api, datumKort, eur } from './delen'

const INP = 'input-base'
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

export const SOORT_TEKST: Record<RegistratieSoort, { titel: string; uitleg: string }> = {
  inkomst: {
    titel: 'Inkomst',
    uitleg: 'Telt mee zoals de WAM-afspraak: elke €5.000 netto = 1%, tot 5%.',
  },
  kost: {
    titel: 'Kost',
    uitleg: 'Gaat van Marco\'s totaal af: eerst van de inkomsten via WAM, wat overblijft van de contracten.',
  },
}

/** Een inkomst of algemene kost: de cijfers, de verantwoording, aanpassen of schrappen, en het akkoord. */
export function RegistratieVenster({ r, vennoten, ik, laatste, onLaatste, onClose, onVernieuw, volgende }: {
  r: RegistratieWeergave
  vennoten: Record<Vennoot, string>
  ik: Vennoot | null
  laatste: string | null
  onLaatste: (png: string) => void
  onClose: () => void
  onVernieuw: () => void
  volgende?: (() => void) | null
}) {
  const [bewerk, setBewerk] = useState(false)
  const [schrap, setSchrap] = useState(false)
  const [bezig, setBezig] = useState(false)

  const actie = async (a: 'schrappen' | 'herstellen') => {
    setBezig(true)
    try {
      await api('/api/admin/vesting/registraties', { method: 'PATCH', body: JSON.stringify({ id: r.id, actie: a }) })
      toast.success(a === 'schrappen' ? 'Geschrapt. Iedereen tekent nu voor het schrappen.' : 'Teruggezet.')
      setSchrap(false)
      onVernieuw()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }

  return (
    <Paneel
      titel={<span>{r.geschrapt && <span className="text-red-700">Geschrapt · </span>}{r.omschrijving}</span>}
      sub={`${SOORT_TEKST[r.soort].titel} · ${datumKort(r.datum)}`}
      onClose={onClose}
      voet={volgende ? <div className="flex justify-end"><button type="button" onClick={volgende} className="btn-secondary text-sm">Volgende</button></div> : undefined}
    >
      <section>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-900">{SOORT_TEKST[r.soort].titel}</h3>
          {!bewerk && !r.geschrapt && <button type="button" onClick={() => setBewerk(true)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Pencil className="h-3 w-3" />Aanpassen</button>}
        </div>
        {bewerk
          ? <RegistratieForm soort={r.soort} r={r} onKlaar={() => { setBewerk(false); onVernieuw() }} onAnnuleer={() => setBewerk(false)} />
          : (
            <dl className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
              <Rij label="Bedrag (excl. btw)"><b className={`tabular-nums ${r.geschrapt ? 'line-through text-gray-400' : ''}`}>{r.soort === 'kost' ? '− ' : ''}{eur(r.bedrag, true)}</b></Rij>
              <Rij label="Datum">{datumKort(r.datum)}</Rij>
              {r.referentie && <Rij label="Referentie">{r.referentie}</Rij>}
              <div className="px-3 py-2.5">
                <dt className="text-xs text-gray-500 mb-0.5">Verantwoording</dt>
                <dd className="text-gray-800 whitespace-pre-wrap">{r.verantwoording || <span className="text-amber-700">Nog geen verantwoording.</span>}</dd>
              </div>
            </dl>
          )}
        <p className="mt-2 text-xs text-gray-500">{r.geschrapt ? 'Geschrapt: telt niet meer mee. Het blijft zichtbaar, met alle handtekeningen.' : SOORT_TEKST[r.soort].uitleg}</p>
      </section>

      <Akkoord onderwerp={r.soort} id={r.id} akkoord={r.akkoord} vennoten={vennoten} ik={ik} laatste={laatste} onLaatste={onLaatste} onGetekend={onVernieuw}
        uitleg={r.geschrapt
          ? `Je tekent dat ${r.omschrijving} (${eur(r.bedrag, true)}) geschrapt is en niet meer meetelt.`
          : r.soort === 'inkomst'
            ? `Je tekent dat ${eur(r.bedrag, true)} (${r.omschrijving}) meetelt voor de vesting van Marco.`
            : `Je tekent dat ${eur(r.bedrag, true)} (${r.omschrijving}) van Marco's totaal afgaat.`} />

      <section className="pt-1">
        {r.geschrapt
          ? <button type="button" onClick={() => actie('herstellen')} disabled={bezig} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black">{bezig ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}Terugzetten</button>
          : !schrap
            ? <button type="button" onClick={() => setSchrap(true)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-700"><Trash2 className="h-3 w-3" />Schrappen</button>
            : <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 space-y-2">
                <p>Geschrapt telt niet meer mee, maar blijft zichtbaar met alle handtekeningen. Ook het schrappen tekent iedereen.</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => actie('schrappen')} disabled={bezig} className="btn-danger text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Schrappen</button>
                  <button type="button" onClick={() => setSchrap(false)} className="btn-secondary text-sm">Annuleren</button>
                </div>
              </div>}
      </section>
    </Paneel>
  )
}

function Rij({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 px-3 py-2.5"><dt className="text-gray-500">{label}</dt><dd className="text-right">{children}</dd></div>
}

/** Nieuwe inkomst of algemene kost, of een bestaande aanpassen. */
export function RegistratieForm({ soort, r, onKlaar, onAnnuleer }: { soort: RegistratieSoort; r?: RegistratieWeergave; onKlaar: (id: string | null) => void; onAnnuleer: () => void }) {
  const [omschrijving, setOmschrijving] = useState(r?.omschrijving ?? '')
  const [bedrag, setBedrag] = useState(r ? String(r.bedrag).replace('.', ',') : '')
  const [datum, setDatum] = useState(r?.datum ?? vandaag())
  const [verantwoording, setVerantwoording] = useState(r?.verantwoording ?? '')
  const [referentie, setReferentie] = useState(r?.referentie ?? '')
  const [bezig, setBezig] = useState(false)
  const b = leesGetal(bedrag)
  const ok = omschrijving.trim().length >= 2 && b !== null && b > 0 && verantwoording.trim().length >= 5 && /^\d{4}-\d{2}-\d{2}$/.test(datum)

  const bewaar = async () => {
    setBezig(true)
    try {
      const velden = { omschrijving: omschrijving.trim(), bedrag: b, datum, verantwoording: verantwoording.trim(), referentie: referentie.trim() || null }
      const j = r
        ? await api('/api/admin/vesting/registraties', { method: 'PATCH', body: JSON.stringify({ id: r.id, ...velden }) })
        : await api('/api/admin/vesting/registraties', { method: 'POST', body: JSON.stringify({ soort, ...velden }) })
      toast.success(r ? 'Aangepast. Iedereen tekent opnieuw.' : `${SOORT_TEKST[soort].titel} geregistreerd.`)
      onKlaar(r ? r.id : typeof j.id === 'string' ? j.id : null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Omschrijving</label>
        <input className={INP} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} maxLength={200} autoFocus
          placeholder={soort === 'inkomst' ? 'Bv. factuur WAM november' : 'Bv. afsluiting WAM bij de boekhouder'} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Bedrag (excl. btw)</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
            <input className={`${INP} pl-7`} inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="0" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Datum</label>
          <input className={INP} type="date" value={datum} onChange={(e) => setDatum(e.target.value)} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Verantwoording</label>
        <textarea className={`${INP} min-h-[96px]`} value={verantwoording} onChange={(e) => setVerantwoording(e.target.value)} maxLength={2000}
          placeholder={soort === 'inkomst'
            ? 'Bv. Marco factureert zijn WAM-contracten voortaan via de BV. WAM is de klant, de BV stuurt de factuur naar WAM; dat geld komt in de BV.'
            : 'Waarom gaat dit van Marco\'s totaal af?'} />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Referentie <span className="font-normal text-gray-400">(optioneel: factuurnummer, contract …)</span></label>
        <input className={INP} value={referentie} onChange={(e) => setReferentie(e.target.value)} maxLength={200} placeholder="Bv. 2026-125" />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={bewaar} disabled={!ok || bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{r ? 'Bewaren' : 'Registreren'}</button>
        <button type="button" onClick={onAnnuleer} className="btn-secondary text-sm">Annuleren</button>
      </div>
    </div>
  )
}

/**
 * "Kost registreren": een algemene kost (van Marco's totaal) of een kost bij
 * één contract (bv. hosting of een extra onderaanneming achteraf).
 */
export function KostRegistreren({ contracten, onKlaar, onClose }: { contracten: ContractWeergave[]; onKlaar: (open: { soort: 'contract' | 'kost'; id: string } | null) => void; onClose: () => void }) {
  const [waar, setWaar] = useState<'algemeen' | 'contract'>('contract')
  const [contractId, setContractId] = useState('')
  const [soort, setSoort] = useState<KostSoort>('hosting')
  const [omschrijving, setOmschrijving] = useState('')
  const [bedrag, setBedrag] = useState('')
  const [verantwoording, setVerantwoording] = useState('')
  const [bezig, setBezig] = useState(false)
  const b = leesGetal(bedrag)
  const ok = !!contractId && b !== null && b > 0 && verantwoording.trim().length >= 5

  const bewaarContractKost = async () => {
    setBezig(true)
    try {
      await api('/api/admin/vesting/kosten', { method: 'POST', body: JSON.stringify({ vesting_contract_id: contractId, soort, omschrijving: omschrijving.trim(), bedrag: b, verantwoording: verantwoording.trim() }) })
      toast.success('Kost geregistreerd. Iedereen tekent het contract opnieuw.')
      onKlaar({ soort: 'contract', id: contractId })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(false) }
  }

  return (
    <Paneel titel="Kost registreren" sub="Elke kost met een verantwoording; daarna tekent iedereen." onClose={onClose}>
      <div className="flex flex-wrap gap-2">
        {([['contract', 'Bij een contract', 'gaat van de waarde van dat contract af'], ['algemeen', 'Algemeen', "gaat van Marco's totaal af (bv. afsluiting WAM)"]] as const).map(([k, l, s]) => (
          <button key={k} type="button" onClick={() => setWaar(k)} aria-pressed={waar === k}
            className={`flex-1 min-w-[150px] rounded-lg border px-3 py-2.5 text-left ${waar === k ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:border-gray-400'}`}>
            <div className="text-sm font-medium">{l}</div><div className={`text-xs ${waar === k ? 'text-gray-300' : 'text-gray-500'}`}>{s}</div>
          </button>
        ))}
      </div>

      {waar === 'algemeen'
        ? <RegistratieForm soort="kost" onKlaar={(id) => onKlaar(id ? { soort: 'kost', id } : null)} onAnnuleer={onClose} />
        : (
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Contract</label>
              <select className={INP} value={contractId} onChange={(e) => setContractId(e.target.value)}>
                <option value="">— Kies het contract —</option>
                {contracten.map((c) => <option key={c.id} value={c.id}>{c.klant} · {c.titel ?? c.nr}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Soort</label>
                <select className={INP} value={soort} onChange={(e) => setSoort(e.target.value as KostSoort)}>
                  {KOST_SOORTEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bedrag (excl. btw)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
                  <input className={`${INP} pl-7`} inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="0" />
                </div>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Omschrijving <span className="font-normal text-gray-400">(optioneel)</span></label>
              <input className={INP} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} maxLength={200} placeholder="Bv. hosting 12 maanden" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Verantwoording</label>
              <textarea className={`${INP} min-h-[80px]`} value={verantwoording} onChange={(e) => setVerantwoording(e.target.value)} maxLength={1000} placeholder="Bv. extra developer ingehuurd na de oplevering." />
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={bewaarContractKost} disabled={!ok || bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Registreren</button>
              <button type="button" onClick={onClose} className="btn-secondary text-sm">Annuleren</button>
            </div>
          </div>
        )}
    </Paneel>
  )
}

/** "Inkomst registreren" in een paneel. */
export function InkomstRegistreren({ onKlaar, onClose }: { onKlaar: (id: string | null) => void; onClose: () => void }) {
  return (
    <Paneel titel="Inkomst registreren" sub="Inkomsten via WAM of een andere weg, met verantwoording. Daarna tekent iedereen." onClose={onClose}>
      <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">{SOORT_TEKST.inkomst.uitleg}</p>
      <RegistratieForm soort="inkomst" onKlaar={onKlaar} onAnnuleer={onClose} />
    </Paneel>
  )
}
