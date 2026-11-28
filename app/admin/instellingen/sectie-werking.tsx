'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { DOMEINEN, WERK_SOORTEN, MATEN, leesWerking, eindUur, auditPrijs, type WerkingInstellingen, type Maat } from '@/lib/werking/instellingen'
import type { Ctx } from './instellingen-client'
import { Kop, OpslaanBalk, Groep, Veld, Getal, INP } from './ui'

/**
 * Werking (28 nov 2026): de afspraken van de nieuwe werking als instellingen.
 * Enkel de zaakvoerders passen ze aan (de API weigert anderen). Elke waarde
 * heeft een beginwaarde; leeg of ongeldig = die beginwaarde.
 */

const NAMEN = ['Marco', 'Bram', 'Chiara', 'Yasmine', 'Jonathan']
const DAGEN = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag']

function Naam({ label, hint, value, onChange, disabled }: { label: string; hint?: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <Veld label={label} hint={hint}>
      <input className={INP} list="werking-namen" value={value} maxLength={40} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Veld>
  )
}

export function Rij({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>
}

export function SectieWerking({ ctx }: { ctx: Ctx }) {
  const bron = ctx.inst.werking
  const [v, setV] = useState<WerkingInstellingen>(bron)
  useEffect(() => { setV(bron) }, [bron])
  const vuil = JSON.stringify(v) !== JSON.stringify(bron)
  const { zetVuil } = ctx
  useEffect(() => { zetVuil(vuil) }, [vuil, zetVuil])
  const uit = !ctx.isAdmin
  const zet = <K extends keyof WerkingInstellingen>(k: K, w: Partial<WerkingInstellingen[K]>) => setV((x) => ({ ...x, [k]: { ...x[k], ...w } }))

  return (
    <div className="card-base">
      <Kop titel="Werking" tekst="Wie beslist waarover, wanneer het weekoverleg is en wie welk werk doet." />
      <datalist id="werking-namen">{NAMEN.map((n) => <option key={n} value={n} />)}</datalist>
      {uit && <p className="mb-4 text-sm text-gray-600">Enkel de zaakvoerders passen dit aan.</p>}

      <div className="space-y-6">
      <Groep titel="Domeinen">
        <p className="text-[12px] text-gray-500 -mt-1 mb-2">Een beslissing binnen één domein neemt de eigenaar, zonder stemming. Over meerdere domeinen stemmen jullie: twee op drie.</p>
        <Rij>
          {DOMEINEN.map((d) => (
            <Naam key={d.key} label={d.label} value={v.domeinen[d.key]} disabled={uit} onChange={(w) => zet('domeinen', { [d.key]: w } as Partial<WerkingInstellingen['domeinen']>)} />
          ))}
        </Rij>
      </Groep>

      <Groep titel="Weekoverleg">
        <Rij>
          <Veld label="Dag">
            <select className={INP} value={v.weekoverleg.dag} disabled={uit} onChange={(e) => zet('weekoverleg', { dag: Number(e.target.value) })}>
              {DAGEN.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
            </select>
          </Veld>
          <Veld label="Van" hint={`Tot ${eindUur(v.weekoverleg.van, v.weekoverleg.duur_min)}`}>
            <div className="flex gap-2">
              <input className={INP} type="time" value={v.weekoverleg.van} disabled={uit} onChange={(e) => zet('weekoverleg', { van: e.target.value })} />
              <select className={INP} value={v.weekoverleg.duur_min} disabled={uit} onChange={(e) => zet('weekoverleg', { duur_min: Number(e.target.value) })} aria-label="Duur">
                {[15, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
          </Veld>
        </Rij>
        <p className="text-[12px] text-gray-500 mt-2">
          {v.weekoverleg.reeks_id ? 'Het vaste blok staat in de agenda. Een ander moment? Pas het aan en zet het opnieuw vast in Ritme → Weekoverleg.' : 'Het vaste blok zet je in de agenda met Ritme → Weekoverleg → Vast moment instellen.'}
        </p>
      </Groep>

      <Groep titel="Planning Media">
        <p className="text-[12px] text-gray-500 -mt-1 mb-2">Wie standaard welk werk doet. Per taak kan je iemand anders kiezen.</p>
        <Rij>
          {WERK_SOORTEN.map((s) => (
            <Naam key={s.key} label={s.label} hint={s.uitleg} value={v.planning[s.key]} disabled={uit} onChange={(w) => zet('planning', { [s.key]: w } as Partial<WerkingInstellingen['planning']>)} />
          ))}
        </Rij>
      </Groep>

      <Groep titel="Verkoop Solutions">
        <p className="text-[12px] text-gray-500 -mt-1 mb-2">Auditprijs = basis + prijs per proces. Nu: {[1, 2, 3, 4, 5].filter((n) => n <= v.verkoop.max_processen).map((n) => `${n} → € ${auditPrijs(n, v.verkoop).toLocaleString('nl-BE')}`).join(' · ')}</p>
        <Rij>
          <Getal label="Audit: basis" eenheid="€" value={v.verkoop.audit_basis} min={0} onChange={(w) => zet('verkoop', { audit_basis: w })} />
          <Getal label="Audit: per proces" eenheid="€" value={v.verkoop.audit_per_proces} min={0} onChange={(w) => zet('verkoop', { audit_per_proces: w })} />
          <Getal label="Hoogstens processen per audit" value={v.verkoop.max_processen} min={1} max={20} onChange={(w) => zet('verkoop', { max_processen: w })} />
          <Getal label="Opvolgen: elke" eenheid="dagen" value={v.verkoop.opvolg_dagen} min={1} max={60} onChange={(w) => zet('verkoop', { opvolg_dagen: w })} hint="Na een belpoging stelt de app de volgende opvolging zo ver voor." />
          <Getal label="Presentatie: hoogstens na de auditdag" eenheid="dagen" value={v.verkoop.presentatie_max_dagen} min={1} max={60} onChange={(w) => zet('verkoop', { presentatie_max_dagen: w })} />
          <Getal label="Presentatie: per proces" eenheid="min" value={v.verkoop.presentatie_min_per_proces} min={1} max={120} onChange={(w) => zet('verkoop', { presentatie_min_per_proces: w })} />
          <Naam label="Auditdag ter plaatse" value={v.verkoop.auditdag_door} disabled={uit} onChange={(w) => zet('verkoop', { auditdag_door: w })} />
          <Naam label="Rapport schrijft" value={v.verkoop.rapport_door} disabled={uit} onChange={(w) => zet('verkoop', { rapport_door: w })} />
        </Rij>
      </Groep>

      <Groep titel="Prijs per workflow (Solutions)">
        <p className="text-[12px] text-gray-500 -mt-1 mb-2">Bespaarde uren per week × weken × uurwaarde, afgerond. De klant ziet nooit deze getallen, enkel de maat en de vaste prijs.</p>
        <Rij>
          <Getal label="Weken" value={v.prijzen.weken} min={1} max={104} onChange={(w) => zet('prijzen', { weken: w })} />
          <Getal label="Uurwaarde" eenheid="€" value={v.prijzen.uurwaarde} min={1} onChange={(w) => zet('prijzen', { uurwaarde: w })} />
          <Getal label="Minimum per workflow" eenheid="u/week" value={v.prijzen.min_uren} min={0} onChange={(w) => zet('prijzen', { min_uren: w })} hint="Minder = bundelen met een ander proces." />
          <Getal label="Afronden op" eenheid="€" value={v.prijzen.afronding} min={1} onChange={(w) => zet('prijzen', { afronding: w })} />
          <Getal label="Andere waarde: uurprijs" eenheid="€" value={v.prijzen.andere_uurprijs} min={1} onChange={(w) => zet('prijzen', { andere_uurprijs: w })} hint="Projecten zonder tijdswinst: geschatte uren × deze prijs." />
        </Rij>
        <div className="mt-3 space-y-2">
          {MATEN.map((m) => {
            const x = v.prijzen.maten[m.key as Maat]
            const zetMaat = (p: Partial<typeof x>) => zet('prijzen', { maten: { ...v.prijzen.maten, [m.key]: { ...x, ...p } } })
            return (
              <div key={m.key} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
                <div className="text-sm font-medium pb-2 col-span-2 sm:col-span-1">{m.label}</div>
                <Getal label="Van (u/week)" value={x.van} min={0} onChange={(w) => zetMaat({ van: w })} />
                <Getal label="Tot (u/week)" value={x.tot ?? NaN} min={0} onChange={(w) => zetMaat({ tot: Number.isFinite(w) ? w : null })} hint={x.tot === null ? 'leeg = en meer' : undefined} />
                <Getal label="Prijs vanaf" eenheid="€" value={x.min} min={0} onChange={(w) => zetMaat({ min: w })} />
                <Getal label="Prijs tot" eenheid="€" value={x.max ?? NaN} min={0} onChange={(w) => zetMaat({ max: Number.isFinite(w) ? w : null })} hint={x.max === null ? 'leeg = geen maximum' : undefined} />
              </div>
            )
          })}
        </div>
      </Groep>

      <Groep titel="Levering per workflow (Solutions)">
        <Rij>
          <Getal label="Bouw" eenheid="dagen" value={v.levering.bouw_dagen} min={1} max={120} onChange={(w) => zet('levering', { bouw_dagen: w })} hint="Langer in bouw zonder Wacht op klant = Op te volgen." />
          <Getal label="Nazorg" eenheid="weken" value={v.levering.nazorg_weken} min={0} max={26} onChange={(w) => zet('levering', { nazorg_weken: w })} hint="Eén call per week." />
          <Getal label="Nazorgcall" eenheid="min" value={v.levering.nazorg_call_min} min={5} max={240} onChange={(w) => zet('levering', { nazorg_call_min: w })} />
          <Naam label="Bouwt standaard" value={v.levering.verantwoordelijke} disabled={uit} onChange={(w) => zet('levering', { verantwoordelijke: w })} />
        </Rij>
      </Groep>

      <Groep titel="Care-pakketten (Solutions)">
        <p className="text-[12px] text-gray-500 -mt-1 mb-2">{v.care.bevestigd ? 'Bevestigd.' : 'Dit is het voorstel uit de opdracht en nog niet bevestigd.'} Reactietijd in werkuren: één werkdag = de werkuren hieronder.</p>
        <div className="space-y-3">
          {v.care.pakketten.map((p, i) => {
            const zetP = (w: Partial<typeof p>) => zet('care', { pakketten: v.care.pakketten.map((x, j) => (j === i ? { ...x, ...w } : x)) })
            return (
              <div key={p.key} className="rounded-xl border border-gray-100 p-3 space-y-2">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <Veld label="Naam"><input className={INP} value={p.naam} maxLength={30} disabled={uit} onChange={(e) => zetP({ naam: e.target.value })} /></Veld>
                  <Getal label="Prijs per maand" eenheid="€" value={p.prijs} min={0} onChange={(w) => zetP({ prijs: w })} />
                  <Getal label="Databank" eenheid="GB" value={p.db_gb} min={0} onChange={(w) => zetP({ db_gb: w })} />
                  <Getal label="Bestanden" eenheid="GB" value={p.bestanden_gb} min={0} onChange={(w) => zetP({ bestanden_gb: w })} />
                  <Getal label="Reactietijd" eenheid="werkuren" value={p.reactie_werkuren} min={1} onChange={(w) => zetP({ reactie_werkuren: w })} />
                  <Getal label="Aanpassingen" eenheid="u/maand" value={p.uren_per_maand} min={0} onChange={(w) => zetP({ uren_per_maand: w })} />
                  <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={p.monitoring} disabled={uit} onChange={(e) => zetP({ monitoring: e.target.checked })} />Monitoring</label>
                  <label className="flex items-center gap-2 text-sm pb-2"><input type="checkbox" checked={p.maandrapport} disabled={uit} onChange={(e) => zetP({ maandrapport: e.target.checked })} />Maandrapport</label>
                </div>
              </div>
            )
          })}
        </div>
        <Rij>
          <Veld label="Werkuren van"><input className={INP} value={v.care.werkdag_van} disabled={uit} onChange={(e) => zet('care', { werkdag_van: e.target.value })} placeholder="09:00" /></Veld>
          <Veld label="Werkuren tot"><input className={INP} value={v.care.werkdag_tot} disabled={uit} onChange={(e) => zet('care', { werkdag_tot: e.target.value })} placeholder="17:00" /></Veld>
          <Getal label="Migratie naar een ander platform, vanaf" eenheid="€" value={v.care.migratie_vanaf} min={0} onChange={(w) => zet('care', { migratie_vanaf: w })} hint="Offerte-item; een overdracht zonder Care is gratis." />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.care.bevestigd} disabled={uit} onChange={(e) => zet('care', { bevestigd: e.target.checked })} />Pakketten bevestigd</label>
        </Rij>
      </Groep>
      </div>

      <OpslaanBalk vuil={vuil} bezig={ctx.bezig} onOpslaan={() => ctx.opslaan('werking', leesWerking(v), [])} onAnnuleer={() => setV(bron)} bijgewerkt={ctx.bijgewerkt.werking} />
    </div>
  )
}
