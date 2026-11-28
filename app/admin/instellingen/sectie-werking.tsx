'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { DOMEINEN, WERK_SOORTEN, leesWerking, eindUur, type WerkingInstellingen } from '@/lib/werking/instellingen'
import type { Ctx } from './instellingen-client'
import { Kop, OpslaanBalk, Groep, Veld, INP } from './ui'

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
      </div>

      <OpslaanBalk vuil={vuil} bezig={ctx.bezig} onOpslaan={() => ctx.opslaan('werking', leesWerking(v), [])} onAnnuleer={() => setV(bron)} bijgewerkt={ctx.bijgewerkt.werking} />
    </div>
  )
}
