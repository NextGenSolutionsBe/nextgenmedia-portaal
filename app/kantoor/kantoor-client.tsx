'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, Plus, X, Check, Building2, ArrowRight, Handshake, Search, Eye, EyeOff,
} from 'lucide-react'
import {
  SOORTEN, STATUSSEN, euro, standaardZichtbaar,
  type Bedrijf, type Soort, type ZichtbareOpdracht, type Samenvatting,
} from '@/lib/kantoor/model'

/**
 * Het Kantoor: waar onze bedrijven en partners elkaar werk doorgeven.
 *
 * Alles wat hier binnenkomt is al door de server gefilterd op wat het actieve
 * bedrijf mag zien — een bedrag dat hier niet staat, is ook nooit verstuurd.
 */
export function KantoorClient() {
  const [rijen, setRijen] = useState<ZichtbareOpdracht[]>([])
  const [cijfers, setCijfers] = useState<Samenvatting | null>(null)
  const [bedrijven, setBedrijven] = useState<Bedrijf[]>([])
  const [mijnBedrijven, setMijnBedrijven] = useState<Bedrijf[]>([])
  const [actiefId, setActiefId] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [laden, setLaden] = useState(true)
  const [q, setQ] = useState('')
  const [nieuw, setNieuw] = useState(false)

  const laad = useCallback(async (bedrijfId?: string) => {
    setLaden(true)
    try {
      const p = bedrijfId ? `?bedrijf=${bedrijfId}` : ''
      const res = await fetch(`/api/kantoor/opdrachten${p}`)
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setRijen(j.opdrachten ?? [])
      setCijfers(j.samenvatting ?? null)
      setBedrijven(j.bedrijven ?? [])
      setMijnBedrijven(j.mijnBedrijven ?? [])
      setIsAdmin(!!j.isAdmin)
      setHint(j.hint ?? null)
      if (j.actiefBedrijfId) setActiefId(j.actiefBedrijfId)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const zichtbaar = useMemo(() => {
    const naald = q.trim().toLowerCase()
    if (!naald) return rijen
    return rijen.filter((o) => [o.titel, o.klant_naam, o.tegenpartij_naam, o.omschrijving]
      .some((v) => (v ?? '').toLowerCase().includes(naald)))
  }, [rijen, q])

  const zetStatus = async (o: ZichtbareOpdracht, status: string) => {
    const vorige = rijen
    setRijen((p) => p.map((x) => (x.id === o.id ? { ...x, status: status as ZichtbareOpdracht['status'] } : x)))
    try {
      const res = await fetch('/api/kantoor/opdrachten', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: o.id, status }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      // Afronden verandert de cijfers; opnieuw laden houdt ze eerlijk.
      laad(actiefId)
    } catch (e) {
      setRijen(vorige)
      toast.error(e instanceof Error ? e.message : 'Bijwerken mislukt')
    }
  }

  const actief = mijnBedrijven.find((b) => b.id === actiefId)

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Handshake className="h-6 w-6" />Kantoor
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Werk dat we aan elkaar doorgeven — onderaanneming en doorverwijzing, met wat iedereen eraan verdient.
          </p>
        </div>
        <button onClick={() => setNieuw(true)} className="btn-primary text-sm" disabled={!actief}>
          <Plus className="h-4 w-4" />Nieuwe samenwerking
        </button>
      </div>

      {hint && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{hint}</p>}

      {/* Bedrijfswissel: info@nextgenmedia.be hoort bij zowel NextGenMedia als
          NextGenSolutions en wisselt hier, zonder tweede account. */}
      {mijnBedrijven.length > 1 && (
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          {mijnBedrijven.map((b) => (
            <button key={b.id} onClick={() => { setActiefId(b.id); laad(b.id) }}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${
                b.id === actiefId ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-black'}`}>
              <Building2 className="h-3.5 w-3.5" />{b.naam}
            </button>
          ))}
        </div>
      )}
      {mijnBedrijven.length === 1 && actief && (
        <p className="text-sm text-gray-600 flex items-center gap-1.5">
          <Building2 className="h-4 w-4 text-gray-400" />Je bekijkt dit als <b>{actief.naam}</b>
        </p>
      )}

      {cijfers && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Kaart label="Verdiend (afgerond)" waarde={euro(cijfers.verdiendCents)}
            hint={`${cijfers.aantalAfgerond} afgeronde opdrachten`} accent />
          <Kaart label="Staat nog open" waarde={euro(cijfers.openCents)}
            hint={`${cijfers.aantalLopend} lopende opdrachten`} />
          <Kaart label="Samenwerkingen" waarde={String(cijfers.perPartner.length)}
            hint="bedrijven waarmee je werk deelt" />
        </div>
      )}

      {cijfers && cijfers.perPartner.length > 0 && (
        <div className="card-base p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Wat leveren we elkaar op?</h2>
          <div className="space-y-2">
            {cijfers.perPartner.map((p) => (
              <div key={p.naam} className="flex items-center justify-between gap-3 text-sm border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                <span className="font-medium text-gray-900">{p.naam}</span>
                <span className="text-gray-500 text-xs">{p.aantal} opdracht{p.aantal === 1 ? '' : 'en'}</span>
                <span className="ml-auto tabular-nums">
                  <b className="text-green-700">{euro(p.verdiendCents)}</b>
                  {p.openCents > 0 && <span className="text-gray-400"> + {euro(p.openCents)} open</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative">
        <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input className="input-base pl-8 w-72" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Titel, klant of partner…" />
      </div>

      {laden ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : zichtbaar.length === 0 ? (
        <div className="card-base text-center py-12 text-gray-500">
          <Handshake className="h-8 w-8 mx-auto text-gray-300 mb-2" />
          <p className="text-sm">
            {rijen.length === 0 ? 'Nog geen samenwerkingen vastgelegd.' : 'Niets gevonden.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {zichtbaar.map((o) => <Rij key={o.id} o={o} onStatus={zetStatus} />)}
        </div>
      )}

      {nieuw && actief && (
        <NieuwDialoog
          bedrijven={bedrijven} mijnBedrijf={actief} isAdmin={isAdmin}
          onClose={() => setNieuw(false)}
          onOpgeslagen={() => { setNieuw(false); laad(actiefId) }}
        />
      )}
    </div>
  )
}

function Kaart({ label, waarde, hint, accent }: { label: string; waarde: string; hint: string; accent?: boolean }) {
  return (
    <div className={`card-base p-4 ${accent ? 'bg-[#fff848]/20 border-yellow-200' : ''}`}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-bold tabular-nums mt-0.5">{waarde}</div>
      <div className="text-[11px] text-gray-500 mt-0.5">{hint}</div>
    </div>
  )
}

function Rij({ o, onStatus }: { o: ZichtbareOpdracht; onStatus: (o: ZichtbareOpdracht, s: string) => void }) {
  const status = STATUSSEN.find((s) => s.key === o.status) ?? STATUSSEN[0]
  const soort = SOORTEN.find((s) => s.key === o.soort)

  return (
    <div className="card-base p-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-gray-900">{o.titel}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${status.badge}`}>
              {status.label}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600">
              {soort?.label}
            </span>
          </div>
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1.5 flex-wrap">
            {o.klant_naam && <span>Klant: {o.klant_naam} ·</span>}
            <span className="inline-flex items-center gap-1">
              {o.ik_ontvang ? 'van' : 'naar'} <b className="text-gray-700">{o.tegenpartij_naam}</b>
            </span>
          </div>
          {o.omschrijving && <p className="text-xs text-gray-500 mt-1">{o.omschrijving}</p>}
        </div>

        <div className="text-right shrink-0">
          <div className="text-[11px] text-gray-500">{o.ik_ontvang ? 'Jij ontvangt' : 'Jij houdt over'}</div>
          <div className="text-lg font-bold tabular-nums text-gray-900">{euro(o.mijn_bedrag_cents)}</div>
          {/* Het totaal alleen tonen wanneer de server het meestuurde. Is het
              afgeschermd, dan zeggen we dát — geen leeg vakje dat vragen oproept. */}
          {o.totaal_cents !== null ? (
            <div className="text-[11px] text-gray-500 flex items-center justify-end gap-1">
              <Eye className="h-3 w-3" />totaal {euro(o.totaal_cents)}
              {o.vergoeding_pct !== null && <span>· {o.vergoeding_pct}%</span>}
            </div>
          ) : (
            <div className="text-[11px] text-gray-400 flex items-center justify-end gap-1" title="Het totaalbedrag is niet gedeeld bij deze opdracht">
              <EyeOff className="h-3 w-3" />totaal niet gedeeld
            </div>
          )}
        </div>

        <select className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white shrink-0 self-start"
          value={o.status} onChange={(e) => onStatus(o, e.target.value)}>
          {STATUSSEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
    </div>
  )
}

function NieuwDialoog({ bedrijven, mijnBedrijf, isAdmin, onClose, onOpgeslagen }: {
  bedrijven: Bedrijf[]; mijnBedrijf: Bedrijf; isAdmin: boolean
  onClose: () => void; onOpgeslagen: () => void
}) {
  const [soort, setSoort] = useState<Soort>('onderaanneming')
  const [titel, setTitel] = useState('')
  const [klant, setKlant] = useState('')
  const [omschrijving, setOmschrijving] = useState('')
  const [totaal, setTotaal] = useState('')
  const [vergoeding, setVergoeding] = useState('')
  const [pct, setPct] = useState('')
  const [gebruikPct, setGebruikPct] = useState(false)
  const [tegenpartijId, setTegenpartijId] = useState('')
  const [zichtbaar, setZichtbaar] = useState(standaardZichtbaar('onderaanneming'))
  const [bezig, setBezig] = useState(false)

  // Van soort wisselen zet de standaard-zichtbaarheid mee: bij doorverwijzing
  // is het totaal de basis van het percentage, bij onderaanneming onze marge.
  const kiesSoort = (s: Soort) => {
    setSoort(s)
    setZichtbaar(standaardZichtbaar(s))
    setGebruikPct(s === 'doorverwijzing')
  }

  const anderen = bedrijven.filter((b) => b.id !== mijnBedrijf.id)

  /**
   * Wie factureert en wie ontvangt hangt af van de soort:
   *  · onderaanneming — ik heb de klant en factureer; de ander voert uit;
   *  · doorverwijzing — ik heb de klant aangebracht; de ander sluit én
   *    factureert, en betaalt mij het percentage.
   */
  const factureertId = soort === 'onderaanneming' ? mijnBedrijf.id : tegenpartijId
  const ontvangtId = soort === 'onderaanneming' ? tegenpartijId : mijnBedrijf.id
  const tegenpartij = anderen.find((b) => b.id === tegenpartijId)

  const bewaar = async () => {
    if (!titel.trim()) { toast.error('Geef de opdracht een titel'); return }
    if (!tegenpartijId) { toast.error('Kies het andere bedrijf'); return }
    setBezig(true)
    try {
      const res = await fetch('/api/kantoor/opdrachten', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          soort, titel: titel.trim(), klant_naam: klant, omschrijving,
          factureert_id: factureertId, ontvangt_id: ontvangtId,
          totaal, bedragen_zichtbaar: zichtbaar,
          ...(gebruikPct ? { vergoeding_pct: pct } : { vergoeding }),
        }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Vastgelegd.')
      onOpgeslagen()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Handshake className="h-4 w-4 text-gray-400" />Nieuwe samenwerking
          </h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Wat voor samenwerking?</label>
            <div className="flex gap-2">
              {SOORTEN.map((s) => (
                <button key={s.key} type="button" onClick={() => kiesSoort(s.key)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
                    soort === s.key ? 'bg-[#fff848] border-yellow-400 text-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">{SOORTEN.find((s) => s.key === soort)?.uitleg}</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Met welk bedrijf?</label>
            <select className="input-base" value={tegenpartijId} onChange={(e) => setTegenpartijId(e.target.value)}>
              <option value="">Kies een bedrijf…</option>
              {anderen.map((b) => <option key={b.id} value={b.id}>{b.naam}</option>)}
            </select>
          </div>

          {/* Wie doet wat — in gewone taal, zodat niemand de rollen omdraait. */}
          {tegenpartij && (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700 flex items-center gap-2 flex-wrap">
              <b>{soort === 'onderaanneming' ? mijnBedrijf.naam : tegenpartij.naam}</b>
              factureert de klant
              <ArrowRight className="h-3 w-3 text-gray-400" />
              <b>{soort === 'onderaanneming' ? tegenpartij.naam : mijnBedrijf.naam}</b>
              krijgt de vergoeding
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Waar gaat het over?</label>
            <input className="input-base" value={titel} onChange={(e) => setTitel(e.target.value)}
              placeholder="Webshop voor Klant X" maxLength={200} autoFocus />
            <input className="input-base mt-1.5" value={klant} onChange={(e) => setKlant(e.target.value)}
              placeholder="Naam van de eindklant — optioneel" maxLength={160} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Totaalbedrag (excl. btw)</label>
              <input className="input-base" value={totaal} onChange={(e) => setTotaal(e.target.value)}
                placeholder="5000" inputMode="decimal" />
              <p className="text-[11px] text-gray-500 mt-1">Wat de eindklant betaalt.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Vergoeding {gebruikPct ? '(%)' : '(€)'}
              </label>
              {gebruikPct ? (
                <input className="input-base" value={pct} onChange={(e) => setPct(e.target.value)}
                  placeholder="10" inputMode="decimal" />
              ) : (
                <input className="input-base" value={vergoeding} onChange={(e) => setVergoeding(e.target.value)}
                  placeholder="4000" inputMode="decimal" />
              )}
              <button type="button" onClick={() => setGebruikPct((v) => !v)}
                className="text-[11px] text-blue-600 hover:underline mt-1">
                {gebruikPct ? 'Liever een vast bedrag' : 'Liever een percentage'}
              </button>
            </div>
          </div>

          <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-gray-200 p-3">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[#fff848]"
              checked={zichtbaar} onChange={(e) => setZichtbaar(e.target.checked)} />
            <span>
              <span className="block text-sm font-medium text-gray-900">
                Totaalbedrag tonen aan {tegenpartij?.naam ?? 'de tegenpartij'}
              </span>
              <span className="block text-[11px] text-gray-500">
                {zichtbaar
                  ? 'Zij zien het totaalbedrag en dus ook wat er voor de ander overblijft.'
                  : 'Zij zien alleen hun eigen vergoeding, niet het totaal of de marge.'}
              </span>
            </span>
          </label>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Notities <span className="text-gray-400">— optioneel</span>
            </label>
            <textarea rows={2} className="input-base" value={omschrijving}
              onChange={(e) => setOmschrijving(e.target.value)} maxLength={4000} />
          </div>

          {isAdmin && (
            <p className="text-[11px] text-gray-500">
              Je legt dit vast namens <b>{mijnBedrijf.naam}</b>.
            </p>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={bewaar} disabled={bezig} className="btn-primary flex-1">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Vastleggen
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}
