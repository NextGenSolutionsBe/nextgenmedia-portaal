'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ExternalLink, Loader2, Plus, Trash2 } from 'lucide-react'
import { leesGetal } from '@/lib/getal'
import { toerekeningsfactor, type LeadSoort } from '@/lib/vesting'
import { KOST_SOORTEN, kostSoortLabel, type KostSoort } from '@/lib/vesting-akkoord'
import { isGetekend, snelNaarRij, snelTotaal, controleerSnel, type KandidaatContract, type SnelInvoer } from '@/lib/vesting-snel'
import { LeadKiezer, Paneel, Rekensom, RolKnop, api, datumKort, eur } from './delen'

type Klant = { id: string; naam: string; closer: string | null; setter: string | null }
const isMarco = (s?: string | null) => !!s && s.trim().toLowerCase().startsWith('marco')
const INP = 'input-base'

/**
 * "Telt mee": een contract uit Contracten/Projecten in de vesting zetten, met
 * wat Marco deed, de waarde en de kosten. Het rekenvoorbeeld staat er live bij:
 * €5.000 − €2.000 kosten = €3.000 × 50% = €1.500.
 */
export function BeoordeelVenster({ k, klanten, onClose, onToegevoegd }: {
  k: KandidaatContract
  klanten: Klant[]
  onClose: () => void
  onToegevoegd: (vestingId: string | null) => void
}) {
  const klant = k.client_id ? klanten.find((x) => x.id === k.client_id) : undefined
  const getekend = isGetekend(k.status)
  const [soort, setSoort] = useState<'eenmalig' | 'maand'>('eenmalig')
  const [prijs, setPrijs] = useState(k.waarde ? String(k.waarde).replace('.', ',') : '')
  const [maanden, setMaanden] = useState('')
  const [afspraak, setAfspraak] = useState(klant?.setter ? isMarco(klant.setter) : false)
  const [closing, setClosing] = useState(klant?.closer ? isMarco(klant.closer) : false)
  const [lead, setLead] = useState<LeadSoort | null>(null)
  const [kosten, setKosten] = useState<{ soort: KostSoort; omschrijving: string; bedrag: string }[]>([])
  const [bezig, setBezig] = useState(false)

  const invoer: SnelInvoer = {
    klant: k.klant ?? klant?.naam ?? '', client_id: k.client_id, contract_id: k.id, titel: k.titel,
    ondertekend_op: getekend && k.signed_at ? k.signed_at : '', start_dienst: k.start_date,
    soort, prijs: leesGetal(prijs), maanden: soort === 'maand' ? leesGetal(maanden) : null,
    afspraak, closing, lead, wachtOpKlant: !getekend,
  }
  const totaal = snelTotaal(invoer)
  const kostSom = kosten.reduce((s, x) => s + (leesGetal(x.bedrag) ?? 0), 0)
  const netto = totaal === null ? null : Math.max(0, totaal - kostSom)
  const factor = toerekeningsfactor({ appointment_door_marco: afspraak, closed_door_marco: closing, lead_soort: lead })
  const fout = controleerSnel(invoer) ?? (kosten.some((x) => !(leesGetal(x.bedrag) ?? 0)) ? 'Vul bij elke kost een bedrag in.' : null)

  const bewaar = async () => {
    if (fout) { toast.error(fout); return }
    setBezig(true)
    try {
      const j = await api('/api/admin/vesting', { method: 'POST', body: JSON.stringify(snelNaarRij(invoer)) })
      const id = typeof j.id === 'string' ? j.id : null
      if (id) {
        for (const x of kosten) {
          await api('/api/admin/vesting/kosten', { method: 'POST', body: JSON.stringify({ vesting_contract_id: id, soort: x.soort, omschrijving: x.omschrijving, bedrag: leesGetal(x.bedrag) }) })
        }
      }
      toast.success(`${invoer.klant} telt mee.`)
      onToegevoegd(id)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(false) }
  }

  return (
    <Paneel
      titel={invoer.klant || k.titel}
      sub={<span>{k.titel} · {getekend ? `getekend ${datumKort(k.signed_at)}` : 'de klant tekende nog niet'}</span>}
      onClose={onClose}
      voet={
        <div className="flex items-center gap-2">
          <Link href={`/admin/contracts/${k.id}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black mr-auto">Contract openen<ExternalLink className="h-3 w-3" /></Link>
          <button type="button" onClick={onClose} className="btn-secondary text-sm">Annuleren</button>
          <button type="button" onClick={bewaar} disabled={bezig || !!fout} title={fout ?? undefined} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Telt mee</button>
        </div>
      }
    >
      {!getekend && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600">
          De klant tekende nog niet. Je kan nu al vastleggen wat Marco deed; het telt mee vanaf de ondertekening.
        </p>
      )}

      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Hoe kwam de klant binnen?</h3>
        <LeadKiezer waarde={lead} onChange={setLead} />
      </section>

      <section>
        {!lead && <>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Wat deed Marco?</h3>
        <div className="flex flex-wrap gap-2">
          <RolKnop aan={afspraak} label="Afspraak gezet" onClick={() => setAfspraak((x) => !x)} />
          <RolKnop aan={closing} label="Klant geclosed" onClick={() => setClosing((x) => !x)} />
        </div>
        </>}
        {factor === 0 && <p className="mt-2 text-xs text-amber-800">Zonder afspraak of closing door Marco telt dit contract niet mee. Kies dan "Telt niet mee" in de lijst.</p>}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Contractwaarde (excl. btw)</h3>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
            <input className={`${INP} pl-7 text-base font-semibold`} inputMode="decimal" value={prijs} onChange={(e) => setPrijs(e.target.value)} placeholder="0" aria-label="Contractwaarde" />
          </div>
          <div className="inline-flex rounded-md border border-gray-200 p-0.5 shrink-0">
            {(['eenmalig', 'maand'] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSoort(s)} className={`px-2.5 rounded text-xs ${soort === s ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>{s === 'eenmalig' ? 'totaal' : 'per maand'}</button>
            ))}
          </div>
        </div>
        {soort === 'maand' && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <input className={`${INP} w-20`} inputMode="numeric" value={maanden} onChange={(e) => setMaanden(e.target.value.replace(/\D/g, ''))} placeholder="12" aria-label="Aantal maanden" />
            <span className="text-gray-600">maanden</span>
          </div>
        )}
        {k.waarde !== null && <p className="mt-1 text-[11px] text-gray-500">Ingevuld uit het contract. Kijk het na.</p>}
      </section>

      <section>
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-900">Kosten verbonden aan dit contract</h3>
          <button type="button" onClick={() => setKosten((l) => [...l, { soort: 'hosting', omschrijving: '', bedrag: '' }])} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Plus className="h-3 w-3" />Kost toevoegen</button>
        </div>
        {kosten.length === 0 && <p className="text-sm text-gray-500">Geen kosten. Hosting, onderaanneming of advertentiebudget gaan van de waarde af.</p>}
        <div className="space-y-2">
          {kosten.map((x, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-2.5 space-y-2">
              <div className="flex gap-2">
                <select className={INP} value={x.soort} onChange={(e) => setKosten((l) => l.map((y, j) => (j === i ? { ...y, soort: e.target.value as KostSoort } : y)))} aria-label="Soort kost">
                  {KOST_SOORTEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <div className="relative w-32 shrink-0">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
                  <input className={`${INP} pl-7`} inputMode="decimal" value={x.bedrag} onChange={(e) => setKosten((l) => l.map((y, j) => (j === i ? { ...y, bedrag: e.target.value } : y)))} placeholder="0" aria-label={`Bedrag ${kostSoortLabel(x.soort)}`} />
                </div>
                <button type="button" onClick={() => setKosten((l) => l.filter((_, j) => j !== i))} className="h-9 w-9 shrink-0 flex items-center justify-center rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50" aria-label="Kost weghalen"><Trash2 className="h-4 w-4" /></button>
              </div>
              <input className={INP} value={x.omschrijving} onChange={(e) => setKosten((l) => l.map((y, j) => (j === i ? { ...y, omschrijving: e.target.value } : y)))} placeholder="Omschrijving (optioneel)" maxLength={200} />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-gray-900 mb-2">Wat telt mee</h3>
        <Rekensom regels={[
          { label: 'Contractwaarde', waarde: eur(totaal, true) },
          { label: 'Kosten', waarde: kostSom ? `− ${eur(kostSom, true)}` : eur(0) },
          { label: 'Netto', waarde: eur(netto, true) },
          { label: 'Deel van Marco', waarde: `× ${Math.round(factor * 100)}%` },
          { label: 'Telt mee voor Marco', waarde: netto === null ? '—' : eur(netto * factor, true), sterk: true },
        ]} />
        <p className="mt-2 text-[11px] text-gray-500">Daarna tekenen Marco, Bram en Chiara elk voor deze cijfers.</p>
      </section>
    </Paneel>
  )
}
