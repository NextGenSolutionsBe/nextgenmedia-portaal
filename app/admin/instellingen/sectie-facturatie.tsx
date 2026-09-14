'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, XCircle, ExternalLink } from 'lucide-react'
import type { FacturatieInstellingen } from '@/lib/instellingen/model'
import type { Ctx } from './instellingen-client'
import { Kop, Groep, Tekst, Getal, Veld, OpslaanBalk, Schakelaar, INP } from './ui'

type Controle = { ok: boolean; listId: string; workspace: string; space: string; folder: string; list: string; pad: string; url: string; afwijkingen: string[]; verwacht: { space: string; folder: string; list: string } }

export function SectieFacturatie({ ctx }: { ctx: Ctx }) {
  const bron = ctx.inst.facturatie
  const [v, setV] = useState<FacturatieInstellingen>(bron)
  useEffect(() => { setV(bron) }, [bron])
  const vuil = JSON.stringify(v) !== JSON.stringify(bron)
  const { zetVuil } = ctx
  useEffect(() => { zetVuil(vuil) }, [vuil, zetVuil])
  const zet = <K extends keyof FacturatieInstellingen>(k: K, w: FacturatieInstellingen[K]) => setV((p) => ({ ...p, [k]: w }))

  // ClickUp-lijst: controleren → tonen → bevestigen → pas dan opslaan.
  const [controle, setControle] = useState<Controle | null>(null)
  const [controleFout, setControleFout] = useState<string | null>(null)
  const [controleren, setControleren] = useState(false)
  const [bevestigd, setBevestigd] = useState(false)
  const lijstGewijzigd = v.clickup_lijst_id !== bron.clickup_lijst_id && v.clickup_lijst_id !== ''
  const controleGeldig = !!controle && controle.ok && controle.listId === v.clickup_lijst_id

  const controleer = async () => {
    setControleren(true); setControle(null); setControleFout(null); setBevestigd(false)
    try {
      const r = await fetch('/api/admin/instellingen/clickup-lijst', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lijstId: v.clickup_lijst_id }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Controle mislukt')
      setControle(j)
    } catch (e) { setControleFout(e instanceof Error ? e.message : 'Controle mislukt') } finally { setControleren(false) }
  }

  const opslaan = () => {
    if (lijstGewijzigd && !(controleGeldig && bevestigd)) { toast.error('Controleer en bevestig eerst de ClickUp-lijst voordat je opslaat.'); return }
    ctx.opslaan('facturatie', v, lijstGewijzigd && bevestigd ? ['clickup_lijst'] : []).then((ok) => { if (ok) { setControle(null); setBevestigd(false) } })
  }

  const actieveLijst = bron.clickup_lijst_id || ctx.omgeving.clickupLijstEnv
  const bronLabel = bron.clickup_lijst_id ? 'ingesteld via deze pagina' : ctx.omgeving.clickupLijstEnv ? 'uit de omgevingsvariabele CLICKUP_INVOICING_LIST_ID' : null

  return (
    <div className="card-base">
      <Kop titel="Facturatie-instellingen" tekst="Standaardwaarden voor nieuwe facturen en de koppeling met de ClickUp-facturatielijst. Bestaande facturen en taken veranderen niet." />
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
            <Veld label="Standaardomschrijving" breed hint="Voorgesteld bij een nieuwe factuurlijn."><textarea className={INP} rows={2} value={v.standaard_omschrijving} onChange={(e) => zet('standaard_omschrijving', e.target.value)} /></Veld>
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

        <Groep titel="ClickUp-koppeling">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 px-4 py-3">
              <div>
                <div className="text-sm font-medium">Facturatietaken naar ClickUp sturen</div>
                <div className="text-[11px] text-gray-500">Bij ondertekende contracten en nieuwe facturen. Taken worden nooit verwijderd of verplaatst.</div>
              </div>
              <Schakelaar aan={v.clickup_sync_aan} onChange={(w) => zet('clickup_sync_aan', w)} label="ClickUp-synchronisatie" />
            </div>

            <div className="rounded-xl border border-gray-100 p-4 space-y-3">
              <div className="text-sm">
                <span className="font-medium">Actieve facturatielijst:</span>{' '}
                {actieveLijst ? <><code className="text-xs bg-gray-100 rounded px-1.5 py-0.5">{actieveLijst}</code> <span className="text-gray-500">({bronLabel})</span></> : <span className="text-amber-700">niet ingesteld — er worden geen facturatietaken aangemaakt</span>}
                {bron.clickup_lijst_pad && <div className="text-[11px] text-gray-500 mt-0.5">{bron.clickup_lijst_pad}</div>}
              </div>
              <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
                <Tekst label="Lijst-id wijzigen" value={v.clickup_lijst_id} onChange={(w) => { zet('clickup_lijst_id', w.replace(/\D/g, '')); setControle(null); setBevestigd(false); setControleFout(null) }} placeholder={ctx.omgeving.clickupLijstEnv ?? 'bv. 1200340000002297'} hint="Leeg = de omgevingsvariabele geldt. Een nieuw id wordt eerst via de ClickUp-API gecontroleerd." />
                <button type="button" onClick={controleer} disabled={!v.clickup_lijst_id || controleren || !lijstGewijzigd} className="btn-secondary mb-5 disabled:opacity-40">
                  {controleren && <Loader2 className="h-4 w-4 animate-spin" />}Lijst controleren
                </button>
              </div>
              {controleFout && <div className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-start gap-2"><XCircle className="h-4 w-4 mt-0.5 shrink-0" />{controleFout}</div>}
              {controle && (
                <div className={`rounded-lg border px-3 py-3 text-sm ${controle.ok ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
                  <div className="flex items-center gap-2 font-medium mb-2">
                    {controle.ok ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <XCircle className="h-4 w-4 text-amber-700" />}
                    {controle.ok ? 'De lijst staat op de verwachte plaats.' : 'De lijst staat niet op de verwachte plaats.'}
                    <a href={controle.url} target="_blank" rel="noreferrer" className="ml-auto text-xs underline inline-flex items-center gap-1">Openen in ClickUp <ExternalLink className="h-3 w-3" /></a>
                  </div>
                  <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-gray-500">Workspace</dt><dd>{controle.workspace || '—'}</dd>
                    <dt className="text-gray-500">Space</dt><dd>{controle.space || '—'} <span className="text-gray-400">(verwacht: {controle.verwacht.space})</span></dd>
                    <dt className="text-gray-500">Folder</dt><dd>{controle.folder || '—'} <span className="text-gray-400">(verwacht: {controle.verwacht.folder})</span></dd>
                    <dt className="text-gray-500">Lijst</dt><dd>{controle.list} <span className="text-gray-400">(verwacht: {controle.verwacht.list})</span> · id {controle.listId}</dd>
                  </dl>
                  {!controle.ok && <ul className="list-disc ml-5 mt-2 text-xs text-amber-900">{controle.afwijkingen.map((a) => <li key={a}>{a}</li>)}</ul>}
                  {controle.ok && (
                    <label className="flex items-start gap-2 mt-3 text-sm">
                      <input type="checkbox" className="mt-0.5" checked={bevestigd} onChange={(e) => setBevestigd(e.target.checked)} />
                      <span>Ik bevestig dat nieuwe facturatietaken voortaan in <b>{controle.pad}</b> komen. Bestaande taken blijven staan waar ze staan.</span>
                    </label>
                  )}
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-3">
                <Tekst label="Verantwoordelijke (ClickUp gebruikers-id)" value={v.clickup_assignee_id} onChange={(w) => zet('clickup_assignee_id', w.replace(/\D/g, ''))} placeholder={ctx.omgeving.clickupAssigneeEnv ?? 'leeg = geen'} hint="Leeg = de omgevingsvariabele CLICKUP_INVOICING_ASSIGNEE_ID, anders geen verantwoordelijke." />
                <Tekst label="Naam verantwoordelijke (ter info)" value={v.clickup_assignee_naam} onChange={(w) => zet('clickup_assignee_naam', w)} placeholder="Bram Reinquin" />
              </div>
            </div>
          </div>
        </Groep>
      </div>
      <OpslaanBalk vuil={vuil} bezig={ctx.bezig} onOpslaan={opslaan} onAnnuleer={() => { setV(bron); setControle(null); setBevestigd(false) }} bijgewerkt={ctx.bijgewerkt.facturatie} />
    </div>
  )
}
