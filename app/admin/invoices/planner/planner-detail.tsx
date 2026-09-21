'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { X, Send, CalendarClock, Ban, Eye, Pencil, FilePlus2, Loader2, AlertTriangle, Repeat, Plus } from 'lucide-react'
import { Bevestig, INP } from '@/app/admin/instellingen/ui'
import { STATUS_INFO, HERKOMST_LABEL, datumLang, datumNl, euro2, isDatum, type Moment } from '@/lib/facturatie/planner-model'

export type Actie = 'verstuurd' | 'verplaats' | 'annuleer'
export type ActieUitvoerder = (actie: Actie, moment: Moment, extra?: { datum?: string }) => Promise<boolean>

function Rij({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 py-1.5 border-b border-gray-50 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-gray-900 min-w-0 break-words">{children}</dd>
    </div>
  )
}

export function StatusBadge({ status, klein }: { status: Moment['status']; klein?: boolean }) {
  const s = STATUS_INFO[status]
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 ${klein ? 'py-0 text-[10px]' : 'py-0.5 text-[11px]'} font-medium whitespace-nowrap ${s.cls}`}><span className={`h-1.5 w-1.5 rounded-full ${s.stip}`} />{s.label}</span>
}

function Lade({ titel, onSluit, children, breed }: { titel: ReactNode; onSluit: () => void; children: ReactNode; breed?: boolean }) {
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/30" onClick={onSluit} />
      <aside className={`absolute inset-y-0 right-0 w-full ${breed ? 'sm:w-[520px]' : 'sm:w-[460px]'} bg-white shadow-2xl flex flex-col animate-fade-in`}>
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">{titel}</div>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 shrink-0" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
      </aside>
    </div>
  )
}

/** Detailpaneel van één facturatiemoment, met enkel de acties die van toepassing zijn. */
export function PlannerDetail({ moment: m, onSluit, onActie, bezig, onOpenFactuur }: { moment: Moment; onSluit: () => void; onActie: ActieUitvoerder; bezig: boolean; onOpenFactuur?: (invoiceId: string) => void }) {
  const isFactuur = m.bron === 'invoice' && !!m.invoice_id && !!onOpenFactuur
  const [verplaatsen, setVerplaatsen] = useState(false)
  const [nieuweDatum, setNieuweDatum] = useState(m.datum)
  const [vraagAnnuleer, setVraagAnnuleer] = useState(false)
  const a = m.acties

  return (
    <Lade onSluit={onSluit} titel={
      <>
        <div className="text-[11px] uppercase tracking-wide text-gray-400">{HERKOMST_LABEL[m.herkomst]}</div>
        <h3 className="font-semibold text-gray-900 truncate">{m.klant}</h3>
        <div className="flex items-center gap-2 mt-1 flex-wrap"><StatusBadge status={m.status} /><span className="text-xs text-gray-500">{m.type} · {datumLang(m.datum)}</span></div>
      </>
    }>
      {m.ontbrekend.length > 0 && (
        <div className="mb-3 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-900 flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div><b>Ontbrekende gegevens:</b> {m.ontbrekend.join(', ')}</div>
        </div>
      )}
      <dl>
        <Rij label="Klant">{m.client_id ? <Link href={`/admin/clients/${m.client_id}`} prefetch={false} className="underline decoration-gray-300 hover:decoration-black">{m.klant}</Link> : m.klant}</Rij>
        <Rij label="Project">{m.project ?? <span className="text-gray-400">—</span>}</Rij>
        {m.omschrijving && <Rij label="Omschrijving">{m.omschrijving}</Rij>}
        <Rij label="Facturatiedatum">{datumNl(m.datum)}</Rij>
        <Rij label="Bedrag excl. btw"><b>{euro2(m.bedrag_excl)}</b></Rij>
        <Rij label="Btw">{m.btw_pct.toLocaleString('nl-BE')} % · {euro2(m.bedrag_incl - m.bedrag_excl)}</Rij>
        <Rij label="Bedrag incl. btw">{euro2(m.bedrag_incl)}</Rij>
        <Rij label="Type factuur">{m.type}</Rij>
        <Rij label="Betaaltermijn">{m.betaaltermijn} dagen</Rij>
        {m.verzonden_op && <Rij label="Verstuurd op">{datumNl(m.verzonden_op)}{m.verzonden_door ? ` · door ${m.verzonden_door.split('@')[0]}` : ''}</Rij>}
        {m.status !== 'geannuleerd' && m.status !== 'gecrediteerd' && <Rij label="Verwacht binnen">{datumNl(m.verwacht_op)} <span className="text-gray-400">(verzenddatum + termijn)</span></Rij>}
        {m.schema && <Rij label="Terugkerend schema"><span className="inline-flex items-center gap-1"><Repeat className="h-3 w-3" />{m.schema}</span></Rij>}
        {m.contract_id && <Rij label="Contract"><Link href={`/admin/contracts/${m.contract_id}`} prefetch={false} className="underline decoration-gray-300 hover:decoration-black">{m.contract_titel || m.contract_id.slice(0, 8)}</Link></Rij>}
        <Rij label="Status"><StatusBadge status={m.status} /></Rij>
        <Rij label="Herkomst">{HERKOMST_LABEL[m.herkomst]}</Rij>
        <Rij label="Verantwoordelijke">{m.verantwoordelijke ?? '—'}</Rij>
        {m.opmerking && <Rij label="Interne opmerkingen">{m.opmerking}</Rij>}
        <Rij label="Referentie"><code className="text-[11px] bg-gray-100 rounded px-1">{m.id}</code></Rij>
      </dl>

      <div className="mt-4 space-y-2">
        <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">Acties</div>
        <div className="flex flex-wrap gap-2">
          {isFactuur && <button type="button" onClick={() => onOpenFactuur!(m.invoice_id!)} className="btn-primary text-xs"><Pencil className="h-3.5 w-3.5" />{m.status === 'te_versturen' || m.status === 'gepland' ? 'Factuur openen en bewerken' : 'Factuur openen'}</button>}
          {!isFactuur && a.bekijkenUrl && <Link href={a.bekijkenUrl} prefetch={false} className="btn-secondary text-xs"><Eye className="h-3.5 w-3.5" />Bekijken</Link>}
          {!isFactuur && a.aanpassenUrl && <Link href={a.aanpassenUrl} prefetch={false} className="btn-secondary text-xs"><Pencil className="h-3.5 w-3.5" />Aanpassen</Link>}
          {a.voorbereidenUrl && <Link href={a.voorbereidenUrl} prefetch={false} className="btn-secondary text-xs"><FilePlus2 className="h-3.5 w-3.5" />Factuur voorbereiden</Link>}
          {a.kanVerstuurd && <button type="button" disabled={bezig} onClick={() => onActie('verstuurd', m)} className="btn-primary text-xs">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Markeren als verstuurd</button>}
          {a.kanVerplaatsen && <button type="button" disabled={bezig} onClick={() => setVerplaatsen((v) => !v)} className="btn-secondary text-xs"><CalendarClock className="h-3.5 w-3.5" />Facturatiedatum verplaatsen</button>}
          {a.kanAnnuleren && <button type="button" disabled={bezig} onClick={() => setVraagAnnuleer(true)} className="btn-secondary text-xs text-red-600"><Ban className="h-3.5 w-3.5" />Opdracht annuleren</button>}
        </div>
        {verplaatsen && (
          <div className="rounded-xl border border-gray-200 p-3 flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Nieuwe facturatiedatum</label>
              <input type="date" className={INP} value={nieuweDatum} onChange={(e) => setNieuweDatum(e.target.value)} />
            </div>
            <button type="button" disabled={bezig || !isDatum(nieuweDatum) || nieuweDatum === m.datum} onClick={async () => { const ok = await onActie('verplaats', m, { datum: nieuweDatum }); if (ok) setVerplaatsen(false) }} className="btn-primary text-xs">Verplaatsen</button>
            <button type="button" onClick={() => setVerplaatsen(false)} className="btn-secondary text-xs">Annuleren</button>
            {(m.status === 'verstuurd' || m.status === 'betaald') && <p className="w-full text-[11px] text-gray-500">Ook een verstuurde of betaalde factuur mag van datum veranderen; de nieuwe datum staat meteen in Facturen en op het contract.</p>}
          </div>
        )}
        {!a.kanVerstuurd && !a.kanVerplaatsen && !a.kanAnnuleren && m.bron === 'wam' && <p className="text-[11px] text-gray-500">WAM-termijnen beheer je in Vesting → WAM-portefeuille.</p>}
      </div>

      {vraagAnnuleer && (
        <Bevestig titel="Facturatieopdracht annuleren" gevaarlijk bezig={bezig} bevestigLabel="Ja, annuleren"
          tekst={<>Je annuleert de facturatie van <b>{m.klant}</b> op {datumNl(m.datum)} ({euro2(m.bedrag_excl)} excl. btw). Het item verdwijnt uit de standaardplanner maar blijft in de geschiedenis.</>}
          onAnnuleer={() => setVraagAnnuleer(false)}
          onBevestig={async () => { const ok = await onActie('annuleer', m); if (ok) { setVraagAnnuleer(false); onSluit() } }} />
      )}
    </Lade>
  )
}

/** Alle momenten van één dag (na "+N meer" of klik op een dag). */
export function DagPaneel({ datum, momenten, onSluit, onKies, onNieuw }: { datum: string; momenten: Moment[]; onSluit: () => void; onKies: (m: Moment) => void; onNieuw?: (datum: string) => void }) {
  const totaal = momenten.filter((m) => m.status !== 'geannuleerd').reduce((s, m) => s + m.bedrag_excl, 0)
  return (
    <Lade onSluit={onSluit} breed titel={
      <>
        <h3 className="font-semibold text-gray-900 capitalize">{datumLang(datum)}</h3>
        <div className="text-xs text-gray-500 mt-0.5">{momenten.length} facturatiemoment{momenten.length === 1 ? '' : 'en'} · {euro2(totaal)} excl. btw</div>
      </>
    }>
      {onNieuw && <button type="button" onClick={() => onNieuw(datum)} className="btn-secondary text-xs mb-3"><Plus className="h-3.5 w-3.5" />Nieuwe factuur op deze dag</button>}
      {momenten.length === 0 ? <p className="text-sm text-gray-400">Niets gepland op deze dag.</p> : (
        <div className="divide-y divide-gray-50">
          {momenten.map((m) => (
            <button key={m.id} type="button" onClick={() => onKies(m)} className="w-full text-left py-2.5 flex items-center gap-3 hover:bg-gray-50 rounded-lg px-2 -mx-2">
              <span className={`h-2 w-2 rounded-full shrink-0 ${STATUS_INFO[m.status].stip}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium truncate">{m.klant}</div>
                <div className="text-[11px] text-gray-500 truncate">{m.type} · {HERKOMST_LABEL[m.herkomst]}{m.project ? ` · ${m.project}` : ''}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold">{euro2(m.bedrag_excl)}</div>
                <StatusBadge status={m.status} klein />
              </div>
            </button>
          ))}
        </div>
      )}
    </Lade>
  )
}
