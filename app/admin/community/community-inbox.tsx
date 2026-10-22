'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, AlertTriangle, ExternalLink, Loader2, RefreshCw, Send, MessagesSquare } from 'lucide-react'
import { INP, Dialoog } from '@/app/admin/instellingen/ui'
import { MailComposer } from '@/components/admin/mail-composer'
import { NETWERK_LABEL } from '@/lib/metricool-inbox-parse'
import { CATEGORIEEN, CATEGORIE_LABEL, STATUSSEN, STATUS_LABEL, resterend, magNaarStatus, type Status, type Categorie, type Voorstel } from '@/lib/community/model'

/**
 * Inbox community management. Lijst gesorteerd op deadline (rood onder 4 uur),
 * detail met post, comment, voorstellen en een bewerkbaar antwoord. Versturen
 * gebeurt enkel na een bevestiging met preview; de ingelogde persoon is wie
 * bevestigt. Klantmails blijven handmatig (MailComposer).
 */
type Rij = {
  id: string; client_id: string; kanaal_id: string; bron: 'comment' | 'dm'; netwerk: string | null; post_tekst: string | null; post_url: string | null
  auteur_naam: string | null; auteur_handle: string | null; tekst: string | null; ontvangen_op: string | null; antwoord_mogelijk_tot: string | null
  categorie: Categorie | null; status: Status; voorstellen: Voorstel[]; gekozen_tekst: string | null; verstuur_fout: string | null; verstuurd_op: string | null; verstuurd_door: string | null
}
type Klant = { id: string; company_name: string }
type Kanaal = { id: string; client_id: string; naam: string; laatste_fout: string | null; laatst_gesynct: string | null }
type Lijst = { berichten: Rij[]; klanten: Klant[]; kanalen: Kanaal[]; magAanpassen: boolean }
type Detail = { bericht: Rij & { categorie_reden: string | null; extern_id: string }; draad: { id: string; auteur_naam: string | null; tekst: string | null; ontvangen_op: string | null; status: Status }[]; klant: { id: string; company_name: string } | null; kanaal: { naam: string } | null; klantKeurtGoed: boolean; magAanpassen: boolean }

const datum = (v: string | null) => (v ? new Date(v).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')
const STATUS_KLEUR: Record<Status, string> = {
  nieuw: 'bg-gray-100 text-gray-700', te_beantwoorden: 'bg-[#fff848] text-gray-900', bij_klant: 'bg-blue-100 text-blue-800', klant_gekozen: 'bg-purple-100 text-purple-800',
  verstuurd: 'bg-green-100 text-green-800', genegeerd: 'bg-gray-100 text-gray-500', verlopen: 'bg-gray-200 text-gray-600', fout: 'bg-red-100 text-red-700',
}

function Tijd({ deadline }: { deadline: string | null }) {
  const r = resterend(deadline)
  if (!r) return <span className="text-[11px] text-gray-400">geen termijn</span>
  return <span className={`status-badge ${r.voorbij ? 'bg-gray-200 text-gray-600' : r.dringend ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-700'}`}>{r.voorbij ? 'verlopen' : `nog ${r.tekst}`}</span>
}

export function CommunityInbox() {
  const sp = useSearchParams()
  const [filters, setFilters] = useState({ klant: sp.get('klant') ?? '', kanaal: '', netwerk: '', status: '', categorie: '' })
  const [lijst, setLijst] = useState<Lijst | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [gekozen, setGekozen] = useState<string | null>(null)
  const [laden, setLaden] = useState(false)

  const laad = useCallback(() => {
    setLaden(true)
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v))
    fetch(`/api/admin/community/berichten?${qs}`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setLijst(j); setFout(null) })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'))
      .finally(() => setLaden(false))
  }, [filters])
  useEffect(() => { laad() }, [laad])
  // De resterende tijd telt af: elke minuut opnieuw tekenen volstaat.
  const [, tik] = useState(0)
  useEffect(() => { const t = setInterval(() => tik((x) => x + 1), 60_000); return () => clearInterval(t) }, [])

  const klantNaam = useMemo(() => new Map((lijst?.klanten ?? []).map((k) => [k.id, k.company_name])), [lijst])
  const kanaalNaam = useMemo(() => new Map((lijst?.kanalen ?? []).map((k) => [k.id, k.naam])), [lijst])
  const kanaalFouten = (lijst?.kanalen ?? []).filter((k) => k.laatste_fout && (!filters.klant || k.client_id === filters.klant))
  const zet = (k: keyof typeof filters, v: string) => setFilters((f) => ({ ...f, [k]: v, ...(k === 'klant' ? { kanaal: '' } : {}) }))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <MessagesSquare className="h-5 w-5 text-gray-400" />
        <h1 className="text-xl font-semibold flex-1">Community</h1>
        <button type="button" className="btn-secondary text-sm" onClick={laad} disabled={laden}><RefreshCw className={`h-4 w-4 ${laden ? 'animate-spin' : ''}`} />Vernieuwen</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <select className={INP} aria-label="Klant" value={filters.klant} onChange={(e) => zet('klant', e.target.value)}>
          <option value="">Alle klanten</option>
          {(lijst?.klanten ?? []).map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}
        </select>
        <select className={INP} aria-label="Kanaal" value={filters.kanaal} onChange={(e) => zet('kanaal', e.target.value)}>
          <option value="">Alle kanalen</option>
          {(lijst?.kanalen ?? []).filter((k) => !filters.klant || k.client_id === filters.klant).map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}
        </select>
        <select className={INP} aria-label="Netwerk" value={filters.netwerk} onChange={(e) => zet('netwerk', e.target.value)}>
          <option value="">Alle netwerken</option>
          {Object.entries(NETWERK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className={INP} aria-label="Status" value={filters.status} onChange={(e) => zet('status', e.target.value)}>
          <option value="">Open</option>
          {STATUSSEN.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select className={INP} aria-label="Categorie" value={filters.categorie} onChange={(e) => zet('categorie', e.target.value)}>
          <option value="">Alle categorieën</option>
          <option value="geen">Nog niet ingedeeld</option>
          {CATEGORIEEN.map((c) => <option key={c} value={c}>{CATEGORIE_LABEL[c]}</option>)}
        </select>
      </div>

      {kanaalFouten.map((k) => (
        <div key={k.id} className="text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" /><span><b>{k.naam}</b>: {k.laatste_fout}</span></div>
      ))}
      {fout && <div className="card-base text-sm text-red-600">{fout}</div>}
      {!lijst && !fout && <div className="card-base py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" /></div>}

      {lijst && (
        <div className="grid lg:grid-cols-5 gap-4 items-start">
          <ul className={`lg:col-span-2 space-y-2 ${gekozen ? 'hidden lg:block' : ''}`}>
            {lijst.berichten.length === 0 && (
              <li className="card-base text-sm text-gray-500 text-center py-8">
                {lijst.klanten.length === 0 ? <>Community management staat voor geen enkele klant aan. Zet het aan op de <Link href="/admin/clients" className="underline">klantdetail</Link>.</> : 'Geen berichten met deze filters.'}
              </li>
            )}
            {lijst.berichten.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => setGekozen(b.id)}
                  className={`w-full text-left card-base !p-3 space-y-1.5 hover:border-gray-300 ${gekozen === b.id ? 'ring-2 ring-[#fff848]' : ''}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Tijd deadline={b.antwoord_mogelijk_tot} />
                    <span className={`status-badge ${STATUS_KLEUR[b.status]}`}>{STATUS_LABEL[b.status]}</span>
                    {b.categorie && <span className="status-badge bg-gray-50 text-gray-600">{CATEGORIE_LABEL[b.categorie]}</span>}
                  </div>
                  <div className="text-[11px] text-gray-500 truncate">{klantNaam.get(b.client_id)} · {kanaalNaam.get(b.kanaal_id)} · {NETWERK_LABEL[b.netwerk ?? ''] ?? b.netwerk} {b.bron === 'dm' ? 'DM' : 'comment'}</div>
                  <div className="text-sm"><b>{b.auteur_naam ?? 'Onbekend'}</b>: <span className="text-gray-700 line-clamp-2">{b.tekst || <i className="text-gray-400">geen tekst</i>}</span></div>
                  {b.verstuur_fout && <div className="text-[11px] text-red-600 truncate">Versturen mislukte: {b.verstuur_fout}</div>}
                </button>
              </li>
            ))}
          </ul>
          <div className={`lg:col-span-3 ${gekozen ? '' : 'hidden lg:block'}`}>
            {gekozen
              ? <BerichtDetail key={gekozen} id={gekozen} onTerug={() => setGekozen(null)} onGewijzigd={laad} />
              : <div className="card-base text-sm text-gray-400 text-center py-16">Kies een bericht.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function BerichtDetail({ id, onTerug, onGewijzigd }: { id: string; onTerug: () => void; onGewijzigd: () => void }) {
  const [d, setD] = useState<Detail | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [tekst, setTekst] = useState('')
  const [bezig, setBezig] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)

  const laad = useCallback(() => {
    fetch(`/api/admin/community/berichten?id=${id}`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j); setTekst(j.bericht.gekozen_tekst ?? j.bericht.voorstellen?.[0]?.tekst ?? '') })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [id])
  useEffect(() => { laad() }, [laad])

  const actie = async (naam: string, body: Record<string, unknown>, melding: string) => {
    setBezig(naam)
    try {
      const r = await fetch('/api/admin/community/berichten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Mislukt')
      toast.success(melding); laad(); onGewijzigd()
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); laad(); onGewijzigd(); return false } finally { setBezig(null) }
  }

  if (fout) return <div className="card-base text-sm text-red-600">{fout}</div>
  if (!d) return <div className="card-base py-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-gray-400" /></div>
  const b = d.bericht
  const mag = d.magAanpassen
  const kanVersturen = mag && (b.status === 'te_beantwoorden' || b.status === 'klant_gekozen') && !resterend(b.antwoord_mogelijk_tot)?.voorbij
  const statusKnop = (naar: Status, label: string) => mag && magNaarStatus(b.status, naar) && (
    <button type="button" className="btn-secondary text-sm" disabled={!!bezig} onClick={() => actie(naar, { actie: 'status', status: naar }, `${STATUS_LABEL[naar]}.`)}>
      {bezig === naar && <Loader2 className="h-4 w-4 animate-spin" />}{label}
    </button>
  )

  return (
    <div className="card-base space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <button type="button" className="lg:hidden btn-secondary text-xs" onClick={onTerug}><ArrowLeft className="h-3.5 w-3.5" />Terug</button>
        <Tijd deadline={b.antwoord_mogelijk_tot} />
        <span className={`status-badge ${STATUS_KLEUR[b.status]}`}>{STATUS_LABEL[b.status]}</span>
        {b.categorie && <span className="status-badge bg-gray-50 text-gray-600" title={b.categorie_reden ?? ''}>{CATEGORIE_LABEL[b.categorie]}</span>}
        <span className="text-xs text-gray-500">{d.klant?.company_name} · {d.kanaal?.naam} · {NETWERK_LABEL[b.netwerk ?? ''] ?? b.netwerk} {b.bron === 'dm' ? 'DM' : 'comment'}</span>
      </div>

      {b.verstuur_fout && <div className="text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2 flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span><b>Versturen mislukte:</b> {b.verstuur_fout}</span></div>}

      {b.bron === 'comment' && (
        <div className="rounded-lg bg-gray-50 p-3 text-sm">
          <div className="flex items-center justify-between gap-2 mb-1"><span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Post</span>
            {b.post_url && <a href={b.post_url} target="_blank" rel="noreferrer" className="text-xs inline-flex items-center gap-1 underline">Openen<ExternalLink className="h-3 w-3" /></a>}</div>
          <p className="whitespace-pre-line line-clamp-6 text-gray-700">{b.post_tekst || <i className="text-gray-400">geen tekst</i>}</p>
        </div>
      )}

      <div className="text-sm">
        <div className="text-[11px] text-gray-500">{b.auteur_naam ?? 'Onbekend'}{b.auteur_handle && b.auteur_handle !== b.auteur_naam ? ` (${b.auteur_handle})` : ''} · {datum(b.ontvangen_op)}</div>
        <p className="whitespace-pre-line mt-0.5">{b.tekst || <i className="text-gray-400">geen tekst (bv. enkel een bijlage)</i>}</p>
        {b.categorie_reden && <p className="text-[11px] text-gray-500 mt-1">Indeling: {b.categorie_reden}</p>}
      </div>

      {d.draad.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs text-gray-600">Draad ({d.draad.length})</summary>
          <ul className="mt-2 space-y-1.5 border-l-2 border-gray-100 pl-3">
            {d.draad.map((x) => <li key={x.id}><span className="text-[11px] text-gray-500">{x.auteur_naam ?? '?'} · {datum(x.ontvangen_op)} · {STATUS_LABEL[x.status]}</span><p className="line-clamp-3">{x.tekst}</p></li>)}
          </ul>
        </details>
      )}

      {b.status === 'verstuurd' ? (
        <div className="rounded-lg bg-green-50 p-3 text-sm"><div className="text-[11px] text-green-800">Verstuurd {datum(b.verstuurd_op)}{b.verstuurd_door ? ` door ${b.verstuurd_door}` : ''}</div>{b.gekozen_tekst && <p className="whitespace-pre-line mt-1">{b.gekozen_tekst}</p>}</div>
      ) : (
        <>
          {b.voorstellen?.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {b.voorstellen.map((v, i) => (
                <button key={i} type="button" disabled={!mag} onClick={() => setTekst(v.tekst)}
                  className={`text-left rounded-lg border p-3 text-sm hover:border-gray-400 ${tekst === v.tekst ? 'border-gray-900 bg-[#fff848]/20' : 'border-gray-200'}`}>
                  <p className="whitespace-pre-line">{v.tekst}</p>
                  {v.toelichting && <p className="text-[11px] text-gray-500 mt-1">{v.toelichting}</p>}
                </button>
              ))}
            </div>
          )}
          <div>
            <label htmlFor="cm-antwoord" className="block text-xs font-medium text-gray-600 mb-1">Antwoord</label>
            <textarea id="cm-antwoord" rows={4} className={INP} disabled={!mag} value={tekst} maxLength={2000} onChange={(e) => setTekst(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            {kanVersturen && <button type="button" className="btn-primary text-sm" disabled={!tekst.trim() || !!bezig} onClick={() => setPreview(true)}><Send className="h-4 w-4" />Versturen</button>}
            {mag && tekst.trim() !== (b.gekozen_tekst ?? '').trim() && (
              <button type="button" className="btn-secondary text-sm" disabled={!!bezig} onClick={() => actie('tekst', { actie: 'tekst', tekst }, 'Antwoord bewaard.')}>Antwoord bewaren</button>
            )}
            {statusKnop('bij_klant', 'Naar klant')}
            {b.status === 'bij_klant' && statusKnop('te_beantwoorden', 'Zelf beantwoorden')}
            {b.status === 'fout' && statusKnop('te_beantwoorden', 'Opnieuw proberen')}
            {statusKnop('genegeerd', 'Negeren')}
            {b.status !== 'nieuw' && statusKnop('nieuw', 'Terug naar nieuw')}
            {b.status === 'bij_klant' && d.klant && <MailComposer context={{ type: 'client', clientId: d.klant.id, kind: 'community' }} label="Klant herinneren" className="btn-secondary text-sm" />}
          </div>
          {(b.status === 'verlopen' || resterend(b.antwoord_mogelijk_tot)?.voorbij) && <p className="text-xs text-gray-500">De termijn om via Metricool te antwoorden is voorbij. Dit kan enkel nog in de app van het netwerk zelf.</p>}
        </>
      )}

      {preview && (
        <Dialoog titel="Antwoord versturen" onSluit={() => setPreview(false)}>
          <div className="space-y-3 text-sm">
            <p>Dit antwoord gaat meteen online als <b>{d.kanaal?.naam}</b> op {NETWERK_LABEL[b.netwerk ?? ''] ?? b.netwerk}, als {b.bron === 'dm' ? 'DM aan' : 'reactie op'} <b>{b.auteur_naam ?? 'de afzender'}</b>. Verwijderen kan daarna niet via de app.</p>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 whitespace-pre-line">{tekst.trim()}</div>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPreview(false)}>Annuleren</button>
              <button type="button" className="btn-primary" disabled={!!bezig} onClick={async () => { if (await actie('versturen', { actie: 'versturen', tekst }, 'Verstuurd.')) setPreview(false) }}>
                {bezig === 'versturen' && <Loader2 className="h-4 w-4 animate-spin" />}Ja, versturen
              </button>
            </div>
          </div>
        </Dialoog>
      )}
    </div>
  )
}
