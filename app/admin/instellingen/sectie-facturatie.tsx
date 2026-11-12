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
  const [nummer, setNummer] = useState<{ nummer: string; laatste: string | null } | null>(null)
  useEffect(() => {
    fetch('/api/admin/invoices/volgend-nummer', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (typeof j.nummer === 'string') setNummer(j) }).catch(() => {})
  }, [bron])

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
        <Groep titel="Kilometervergoeding">
          <div className="grid sm:grid-cols-3 gap-3">
            <Getal label="Afgesproken tarief per km (excl. btw)" value={v.km_tarief_excl} onChange={(w) => zet('km_tarief_excl', w)} min={0} max={100} stap={0.01} eenheid="€/km" />
            <Getal label="Btw op kilometers" value={v.km_btw_pct} onChange={(w) => zet('km_btw_pct', w)} min={0} max={100} stap={0.5} eenheid="%" />
          </div>
          <p className="text-[11px] text-gray-500 mt-1">Voorgesteld bij “Kilometers toevoegen” in Facturen; per item aanpasbaar. Dit is jullie commerciële tarief, geen wettelijk vergoedingstarief. 0 = elke keer zelf invullen.</p>
        </Groep>
        <Groep titel="Factuurnummers">
          <p className="text-sm text-gray-700">Het factuurnummer loopt vanzelf door: na <b>{nummer?.laatste ?? '…'}</b> stelt de app <b>{nummer?.nummer ?? '…'}</b> voor bij het markeren als gefactureerd. Op 1 januari begint het nieuwe jaar op 001 (bv. 2027-001). Een nummer dat al op een andere factuur staat, wordt geweigerd.</p>
          <div className="grid sm:grid-cols-3 gap-3 mt-2">
            <Tekst label="Verder vanaf (optioneel)" value={v.factuurnummer_vanaf} onChange={(w) => zet('factuurnummer_vanaf', w.trim())} placeholder="bv. 2026-130" hint="Enkel nodig als er facturen buiten de app gemaakt zijn. Leeg = hoogste nummer in de app + 1." />
          </div>
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
