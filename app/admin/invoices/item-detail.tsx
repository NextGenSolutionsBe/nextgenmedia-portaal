'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Pencil, CheckCircle2, RotateCcw, CalendarClock, Ban, Wallet, ChevronDown, ChevronRight, Paperclip, Trash2, Repeat, History, ExternalLink, Copy } from 'lucide-react'
import { Bevestig, INP } from '@/app/admin/instellingen/ui'
import { datumLang, datumNl, euro2, isDatum, tabVan, type Moment } from '@/lib/facturatie/planner-model'
import { Lade, StatusBadge } from './planner/planner-detail'
import { ReeksBewerken } from './planner/reeks-bewerken'
import { ItemInhoud, KopieerKnop, factuurTekst, laadItem, type ItemData } from './item-inhoud'
import { KostenEnWinstDialoog } from './kosten-en-winst'

/**
 * “Bekijken”: alles van één facturatie-item op één plek. Bovenaan wat je
 * dagelijks nodig hebt (kopiëren, aanpassen, markeren als gefactureerd);
 * betaling, kosten en historiek staan eronder als secundaire details.
 */
export function ItemDetail({ moment, onSluit, onGewijzigd, onBewerk, onEigenArtikelen, onGeavanceerd }: {
  moment: Moment
  onSluit: () => void
  onGewijzigd: () => void
  onBewerk: (invoiceId: string) => void
  onEigenArtikelen: (m: Moment) => void
  onGeavanceerd: (invoiceId: string) => void
}) {
  const [data, setData] = useState<ItemData | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [extern, setExtern] = useState('')
  const [bevestigOntbrekend, setBevestigOntbrekend] = useState(false)
  const [vraag, setVraag] = useState<'heropen' | 'annuleer' | null>(null)
  const [verplaats, setVerplaats] = useState(false)
  const [nieuweDatum, setNieuweDatum] = useState(moment.datum)
  const [meer, setMeer] = useState(false)
  const [kosten, setKosten] = useState(false)
  const [reeks, setReeks] = useState(false)

  const laad = useCallback(async () => {
    try { const d = await laadItem(moment.id); setData(d); setExtern(d.detail.extern_factuurnummer ?? '') } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [moment.id])
  useEffect(() => { laad() }, [laad])

  const actie = async (a: string, extra: Record<string, unknown> = {}, melding = 'Bijgewerkt.') => {
    if (!data) return false
    setBezig(true)
    try {
      const r = await fetch('/api/admin/invoices/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: a, id: data.id, ...extra }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Actie mislukt')
      toast.success(j.melding ?? melding); onGewijzigd(); await laad(); return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Actie mislukt'); return false } finally { setBezig(false) }
  }

  const status = data?.status ?? moment.status
  const tab = tabVan({ status })
  const isFactuur = data?.bron === 'invoice' && !!data.invoice_id
  const isReeksMaand = data?.bron === 'recurring'
  const ontbreekt = (data?.ontbrekend.length ?? 0) > 0

  const uploadBijlage = async (f: File) => {
    if (!data?.invoice_id) return
    const fd = new FormData(); fd.append('file', f); fd.append('invoice_id', data.invoice_id)
    setBezig(true)
    try { const r = await fetch('/api/admin/invoices/bijlagen', { method: 'POST', body: fd }); const j = await r.json(); if (!r.ok) throw new Error(j.error); toast.success('Bijlage toegevoegd.'); await laad() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Uploaden mislukt') } finally { setBezig(false) }
  }
  const verwijderBijlage = async (id: string, naam: string) => {
    if (!confirm(`Bijlage “${naam}” verwijderen?`)) return
    try { const r = await fetch(`/api/admin/invoices/bijlagen?id=${id}`, { method: 'DELETE' }); const j = await r.json(); if (!r.ok) throw new Error(j.error); toast.success('Bijlage verwijderd.'); await laad() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }

  return (
    <Lade breed onSluit={onSluit} titel={
      <>
        <h3 className="font-semibold text-gray-900 truncate">{moment.klant}</h3>
        <div className="flex items-center gap-2 mt-1 flex-wrap"><StatusBadge status={status} /><span className="text-xs text-gray-500">{moment.type} · gepland {datumLang(moment.datum)}</span></div>
      </>
    }>
      {fout && <div className="text-sm text-red-700">{fout}</div>}
      {!data && !fout && <div className="py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>}
      {data && (
        <div className="space-y-4">
          {/* Dagelijkse acties */}
          <div className="flex flex-wrap gap-2">
            <KopieerKnop tekst={factuurTekst(data)} label="Kopieer factuurgegevens" melding="Factuurgegevens gekopieerd (zonder interne notities)." />
            {isFactuur && <button type="button" onClick={() => onBewerk(data.invoice_id!)} className="btn-secondary text-sm"><Pencil className="h-4 w-4" />Aanpassen</button>}
            {isReeksMaand && tab === 'te_factureren' && <button type="button" onClick={() => onEigenArtikelen(moment)} className="btn-secondary text-sm" title="Extra kilometers of kosten enkel voor deze maand"><Pencil className="h-4 w-4" />Artikelen voor deze maand aanpassen</button>}
          </div>

          {tab === 'te_factureren' && (
            <div className="rounded-xl border-2 border-[#166534]/30 bg-green-50/40 p-3 space-y-2">
              <div className="grid sm:grid-cols-[1fr_auto] gap-2 items-end">
                <div><label className="block text-xs font-medium text-gray-700 mb-1">Extern factuurnummer <span className="text-gray-400 font-normal">— optioneel</span></label><input className={INP} value={extern} onChange={(e) => setExtern(e.target.value)} placeholder="bv. 2026-81" /></div>
                <button type="button" disabled={bezig || (ontbreekt && !bevestigOntbrekend)} onClick={() => actie('verstuurd', { extern_nummer: extern }, 'Gemarkeerd als gefactureerd.')}
                  className="btn-primary text-sm bg-[#166534] hover:bg-[#14532d] text-white border-[#166534]">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Markeren als gefactureerd</button>
              </div>
              {ontbreekt && <label className="flex items-start gap-2 text-xs text-amber-900"><input type="checkbox" checked={bevestigOntbrekend} onChange={(e) => setBevestigOntbrekend(e.target.checked)} className="mt-0.5" />Er ontbreken gegevens (zie hieronder). Ik heb de factuur toch volledig opgemaakt.</label>}
              <p className="text-[11px] text-gray-500">Gefactureerd = extern aangemaakt en verstuurd. Betaling volg je apart op.</p>
            </div>
          )}
          {tab === 'gefactureerd' && (
            <div className="rounded-xl bg-[#166534] text-white p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium"><CheckCircle2 className="h-4 w-4" />Gefactureerd{data.verzonden_op ? ` op ${datumNl(data.verzonden_op)}` : ''}{data.verzonden_door ? ` door ${data.verzonden_door.split('@')[0]}` : ''}</div>
              <div className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end">
                <div><label className="block text-[11px] text-green-100 mb-1">Extern factuurnummer</label><input className={`${INP} text-gray-900`} value={extern} onChange={(e) => setExtern(e.target.value)} placeholder="optioneel" /></div>
                <button type="button" disabled={bezig || extern === (data.detail.extern_factuurnummer ?? '')} onClick={() => actie('extern_nummer', { extern_nummer: extern }, 'Factuurnummer bewaard.')} className="btn-secondary text-sm">Bewaren</button>
                <button type="button" disabled={bezig} onClick={() => setVraag('heropen')} className="btn-secondary text-sm"><RotateCcw className="h-4 w-4" />Terugzetten</button>
              </div>
            </div>
          )}

          <ItemInhoud data={data} metBijlagen={false} />

          {/* Bijlagen */}
          {isFactuur && (
            <section>
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[11px] uppercase tracking-wide text-gray-400">Bijlagen</span>
                <label className="text-xs underline cursor-pointer text-gray-700">+ bijlage<input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadBijlage(f); e.target.value = '' }} /></label>
              </div>
              {data.bijlagen.length === 0 ? <div className="text-sm text-gray-400">Geen bijlagen.</div> : (
                <ul className="space-y-1">{data.bijlagen.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 text-sm">
                    <a href={`/api/admin/invoices/bijlagen?id=${b.id}`} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline inline-flex items-center gap-1 min-w-0 truncate"><Paperclip className="h-3.5 w-3.5 shrink-0" />{b.naam}</a>
                    <button type="button" onClick={() => verwijderBijlage(b.id, b.naam)} className="text-red-600 hover:bg-red-50 rounded p-1 ml-auto" aria-label="Bijlage verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                  </li>
                ))}</ul>
              )}
            </section>
          )}

          {/* Secundair: planning, betaling, kosten en historiek */}
          <section className="border-t border-gray-100 pt-3">
            <button type="button" onClick={() => setMeer((x) => !x)} className="text-sm font-medium text-gray-700 inline-flex items-center gap-1.5">{meer ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Meer: datum, betaling, kosten en historiek</button>
            {meer && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {moment.acties.kanVerplaatsen && <button type="button" onClick={() => setVerplaats((x) => !x)} className="btn-secondary text-xs"><CalendarClock className="h-3.5 w-3.5" />Geplande datum verplaatsen</button>}
                  {(moment.bron === 'invoice' || moment.bron === 'recurring') && <button type="button" onClick={() => setKosten(true)} className="btn-secondary text-xs"><Wallet className="h-3.5 w-3.5" />Kosten en winst</button>}
                  {isReeksMaand && data.recurring_id && <button type="button" onClick={() => setReeks(true)} className="btn-secondary text-xs"><Repeat className="h-3.5 w-3.5" />Reeks bewerken</button>}
                  {isFactuur && <button type="button" onClick={() => onGeavanceerd(data.invoice_id!)} className="btn-secondary text-xs" title="Historiek, gedeeltelijke betaling, crediteren of verwijderen"><History className="h-3.5 w-3.5" />Historiek en geavanceerd</button>}
                  {data.contract_id && <Link href={`/admin/contracts/${data.contract_id}`} prefetch={false} className="btn-secondary text-xs"><ExternalLink className="h-3.5 w-3.5" />Contract</Link>}
                  {moment.acties.kanAnnuleren && tab === 'te_factureren' && <button type="button" onClick={() => setVraag('annuleer')} className="btn-secondary text-xs text-red-600"><Ban className="h-3.5 w-3.5" />Annuleren</button>}
                  {(status === 'geannuleerd' || status === 'gecrediteerd') && <button type="button" onClick={() => actie('heropen', {}, 'Teruggezet naar te factureren.')} className="btn-secondary text-xs"><RotateCcw className="h-3.5 w-3.5" />Terug naar te factureren</button>}
                </div>
                {verplaats && (
                  <div className="rounded-xl border border-gray-200 p-3 flex items-end gap-2 flex-wrap">
                    <div className="flex-1 min-w-[160px]"><label className="block text-xs font-medium text-gray-600 mb-1">Nieuwe geplande facturatiedatum</label><input type="date" className={INP} value={nieuweDatum} onChange={(e) => setNieuweDatum(e.target.value)} /></div>
                    <button type="button" disabled={bezig || !isDatum(nieuweDatum) || nieuweDatum === moment.datum} onClick={async () => { if (await actie('verplaats', { datum: nieuweDatum }, 'Datum verplaatst.')) setVerplaats(false) }} className="btn-primary text-xs">Verplaatsen</button>
                  </div>
                )}
                {tab === 'gefactureerd' && (
                  <div className="rounded-xl border border-gray-200 p-3 text-sm space-y-2">
                    <div className="text-[11px] uppercase tracking-wide text-gray-400">Betaling (apart van gefactureerd)</div>
                    {status === 'betaald'
                      ? <div className="flex items-center gap-2 flex-wrap"><span className="text-[#166534] font-medium">Betaald{data.betaald_op ? ` op ${datumNl(data.betaald_op)}` : ''}</span><button type="button" disabled={bezig} onClick={() => actie('onbetaald', {}, 'Betaling teruggedraaid.')} className="btn-secondary text-xs ml-auto"><RotateCcw className="h-3.5 w-3.5" />Betaling terugdraaien</button></div>
                      : <div className="flex items-center gap-2 flex-wrap"><span className="text-gray-700">Nog niet betaald · verwacht rond {datumNl(moment.verwacht_op)}</span><button type="button" disabled={bezig} onClick={() => actie('betaald', {}, 'Gemarkeerd als betaald.')} className="btn-secondary text-xs ml-auto"><Wallet className="h-3.5 w-3.5" />Markeren als betaald</button></div>}
                  </div>
                )}
                <div className="text-[11px] text-gray-400 flex items-center gap-1"><Copy className="h-3 w-3" />Referentie in de app: <code>{data.id}</code></div>
              </div>
            )}
          </section>
        </div>
      )}

      {vraag === 'heropen' && (
        <Bevestig titel="Terugzetten naar te factureren?" bezig={bezig} bevestigLabel="Terugzetten"
          tekst={<>Het item gaat terug naar <b>Te factureren</b>; de factuurdatum en wie het afwerkte worden gewist. Het externe factuurnummer blijft staan.</>}
          onAnnuleer={() => setVraag(null)} onBevestig={async () => { setVraag(null); await actie('heropen', {}, 'Teruggezet naar te factureren.') }} />
      )}
      {vraag === 'annuleer' && (
        <Bevestig titel="Item annuleren?" gevaarlijk bezig={bezig} bevestigLabel="Ja, annuleren"
          tekst={<>Je annuleert {moment.klant} op {datumNl(moment.datum)} ({euro2(moment.bedrag_excl)} excl. btw). Het telt niet meer mee, maar blijft in Alles (grijs) staan.</>}
          onAnnuleer={() => setVraag(null)} onBevestig={async () => { setVraag(null); if (await actie('annuleer', {}, 'Geannuleerd.')) onSluit() }} />
      )}
      {kosten && (
        <KostenEnWinstDialoog
          factuur={moment.bron === 'invoice' ? { invoice_id: moment.bronId } : { recurring_id: moment.bronId, maand: moment.maand }}
          titel={`${moment.klant} · ${datumNl(moment.datum)} · ${euro2(moment.bedrag_excl)} excl. btw`}
          clientId={moment.client_id} onClose={() => setKosten(false)} onChanged={onGewijzigd} />
      )}
      {reeks && data?.recurring_id && <ReeksBewerken recurringId={data.recurring_id} onSluit={() => setReeks(false)} onKlaar={() => { setReeks(false); onGewijzigd(); onSluit() }} />}
    </Lade>
  )
}
