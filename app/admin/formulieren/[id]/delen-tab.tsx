'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Link2, Copy, ExternalLink, Ban, Loader2, Plus, AlertTriangle, Check, Users, Globe, Pencil, Trash2 } from 'lucide-react'
import { Dialoog, Bevestig, INP } from '@/app/admin/instellingen/ui'
import { cn } from '@/lib/utils'
import { MailComposer } from '@/components/admin/mail-composer'
import { LINK_STATUS_LABEL, type LinkStatus } from '@/lib/formulieren/model'
import type { Formulier, Link as DeelLink } from './types'

type Klant = { id: string; company_name: string }

/** timestamptz → 'YYYY-MM-DD' in Belgische tijd (voor een <input type="date">). */
const alsDag = (s: string | null) => (s ? new Date(s).toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }) : '')
const datum = (s: string | null) => (s ? new Date(s).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const STATUS_KLEUR: Record<LinkStatus, string> = {
  ok: 'bg-green-100 text-green-700', onbekend: 'bg-gray-100 text-gray-600', ingetrokken: 'bg-gray-200 text-gray-600',
  verlopen: 'bg-amber-100 text-amber-700', gesloten: 'bg-gray-100 text-gray-600', gebruikt: 'bg-blue-100 text-blue-700',
}

/**
 * Delen: links aanmaken (algemeen of per klant), kopiëren, openen, intrekken.
 * Mailen gebeurt uitsluitend via de MailComposer (preview + handmatige
 * bevestiging) — er wordt nooit automatisch iets naar een klant gestuurd.
 */
export function DelenTab({ formulier, links, klantId, vuil, onLinksGewijzigd, activeer }: {
  formulier: Formulier
  links: DeelLink[]
  klantId: string | null
  vuil: boolean
  onLinksGewijzigd: () => void
  activeer: () => Promise<boolean>
}) {
  const [klanten, setKlanten] = useState<Klant[]>([])
  const [klant, setKlant] = useState(klantId ?? '')
  const [label, setLabel] = useState('')
  const [verloopt, setVerloopt] = useState('')
  const [eenmalig, setEenmalig] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [gekopieerd, setGekopieerd] = useState<string | null>(null)
  const [origin, setOrigin] = useState('')
  const [toonIngetrokken, setToonIngetrokken] = useState(false)
  const [bewerk, setBewerk] = useState<DeelLink | null>(null)
  const [intrekken, setIntrekken] = useState<DeelLink | null>(null)
  const [wissen, setWissen] = useState<DeelLink | null>(null)
  const [actieBezig, setActieBezig] = useState(false)

  useEffect(() => { setOrigin(window.location.origin) }, [])
  useEffect(() => {
    fetch('/api/admin/clients-list').then((r) => r.json()).then((j) => setKlanten(j.clients ?? [])).catch(() => {})
  }, [])

  const url = (token: string) => `${origin}/f/${token}`

  const maakLink = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/formulieren/${formulier.id}/links`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: klant || null, label, verloopt_op: verloopt || null, eenmalig }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Link aangemaakt')
      setLabel(''); setVerloopt(''); setEenmalig(false)
      onLinksGewijzigd()
      kopieer(j.link.token, false)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Link aanmaken mislukt') } finally { setBezig(false) }
  }

  const kopieer = async (token: string, melding = true) => {
    try {
      await navigator.clipboard.writeText(url(token))
      setGekopieerd(token); setTimeout(() => setGekopieerd((t) => (t === token ? null : t)), 2000)
      toast.success(melding ? 'Link gekopieerd' : 'Link gekopieerd naar het klembord')
    } catch { if (melding) toast.error('Kopiëren lukte niet — selecteer de link en kopieer handmatig.') }
  }

  const trekIn = async () => {
    if (!intrekken) return
    setActieBezig(true)
    try {
      const r = await fetch(`/api/admin/formulieren/${formulier.id}/links`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ link_id: intrekken.id }) })
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Intrekken mislukt')
      toast.success('Link ingetrokken'); setIntrekken(null); onLinksGewijzigd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Intrekken mislukt') } finally { setActieBezig(false) }
  }

  const verwijder = async () => {
    if (!wissen) return
    setActieBezig(true)
    try {
      const r = await fetch(`/api/admin/formulieren/${formulier.id}/links?link_id=${encodeURIComponent(wissen.id)}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Verwijderen mislukt')
      toast.success('Link verwijderd'); setWissen(null); onLinksGewijzigd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setActieBezig(false) }
  }

  const zichtbaar = links.filter((l) => toonIngetrokken || !l.ingetrokken_op)
  const aantalIngetrokken = links.filter((l) => l.ingetrokken_op).length
  const nietActief = formulier.status !== 'actief' || !!formulier.gearchiveerd_op

  return (
    <div className="space-y-5 max-w-4xl">
      {nietActief && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 flex items-start gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1 min-w-[200px]">
            {formulier.gearchiveerd_op ? 'Dit formulier is gearchiveerd: links werken niet.' : `Dit formulier staat op "${formulier.status === 'concept' ? 'concept' : 'gesloten'}". Links kun je al aanmaken, maar klanten kunnen pas invullen als het formulier actief is.`}
          </span>
          {!formulier.gearchiveerd_op && (
            <button onClick={() => activeer()} className="btn-primary text-xs px-3 py-1.5">{vuil ? 'Opslaan en activeren' : 'Formulier activeren'}</button>
          )}
        </div>
      )}

      <div className="card-base space-y-3">
        <h2 className="font-semibold text-sm flex items-center gap-2"><Plus className="h-4 w-4" />Nieuwe link</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Klant (optioneel)</span>
            <select className="input-base" value={klant} onChange={(e) => setKlant(e.target.value)}>
              <option value="">— Algemene link (geen klant) —</option>
              {klanten.map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Label (optioneel, enkel intern)</span>
            <input className="input-base" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="bv. Nieuwsbrief september, Website-knop" />
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-gray-600 mb-1">Geldig tot (optioneel)</span>
            <input type="date" className="input-base" value={verloopt} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setVerloopt(e.target.value)} />
          </label>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={maakLink} disabled={bezig} className="btn-primary">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}Link aanmaken</button>
          <span className="text-xs text-gray-400">De link wordt meteen gekopieerd. Er wordt niets automatisch gemaild.</span>
        </div>
      </div>

      <div className="card-base !p-0 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-sm">Links ({zichtbaar.length})</h2>
          {aantalIngetrokken > 0 && (
            <button onClick={() => setToonIngetrokken((t) => !t)} className="text-xs text-gray-500 underline">{toonIngetrokken ? 'Ingetrokken verbergen' : `Ingetrokken tonen (${aantalIngetrokken})`}</button>
          )}
        </div>
        {zichtbaar.length === 0 ? (
          <div className="empty-state text-sm">Nog geen links. Maak hierboven een algemene link of een link voor een klant.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {zichtbaar.map((l) => {
              const st = l.status ?? 'ok'
              return (
                <li key={l.id} className={cn('px-5 py-3 space-y-2', l.ingetrokken_op && 'opacity-60')}>
                  <div className="flex items-start gap-2 flex-wrap">
                    <div className="flex-1 min-w-[200px]">
                      <div className="text-sm font-medium flex items-center gap-1.5">
                        {l.client_id ? <Users className="h-3.5 w-3.5 text-gray-400" /> : <Globe className="h-3.5 w-3.5 text-gray-400" />}
                        {l.klant_naam ?? 'Algemene link'}{l.label && <span className="text-gray-500 font-normal">· {l.label}</span>}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        Aangemaakt {datum(l.created_at)}{l.verloopt_op ? ` · geldig tot ${datum(l.verloopt_op)}` : ''} · {l.inzendingen} inzending{l.inzendingen === 1 ? '' : 'en'}
                      </div>
                    </div>
                    <span className={cn('status-badge', STATUS_KLEUR[st])}>{LINK_STATUS_LABEL[st]}</span>
                  </div>
                  {!l.ingetrokken_op && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <input readOnly value={url(l.token)} onFocus={(e) => e.currentTarget.select()} className="input-base font-mono text-xs flex-1 min-w-[220px] bg-gray-50" aria-label="Link" />
                      <button onClick={() => kopieer(l.token)} className="btn-secondary text-xs px-3 py-1.5">{gekopieerd === l.token ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}Kopieer</button>
                      <a href={url(l.token)} target="_blank" rel="noopener noreferrer" className="btn-secondary text-xs px-3 py-1.5"><ExternalLink className="h-3.5 w-3.5" />Openen</a>
                      <MailComposer
                        label="Mailen" className="btn-secondary text-xs px-3 py-1.5"
                        context={{ type: 'formulier', link: url(l.token), formulierTitel: formulier.titel, clientId: l.client_id, clientName: l.klant_naam, verlooptOp: l.verloopt_op }}
                      />
                      <button onClick={() => setBewerk(l)} className="btn-secondary text-xs px-3 py-1.5"><Pencil className="h-3.5 w-3.5" />Bewerken</button>
                      <button onClick={() => setIntrekken(l)} className="btn-danger text-xs px-3 py-1.5"><Ban className="h-3.5 w-3.5" />Intrekken</button>
                      {l.inzendingen === 0 && (
                        <button onClick={() => setWissen(l)} className="btn-secondary text-xs px-3 py-1.5 text-red-600"><Trash2 className="h-3.5 w-3.5" />Verwijderen</button>
                      )}
                    </div>
                  )}
                  {l.ingetrokken_op && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {l.inzendingen === 0 ? (
                        <button onClick={() => setWissen(l)} className="btn-secondary text-xs px-3 py-1.5 text-red-600"><Trash2 className="h-3.5 w-3.5" />Verwijderen</button>
                      ) : (
                        <span className="text-xs text-gray-400">Ingetrokken op {datum(l.ingetrokken_op)} — blijft bewaard omdat er inzendingen via deze link binnenkwamen.</span>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {zichtbaar.some((l) => l.inzendingen > 0) && (
          <p className="px-5 py-3 border-t border-gray-100 text-[11px] text-gray-400">
            Een link waarlangs al inzendingen binnenkwamen kan je niet verwijderen (de herkomst van die inzendingen blijft bewaard) — trek hem in.
          </p>
        )}
      </div>

      {bewerk && (
        <LinkBewerken formulierId={formulier.id} link={bewerk} klanten={klanten}
          onSluit={() => setBewerk(null)} onBewaard={() => { setBewerk(null); onLinksGewijzigd() }} />
      )}
      {intrekken && (
        <Bevestig
          titel="Link intrekken"
          tekst={<>Deze link intrekken? Wie de link heeft, kan het formulier daarna niet meer invullen.{intrekken.inzendingen > 0 ? ' Bestaande inzendingen blijven bewaard.' : ''}</>}
          bevestigLabel="Intrekken" gevaarlijk bezig={actieBezig}
          onBevestig={() => void trekIn()} onAnnuleer={() => setIntrekken(null)}
        />
      )}
      {wissen && (
        <Bevestig
          titel="Link verwijderen"
          tekst={<>De link <strong>{wissen.klant_naam ?? 'Algemene link'}{wissen.label ? ` · ${wissen.label}` : ''}</strong> definitief verwijderen? Wie de link heeft, krijgt daarna een foutmelding. Dit kan niet ongedaan gemaakt worden.</>}
          bevestigLabel="Verwijderen" gevaarlijk bezig={actieBezig}
          onBevestig={() => void verwijder()} onAnnuleer={() => setWissen(null)}
        />
      )}
    </div>
  )
}

/** Label, klant, vervaldatum en "eenmalig" van een bestaande link aanpassen. De link (token) zelf blijft dezelfde. */
function LinkBewerken({ formulierId, link, klanten, onSluit, onBewaard }: {
  formulierId: string; link: DeelLink; klanten: Klant[]; onSluit: () => void; onBewaard: () => void
}) {
  const [klant, setKlant] = useState(link.client_id ?? '')
  const [label, setLabel] = useState(link.label ?? '')
  const [verloopt, setVerloopt] = useState(alsDag(link.verloopt_op))
  const [eenmalig, setEenmalig] = useState(!!link.eenmalig)
  const [bezig, setBezig] = useState(false)
  const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  const klantWeg = !!link.client_id && !klanten.some((k) => k.id === link.client_id)

  const bewaar = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/formulieren/${formulierId}/links`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link_id: link.id, client_id: klant || null, label, verloopt_op: verloopt || null, eenmalig }),
      })
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Opslaan mislukt')
      toast.success('Link bijgewerkt')
      onBewaard()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt'); setBezig(false) }
  }

  return (
    <Dialoog titel="Link bewerken" onSluit={onSluit}>
      <div className="space-y-3">
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Klant</span>
          <select className={INP} value={klant} onChange={(e) => setKlant(e.target.value)}>
            <option value="">— Algemene link (geen klant) —</option>
            {klantWeg && <option value={link.client_id ?? ''}>{link.klant_naam ?? 'Huidige klant'}</option>}
            {klanten.map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}
          </select>
          {link.inzendingen > 0 && klant !== (link.client_id ?? '') && (
            <span className="block text-[11px] text-amber-700 mt-1">Bestaande inzendingen blijven aan hun oorspronkelijke klant gekoppeld; enkel nieuwe inzendingen krijgen de nieuwe klant.</span>
          )}
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Label (enkel intern)</span>
          <input className={INP} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="bv. Nieuwsbrief september" />
        </label>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Geldig tot (leeg = geen vervaldatum)</span>
          <div className="flex gap-2">
            <input type="date" className={INP} value={verloopt} min={verloopt && verloopt < vandaag ? verloopt : vandaag} onChange={(e) => setVerloopt(e.target.value)} />
            {verloopt && <button type="button" onClick={() => setVerloopt('')} className="btn-secondary text-xs shrink-0">Wissen</button>}
          </div>
        </label>
        <label className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={eenmalig} onChange={(e) => setEenmalig(e.target.checked)} />
          <span>Eenmalige link<span className="block text-[11px] text-gray-400">Toont de link als &quot;gebruikt&quot; zodra er een inzending is.</span></span>
        </label>
        <p className="text-[11px] text-gray-400">De link zelf (het adres) blijft dezelfde; wie hem al heeft, kan hem blijven gebruiken.</p>
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onSluit} disabled={bezig} className="btn-secondary">Annuleren</button>
          <button type="button" onClick={() => void bewaar()} disabled={bezig} className="btn-primary">
            {bezig && <Loader2 className="h-4 w-4 animate-spin" />}Opslaan
          </button>
        </div>
      </div>
    </Dialoog>
  )
}
