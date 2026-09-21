'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X, Play, Square } from 'lucide-react'
import { STAGES, stageLabel } from '@/lib/sales/stages'
import { UITKOMSTEN, formatDuur, parseDuur } from '@/lib/sales/activiteiten-model'
import { DIENSTEN, LEADBRONNEN } from '@/lib/sales/leadbron'
import { type Lead, type Medewerker, vandaag } from './types'

/**
 * De dialogen van het bord: gesprek, e-mail, notitie, voorstel, opvolgdatum,
 * gewonnen/verloren en nieuwe lead. Alles wat een activiteit is gaat via
 * POST /api/admin/sales/activiteiten; daar draaien de statistieken op.
 *
 * Niets gebeurt automatisch: een uitkomst verplaatst de kaart niet, tenzij je
 * zelf een fase kiest. Een gespreksduur wordt nooit verzonnen — leeg is leeg.
 */

// ── Bouwstenen ───────────────────────────────────────────────────────────────
export function Dialoog({ titel, sub, onClose, children, onOpslaan, bezig, opslaanTekst = 'Opslaan', breed = false }: {
  titel: string; sub?: string | null; onClose: () => void; children: React.ReactNode
  onOpslaan: () => void; bezig: boolean; opslaanTekst?: string; breed?: boolean
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center sm:p-4 bg-black/30 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full ${breed ? 'sm:max-w-lg' : 'sm:max-w-md'} max-h-[92dvh] flex flex-col overflow-hidden`}>
        <div className="flex items-start justify-between gap-2 px-5 pt-4 pb-3 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900">{titel}</h3>
            {sub && <p className="text-xs text-gray-500 truncate">{sub}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Sluiten"
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 shrink-0"><X className="h-4 w-4" /></button>
        </div>
        <form className="flex flex-col min-h-0" onSubmit={(e) => { e.preventDefault(); if (!bezig) onOpslaan() }}>
          <div className="px-5 py-4 space-y-3 overflow-y-auto">{children}</div>
          <div className="px-5 py-3 border-t border-gray-100 flex gap-2">
            <button type="submit" disabled={bezig} className="btn-primary flex-1">
              {bezig && <Loader2 className="h-4 w-4 animate-spin" />}{opslaanTekst}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function Veld({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400 mt-0.5">{hint}</span>}
    </label>
  )
}

function FaseKeuze({ waarde, onChange, huidig }: { waarde: string; onChange: (v: string) => void; huidig: string }) {
  return (
    <select className="input-base" value={waarde} onChange={(e) => onChange(e.target.value)}>
      <option value="">Niet verplaatsen ({stageLabel(huidig)})</option>
      {STAGES.filter((s) => s.key !== huidig && s.key !== 'gewonnen' && s.key !== 'verloren')
        .map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
    </select>
  )
}

async function registreer(body: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch('/api/admin/sales/activiteiten', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
    return true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
    return false
  }
}

const bedrijf = (l: Lead) => l.sales_companies?.name ?? 'Lead'

// ── Telefoongesprek ──────────────────────────────────────────────────────────
export function GesprekDialoog({ lead, onClose, onKlaar }: { lead: Lead; onClose: () => void; onKlaar: () => void }) {
  const [duur, setDuur] = useState('')
  const [uitkomst, setUitkomst] = useState('')
  const [notitie, setNotitie] = useState('')
  const [opvolg, setOpvolg] = useState('')
  const [fase, setFase] = useState('')
  const [bezig, setBezig] = useState(false)
  // Timer: enkel wat je zelf start en stopt telt. Nooit een geschatte duur.
  const [startOp, setStartOp] = useState<number | null>(null)
  const [nu, setNu] = useState(Date.now())
  useEffect(() => {
    if (startOp === null) return
    const t = setInterval(() => setNu(Date.now()), 1000)
    return () => clearInterval(t)
  }, [startOp])
  const loopt = startOp !== null
  const verstreken = loopt ? Math.max(0, Math.round((nu - startOp) / 1000)) : 0

  const stopTimer = () => {
    if (startOp === null) return
    setDuur(formatDuur(Math.max(0, Math.round((Date.now() - startOp) / 1000))))
    setStartOp(null)
  }

  const opslaan = async () => {
    let seconden: number | null = null
    if (loopt) {
      seconden = Math.max(0, Math.round((Date.now() - (startOp as number)) / 1000))
      setStartOp(null)
    } else if (duur.trim()) {
      seconden = parseDuur(duur)
      if (seconden === null) { toast.error('Duur als mm:ss, bv. 3:20.'); return }
    }
    if (!uitkomst) { toast.error('Kies de uitkomst van het gesprek.'); return }
    setBezig(true)
    const ok = await registreer({
      leadId: lead.id, type: 'telefoongesprek', duurSeconden: seconden, uitkomst,
      notitie: notitie.trim() || null, opvolgdatum: opvolg || null, naarFase: fase || null,
    })
    setBezig(false)
    if (ok) { toast.success('Gesprek geregistreerd.', { duration: 1500 }); onKlaar() }
  }

  return (
    <Dialoog titel="Telefoongesprek registreren" sub={bedrijf(lead)} onClose={onClose} onOpslaan={opslaan} bezig={bezig}>
      <Veld label="Uitkomst *">
        <div className="grid grid-cols-2 gap-1.5">
          {UITKOMSTEN.map((u) => (
            <button key={u.key} type="button" onClick={() => setUitkomst(u.key)}
              className={`text-xs px-2 py-2 rounded-lg border text-left ${uitkomst === u.key ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}>
              {u.label}
            </button>
          ))}
        </div>
      </Veld>
      <Veld label="Gespreksduur (optioneel)" hint="Typ mm:ss of gebruik de timer. Leeg laten mag: dan wordt er geen duur geteld.">
        <div className="flex gap-2 items-center">
          <input className="input-base w-28" inputMode="numeric" placeholder="mm:ss" disabled={loopt}
            value={loopt ? formatDuur(verstreken) : duur} onChange={(e) => setDuur(e.target.value)} />
          {loopt ? (
            <button type="button" onClick={stopTimer} className="btn-secondary text-sm">
              <Square className="h-3.5 w-3.5 text-red-600" />Stop
            </button>
          ) : (
            <button type="button" onClick={() => { setNu(Date.now()); setStartOp(Date.now()) }} className="btn-secondary text-sm">
              <Play className="h-3.5 w-3.5" />Start timer
            </button>
          )}
        </div>
      </Veld>
      <Veld label="Interne notitie">
        <textarea rows={3} className="input-base" value={notitie} onChange={(e) => setNotitie(e.target.value)}
          placeholder="Wat is er gezegd?" />
      </Veld>
      <div className="grid grid-cols-2 gap-2">
        <Veld label="Opvolgdatum">
          <input type="date" className="input-base" value={opvolg} onChange={(e) => setOpvolg(e.target.value)} />
        </Veld>
        <Veld label="Verplaatsen naar">
          <FaseKeuze waarde={fase} onChange={setFase} huidig={lead.stage_key} />
        </Veld>
      </div>
    </Dialoog>
  )
}

// ── E-mail ───────────────────────────────────────────────────────────────────
export function EmailDialoog({ lead, onClose, onKlaar }: { lead: Lead; onClose: () => void; onKlaar: () => void }) {
  const [notitie, setNotitie] = useState('')
  const [opvolg, setOpvolg] = useState('')
  const [fase, setFase] = useState('')
  const [bezig, setBezig] = useState(false)
  const opslaan = async () => {
    setBezig(true)
    const ok = await registreer({
      leadId: lead.id, type: 'email_verstuurd', notitie: notitie.trim() || null,
      opvolgdatum: opvolg || null, naarFase: fase || null,
    })
    setBezig(false)
    if (ok) { toast.success('E-mail geregistreerd.', { duration: 1500 }); onKlaar() }
  }
  return (
    <Dialoog titel="E-mail registreren" sub={bedrijf(lead)} onClose={onClose} onOpslaan={opslaan} bezig={bezig}>
      <p className="text-[11px] text-gray-500">Registreert dat je een e-mail stuurde. Er wordt hier niets verzonden.</p>
      <Veld label="Interne notitie">
        <textarea rows={3} className="input-base" value={notitie} onChange={(e) => setNotitie(e.target.value)}
          placeholder="Onderwerp of korte inhoud" />
      </Veld>
      <div className="grid grid-cols-2 gap-2">
        <Veld label="Opvolgdatum">
          <input type="date" className="input-base" value={opvolg} onChange={(e) => setOpvolg(e.target.value)} />
        </Veld>
        <Veld label="Verplaatsen naar">
          <FaseKeuze waarde={fase} onChange={setFase} huidig={lead.stage_key} />
        </Veld>
      </div>
    </Dialoog>
  )
}

// ── Interne notitie ──────────────────────────────────────────────────────────
export function NotitieDialoog({ lead, onClose, onKlaar }: { lead: Lead; onClose: () => void; onKlaar: () => void }) {
  const [notitie, setNotitie] = useState('')
  const [bezig, setBezig] = useState(false)
  const opslaan = async () => {
    if (!notitie.trim()) { toast.error('Typ eerst een notitie.'); return }
    setBezig(true)
    const ok = await registreer({ leadId: lead.id, type: 'interne_notitie', notitie: notitie.trim() })
    setBezig(false)
    if (ok) { toast.success('Notitie opgeslagen.', { duration: 1500 }); onKlaar() }
  }
  return (
    <Dialoog titel="Interne notitie toevoegen" sub={bedrijf(lead)} onClose={onClose} onOpslaan={opslaan} bezig={bezig}>
      <Veld label="Notitie" hint="Intern: komt nooit in een portaal of mail terecht.">
        <textarea rows={4} autoFocus className="input-base" value={notitie} onChange={(e) => setNotitie(e.target.value)} />
      </Veld>
    </Dialoog>
  )
}

// ── Voorstel ─────────────────────────────────────────────────────────────────
export function VoorstelDialoog({ lead, onClose, onKlaar }: { lead: Lead; onClose: () => void; onKlaar: () => void }) {
  const [notitie, setNotitie] = useState('')
  const [opvolg, setOpvolg] = useState('')
  const [bezig, setBezig] = useState(false)
  const opslaan = async () => {
    setBezig(true)
    const ok = await registreer({
      leadId: lead.id, type: 'voorstel_verstuurd', notitie: notitie.trim() || null, opvolgdatum: opvolg || null,
    })
    setBezig(false)
    if (ok) { toast.success('Voorstel geregistreerd.', { duration: 1500 }); onKlaar() }
  }
  return (
    <Dialoog titel="Voorstel registreren" sub={bedrijf(lead)} onClose={onClose} onOpslaan={opslaan} bezig={bezig}>
      <p className="text-[11px] text-gray-500">De lead gaat naar &ldquo;Voorstel verstuurd&rdquo; (tenzij hij al gesloten is).</p>
      <Veld label="Interne notitie">
        <textarea rows={3} className="input-base" value={notitie} onChange={(e) => setNotitie(e.target.value)}
          placeholder="Wat zit er in het voorstel?" />
      </Veld>
      <Veld label="Opvolgdatum">
        <input type="date" className="input-base" value={opvolg} onChange={(e) => setOpvolg(e.target.value)} />
      </Veld>
    </Dialoog>
  )
}

// ── Opvolgdatum ──────────────────────────────────────────────────────────────
export function OpvolgDialoog({ lead, onClose, onKlaar }: { lead: Lead; onClose: () => void; onKlaar: () => void }) {
  const [datum, setDatum] = useState(lead.opvolgdatum?.slice(0, 10) ?? '')
  const [bezig, setBezig] = useState(false)
  const opslaan = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/sales/leads/${lead.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opvolgdatum: datum || null }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      toast.success(datum ? 'Opvolgdatum gezet.' : 'Opvolgdatum gewist.', { duration: 1500 })
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }
  const snel = (dagen: number) => {
    const d = new Date(); d.setDate(d.getDate() + dagen)
    setDatum(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return (
    <Dialoog titel="Opvolgdatum instellen" sub={bedrijf(lead)} onClose={onClose} onOpslaan={opslaan} bezig={bezig}>
      <Veld label="Volgende opvolgdatum">
        <input type="date" className="input-base" value={datum} onChange={(e) => setDatum(e.target.value)} />
      </Veld>
      <div className="flex flex-wrap gap-1.5">
        {[['Morgen', 1], ['Over 3 dagen', 3], ['Volgende week', 7], ['Over 2 weken', 14]].map(([l, n]) => (
          <button key={l} type="button" onClick={() => snel(n as number)} className="text-xs px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50">{l}</button>
        ))}
        {datum && <button type="button" onClick={() => setDatum('')} className="text-xs px-2 py-1 text-gray-500 hover:text-black">Wissen</button>}
      </div>
    </Dialoog>
  )
}

// ── Gewonnen / verloren ──────────────────────────────────────────────────────
export type SluitGegevens = {
  gesloten_op: string
  deal_waarde?: string
  dienst?: string
  verlies_reden?: string
}

export function SluitDialoog({ lead, soort, onClose, onBevestig }: {
  lead: Lead; soort: 'gewonnen' | 'verloren'; onClose: () => void
  onBevestig: (g: SluitGegevens) => Promise<boolean> | boolean
}) {
  const [datum, setDatum] = useState(vandaag())
  const [waarde, setWaarde] = useState('')
  const [dienst, setDienst] = useState(lead.dienst ?? '')
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  const opslaan = async () => {
    setBezig(true)
    const ok = await onBevestig(soort === 'gewonnen'
      ? { gesloten_op: datum || vandaag(), deal_waarde: waarde.trim() || undefined, dienst: dienst.trim() || undefined }
      : { gesloten_op: datum || vandaag(), verlies_reden: reden.trim() || undefined })
    setBezig(false)
    if (ok) onClose()
  }
  return (
    <Dialoog titel={soort === 'gewonnen' ? 'Deal gewonnen' : 'Deal verloren'} sub={bedrijf(lead)}
      onClose={onClose} onOpslaan={opslaan} bezig={bezig} opslaanTekst={soort === 'gewonnen' ? 'Markeer als gewonnen' : 'Markeer als verloren'}>
      <Veld label={soort === 'gewonnen' ? 'Sluitingsdatum' : 'Datum'}>
        <input type="date" className="input-base" value={datum} onChange={(e) => setDatum(e.target.value)} />
      </Veld>
      {soort === 'gewonnen' ? (
        <>
          <Veld label="Dealwaarde in euro (optioneel)">
            <input className="input-base" inputMode="decimal" placeholder="bv. 4.950" value={waarde} onChange={(e) => setWaarde(e.target.value)} />
          </Veld>
          <Veld label="Verkochte dienst (optioneel)">
            <input className="input-base" list="diensten-lijst" value={dienst} onChange={(e) => setDienst(e.target.value)} />
          </Veld>
        </>
      ) : (
        <Veld label="Verliesreden (optioneel)">
          <input className="input-base" value={reden} onChange={(e) => setReden(e.target.value)} placeholder="bv. te duur, werkt al met iemand" />
        </Veld>
      )}
      <DienstenLijst />
    </Dialoog>
  )
}

export function DienstenLijst() {
  return <datalist id="diensten-lijst">{DIENSTEN.map((d) => <option key={d} value={d} />)}</datalist>
}

// ── Nieuwe lead ──────────────────────────────────────────────────────────────
export function NieuweLeadDialoog({ pipelineId, medewerkers, meId, onClose, onAangemaakt }: {
  pipelineId: string; medewerkers: Medewerker[]; meId: string | null
  onClose: () => void; onAangemaakt: (id: string) => void
}) {
  const [f, setF] = useState({
    bedrijf: '', contact: '', telefoon: '', email: '', website: '', leadbron: 'outbound',
    dienst: '', verantwoordelijke: meId ?? '', notitie: '', opvolgdatum: '', fase: 'outbound',
  })
  const [bezig, setBezig] = useState(false)
  const zet = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const opslaan = async () => {
    if (!f.bedrijf.trim()) { toast.error('Bedrijfsnaam is verplicht.'); return }
    setBezig(true)
    try {
      const r = await fetch('/api/admin/sales/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineId,
          company: { name: f.bedrijf.trim(), website: f.website.trim() || undefined },
          contact: { name: f.contact.trim() || undefined, email: f.email.trim() || undefined, phone: f.telefoon.trim() || undefined },
          leadbron: f.leadbron, dienst: f.dienst.trim() || null, assigned_to: f.verantwoordelijke || null,
          note: f.notitie.trim() || undefined, opvolgdatum: f.opvolgdatum || null, stage: f.fase,
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Toevoegen mislukt')
      toast.success('Lead toegevoegd.', { duration: 1500 })
      onAangemaakt(String(j.id))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }

  return (
    <Dialoog titel="Nieuwe lead toevoegen" onClose={onClose} onOpslaan={opslaan} bezig={bezig} breed opslaanTekst="Lead toevoegen">
      <Veld label="Bedrijfsnaam *">
        <input autoFocus className="input-base" value={f.bedrijf} onChange={(e) => zet('bedrijf', e.target.value)} />
      </Veld>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Veld label="Contactpersoon"><input className="input-base" value={f.contact} onChange={(e) => zet('contact', e.target.value)} /></Veld>
        <Veld label="Telefoon"><input className="input-base" type="tel" value={f.telefoon} onChange={(e) => zet('telefoon', e.target.value)} /></Veld>
        <Veld label="E-mail"><input className="input-base" type="email" value={f.email} onChange={(e) => zet('email', e.target.value)} /></Veld>
        <Veld label="Website"><input className="input-base" placeholder="bedrijf.be" value={f.website} onChange={(e) => zet('website', e.target.value)} /></Veld>
        <Veld label="Leadbron">
          <select className="input-base" value={f.leadbron} onChange={(e) => zet('leadbron', e.target.value)}>
            {LEADBRONNEN.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
        </Veld>
        <Veld label="Geïnteresseerde dienst">
          <input className="input-base" list="diensten-lijst" value={f.dienst} onChange={(e) => zet('dienst', e.target.value)} />
        </Veld>
        <Veld label="Verantwoordelijke">
          <select className="input-base" value={f.verantwoordelijke} onChange={(e) => zet('verantwoordelijke', e.target.value)}>
            <option value="">Niemand</option>
            {medewerkers.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
          </select>
        </Veld>
        <Veld label="Volgende opvolgdatum">
          <input type="date" className="input-base" value={f.opvolgdatum} onChange={(e) => zet('opvolgdatum', e.target.value)} />
        </Veld>
        <Veld label="Pipelinefase">
          <select className="input-base" value={f.fase} onChange={(e) => zet('fase', e.target.value)}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Veld>
      </div>
      <Veld label="Notitie">
        <textarea rows={2} className="input-base" value={f.notitie} onChange={(e) => zet('notitie', e.target.value)} />
      </Veld>
      <DienstenLijst />
      <p className="text-[11px] text-gray-500">Bestaat dit bedrijf al, dan melden we dat — er komt nooit een dubbele lead bij.</p>
    </Dialoog>
  )
}
