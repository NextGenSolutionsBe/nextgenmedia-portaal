'use client'

import { useEffect, useState } from 'react'
import type { Organisatie } from '@/lib/instellingen/model'
import type { Ctx } from './instellingen-client'
import { Kop, Groep, Tekst, Getal, Veld, OpslaanBalk, INP } from './ui'

export function SectieBedrijf({ ctx }: { ctx: Ctx }) {
  const bron = ctx.inst.organisatie
  const [v, setV] = useState<Organisatie>(bron)
  useEffect(() => { setV(bron) }, [bron])
  const vuil = JSON.stringify(v) !== JSON.stringify(bron)
  const { zetVuil } = ctx
  useEffect(() => { zetVuil(vuil) }, [vuil, zetVuil])
  const zet = <K extends keyof Organisatie>(k: K, w: Organisatie[K]) => setV((p) => ({ ...p, [k]: w }))

  return (
    <div className="card-base">
      <Kop titel="Bedrijfsgegevens" tekst="De vaste gegevens van de onderneming. Ze verschijnen op nieuwe documenten en in de facturatiegegevens; bestaande documenten veranderen niet." />
      <div className="space-y-5">
        <Groep titel="Identiteit">
          <div className="grid sm:grid-cols-2 gap-3">
            <Tekst label="Vennootschapsnaam" value={v.vennootschapsnaam} onChange={(w) => zet('vennootschapsnaam', w)} placeholder="NextGenMedia BV" />
            <Tekst label="Handelsnaam" value={v.handelsnaam} onChange={(w) => zet('handelsnaam', w)} placeholder="NextGenMedia" />
            <Tekst label="Ondernemingsnummer" value={v.ondernemingsnummer} onChange={(w) => zet('ondernemingsnummer', w)} placeholder="0xxx.xxx.xxx" />
            <Tekst label="Btw-nummer" value={v.btw_nummer} onChange={(w) => zet('btw_nummer', w)} placeholder="BE 0xxx.xxx.xxx" hint="Wordt gecontroleerd op een geldig controlegetal." />
          </div>
        </Groep>
        <Groep titel="Adressen">
          <div className="grid sm:grid-cols-2 gap-3">
            <Veld label="Maatschappelijke zetel"><textarea className={INP} rows={2} value={v.maatschappelijke_zetel} onChange={(e) => zet('maatschappelijke_zetel', e.target.value)} placeholder={'Straat 1\n3500 Hasselt'} /></Veld>
            <Veld label="Facturatieadres" hint="Leeg = zelfde als de maatschappelijke zetel."><textarea className={INP} rows={2} value={v.facturatieadres} onChange={(e) => zet('facturatieadres', e.target.value)} /></Veld>
          </div>
        </Groep>
        <Groep titel="Contact">
          <div className="grid sm:grid-cols-3 gap-3">
            <Tekst label="E-mailadres" type="email" value={v.email} onChange={(w) => zet('email', w)} />
            <Tekst label="Telefoon" value={v.telefoon} onChange={(w) => zet('telefoon', w)} placeholder="+32 …" />
            <Tekst label="Website" value={v.website} onChange={(w) => zet('website', w)} placeholder="https://…" />
          </div>
        </Groep>
        <Groep titel="Bank en betaling">
          <div className="grid sm:grid-cols-3 gap-3">
            <Tekst label="IBAN" value={v.iban} onChange={(w) => zet('iban', w)} placeholder="BE68 5390 0754 7034" />
            <Tekst label="BIC" value={v.bic} onChange={(w) => zet('bic', w)} placeholder="GKCCBEBB" />
            <Getal label="Standaard betalingstermijn" value={v.betalingstermijn_dagen} onChange={(w) => zet('betalingstermijn_dagen', w)} min={0} max={365} eenheid="dagen" />
          </div>
        </Groep>
        <Groep titel="Regionaal">
          <div className="grid sm:grid-cols-3 gap-3">
            <Tekst label="Valuta" value={v.valuta} onChange={(w) => zet('valuta', w.toUpperCase())} maxLength={3} />
            <Veld label="Tijdzone">
              <select className={INP} value={v.tijdzone} onChange={(e) => zet('tijdzone', e.target.value)}>
                <option value="Europe/Brussels">Europe/Brussels</option>
                <option value="Europe/Amsterdam">Europe/Amsterdam</option>
                <option value="Europe/Paris">Europe/Paris</option>
                <option value="UTC">UTC</option>
              </select>
            </Veld>
            <Veld label="Datumnotatie">
              <select className={INP} value={v.datumnotatie} onChange={(e) => zet('datumnotatie', e.target.value)}>
                <option value="dd/mm/jjjj">dd/mm/jjjj</option>
                <option value="dd-mm-jjjj">dd-mm-jjjj</option>
                <option value="jjjj-mm-dd">jjjj-mm-dd</option>
              </select>
            </Veld>
          </div>
        </Groep>
      </div>
      <OpslaanBalk vuil={vuil} bezig={ctx.bezig} onOpslaan={() => ctx.opslaan('organisatie', v)} onAnnuleer={() => setV(bron)} bijgewerkt={ctx.bijgewerkt.organisatie} />
    </div>
  )
}
