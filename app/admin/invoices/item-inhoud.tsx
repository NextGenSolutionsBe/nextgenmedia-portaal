'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Copy, Check, AlertTriangle, Info, StickyNote, Paperclip } from 'lucide-react'
import { formatEuro } from '@/lib/utils'
import { berekenRegel, berekenTotalen, eenheidTekst } from '@/lib/facturen/regels'
import { adresRegels, kopieerTekst, prestatieTekst, regelKopie, FACTUUR_TYPES, type ItemDetail } from '@/lib/facturatie/item-model'
import type { PlannerStatus } from '@/lib/facturatie/planner-model'

/**
 * De inhoud van één facturatie-item zoals Bram ze overneemt: klant, project,
 * referentie, alle regels volledig leesbaar, totalen, de mededeling — en de
 * interne notitie duidelijk apart. Gebruikt in het detailvenster én de ronde.
 */

export type Bijlage = { id: string; naam: string; grootte: number | null; mime: string | null; created_by: string | null; created_at: string }
export type ItemData = {
  id: string; bron: 'invoice' | 'recurring'; invoice_id: string | null; recurring_id: string | null; maand: string | null
  status: PlannerStatus; detail: ItemDetail; ontbrekend: string[]; aandacht: string[]; bijlagen: Bijlage[]
  contract_id: string | null; client_id: string | null; verzonden_op: string | null; verzonden_door: string | null; betaald_op: string | null
  betaald_bedrag: number; bedrag_incl: number
}

export async function laadItem(id: string): Promise<ItemData> {
  let r = await fetch(`/api/admin/invoices/item?id=${encodeURIComponent(id)}`, { cache: 'no-store' })
  let j = await r.json()
  if (r.ok && j.doorverwijzen) { r = await fetch(`/api/admin/invoices/item?id=${encodeURIComponent(j.doorverwijzen)}`, { cache: 'no-store' }); j = await r.json() }
  if (!r.ok) throw new Error(j.error || 'Laden mislukt')
  return j as ItemData
}

export async function kopieer(tekst: string, melding = 'Gekopieerd.'): Promise<void> {
  try { await navigator.clipboard.writeText(tekst) } catch {
    // Oudere browsers / geen toestemming: via een tijdelijk tekstvak.
    const t = document.createElement('textarea'); t.value = tekst; t.style.position = 'fixed'; t.style.opacity = '0'
    document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove()
  }
  toast.success(melding)
}

export function KopieerKnop({ tekst, label, klein, melding }: { tekst: string; label?: string; klein?: boolean; melding?: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button type="button" onClick={async () => { await kopieer(tekst, melding); setOk(true); setTimeout(() => setOk(false), 1500) }}
      className={klein ? 'h-7 px-2 inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white text-[11px] text-gray-700 hover:border-gray-400 shrink-0' : 'btn-secondary text-sm'}
      title={label ?? 'Kopiëren'} aria-label={label ?? 'Kopiëren'}>
      {ok ? <Check className="h-3.5 w-3.5 text-green-700" /> : <Copy className="h-3.5 w-3.5" />}{label && <span>{label}</span>}
    </button>
  )
}

const datumNl = (d: string | null | undefined) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '—')

export function ItemInhoud({ data, metBijlagen = true }: { data: ItemData; metBijlagen?: boolean }) {
  const d = data.detail
  const t = berekenTotalen(d.regels)
  const k = d.klant
  const adres = adresRegels(k)
  const type = FACTUUR_TYPES.find((x) => x.key === d.type)?.label
  return (
    <div className="space-y-4">
      {data.ontbrekend.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-semibold flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Gegevens ontbreken</div>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">{data.ontbrekend.map((o) => <li key={o}>{o}</li>)}</ul>
        </div>
      )}
      {data.aandacht.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs text-gray-700 flex gap-2"><Info className="h-4 w-4 shrink-0 mt-0.5" /><div>{data.aandacht.join(' ')}</div></div>
      )}

      {/* Klant */}
      <section className="rounded-xl border border-gray-200 p-3">
        <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Klant</div>
        {k ? (
          <div className="text-sm space-y-0.5">
            <div className="flex items-center justify-between gap-2"><b className="text-gray-900">{k.naam}</b><KopieerKnop klein tekst={k.naam} label="Naam" melding="Klantnaam gekopieerd." /></div>
            {k.btw && <div className="flex items-center justify-between gap-2"><span>Btw {k.btw}</span><KopieerKnop klein tekst={k.btw} label="Btw" melding="Btw-nummer gekopieerd." /></div>}
            {adres.length > 0 && <div className="flex items-center justify-between gap-2"><span>{adres.join(', ')}</span><KopieerKnop klein tekst={adres.join('\n')} label="Adres" melding="Adres gekopieerd." /></div>}
            {(k.facturatie_email || k.email) && <div className="text-gray-600">{k.facturatie_email || k.email}</div>}
            {(k.contact || k.telefoon) && <div className="text-gray-500 text-xs">{[k.contact, k.telefoon].filter(Boolean).join(' · ')}</div>}
          </div>
        ) : <div className="text-sm text-red-600">Geen klant gekoppeld.</div>}
      </section>

      {/* Basis */}
      <section className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <Veld label="Geplande facturatiedatum">{datumNl(d.datum)}</Veld>
        <Veld label="Type">{type ?? '—'}</Veld>
        <Veld label="Project">{d.project ?? '—'}</Veld>
        <Veld label="Klantreferentie">{d.klant_referentie ? <span className="inline-flex items-center gap-1">{d.klant_referentie}<KopieerKnop klein tekst={d.klant_referentie} /></span> : '—'}</Veld>
        <Veld label="Prestatieperiode">{prestatieTekst(d) || '—'}</Veld>
        <Veld label="Betaaltermijn">{d.betaaltermijn} dagen</Veld>
        {d.titel && <div className="col-span-2"><Veld label="Omschrijving">{d.titel}</Veld></div>}
        {d.extern_factuurnummer && <Veld label="Extern factuurnummer">{d.extern_factuurnummer}</Veld>}
      </section>

      {/* Regels */}
      <section>
        <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Factuurregels</div>
        <ul className="space-y-2">
          {d.regels.length === 0 && <li className="text-sm text-gray-500">Geen regels.</li>}
          {d.regels.map((r, i) => {
            const b = berekenRegel(r)
            return (
              <li key={i} className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-gray-900">{i + 1}. {r.artikel || r.omschrijving}</div>
                    {r.omschrijving && r.omschrijving !== r.artikel && <div className="text-sm text-gray-700 whitespace-pre-wrap">{r.omschrijving}</div>}
                  </div>
                  <KopieerKnop klein tekst={r.omschrijving || r.artikel} label="Omschrijving" melding="Omschrijving gekopieerd." />
                </div>
                <div className="mt-1.5 text-xs text-gray-600 tabular-nums flex flex-wrap gap-x-3 gap-y-0.5">
                  <span>{r.aantal.toLocaleString('nl-BE')} {eenheidTekst(r.eenheid, r.aantal)} × {formatEuro(r.prijs_excl)}</span>
                  {(r.korting_pct > 0 || (r.korting_eur ?? 0) > 0) && <span>korting {r.korting_pct > 0 ? `${r.korting_pct}%` : formatEuro(r.korting_eur ?? 0)}</span>}
                  <span>btw {r.btw_pct.toLocaleString('nl-BE')}%</span>
                  <span className="ml-auto font-semibold text-gray-900">{formatEuro(b.excl)} excl. · {formatEuro(b.incl)} incl.</span>
                </div>
                <div className="mt-1 flex justify-end"><KopieerKnop klein tekst={regelKopie(r)} label="Hele regel" melding="Regel gekopieerd." /></div>
              </li>
            )
          })}
        </ul>
        <div className="mt-2 rounded-xl bg-gray-50 border border-gray-200 p-3 text-sm tabular-nums space-y-0.5 ml-auto max-w-xs">
          <div className="flex justify-between"><span>Subtotaal excl. btw</span><b>{formatEuro(t.excl)}</b></div>
          {t.perBtw.map((p) => <div key={p.pct} className="flex justify-between text-gray-600"><span>Btw {p.pct.toLocaleString('nl-BE')} %</span><span>{formatEuro(p.btw)}</span></div>)}
          <div className="flex justify-between text-base"><span>Totaal incl. btw</span><b>{formatEuro(t.incl)}</b></div>
        </div>
      </section>

      {/* Mededeling (op de factuur) en interne notitie (NIET) */}
      <section className="rounded-xl border border-gray-200 p-3">
        <div className="flex items-center justify-between gap-2"><span className="text-[11px] uppercase tracking-wide text-gray-400">Mededeling voor op de factuur</span>{d.mededeling && <KopieerKnop klein tekst={d.mededeling} label="Mededeling" melding="Mededeling gekopieerd." />}</div>
        <div className="text-sm whitespace-pre-wrap mt-1">{d.mededeling || <span className="text-gray-400">—</span>}</div>
      </section>
      {d.notitie && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-[11px] uppercase tracking-wide text-amber-800 flex items-center gap-1"><StickyNote className="h-3.5 w-3.5" />Interne notitie — niet op de factuur</div>
          <div className="text-sm whitespace-pre-wrap mt-1 text-amber-950">{d.notitie}</div>
        </section>
      )}
      {metBijlagen && data.bijlagen.length > 0 && (
        <section>
          <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Bijlagen</div>
          <ul className="space-y-1">{data.bijlagen.map((b) => <li key={b.id}><a href={`/api/admin/invoices/bijlagen?id=${b.id}`} target="_blank" rel="noreferrer" className="text-sm text-blue-700 hover:underline inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" />{b.naam}</a></li>)}</ul>
        </section>
      )}
    </div>
  )
}

function Veld({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><div className="text-[11px] text-gray-500">{label}</div><div className="text-gray-900 break-words">{children}</div></div>
}

/** De volledige factuurtekst (enkel wat op de externe factuur hoort). */
export const factuurTekst = (data: ItemData) => kopieerTekst(data.detail)
