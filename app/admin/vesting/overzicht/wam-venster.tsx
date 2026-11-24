'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Pencil, Plus, RotateCcw } from 'lucide-react'
import { leesGetal } from '@/lib/getal'
import { maandTekst, type Vennoot } from '@/lib/vesting-akkoord'
import type { WamWeergave } from '@/lib/vesting-weergave'
import { Akkoord, Paneel, Rekensom, VerwijderBlok, api, datumKort, eur } from './delen'

const INP = 'input-base'
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

export const WAM_VERLOOP: Record<WamWeergave['status'], string> = { actief: 'Loopt', voltooid: 'Voltooid', stopgezet: 'Gestopt', niet_betaler: 'Niet-betaler' }

/**
 * Eén WAM-contract: Marco's klant van vóór de samenwerking. Wat er van die
 * klant binnenkwam (de betaalde termijnen) telt zoals de WAM-afspraak. Een
 * termijn als betaald aanduiden, de cijfers aanpassen of het contract schrappen
 * verandert wat getekend werd: dan tekenen Marco, Bram en Chiara opnieuw.
 */
export function WamVenster({ w, vennoten, ik, laatste, onLaatste, onClose, onVernieuw, volgende }: {
  w: WamWeergave
  vennoten: Record<Vennoot, string>
  ik: Vennoot | null
  laatste: string | null
  onLaatste: (png: string) => void
  onClose: () => void
  onVernieuw: () => void
  volgende?: (() => void) | null
}) {
  const [bewerk, setBewerk] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)
  const [nieuw, setNieuw] = useState(false)

  const termijn = async (id: string, betaald: boolean) => {
    setBezig(id)
    try {
      await api('/api/admin/vesting', { method: 'PATCH', body: JSON.stringify({ resource: 'termijn', id, status: betaald ? 'betaald' : 'gepland' }) })
      toast.success(betaald ? 'Als betaald aangeduid. Iedereen tekent opnieuw.' : 'Niet meer betaald. Iedereen tekent opnieuw.')
      onVernieuw()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const open = w.termijnen.filter((t) => t.status !== 'geannuleerd')
  const betaald = open.filter((t) => t.status === 'betaald').length
  const uit = w.status === 'stopgezet' || w.status === 'niet_betaler' || !w.betalingenOpSchema
  const regels = [
    { label: 'Contractwaarde', waarde: eur(w.contractwaarde, true) },
    { label: `Ontvangen (${betaald} van ${open.length} termijnen betaald)`, waarde: eur(w.ontvangen, true) },
    ...(w.nogBinnen > 0 ? [{ label: 'Nog te komen', waarde: eur(w.nogBinnen, true), zacht: true }] : []),
    ...(uit && !w.geschrapt ? [{ label: WAM_VERLOOP[w.status] === 'Loopt' ? 'Betalingen niet op schema' : WAM_VERLOOP[w.status], waarde: '€ 0' }] : []),
    { label: 'Telt mee voor Marco', waarde: eur(w.teltMee, true), sterk: true },
  ]

  return (
    <Paneel
      titel={<span>{w.geschrapt && <span className="text-red-700">Geschrapt · </span>}{w.klant}</span>}
      sub={`${w.nr}${w.omschrijving ? ` · ${w.omschrijving}` : ''} · WAM-contract`}
      onClose={onClose}
      voet={volgende ? <div className="flex justify-end"><button type="button" onClick={volgende} className="btn-secondary text-sm">Volgende</button></div> : undefined}
    >
      {w.geschrapt && (
        <p className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3 text-xs text-gray-700">
          Geschrapt uit de vesting: dit WAM-contract telt niet meer mee. Marco, Bram en Chiara tekenen voor het schrappen; terugzetten kan onderaan.
        </p>
      )}

      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Wat er binnenkwam</h3>
        <Rekensom regels={regels} />
        <p className="mt-2 text-xs text-gray-500">Telt samen met de andere inkomsten zoals de WAM-afspraak: elke € 5.000 netto = 1%, tot 5%.</p>
      </section>

      <section>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Termijnen</h3>
          {!w.geschrapt && !nieuw && <button type="button" onClick={() => setNieuw(true)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Plus className="h-3 w-3" />Termijn toevoegen</button>}
        </div>
        {w.termijnen.length === 0 && !nieuw && <p className="text-sm text-gray-500">Nog geen termijnen.</p>}
        {w.termijnen.length > 0 && (
          <ul className="rounded-lg border border-gray-200 divide-y divide-gray-100">
            {w.termijnen.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className={`text-gray-900 ${t.status === 'geannuleerd' ? 'line-through text-gray-400' : ''}`}>{maandTekst(t.periode)}</div>
                  <div className="text-[11px] text-gray-500">
                    {t.status === 'betaald' ? `Betaald${t.betaald_op ? ` op ${datumKort(t.betaald_op)}` : ''}` : t.status === 'geannuleerd' ? 'Geannuleerd' : t.status === 'gefactureerd' ? 'Gefactureerd, nog niet betaald' : 'Nog niet betaald'}
                  </div>
                </div>
                <div className="tabular-nums text-gray-800 shrink-0">{eur(t.bedrag, true)}</div>
                {t.status !== 'geannuleerd' && !w.geschrapt && (
                  t.status === 'betaald'
                    ? <button type="button" onClick={() => termijn(t.id, false)} disabled={bezig === t.id} className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-black shrink-0 w-[92px] justify-end">
                        {bezig === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}Niet betaald
                      </button>
                    : <button type="button" onClick={() => termijn(t.id, true)} disabled={bezig === t.id} className="btn-secondary text-xs h-7 shrink-0 w-[92px] justify-center">
                        {bezig === t.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Betaald
                      </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {nieuw && <NieuweTermijn wamId={w.id} onKlaar={() => { setNieuw(false); onVernieuw() }} onAnnuleer={() => setNieuw(false)} />}
      </section>

      <section>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Gegevens</h3>
          {!bewerk && !w.geschrapt && <button type="button" onClick={() => setBewerk(true)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Pencil className="h-3 w-3" />Aanpassen</button>}
        </div>
        {bewerk
          ? <Gegevens w={w} onKlaar={() => { setBewerk(false); onVernieuw() }} onAnnuleer={() => setBewerk(false)} />
          : (
            <dl className="rounded-lg border border-gray-200 divide-y divide-gray-100 text-sm">
              <Rij label="Klant">{w.klant}</Rij>
              {w.omschrijving && <Rij label="Omschrijving">{w.omschrijving}</Rij>}
              <Rij label="Contractwaarde">{eur(w.contractwaarde, true)}</Rij>
              <Rij label="Verloop">{WAM_VERLOOP[w.status]}</Rij>
              {w.schema.start && <Rij label="Start">{datumKort(w.schema.start)}</Rij>}
              {w.notitie && <Rij label="Notitie">{w.notitie}</Rij>}
            </dl>
          )}
      </section>

      <Akkoord onderwerp="wam" id={w.id} akkoord={w.akkoord} certificaat={w.certificaat} vennoten={vennoten} ik={ik} laatste={laatste} onLaatste={onLaatste} onGetekend={onVernieuw}
        uitleg={w.geschrapt
          ? `Je tekent dat het WAM-contract van ${w.klant} (${w.nr}) geschrapt is en niet meer meetelt.`
          : `Je tekent dat ${eur(w.teltMee, true)} van ${w.klant} (${w.nr}) meetelt voor de vesting van Marco: ${eur(w.ontvangen, true)} ontvangen, ${betaald} van ${open.length} termijnen betaald.`} />

      <VerwijderBlok onderwerp="wam" id={w.id} naam={`${w.klant} (${w.nr})`} akkoord={w.akkoord} geschrapt={w.geschrapt}
        onKlaar={onVernieuw} onWeg={() => { onClose(); onVernieuw() }} />
    </Paneel>
  )
}

function Rij({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3 px-3 py-2.5"><dt className="text-gray-500">{label}</dt><dd className="text-right">{children}</dd></div>
}

export function Gegevens({ w, onKlaar, onAnnuleer }: { w: WamWeergave; onKlaar: () => void; onAnnuleer: () => void }) {
  const [klant, setKlant] = useState(w.klant)
  const [omschrijving, setOmschrijving] = useState(w.omschrijving ?? '')
  const [waarde, setWaarde] = useState(String(w.contractwaarde).replace('.', ','))
  const [status, setStatus] = useState<WamWeergave['status']>(w.status)
  const [notitie, setNotitie] = useState(w.notitie ?? '')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const bewaar = async () => {
    const x = leesGetal(waarde)
    if (klant.trim().length < 2) { setFout('Vul de klant in.'); return }
    if (x === null || x < 0) { setFout('Vul de contractwaarde in (excl. btw).'); return }
    setFout(null); setBezig(true)
    try {
      await api('/api/admin/vesting', { method: 'PATCH', body: JSON.stringify({ resource: 'wam', id: w.id, klant: klant.trim(), omschrijving: omschrijving.trim() || null, contractwaarde: x, status, notitie: notitie.trim() || null }) })
      toast.success('Aangepast. Iedereen tekent opnieuw als de cijfers veranderden.')
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="space-y-2.5">
      <label className="block text-xs text-gray-500">Klant<input className={`${INP} mt-1`} value={klant} onChange={(e) => setKlant(e.target.value)} /></label>
      <label className="block text-xs text-gray-500">Omschrijving (optioneel)<input className={`${INP} mt-1`} value={omschrijving} onChange={(e) => setOmschrijving(e.target.value)} placeholder="bv. Website deel 2" /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-gray-500">Contractwaarde (excl. btw)<input className={`${INP} mt-1`} inputMode="decimal" value={waarde} onChange={(e) => setWaarde(e.target.value)} /></label>
        <label className="block text-xs text-gray-500">Verloop
          <select className={`${INP} mt-1`} value={status} onChange={(e) => setStatus(e.target.value as WamWeergave['status'])}>
            {(Object.keys(WAM_VERLOOP) as WamWeergave['status'][]).map((k) => <option key={k} value={k}>{WAM_VERLOOP[k]}</option>)}
          </select>
        </label>
      </div>
      <label className="block text-xs text-gray-500">Notitie (optioneel)<input className={`${INP} mt-1`} value={notitie} onChange={(e) => setNotitie(e.target.value)} /></label>
      {fout && <p className="text-xs text-red-700">{fout}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
        <button type="button" onClick={onAnnuleer} className="btn-secondary text-sm">Annuleren</button>
      </div>
    </div>
  )
}

export function NieuweTermijn({ wamId, onKlaar, onAnnuleer }: { wamId: string; onKlaar: () => void; onAnnuleer: () => void }) {
  const [datum, setDatum] = useState(vandaag())
  const [bedrag, setBedrag] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const bewaar = async () => {
    const x = leesGetal(bedrag)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) { setFout('Kies de datum.'); return }
    if (x === null || x <= 0) { setFout('Vul het bedrag in (excl. btw).'); return }
    setFout(null); setBezig(true)
    try {
      await api('/api/admin/vesting', { method: 'POST', body: JSON.stringify({ resource: 'termijn', wam_id: wamId, factuurdatum: datum, bedrag_excl: x }) })
      toast.success('Termijn toegevoegd.')
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="mt-2 rounded-lg border border-gray-200 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-xs text-gray-500">Datum<input type="date" className={`${INP} mt-1`} value={datum} onChange={(e) => setDatum(e.target.value)} /></label>
        <label className="block text-xs text-gray-500">Bedrag (excl. btw)<input className={`${INP} mt-1`} inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="180" /></label>
      </div>
      {fout && <p className="text-xs text-red-700">{fout}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Toevoegen</button>
        <button type="button" onClick={onAnnuleer} className="btn-secondary text-sm">Annuleren</button>
      </div>
    </div>
  )
}
