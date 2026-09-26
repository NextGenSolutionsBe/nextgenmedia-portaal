'use client'

import { useEffect, useState } from 'react'
import type { FacturatieInstellingen } from '@/lib/instellingen/model'
import type { Ctx } from './instellingen-client'
import { Kop, Groep, Tekst, Getal, Veld, OpslaanBalk, INP } from './ui'

/**
 * Facturatie-instellingen: standaardwaarden voor nieuwe facturen en
 * factuurvoorstellen, de nummering en wie de facturen opmaakt. Facturen en
 * contracten gaan niet meer naar ClickUp; de facturenlijst en de planner zijn
 * de werklijst.
 */
export function SectieFacturatie({ ctx }: { ctx: Ctx }) {
  const bron = ctx.inst.facturatie
  const [v, setV] = useState<FacturatieInstellingen>(bron)
  useEffect(() => { setV(bron) }, [bron])
  const vuil = JSON.stringify(v) !== JSON.stringify(bron)
  const { zetVuil } = ctx
  useEffect(() => { zetVuil(vuil) }, [vuil, zetVuil])
  const zet = <K extends keyof FacturatieInstellingen>(k: K, w: FacturatieInstellingen[K]) => setV((p) => ({ ...p, [k]: w }))

  return (
    <div className="card-base">
      <Kop titel="Facturatie-instellingen" tekst="Standaardwaarden voor nieuwe facturen en voor de factuurvoorstellen uit contracten. Bestaande facturen veranderen niet." />
      <div className="space-y-5">
        <Groep titel="Standaardwaarden">
          <div className="grid sm:grid-cols-3 gap-3">
            <Getal label="Standaard btw-percentage" value={v.standaard_btw_pct} onChange={(w) => zet('standaard_btw_pct', w)} min={0} max={100} stap={0.5} eenheid="%" />
            <Getal label="Betalingstermijn" value={v.betalingstermijn_dagen} onChange={(w) => zet('betalingstermijn_dagen', w)} min={0} max={365} eenheid="dagen" />
            <Veld label="Standaardstatus nieuwe factuur">
              <select className={INP} value={v.standaard_status} onChange={(e) => zet('standaard_status', e.target.value as FacturatieInstellingen['standaard_status'])}>
                <option value="te_versturen">Te versturen</option>
                <option value="verstuurd">Verstuurd</option>
              </select>
            </Veld>
            <Veld label="Standaardomschrijving" breed hint="Voorgesteld bij een nieuwe factuurregel."><textarea className={INP} rows={2} value={v.standaard_omschrijving} onChange={(e) => zet('standaard_omschrijving', e.target.value)} /></Veld>
            <Veld label="Betaalgegevens op documenten"><textarea className={INP} rows={2} value={v.betaalgegevens} onChange={(e) => zet('betaalgegevens', e.target.value)} placeholder="IBAN, mededeling, …" /></Veld>
          </div>
        </Groep>
        <Groep titel="Nummering">
          <div className="grid sm:grid-cols-4 gap-3">
            <Tekst label="Factuurnummer — voorvoegsel" value={v.factuurnummer_prefix} onChange={(w) => zet('factuurnummer_prefix', w)} />
            <Getal label="Volgend factuurnummer" value={v.factuurnummer_volgend} onChange={(w) => zet('factuurnummer_volgend', w)} min={1} />
            <Tekst label="Creditnota — voorvoegsel" value={v.creditnota_prefix} onChange={(w) => zet('creditnota_prefix', w)} />
            <Getal label="Volgende creditnota" value={v.creditnota_volgend} onChange={(w) => zet('creditnota_volgend', w)} min={1} />
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Voorbeeld: {v.factuurnummer_prefix}{String(v.factuurnummer_volgend || 1).padStart(4, '0')} · {v.creditnota_prefix}{String(v.creditnota_volgend || 1).padStart(4, '0')}</p>
        </Groep>
        <Groep titel="Verantwoordelijke">
          <div className="grid sm:grid-cols-2 gap-3">
            <Tekst label="Wie maakt de facturen op en verstuurt ze?" value={v.verantwoordelijke_naam} onChange={(w) => zet('verantwoordelijke_naam', w)} placeholder="Bram Reinquin" hint="Wordt getoond in de facturatieplanner en op factuurvoorstellen." />
          </div>
          <p className="text-[11px] text-gray-500 mt-2">Facturen en contracten sturen geen taken meer naar ClickUp. De facturenlijst en de planner zijn de werklijst; de socialmediaplanning blijft wél via ClickUp lopen.</p>
        </Groep>
      </div>
      <OpslaanBalk vuil={vuil} bezig={ctx.bezig} onOpslaan={() => ctx.opslaan('facturatie', v, [])} onAnnuleer={() => setV(bron)} bijgewerkt={ctx.bijgewerkt.facturatie} />
    </div>
  )
}
