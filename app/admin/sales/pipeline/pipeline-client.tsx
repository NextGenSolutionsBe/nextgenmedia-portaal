'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Loader2, Plus, Search, Upload, MailCheck, Headphones, PhoneCall, MailPlus, StickyNote,
  CalendarClock, CalendarPlus, MoreHorizontal, FileText, Trophy, XCircle, ExternalLink, User, Flame, PhoneOff, Briefcase,
} from 'lucide-react'
import { STAGES, STAGE_KEYS, STAGE_STYLE, stageLabel, type StageKey } from '@/lib/sales/stages'
import { DIENSTEN, LEADBRONNEN, LEADBRON_STYLE, leadbronLabel, normaliseerLeadbron } from '@/lib/sales/leadbron'
import { merkStijl } from '@/lib/sales/merk'
import { kolomSamenvatting, opdrachtSamenvatting, pipelineTotalen } from '@/lib/sales/opdrachten-model'
import { BeltijdKnop } from '@/components/admin/sales-beltijd'
import { ImportModal } from './import-modal'
import { ReminderSettings } from './reminder-settings'
import { FocusMode } from './focus-mode'
import { LeadDetail, type DialoogSoort } from './lead-detail'
import {
  EmailDialoog, GesprekDialoog, NieuweLeadDialoog, NotitieDialoog, OpvolgDialoog, SluitDialoog, VoorstelDialoog,
  type SluitGegevens,
} from './lead-dialogen'
import {
  type Lead, type Medewerker, type Pipeline, emailVan, euro, korteDatum, merkenVan, telefoonVan, vandaag,
} from './types'

/**
 * DE PIPELINE — één horizontaal kanbanbord voor beide merken.
 *
 * Kolommen in de volgorde van lib/sales/stages.ts: Outbound en Inbound links,
 * Gewonnen en Verloren rechts. Kaarten sleep je tussen en binnen kolommen
 * (native HTML5 drag-and-drop); de volgorde wordt bewaard (positie).
 *
 * BELANGRIJK: een kaart naar "Gebeld" of "E-mail verstuurd" slepen registreert
 * GEEN gesprek of e-mail — enkel een fasewissel. Gesprekken en mails
 * registreer je met de knoppen op de kaart; daar draaien de statistieken op.
 */

const PER_KOLOM = 50
type Doel = { stage: StageKey; index: number }
type Sluiten = { lead: Lead; soort: 'gewonnen' | 'verloren'; index: number }

export function PipelineClient({ pipelines, initialPipelineId }: {
  pipelines: Pipeline[]; initialPipelineId: string
}) {
  const [pipelineId] = useState(initialPipelineId)
  const [leads, setLeads] = useState<Lead[]>([])
  const [medewerkers, setMedewerkers] = useState<Medewerker[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [bezet, setBezet] = useState<Record<string, string>>({})
  const [laden, setLaden] = useState(true)
  const [afgekapt, setAfgekapt] = useState(false)
  const [totaal, setTotaal] = useState(0)

  // Filters
  const [q, setQ] = useState('')
  const [zoek, setZoek] = useState('')
  const [leadbron, setLeadbron] = useState('')
  const [verantwoordelijke, setVerantwoordelijke] = useState('')
  const [dienst, setDienst] = useState('')
  const [opvolg, setOpvolg] = useState('')
  const [toonDnc, setToonDnc] = useState(false)
  useEffect(() => { const t = setTimeout(() => setZoek(q.trim()), 250); return () => clearTimeout(t) }, [q])

  // Paneel, dialogen, menu's
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dialoog, setDialoog] = useState<{ soort: DialoogSoort; leadId: string } | null>(null)
  const [sluiten, setSluiten] = useState<Sluiten | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [nieuweLead, setNieuweLead] = useState(false)
  const [importeren, setImporteren] = useState(false)
  const [herinneringen, setHerinneringen] = useState(false)
  const [focus, setFocus] = useState(false)
  const [zichtbaar, setZichtbaar] = useState<Record<string, number>>({})

  // Slepen
  const [sleepId, setSleepId] = useState<string | null>(null)
  const [doel, setDoel] = useState<Doel | null>(null)
  const volgordeMelding = useRef(false)

  const laad = useCallback(async (opts?: { stil?: boolean }) => {
    if (!opts?.stil) setLaden(true)
    try {
      const p = new URLSearchParams({ pipeline: pipelineId || 'all' })
      if (zoek) p.set('q', zoek)
      if (leadbron) p.set('leadbron', leadbron)
      if (verantwoordelijke) p.set('verantwoordelijke', verantwoordelijke)
      if (dienst) p.set('dienst', dienst)
      if (opvolg) p.set('opvolg', opvolg)
      if (!toonDnc) p.set('hideDnc', '1')
      const r = await fetch(`/api/admin/sales/leads?${p}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Laden mislukt')
      setLeads((j.leads ?? []) as Lead[])
      setMedewerkers((j.medewerkers ?? []) as Medewerker[])
      setMeId(j.meId ?? null)
      setIsAdmin(!!j.isAdmin)
      setBezet(j.bezet ?? {})
      setAfgekapt(!!j.afgekapt)
      setTotaal(Number(j.totaal ?? (j.leads ?? []).length))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Laden mislukt')
    } finally { if (!opts?.stil) setLaden(false) }
  }, [pipelineId, zoek, leadbron, verantwoordelijke, dienst, opvolg, toonDnc])

  useEffect(() => { laad() }, [laad])

  // Deep-link vanuit de globale zoek: /admin/sales/pipeline?lead=<id> opent die lead.
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get('lead')
      if (id) setSelectedId(id)
    } catch { /* geen URL → niets */ }
  }, [])

  // Menu sluiten bij een klik ernaast.
  useEffect(() => {
    if (!menuId) return
    const weg = () => setMenuId(null)
    window.addEventListener('click', weg)
    return () => window.removeEventListener('click', weg)
  }, [menuId])

  const kolommen = useMemo(() => {
    const m = new Map<StageKey, Lead[]>(STAGE_KEYS.map((k) => [k, []]))
    for (const l of leads) (m.get(l.stage_key as StageKey) ?? m.get('outbound')!).push(l)
    return m
  }, [leads])

  // Waarde per kolom en de totalen bovenaan — altijd op de GEFILTERDE leads.
  const totalen = useMemo(() => pipelineTotalen(leads), [leads])

  const leadVan = useCallback((id: string | null) => (id ? leads.find((l) => l.id === id) ?? null : null), [leads])
  const selected = leadVan(selectedId)
  const dialoogLead = leadVan(dialoog?.leadId ?? null)
  const naamVan = (id: string | null) => (id ? medewerkers.find((m) => m.id === id)?.naam ?? null : null)

  const filtersActief = !!(q || leadbron || verantwoordelijke || dienst || opvolg || toonDnc)
  const wisFilters = () => { setQ(''); setLeadbron(''); setVerantwoordelijke(''); setDienst(''); setOpvolg(''); setToonDnc(false) }

  // ── Verplaatsen (slepen, fasekeuze, gewonnen/verloren) ────────────────────
  const verplaats = useCallback(async (id: string, stage: StageKey, index: number, extra?: SluitGegevens): Promise<boolean> => {
    const vorige = leads
    const lead = vorige.find((l) => l.id === id)
    if (!lead) return false
    const vanFase = lead.stage_key as StageKey
    const oudeKolom = vorige.filter((l) => l.stage_key === stage)
    if (vanFase === stage && oudeKolom.findIndex((l) => l.id === id) === index && !extra) return true

    const perKolom = new Map<StageKey, Lead[]>(STAGE_KEYS.map((k) => [k, vorige.filter((l) => l.stage_key === k && l.id !== id)]))
    const doelLijst = perKolom.get(stage)!
    doelLijst.splice(Math.max(0, Math.min(index, doelLijst.length)), 0, { ...lead, stage_key: stage })
    const nieuw = STAGE_KEYS.flatMap((k) => perKolom.get(k)!)
      .map((l) => (l.stage_key === stage ? { ...l, positie: doelLijst.indexOf(l) } : l))
    setLeads(nieuw)

    try {
      if (vanFase !== stage || extra) {
        const r = await fetch(`/api/admin/sales/leads/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...(vanFase !== stage ? { stage } : {}), positie: index, ...(extra ?? {}) }),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error ?? 'Verplaatsen mislukt')
      }
      const r2 = await fetch('/api/admin/sales/leads/herorden', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, ids: doelLijst.map((l) => l.id) }),
      })
      const j2 = await r2.json().catch(() => ({}))
      if (!r2.ok) throw new Error(j2.error ?? 'Volgorde bewaren mislukt')
      if (j2.zonderPositie && !volgordeMelding.current) {
        volgordeMelding.current = true
        toast.info('De volgorde binnen een kolom wordt bewaard zodra de databankmigratie gedraaid is.')
      }
      toast.success(vanFase !== stage ? `Naar ${stageLabel(stage)}` : 'Volgorde bewaard', { duration: 1200 })
      if (vanFase !== stage || extra) laad({ stil: true })
      return true
    } catch (e) {
      setLeads(vorige)
      toast.error(e instanceof Error ? e.message : 'Verplaatsen mislukt — teruggezet.')
      laad({ stil: true })
      return false
    }
  }, [leads, laad])

  /** Naar een kolom — gewonnen/verloren eerst via het dialoogje. */
  const naarKolom = useCallback((lead: Lead, stage: string, index = 0) => {
    const doelFase = stage as StageKey
    if (!STAGE_KEYS.includes(doelFase)) return
    if ((doelFase === 'gewonnen' || doelFase === 'verloren') && lead.stage_key !== doelFase) {
      setSluiten({ lead, soort: doelFase, index })
      return
    }
    void verplaats(lead.id, doelFase, index)
  }, [verplaats])

  // ── Native drag-and-drop ─────────────────────────────────────────────────
  const indexOnder = (container: HTMLElement, y: number, sleep: string | null): number => {
    const kaarten = [...container.querySelectorAll<HTMLElement>('[data-kaart]')].filter((el) => el.dataset.kaart !== sleep)
    let i = 0
    for (const k of kaarten) {
      const r = k.getBoundingClientRect()
      if (y > r.top + r.height / 2) i++
      else break
    }
    return i
  }

  const onDragOver = (e: React.DragEvent<HTMLElement>, stage: StageKey) => {
    if (!sleepId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const index = indexOnder(e.currentTarget, e.clientY, sleepId)
    if (!doel || doel.stage !== stage || doel.index !== index) setDoel({ stage, index })
  }

  const onDrop = (e: React.DragEvent<HTMLElement>, stage: StageKey) => {
    e.preventDefault()
    const id = sleepId || e.dataTransfer.getData('text/plain')
    const index = indexOnder(e.currentTarget, e.clientY, id)
    setSleepId(null); setDoel(null)
    const lead = leadVan(id)
    if (lead) naarKolom(lead, stage, index)
  }

  // ── Snel toevoegen (Outbound) ────────────────────────────────────────────
  const [snelNaam, setSnelNaam] = useState('')
  const [snelTel, setSnelTel] = useState('')
  const [snelBezig, setSnelBezig] = useState(false)
  const snelRef = useRef<HTMLInputElement | null>(null)
  const snelToevoegen = async () => {
    const naam = snelNaam.trim()
    if (!naam || snelBezig) return
    setSnelBezig(true)
    try {
      const r = await fetch('/api/admin/sales/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineId: pipelineId || pipelines[0]?.id || '',
          company: { name: naam }, contact: { phone: snelTel.trim() || undefined },
          stage: 'outbound', leadbron: 'outbound',
        }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        const bestaand = j.existingLeadId as string | undefined
        toast.error(j.error ?? 'Toevoegen mislukt', bestaand ? { action: { label: 'Openen', onClick: () => setSelectedId(bestaand) } } : undefined)
        return
      }
      setSnelNaam(''); setSnelTel('')
      toast.success(`${naam} toegevoegd.`, { duration: 1200 })
      laad({ stil: true })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt')
    } finally {
      setSnelBezig(false)
      requestAnimationFrame(() => snelRef.current?.focus())
    }
  }

  const klaar = () => { setDialoog(null); laad({ stil: true }) }

  return (
    <div className="space-y-3">
      {afgekapt && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Er zijn {totaal} leads, maar het bord toont er {leads.length}. Gebruik de filters om de rest te zien.
        </p>
      )}

      {/* ── Bovenbalk ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[14rem] max-w-md">
          <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input className="input-base pl-8 w-full" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="Zoek bedrijf, contact, telefoon, e-mail of website…" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <BeltijdKnop />
          <button onClick={() => setFocus(true)} disabled={leads.length === 0} className="btn-secondary text-sm"
            title="Belmodus: één lead per keer, sneltoetsen 1–6">
            <Headphones className="h-4 w-4" />Focus Mode
          </button>
          <button onClick={() => setImporteren(true)} className="btn-secondary text-sm" title="Lijst met prospects in bulk toevoegen">
            <Upload className="h-4 w-4" />Importeren
          </button>
          <button onClick={() => setHerinneringen(true)} className="btn-secondary text-sm" title="De herinneringsmail die de dag voor een afspraak vertrekt">
            <MailCheck className="h-4 w-4" />Herinneringsmail
          </button>
          <button onClick={() => setNieuweLead(true)} className="btn-primary text-sm">
            <Plus className="h-4 w-4" />Nieuwe lead toevoegen
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <select className="input-base !w-auto max-w-[220px] text-xs" value={leadbron} onChange={(e) => setLeadbron(e.target.value)} aria-label="Leadbron">
          <option value="">Alle leadbronnen</option>
          <option value="inbound">Alle inbound</option>
          <option value="outbound_alle">Alle outbound</option>
          {LEADBRONNEN.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
        <select className="input-base !w-auto max-w-[220px] text-xs" value={verantwoordelijke} onChange={(e) => setVerantwoordelijke(e.target.value)} aria-label="Verantwoordelijke">
          <option value="">Alle verantwoordelijken</option>
          {meId && <option value={meId}>Mijn leads</option>}
          <option value="niemand">Niemand toegewezen</option>
          {medewerkers.filter((m) => m.id !== meId).map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
        </select>
        <select className="input-base !w-auto max-w-[220px] text-xs" value={dienst} onChange={(e) => setDienst(e.target.value)} aria-label="Dienst">
          <option value="">Alle diensten</option>
          {DIENSTEN.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="input-base !w-auto max-w-[220px] text-xs" value={opvolg} onChange={(e) => setOpvolg(e.target.value)} aria-label="Opvolgdatum">
          <option value="">Opvolgdatum: alle</option>
          <option value="vandaag">Vandaag (en verlopen)</option>
          <option value="week">Deze week</option>
          <option value="verlopen">Verlopen</option>
        </select>
        <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={toonDnc} onChange={(e) => setToonDnc(e.target.checked)} />Toon niet-bellen
        </label>
        {filtersActief && <button onClick={wisFilters} className="text-xs text-gray-500 hover:text-black underline">Filters wissen</button>}
        {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
      </div>

      {/* ── Waarde in de pijplijn ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Totaal label="Open pijplijn" waarde={euro(totalen.openCents)}
          onder={`${totalen.openAantal} ${totalen.openAantal === 1 ? 'lead' : 'leads'} buiten gewonnen/verloren`} />
        <Totaal label="Gewonnen" waarde={euro(totalen.gewonnenCents)} kleur="text-green-700" onder={`${kolommen.get('gewonnen')?.length ?? 0} leads`} />
        <Totaal label="Verloren" waarde={euro(totalen.verlorenCents)} kleur="text-red-600" onder={`${kolommen.get('verloren')?.length ?? 0} leads`} />
      </div>
      {filtersActief && <p className="text-[11px] text-gray-400 -mt-1">Bedragen volgen de actieve filters.</p>}

      {/* ── Het bord ── */}
      <div className="flex gap-3 overflow-x-auto pb-3 -mx-1 px-1 snap-x">
        {STAGES.map((s) => {
          const lijst = kolommen.get(s.key) ?? []
          const max = zichtbaar[s.key] ?? PER_KOLOM
          const { aantal, waardeCents } = kolomSamenvatting(lijst)
          const isDoel = doel?.stage === s.key
          return (
            <section key={s.key}
              className={`shrink-0 w-[85vw] max-w-[18rem] sm:w-72 snap-start rounded-2xl border flex flex-col max-h-[calc(100dvh-14rem)] min-h-[12rem] transition-colors ${isDoel ? 'border-black/30 bg-gray-100' : 'border-gray-200 bg-gray-50'}`}>
              <header className="px-3 py-2 flex items-center justify-between gap-2 border-b border-gray-200">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STAGE_STYLE[s.key]}`}>{s.label}</span>
                  <span className="text-xs text-gray-500 tabular-nums">{aantal}</span>
                </div>
                <span title={`Totale waarde van de ${aantal} leads in ${s.label}`}
                  className={`text-xs font-semibold tabular-nums ${waardeCents === 0 ? 'text-gray-300' : s.key === 'gewonnen' ? 'text-green-700' : s.key === 'verloren' ? 'text-red-600' : 'text-gray-800'}`}>
                  {euro(waardeCents)}
                </span>
              </header>

              {s.key === 'outbound' && (
                <form className="px-2 pt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); void snelToevoegen() }}>
                  <input ref={snelRef} className="input-base text-xs py-1.5 flex-1 min-w-0" placeholder="Bedrijfsnaam + Enter"
                    value={snelNaam} onChange={(e) => setSnelNaam(e.target.value)} aria-label="Snel toevoegen: bedrijfsnaam" />
                  <input className="input-base text-xs py-1.5 w-24" placeholder="Telefoon" type="tel"
                    value={snelTel} onChange={(e) => setSnelTel(e.target.value)} aria-label="Snel toevoegen: telefoon" />
                  <button type="submit" className="hidden" aria-hidden />
                  {snelBezig && <Loader2 className="h-4 w-4 animate-spin text-gray-400 self-center" />}
                </form>
              )}

              <div className="flex-1 overflow-y-auto p-2 space-y-2"
                onDragOver={(e) => onDragOver(e, s.key)}
                onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDoel((d) => (d?.stage === s.key ? null : d)) }}
                onDrop={(e) => onDrop(e, s.key)}>
                {lijst.slice(0, max).map((l, i) => (
                  <div key={l.id}>
                    {isDoel && doel!.index === i && sleepId !== l.id && <div className="h-1 rounded bg-black/40 mb-2" />}
                    <Kaart
                      lead={l}
                      pipelines={pipelines}
                      verantwoordelijke={naamVan(l.assigned_to)}
                      bezetDoor={bezet[l.id]}
                      sleept={sleepId === l.id}
                      menuOpen={menuId === l.id}
                      onOpen={() => setSelectedId(l.id)}
                      onMenu={() => setMenuId(menuId === l.id ? null : l.id)}
                      onDialoog={(soort) => setDialoog({ soort, leadId: l.id })}
                      onKolom={(stage) => naarKolom(l, stage, 0)}
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.id); e.dataTransfer.effectAllowed = 'move'; setSleepId(l.id); setMenuId(null) }}
                      onDragEnd={() => { setSleepId(null); setDoel(null) }}
                    />
                  </div>
                ))}
                {isDoel && doel!.index >= Math.min(lijst.filter((l) => l.id !== sleepId).length, max) && <div className="h-1 rounded bg-black/40" />}
                {lijst.length > max && (
                  <button onClick={() => setZichtbaar((z) => ({ ...z, [s.key]: max + PER_KOLOM }))}
                    className="w-full text-xs text-gray-500 hover:text-black py-1">
                    Meer tonen ({lijst.length - max})
                  </button>
                )}
                {lijst.length === 0 && !laden && <p className="text-[11px] text-gray-400 text-center py-4">Sleep een kaart hierheen</p>}
              </div>
            </section>
          )
        })}
      </div>

      {/* ── Detailpaneel ── */}
      {selected && (
        <LeadDetail
          key={selected.id}
          lead={selected}
          pipelines={pipelines}
          medewerkers={medewerkers}
          meId={meId}
          isAdmin={isAdmin}
          onChanged={() => laad({ stil: true })}
          onClose={() => setSelectedId(null)}
          onDialoog={(soort) => setDialoog({ soort, leadId: selected.id })}
          onFase={(stage) => { if (stage !== selected.stage_key) naarKolom(selected, stage, 0) }}
        />
      )}

      {/* ── Dialogen ── */}
      {dialoog && dialoogLead && dialoog.soort === 'gesprek' && <GesprekDialoog lead={dialoogLead} onClose={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog && dialoogLead && dialoog.soort === 'email' && <EmailDialoog lead={dialoogLead} onClose={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog && dialoogLead && dialoog.soort === 'notitie' && <NotitieDialoog lead={dialoogLead} onClose={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog && dialoogLead && dialoog.soort === 'voorstel' && <VoorstelDialoog lead={dialoogLead} onClose={() => setDialoog(null)} onKlaar={klaar} />}
      {dialoog && dialoogLead && dialoog.soort === 'opvolg' && <OpvolgDialoog lead={dialoogLead} onClose={() => setDialoog(null)} onKlaar={klaar} />}
      {sluiten && (
        <SluitDialoog lead={sluiten.lead} soort={sluiten.soort} onClose={() => setSluiten(null)}
          onBevestig={(g) => verplaats(sluiten.lead.id, sluiten.soort, sluiten.index, g)} />
      )}
      {nieuweLead && (
        <NieuweLeadDialoog pipelineId={pipelineId || pipelines[0]?.id || ''} medewerkers={medewerkers} meId={meId}
          onClose={() => setNieuweLead(false)}
          onAangemaakt={(id) => { setNieuweLead(false); laad({ stil: true }).then(() => setSelectedId(id)) }} />
      )}
      {importeren && (
        <ImportModal pipelineId={pipelineId || pipelines[0]?.id || ''} onClose={() => setImporteren(false)} onDone={() => laad({ stil: true })} />
      )}
      {herinneringen && <ReminderSettings onClose={() => setHerinneringen(false)} />}
      {focus && (
        <FocusMode
          leads={leads}
          bezet={bezet}
          pipelines={pipelines}
          pipelineId={pipelineId || null}
          onClose={() => { setFocus(false); laad({ stil: true }) }}
          onChanged={() => { /* bord ververst bij sluiten */ }}
        />
      )}
    </div>
  )
}

// ── Kaart ────────────────────────────────────────────────────────────────────
function Kaart({
  lead, pipelines, verantwoordelijke, bezetDoor, sleept, menuOpen,
  onOpen, onMenu, onDialoog, onKolom, onDragStart, onDragEnd,
}: {
  lead: Lead
  pipelines: Pipeline[]
  verantwoordelijke: string | null
  bezetDoor?: string
  sleept: boolean
  menuOpen: boolean
  onOpen: () => void
  onMenu: () => void
  onDialoog: (soort: DialoogSoort) => void
  onKolom: (stage: string) => void
  onDragStart: (e: React.DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}) {
  const tel = telefoonVan(lead)
  const mail = emailVan(lead)
  const bron = normaliseerLeadbron(lead.leadbron)
  const opvolg = lead.opvolgdatum?.slice(0, 10) ?? ''
  const vandaagIso = vandaag()
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const waarde = lead.waarde_cents ?? 0
  const opdrachtTekst = opdrachtSamenvatting(lead.opdrachten)

  return (
    <article
      data-kaart={lead.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`relative rounded-xl border bg-white p-2.5 shadow-sm cursor-pointer hover:border-gray-300 select-none ${sleept ? 'opacity-40' : ''} ${lead.do_not_call ? 'border-red-200' : 'border-gray-200'}`}
    >
      <div className="flex items-start gap-1.5 min-w-0">
        {merkenVan(lead, pipelines).map((p) => (
          <span key={p.id} title={p.name} className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${merkStijl(p.key).stip}`} />
        ))}
        <h4 className="font-semibold text-[13px] leading-snug text-gray-900 truncate flex-1">{lead.sales_companies?.name ?? '—'}</h4>
        {lead.warm && <Flame className="h-3.5 w-3.5 text-orange-500 shrink-0" aria-label="Warm" />}
        {lead.do_not_call && <PhoneOff className="h-3.5 w-3.5 text-red-500 shrink-0" aria-label="Niet bellen" />}
      </div>
      {lead.sales_contacts?.name && <p className="text-xs text-gray-600 truncate">{lead.sales_contacts.name}</p>}

      <div className="mt-1 space-y-0.5 text-xs">
        {tel && (
          <a href={`tel:${tel}`} onClick={(e) => { stop(e); onDialoog('gesprek') }} className="block text-gray-800 hover:underline truncate" draggable={false}>
            {tel}
          </a>
        )}
        {mail && (
          <a href={`mailto:${mail}`} onClick={stop} className="block text-gray-500 hover:underline truncate" draggable={false}>{mail}</a>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1 flex-wrap">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${LEADBRON_STYLE[bron]}`}>{leadbronLabel(bron)}</span>
        {verantwoordelijke && (
          <span className="text-[10px] text-gray-600 flex items-center gap-0.5"><User className="h-2.5 w-2.5" />{verantwoordelijke}</span>
        )}
        {opvolg && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${opvolg < vandaagIso ? 'bg-red-100 text-red-700' : opvolg === vandaagIso ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
            <CalendarClock className="h-2.5 w-2.5" />{korteDatum(opvolg)}
          </span>
        )}
      </div>

      {(opdrachtTekst || waarde > 0) && (
        <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
          <span className="flex items-center gap-1 text-gray-600 min-w-0">
            {opdrachtTekst && <><Briefcase className="h-3 w-3 shrink-0 text-gray-400" /><span className="truncate" title={(lead.opdrachten ?? []).map((o) => o.titel).join(', ')}>{opdrachtTekst}</span></>}
          </span>
          {waarde > 0 && (
            <span className={`font-semibold tabular-nums shrink-0 ${lead.stage_key === 'gewonnen' ? 'text-green-700' : lead.stage_key === 'verloren' ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
              {euro(waarde)}
            </span>
          )}
        </div>
      )}

      {lead.laatste_notitie && (
        <p className="mt-1.5 text-[11px] text-gray-500 line-clamp-2 leading-snug" title={lead.laatste_notitie}>{lead.laatste_notitie}</p>
      )}
      {bezetDoor && <p className="mt-1 text-[10px] text-blue-700">{bezetDoor} belt deze lead nu</p>}

      {/* Snelle acties */}
      <div className="mt-2 pt-1.5 border-t border-gray-100 flex items-center justify-between" onClick={stop}>
        <div className="flex items-center gap-0.5">
          <IkoonKnop titel="Telefoongesprek registreren" onClick={() => onDialoog('gesprek')}><PhoneCall className="h-3.5 w-3.5" /></IkoonKnop>
          <IkoonKnop titel="E-mail registreren" onClick={() => onDialoog('email')}><MailPlus className="h-3.5 w-3.5" /></IkoonKnop>
          <IkoonKnop titel="Interne notitie toevoegen" onClick={() => onDialoog('notitie')}><StickyNote className="h-3.5 w-3.5" /></IkoonKnop>
          <IkoonKnop titel="Opvolgdatum instellen" onClick={() => onDialoog('opvolg')}><CalendarClock className="h-3.5 w-3.5" /></IkoonKnop>
          <Link href={`/admin/sales/appointments?lead=${lead.id}`} title="Afspraak plannen" draggable={false}
            className="h-7 w-7 flex items-center justify-center rounded-md text-gray-500 hover:bg-[#fff848]/60 hover:text-black">
            <CalendarPlus className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="relative">
          <IkoonKnop titel="Meer acties" onClick={onMenu}><MoreHorizontal className="h-3.5 w-3.5" /></IkoonKnop>
          {menuOpen && (
            <div className="absolute right-0 bottom-8 z-20 w-48 rounded-xl border border-gray-200 bg-white shadow-lg py-1 text-xs">
              <MenuItem onClick={() => { onMenu(); onDialoog('voorstel') }}><FileText className="h-3.5 w-3.5" />Voorstel registreren</MenuItem>
              <MenuItem onClick={() => { onMenu(); onKolom('gewonnen') }}><Trophy className="h-3.5 w-3.5 text-green-700" />Gewonnen</MenuItem>
              <MenuItem onClick={() => { onMenu(); onKolom('verloren') }}><XCircle className="h-3.5 w-3.5 text-red-600" />Verloren</MenuItem>
              <MenuItem onClick={() => { onMenu(); onOpen() }}><ExternalLink className="h-3.5 w-3.5" />Lead openen</MenuItem>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function Totaal({ label, waarde, onder, kleur = 'text-gray-900' }: { label: string; waarde: string; onder?: string; kleur?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-lg font-bold tabular-nums leading-tight ${kleur}`}>{waarde}</div>
      {onder && <div className="text-[10px] text-gray-400">{onder}</div>}
    </div>
  )
}

function IkoonKnop({ titel, onClick, children }: { titel: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={titel} aria-label={titel} onClick={onClick}
      className="h-7 w-7 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-black">
      {children}
    </button>
  )
}

function MenuItem({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex items-center gap-2">
      {children}
    </button>
  )
}
