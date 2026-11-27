'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { Editor } from '@tiptap/react'
import { toast } from 'sonner'
import {
  Check, Flag, Loader2, Trash2, ExternalLink, Video, MapPin, Lock, Plus, Tag, Users, Building2, ListTree, Palette, CalendarClock, ChevronRight, Search, Paperclip, FileText, FilePlus2, Clock,
} from 'lucide-react'
import { dag, uur, zoneNaarIso, plusDagen, vandaag, isKleur, enkelDeadline, snelleDeadlines, type Item } from '@/lib/agenda/model'
import { zoekVeld } from '@/lib/zoekveld'
import { PersoonFoto } from '@/components/admin/persoon-foto'
import { createClient } from '@/lib/supabase/client'
import { actie, api, padVan, Lade, Popover, PersonenLijst, KleurKeuze, Schakel, MapKiezer, MapLabel, WieKiezer, labelVoorstel, focusRing, ApiFout, type BoomData } from './gedeeld'
import { DeadlineLabel, KLAAR_STIJL } from './kalender'
import { DicteerKnop } from '@/components/admin/dicteer-knop'
import type { DocNode } from '@/lib/agenda/doc-opmaak'

// De editor (TipTap) pas laden als een taak opengaat.
const RijkeEditor = dynamic(() => import('./rijke-editor').then((m) => m.RijkeEditor), {
  ssr: false,
  loading: () => <div className="py-6 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>,
})

type Bijlage = { id: string; naam: string; type: string | null; grootte: number | null; geupload_door: string | null; created_at: string }
type TaakDoc = { id: string; titel: string; updated_at: string; bijgewerkt_door: string | null }
type Detail = { item: Item; beschrijving_json?: DocNode | null; subtaken: Item[]; ouder: { id: string; titel: string } | null; gemaakt_door: string | null; gemaakt_op: string; bijlagen: Bijlage[]; docs: TaakDoc[]; voorlopig?: true }

/**
 * Sneller openen: een taak wordt al geladen zodra de muis erover gaat (of de vinger erop
 * drukt), en het venster toont meteen wat de kalender al weet. Hoogstens 15 seconden oud.
 */
const voorraad = new Map<string, { t: number; p: Promise<Detail> }>()
export function voorladen(id: string): Promise<Detail> {
  const v = voorraad.get(id)
  if (v && Date.now() - v.t < 15_000) return v.p
  const p = api<Detail>(`/api/admin/agenda?item=${id}`)
  p.catch(() => voorraad.delete(id))
  voorraad.set(id, { t: Date.now(), p })
  if (voorraad.size > 40) voorraad.delete(voorraad.keys().next().value as string)
  return p
}
const vanVoorraad = (id: string) => { const p = voorladen(id); voorraad.delete(id); return p }
const voorlopigeDetail = (i: Item): Detail => ({ item: i, subtaken: [], ouder: null, gemaakt_door: null, gemaakt_op: '', bijlagen: [], docs: [], voorlopig: true })

export function ItemVenster({ id, boom, voorlopig, onSluit, onGewijzigd, onVerwijderd, onOpen, onDoc }: {
  id: string; boom: BoomData
  /** Wat de kalender al van de taak weet: meteen tonen, de rest komt erbij. */
  voorlopig?: Item | null
  onSluit: () => void
  onDoc: (id: string) => void
  onGewijzigd: () => void
  onVerwijderd: (id: string) => void
  onOpen: (id: string) => void
}) {
  const [d, setD] = useState<Detail | null>(() => (voorlopig && voorlopig.id === id && voorlopig.bron === 'ag' ? voorlopigeDetail(voorlopig) : null))
  const [fout, setFout] = useState<string | null>(null)
  const versie = useRef<string | null>(voorlopig && voorlopig.id === id ? voorlopig.updated_at : null)
  // Iets bewaard terwijl de taak nog laadde: daarna nog eens vers ophalen, zodat niets terugspringt.
  const bewaardTijdensLaden = useRef(0)
  const laad = useCallback(async (vers = true) => {
    try {
      const teller = bewaardTijdensLaden.current
      let j = await (vers ? api<Detail>(`/api/admin/agenda?item=${id}`) : vanVoorraad(id))
      if (bewaardTijdensLaden.current !== teller) j = await api<Detail>(`/api/admin/agenda?item=${id}`)
      setD(j); versie.current = j.item.updated_at; setFout(null)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [id])
  useEffect(() => { void laad(false) }, [laad])

  const mag = !!boom.rechten.aanpassen
  const personen = useMemo(() => new Map(boom.personen.map((p) => [p.id, p])), [boom.personen])

  /** De beschrijving bewaart vanzelf: zonder versiecontrole (enkel de tekst verandert) en zonder de kalender te herladen. */
  const bewaarBeschrijving = async (json: DocNode) => {
    if (!d) return
    const r = await actie<{ ok: true; versie: string | null }>({ actie: 'item.wijzig', id: d.item.id, beschrijving_json: json })
    if (r.versie) versie.current = r.versie
  }
  const bewaar = async (velden: Record<string, unknown>) => {
    if (!d) return
    const vorige = d.item
    if (d.voorlopig) bewaardTijdensLaden.current++
    setD({ ...d, item: { ...d.item, ...velden } as Item })
    try {
      const r = await actie<{ ok: true; versie: string | null }>({ actie: 'item.wijzig', id: d.item.id, versie: versie.current, ...velden })
      if (r.versie) versie.current = r.versie
      onGewijzigd()
    } catch (e) {
      setD((x) => (x ? { ...x, item: vorige } : x))
      toast.error(e instanceof Error ? e.message : 'Bewaren mislukt')
      if (e instanceof ApiFout && e.status === 409) laad()
    }
  }

  const verwijder = async () => {
    if (!d || !confirm(`"${d.item.titel}" naar de prullenbak? Je kan het daar terugzetten.`)) return
    try {
      await actie({ actie: 'item.verwijder', id: d.item.id })
      onVerwijderd(d.item.id)
      toast.success('Naar de prullenbak', { action: { label: 'Ongedaan maken', onClick: () => { actie({ actie: 'item.herstel', id: d.item.id }).then(onGewijzigd).catch(() => toast.error('Terugzetten mislukt')) } } })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }

  const pad = d ? padVan(boom, d.item.lijst_id) : []
  return (
    <Lade onSluit={onSluit} maat="groot"
      titel={<span className="flex items-center gap-1 min-w-0">{pad.length ? pad.map((s, n) => <span key={n} className="flex items-center gap-1 min-w-0"><span className="truncate">{s}</span>{n < pad.length - 1 && <ChevronRight className="h-3 w-3 shrink-0" />}</span>) : <span>Agenda</span>}</span>}
      acties={d && (
        <>
          {d.item.clickup_url && <a href={d.item.clickup_url} target="_blank" rel="noopener noreferrer" className={`h-8 px-2 rounded-lg hover:bg-gray-100 text-xs text-gray-600 flex items-center gap-1 ${focusRing}`} title="Openen in ClickUp"><ExternalLink className="h-3.5 w-3.5" />ClickUp</a>}
          {boom.rechten.verwijderen && <button type="button" onClick={verwijder} className={`h-8 w-8 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600 flex items-center justify-center ${focusRing}`} aria-label="Verwijderen" title="Naar de prullenbak"><Trash2 className="h-4 w-4" /></button>}
        </>
      )}>
      {fout && <div className="m-5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 p-3">{fout}</div>}
      {!d && !fout && <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {d && <Inhoud d={d} boom={boom} mag={mag} personen={personen} bewaar={bewaar} bewaarBeschrijving={bewaarBeschrijving} onOpen={onOpen} herlaad={() => void laad()} onGewijzigd={onGewijzigd} onDoc={onDoc} />}
    </Lade>
  )
}

function Inhoud({ d, boom, mag, personen, bewaar, bewaarBeschrijving, onOpen, herlaad, onGewijzigd, onDoc }: {
  d: Detail; boom: BoomData; mag: boolean; personen: Map<string, BoomData['personen'][number]>
  bewaar: (v: Record<string, unknown>) => Promise<void>; bewaarBeschrijving: (json: DocNode) => Promise<void>; onOpen: (id: string) => void; herlaad: () => void; onGewijzigd: () => void; onDoc: (id: string) => void
}) {
  const i = d.item
  const [titel, setTitel] = useState(i.titel)
  useEffect(() => setTitel(i.titel), [i.titel])
  const klaar = i.status === 'klaar'
  const [open, setOpen] = useState<null | 'mensen' | 'labels' | 'klant' | 'lijst' | 'kleur'>(null)
  const sluit = useCallback(() => setOpen(null), [])
  const lijst = i.lijst_id ? boom.lijsten.find((l) => l.id === i.lijst_id) : null
  const labelsPer = new Map(boom.labels.map((l) => [l.id, l]))
  const klant = i.client_id ? boom.klanten.find((k) => k.id === i.client_id) : null

  return (
    <div className="px-5 sm:px-8 py-6 space-y-5">
      {d.ouder && <button type="button" onClick={() => onOpen(d.ouder!.id)} className="text-xs text-gray-500 hover:underline flex items-center gap-1"><ChevronRight className="h-3 w-3 rotate-180" />Subtaak van {d.ouder.titel}</button>}

      {/* Titel */}
      <div className="flex items-start gap-3">
        <button type="button" disabled={!mag} onClick={() => bewaar({ status: klaar ? 'open' : 'klaar' })} aria-label={klaar ? 'Terug open zetten' : 'Complete'}
          className={`mt-1.5 h-6 w-6 shrink-0 rounded-full border-2 flex items-center justify-center ${klaar ? 'bg-[#3f9a64] border-[#3f9a64] text-white' : 'border-gray-400 hover:border-gray-900'} ${focusRing}`}>
          {klaar && <Check className="h-3.5 w-3.5" />}
        </button>
        <textarea value={titel} disabled={!mag} rows={1} onChange={(e) => setTitel(e.target.value.replace(/\n/g, ' '))}
          onBlur={() => { const t = titel.trim(); if (t && t !== i.titel) bewaar({ titel: t }); else setTitel(i.titel) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
          className={`flex-1 resize-none text-[26px] font-bold leading-tight bg-transparent border-0 p-0 focus:ring-0 focus:outline-none ${klaar ? 'line-through text-gray-400' : 'text-gray-900'}`}
          style={{ fieldSizing: 'content' } as React.CSSProperties} aria-label="Titel" />
      </div>

      {/* Snelle knoppen */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Eén duidelijke groene knop om de taak af te ronden; daarna kan je ze terug openzetten. */}
        {klaar ? (
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 h-10 rounded-xl px-3.5 text-sm font-semibold text-[#2b4a36] border-l-[3px] border-l-[#4caf73]" style={{ background: KLAAR_STIJL.background }}><Check className="h-4 w-4" />Completed</span>
            {mag && <button type="button" onClick={() => bewaar({ status: 'open' })} className={`h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:border-gray-400 ${focusRing}`}>Terug open</button>}
          </span>
        ) : (
          <button type="button" disabled={!mag} onClick={() => bewaar({ status: 'klaar' })}
            className={`inline-flex items-center gap-2 h-10 rounded-xl bg-[#2f7a4b] hover:bg-[#276a40] active:bg-[#215a37] text-white px-4 text-sm font-semibold shadow-sm disabled:opacity-50 ${focusRing}`}>
            <Check className="h-4 w-4" />Complete
          </button>
        )}
        {i.deadline_op && <DeadlineLabel i={i} lang />}
        {i.soort === 'meeting' && <span className="status-badge !text-xs"><Video className="h-3 w-3" />Meeting</span>}
        {i.clickup_status && <span className="text-[11px] label-mono uppercase px-2 py-0.5 rounded-full border border-gray-200" style={isKleur(i.clickup_status_kleur) ? { borderColor: i.clickup_status_kleur, color: '#272727' } : undefined} title="Status in ClickUp">{i.clickup_status}</span>}
        <button type="button" disabled={!mag} onClick={() => bewaar({ urgent: !i.urgent })} aria-pressed={i.urgent}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${i.urgent ? 'bg-red-50 border-red-300 text-red-700' : 'border-gray-200 text-gray-600 hover:border-gray-400'} ${focusRing}`}>
          <Flag className={`h-3.5 w-3.5 ${i.urgent ? 'fill-red-600 text-red-600' : ''}`} />Dringend
        </button>
        <button type="button" disabled={!mag} onClick={() => bewaar({ soort: i.soort === 'meeting' ? 'taak' : 'meeting' })}
          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs border-gray-200 text-gray-600 hover:border-gray-400 ${focusRing}`}>
          {i.soort === 'meeting' ? 'Maak er een taak van' : 'Maak er een meeting van'}
        </button>
        <span className="flex-1" />
        <Schakel aan={i.prive} disabled={!mag} onWissel={() => bewaar({ prive: !i.prive })} label={<span className="flex items-center gap-1 text-xs text-gray-600"><Lock className="h-3 w-3" />Privé</span>} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
      {/* Eigenschappen: rechts op een groot scherm, bovenaan op de gsm */}
      <aside className="lg:order-2 rounded-2xl bg-gray-50 border border-gray-100 p-4 space-y-4 text-sm">
        {/* Volgorde op vraag: eerst wanneer, dan wie, dan pas de deadline. */}
        <Kop icoon={<CalendarClock className="h-3.5 w-3.5" />}>{i.soort === 'meeting' ? 'Wanneer' : 'Wanneer werk je eraan'}</Kop>
        <Tijden i={i} mag={mag} bewaar={bewaar} />

        <Kop icoon={<Users className="h-3.5 w-3.5" />}>Wie</Kop>
        <WieKiezer boom={boom} gekozen={i.toegewezen} disabled={!mag}
          onWissel={(p) => bewaar({ toegewezen: i.toegewezen.includes(p) ? i.toegewezen.filter((x) => x !== p) : [...i.toegewezen, p] })} />

        {i.soort !== 'meeting' && <>
          <Kop icoon={<Clock className="h-3.5 w-3.5" />}>Deadline</Kop>
          <DeadlineVeld i={i} mag={mag} bewaar={bewaar} />
        </>}

        <Kop icoon={<Building2 className="h-3.5 w-3.5" />}>Klant</Kop>
        <div className="relative">
          <button type="button" disabled={!mag} onClick={() => setOpen(open === 'klant' ? null : 'klant')} className={`rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-gray-50 text-left ${focusRing}`}>
            {klant ? <span className="inline-flex items-center gap-1.5">{boom.klantKleuren[klant.id] && <span className="h-2.5 w-2.5 rounded-full" style={{ background: boom.klantKleuren[klant.id] }} />}{klant.naam}</span> : <span className="text-gray-400">Geen klant{lijst?.client_id || lijst?.map_id ? ' (volgt de map)' : ''}</span>}
          </button>
          <Popover open={open === 'klant'} onSluit={sluit}><KlantLijst boom={boom} gekozen={i.client_id} onKies={(k) => { bewaar({ client_id: k }); sluit() }} /></Popover>
        </div>

        <Kop icoon={<Tag className="h-3.5 w-3.5" />}>Labels</Kop>
        <div className="relative">
          <button type="button" disabled={!mag} onClick={() => setOpen(open === 'labels' ? null : 'labels')} className={`flex flex-wrap gap-1 min-h-7 rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-gray-50 ${focusRing}`}>
            {i.labels.filter((l) => labelsPer.has(l)).length ? i.labels.map((l) => labelsPer.get(l)).filter(Boolean).map((l) => (
              <span key={l!.id} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: l!.kleur, color: '#0f0f0f' }}>{l!.naam}</span>
            )) : <span className="text-gray-400">Geen</span>}
          </button>
          {/* Nog geen label: het voorstel uit de titel en de map, één klik om toe te voegen. */}
          {mag && !i.labels.some((l) => labelsPer.has(l)) && (() => {
            const v = labelVoorstel(boom, { titel: i.titel, lijst_id: i.lijst_id, soort: i.soort })
            return v ? (
              <button type="button" onClick={() => bewaar({ labels: [...i.labels, v.id] })} title="Voorstel: klik om toe te voegen"
                className={`mt-1 inline-flex items-center gap-1 rounded-full border border-dashed border-gray-400 px-2.5 py-0.5 text-xs text-gray-700 hover:border-gray-900 ${focusRing}`}>
                <Plus className="h-3 w-3" />{v.naam}<span className="text-gray-400">· voorstel</span>
              </button>
            ) : null
          })()}
          <Popover open={open === 'labels'} onSluit={sluit}>
            <div className="w-full md:w-56 p-2 max-h-72 overflow-y-auto">
              {boom.labels.map((l) => {
                const aan = i.labels.includes(l.id)
                return (
                  <button key={l.id} type="button" role="checkbox" aria-checked={aan} onClick={() => bewaar({ labels: aan ? i.labels.filter((x) => x !== l.id) : [...i.labels, l.id] })}
                    className={`w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50 ${focusRing}`}>
                    <span className="h-3 w-3 rounded-full" style={{ background: l.kleur }} /><span className="flex-1 text-left">{l.naam}</span>{aan && <Check className="h-4 w-4" />}
                  </button>
                )
              })}
              {!boom.labels.length && <p className="text-xs text-gray-500 p-2">Nog geen labels. Maak ze in Instellingen.</p>}
            </div>
          </Popover>
        </div>

        <Kop icoon={<ListTree className="h-3.5 w-3.5" />}>Map</Kop>
        <div className="relative">
          <button type="button" disabled={!mag} onClick={() => setOpen(open === 'lijst' ? null : 'lijst')} className={`rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-gray-50 text-left max-w-full ${focusRing}`}>
            {lijst ? <MapLabel boom={boom} lijstId={lijst.id} /> : <span className="text-gray-400">Geen map: kies er een</span>}
          </button>
          <Popover open={open === 'lijst'} onSluit={sluit}><MapKiezer boom={boom} gekozen={i.lijst_id} leeg="Geen map (enkel in de agenda)" onKies={(l) => { bewaar({ lijst_id: l }); sluit() }} /></Popover>
        </div>

        <Kop icoon={<Palette className="h-3.5 w-3.5" />}>Kleur</Kop>
        <KleurKeuze waarde={i.kleur} onKies={(k) => mag && bewaar({ kleur: k })} leeg="Automatisch" />

        {(i.soort === 'meeting' || i.locatie || i.meet_url) && <>
          <Kop icoon={<MapPin className="h-3.5 w-3.5" />}>Plaats</Kop>
          <TekstVeld waarde={i.locatie ?? ''} mag={mag} plaats="Adres of plaats" onBewaar={(v) => bewaar({ locatie: v || null })} />
          <Kop icoon={<Video className="h-3.5 w-3.5" />}>Link</Kop>
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-1 min-w-0"><TekstVeld waarde={i.meet_url ?? ''} mag={mag} plaats="https://…" onBewaar={(v) => bewaar({ meet_url: v || null })} /></div>
            {i.meet_url && <a href={i.meet_url} target="_blank" rel="noopener noreferrer" className="btn-primary !py-1 !px-2.5 !text-xs shrink-0">Deelnemen</a>}
          </div>
        </>}
      </aside>

      <div className="lg:order-1 space-y-6 min-w-0">
      {d.voorlopig ? (
        // De beschrijving, bijlagen en subtaken komen er zo bij (de rest staat er al).
        <div className="space-y-3" aria-busy="true">
          <div className="label-mono text-[10px] uppercase text-gray-500">Beschrijving</div>
          <div className="h-24 rounded-xl border border-gray-100 bg-gray-50 animate-pulse" />
          <div className="h-10 rounded-xl bg-gray-50 animate-pulse" />
        </div>
      ) : <>
        {/* Beschrijving */}
        <Beschrijving key={i.id} json={d.beschrijving_json ?? null} markdown={i.beschrijving ?? ''} itemId={i.id} mag={mag} context={i.titel} opslaan={bewaarBeschrijving} />

        {/* Bijlagen en docs */}
        <Bijlagen d={d} mag={mag} magToevoegen={!!boom.rechten.toevoegen} herlaad={herlaad} onDoc={onDoc} />

        {/* Subtaken */}
        <Subtaken d={d} boom={boom} mag={mag && !!boom.rechten.toevoegen} personen={personen} onOpen={onOpen} herlaad={() => { herlaad(); onGewijzigd() }} />
      </>}

      {/* Velden uit ClickUp */}
      {i.velden && Object.keys(i.velden).length > 0 && (
        <div>
          <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Velden</div>
          <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-sm">
            {Object.entries(i.velden).map(([k, v]) => (
              <div key={k} className="contents"><dt className="text-gray-500 truncate">{k}</dt><dd className="text-gray-900 break-words">{Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Ja' : 'Nee') : String(v)}</dd></div>
            ))}
          </dl>
        </div>
      )}

      <div className="text-[11px] text-gray-400 border-t border-gray-100 pt-3 space-y-0.5">
        {d.gemaakt_op && <div>Gemaakt{d.gemaakt_door ? ` door ${d.gemaakt_door}` : ''} op {new Date(d.gemaakt_op).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' })}</div>}
        {i.afgerond_op && <div>Completed{i.afgerond_door ? ` door ${i.afgerond_door}` : ''} op {new Date(i.afgerond_op).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' })}</div>}
      </div>
      </div>
      </div>
    </div>
  )
}

function Kop({ icoon, children }: { icoon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-center gap-1.5 label-mono text-[10px] uppercase tracking-wide text-gray-500 -mb-2.5">{icoon}<span>{children}</span></div>
}

function TekstVeld({ waarde, mag, plaats, onBewaar }: { waarde: string; mag: boolean; plaats: string; onBewaar: (v: string) => void }) {
  const [v, setV] = useState(waarde)
  useEffect(() => setV(waarde), [waarde])
  return <input value={v} disabled={!mag} placeholder={plaats} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== waarde) onBewaar(v.trim()) }}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} className="input-base !py-1.5 text-sm" />
}

/**
 * De deadline: tegen wanneer het af moet, altijd met uur. Staat er geen ander
 * moment, dan staat de taak bovenaan die dag. Bij een taak uit ClickUp met enkel
 * een einde schuift dat einde mee.
 */
function DeadlineVeld({ i, mag, bewaar }: { i: Item; mag: boolean; bewaar: (v: Record<string, unknown>) => Promise<void> }) {
  const gekoppeld = enkelDeadline(i) && !!i.eind_op
  const zet = (iso: string | null) => bewaar(gekoppeld ? { deadline_op: iso, eind_op: iso } : { deadline_op: iso })
  const dd = i.deadline_op ? dag(i.deadline_op) : '', du = i.deadline_op ? uur(i.deadline_op) : ''
  const inp = 'input-base !py-1 !px-2 text-sm'
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <input type="date" disabled={!mag} value={dd} onChange={(e) => e.target.value ? zet(zoneNaarIso(e.target.value, du || '17:00')) : zet(null)} className={`${inp} !w-[9.5rem]`} aria-label="Datum deadline" />
        <input type="time" step={300} disabled={!mag} value={du} onChange={(e) => e.target.value && zet(zoneNaarIso(dd || vandaag(), e.target.value))} className={`${inp} !w-[6.5rem]`} aria-label="Uur deadline" />
        {mag && i.deadline_op && <button type="button" onClick={() => zet(null)} className="text-xs text-gray-500 underline">wissen</button>}
      </div>
      {mag && (
        <div className="flex flex-wrap gap-1.5">
          {snelleDeadlines().map((s) => (
            <button key={s.label} type="button" onClick={() => zet(s.iso)} aria-pressed={i.deadline_op ? Date.parse(i.deadline_op) === Date.parse(s.iso) : false}
              className={`text-xs rounded-full border px-2 py-0.5 ${i.deadline_op && Date.parse(i.deadline_op) === Date.parse(s.iso) ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-200 hover:border-gray-400'} ${focusRing}`}>{s.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Datum en uur. Hele dag = enkel datums; anders begin en einde met uur. Alles in Belgische tijd. */
function Tijden({ i, mag, bewaar }: { i: Item; mag: boolean; bewaar: (v: Record<string, unknown>) => Promise<void> }) {
  const sd = i.start_op ? dag(i.start_op) : '', st = i.start_op ? uur(i.start_op) : ''
  const ed = i.eind_op ? dag(i.eind_op) : '', et = i.eind_op ? uur(i.eind_op) : ''
  const zetHeleDag = (aan: boolean) => {
    if (aan) bewaar({ heel_dag: true, start_op: i.start_op && sd !== ed ? zoneNaarIso(sd, '00:00') : null, eind_op: ed ? zoneNaarIso(ed, '00:00') : null })
    else {
      const d = ed || sd || vandaag()
      bewaar({ heel_dag: false, start_op: zoneNaarIso(d, '09:00'), eind_op: zoneNaarIso(d, '10:00') })
    }
  }
  const zetStart = (nd: string, nt: string) => {
    if (!nd) { bewaar({ start_op: null }); return }
    const nieuw = zoneNaarIso(nd, i.heel_dag ? '00:00' : nt || '09:00')
    // Het einde schuift mee zodat de duur blijft.
    const duur = i.start_op && i.eind_op ? Date.parse(i.eind_op) - Date.parse(i.start_op) : i.heel_dag ? 0 : 3600_000
    const eind = !i.eind_op || Date.parse(i.eind_op) < Date.parse(nieuw) || i.start_op ? new Date(Date.parse(nieuw) + duur).toISOString() : i.eind_op
    bewaar({ start_op: nieuw, eind_op: eind })
  }
  const zetEind = (nd: string, nt: string) => {
    if (!nd) { bewaar({ eind_op: null }); return }
    const nieuw = zoneNaarIso(nd, i.heel_dag ? '00:00' : nt || et || '10:00')
    if (i.start_op && Date.parse(nieuw) < Date.parse(i.start_op)) { toast.error('Het einde ligt voor het begin.'); return }
    bewaar({ eind_op: nieuw })
  }
  const inp = 'input-base !py-1 !px-2 text-sm'
  return (
    <div className="space-y-2">
      <Schakel aan={i.heel_dag} disabled={!mag} onWissel={() => zetHeleDag(!i.heel_dag)} label={<span className="text-xs text-gray-600">Hele dag (zonder uur)</span>} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500 w-9">{i.heel_dag ? 'Start' : 'Van'}</span>
        <input type="date" disabled={!mag} value={sd} onChange={(e) => zetStart(e.target.value, st)} className={`${inp} !w-[9.5rem]`} aria-label="Startdatum" />
        {!i.heel_dag && <input type="time" step={300} disabled={!mag} value={st} onChange={(e) => e.target.value && zetStart(sd || ed || vandaag(), e.target.value)} className={`${inp} !w-[6.5rem]`} aria-label="Startuur" />}
        {i.heel_dag && sd && <button type="button" onClick={() => bewaar({ start_op: null })} className="text-xs text-gray-500 underline">wissen</button>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500 w-9">{i.heel_dag ? 'Tegen' : 'Tot'}</span>
        <input type="date" disabled={!mag} value={ed} onChange={(e) => zetEind(e.target.value, et)} className={`${inp} !w-[9.5rem]`} aria-label="Einddatum" />
        {!i.heel_dag && <input type="time" step={300} disabled={!mag} value={et} onChange={(e) => e.target.value && zetEind(ed || sd || vandaag(), e.target.value)} className={`${inp} !w-[6.5rem]`} aria-label="Einduur" />}
        {mag && !ed && <>
          <button type="button" onClick={() => zetEind(vandaag(), et)} className="text-xs rounded-full border border-gray-200 px-2 py-0.5 hover:border-gray-400">Vandaag</button>
          <button type="button" onClick={() => zetEind(plusDagen(vandaag(), 1), et)} className="text-xs rounded-full border border-gray-200 px-2 py-0.5 hover:border-gray-400">Morgen</button>
        </>}
      </div>
    </div>
  )
}

/**
 * De beschrijving als opgemaakte tekst, zoals de documenten: koppen, vet, markeren,
 * lijstjes, afvinklijst, tabellen en links. Wat uit ClickUp komt (markdown) wordt
 * netjes getoond. Typen bewaart vanzelf; de microfoon zet tekst onderaan.
 */
function Beschrijving({ itemId, json, markdown, mag, context, opslaan }: { itemId: string; json: DocNode | null; markdown: string; mag: boolean; context: string; opslaan: (json: DocNode) => Promise<void> }) {
  const [stand, setStand] = useState<'' | 'bezig' | 'ok' | 'fout'>('')
  const wacht = useRef<DocNode | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const opslaanRef = useRef(opslaan)
  opslaanRef.current = opslaan
  const editorRef = useRef<Editor | null>(null)
  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    const j = wacht.current
    if (!j) return
    wacht.current = null
    setStand('bezig')
    try { await opslaanRef.current(j); setStand('ok') } catch (e) { setStand('fout'); toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
  }, [])
  // Venster dicht of andere taak: wat nog niet bewaard was, meteen bewaren.
  useEffect(() => () => { void flush() }, [flush])
  // Enkel wat iemand zelf doet telt (typen, afvinken, inspreken). Bij het openen zet de editor
  // tabellen netjes; dat mag niet bewaren, anders telt elke geopende taak als "in de app aangepast".
  const handmatig = useRef(false)
  const aangeraakt = useRef(false)
  const onWijzig = useCallback((j: DocNode, _t: string, e: Editor) => {
    if (!mag || (!aangeraakt.current && !handmatig.current && !e.isFocused)) return
    wacht.current = j
    setStand('')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void flush() }, 900)
  }, [mag, flush])
  const onKlaar = useCallback((e: Editor) => { editorRef.current = e }, [])

  // Inspreken: de tekst komt als nieuwe alinea onderaan; de opgekuiste versie vervangt daarna die alinea.
  const dicteer = useRef<{ from: number; to: number; tekst: string } | null>(null)
  const voegIn = (t: string) => {
    const e = editorRef.current
    const tekst = t.trim()
    if (!e || !tekst) return
    const alinea = { type: 'paragraph', content: [{ type: 'text', text: tekst }] }
    handmatig.current = true
    try {
      if (e.isEmpty) {
        e.chain().insertContentAt({ from: 0, to: e.state.doc.content.size }, alinea).run()
        dicteer.current = { from: 1, to: 1 + tekst.length, tekst }
        return
      }
      const eind = e.state.doc.content.size
      e.chain().insertContentAt(eind, alinea).run()
      dicteer.current = { from: eind + 1, to: eind + 1 + tekst.length, tekst }
    } finally { handmatig.current = false }
  }
  const zetIngesproken = (f: (oud: string) => string) => {
    const e = editorRef.current
    if (!e) return
    const d = dicteer.current
    const staatErNog = !!d && d.to <= e.state.doc.content.size && e.state.doc.textBetween(d.from, d.to) === d.tekst
    if (d && staatErNog) {
      const nieuw = f(d.tekst)
      if (nieuw.startsWith(`${d.tekst}\n`)) { voegIn(nieuw.slice(d.tekst.length + 1)); return }
      if (!nieuw.trim()) return
      handmatig.current = true
      try { e.chain().insertContentAt({ from: d.from, to: d.to }, { type: 'text', text: nieuw }).run() } finally { handmatig.current = false }
      dicteer.current = { from: d.from, to: d.from + nieuw.length, tekst: nieuw }
      return
    }
    voegIn(f(''))
  }

  if (!mag && !markdown.trim() && !json) return null
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="label-mono text-[10px] uppercase text-gray-500">Beschrijving</div>
        {mag && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-gray-400" aria-live="polite">{stand === 'bezig' ? 'Bewaren…' : stand === 'ok' ? 'Bewaard' : stand === 'fout' ? 'Niet bewaard' : ''}</span>
            <DicteerKnop zet={zetIngesproken} context={context} klein />
          </div>
        )}
      </div>
      <div onPointerDownCapture={() => { aangeraakt.current = true }} onKeyDownCapture={() => { aangeraakt.current = true }}
        className="rounded-xl border border-gray-100 bg-white px-4 py-3 transition-colors hover:border-gray-200 focus-within:border-gray-300">
        <RijkeEditor docId={itemId} json={json} markdown={markdown} mag={mag} kort onWijzig={onWijzig} onKlaar={onKlaar}
          placeholder="Schrijf hier. Typ - voor een lijstje, [ ] voor een afvinklijst, # voor een titel. Selecteer tekst om te markeren." />
      </div>
    </div>
  )
}

function Subtaken({ d, boom, mag, personen, onOpen, herlaad }: { d: Detail; boom: BoomData; mag: boolean; personen: Map<string, BoomData['personen'][number]>; onOpen: (id: string) => void; herlaad: () => void }) {
  const [nieuw, setNieuw] = useState('')
  const [bezig, setBezig] = useState(false)
  if (!d.subtaken.length && !mag) return null
  const voegToe = async () => {
    const t = nieuw.trim()
    if (!t) return
    setBezig(true)
    try {
      await actie({ actie: 'item.nieuw', titel: t, parent_id: d.item.id, lijst_id: d.item.lijst_id, client_id: d.item.client_id, heel_dag: true, toegewezen: d.item.toegewezen })
      setNieuw(''); herlaad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }
  const wissel = async (s: Item) => {
    try { await actie({ actie: 'item.wijzig', id: s.id, status: s.status === 'klaar' ? 'open' : 'klaar' }); herlaad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const klaar = d.subtaken.filter((s) => s.status === 'klaar').length
  return (
    <div>
      <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Subtaken {d.subtaken.length > 0 && <span className="text-gray-400">· {klaar}/{d.subtaken.length}</span>}</div>
      <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
        {d.subtaken.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-3 py-2">
            <button type="button" disabled={!boom.rechten.aanpassen} onClick={() => wissel(s)} aria-label={s.status === 'klaar' ? 'Terug open zetten' : 'Afvinken'}
              className={`h-4 w-4 shrink-0 rounded-full border flex items-center justify-center ${s.status === 'klaar' ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-400'} ${focusRing}`}>{s.status === 'klaar' && <Check className="h-2.5 w-2.5" />}</button>
            <button type="button" onClick={() => onOpen(s.id)} className={`flex-1 text-left text-sm truncate hover:underline ${s.status === 'klaar' ? 'line-through text-gray-400' : ''}`}>{s.titel}</button>
            {s.eind_op && <span className="text-[11px] text-gray-500 tabular-nums">{new Date(s.eind_op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })}</span>}
            <span className="inline-flex -space-x-1">{s.toegewezen.slice(0, 2).map((p) => <PersoonFoto key={p} naam={personen.get(p)?.naam ?? '?'} maat={16} />)}</span>
          </li>
        ))}
        {mag && (
          <li className="flex items-center gap-2 px-3 py-1.5">
            <Plus className="h-4 w-4 text-gray-400" />
            <input value={nieuw} onChange={(e) => setNieuw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') voegToe() }} disabled={bezig} placeholder="Subtaak toevoegen" className="flex-1 bg-transparent text-sm border-0 p-1 focus:ring-0 focus:outline-none" />
            {bezig && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </li>
        )}
      </ul>
    </div>
  )
}

export function KlantLijst({ boom, gekozen, onKies }: { boom: BoomData; gekozen: string | null; onKies: (id: string | null) => void }) {
  const [q, setQ] = useState('')
  const lijst = boom.klanten.filter((k) => !k.gearchiveerd && k.naam.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 80)
  return (
    <div className="w-full md:w-72 p-2">
      <div className="relative mb-1.5"><Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input {...zoekVeld()} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek een klant…" className="input-base !py-1.5 !pl-8 text-sm" aria-label="Zoek een klant" />
      </div>
      <ul className="max-h-64 overflow-y-auto">
        <li><button type="button" onClick={() => onKies(null)} className="w-full text-left rounded-lg px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-50">Geen klant</button></li>
        {lijst.map((k) => (
          <li key={k.id}><button type="button" onClick={() => onKies(k.id)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
            <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: boom.klantKleuren[k.id] ?? 'transparent' }} />
            <span className="flex-1 text-left truncate">{k.naam}</span>{gekozen === k.id && <Check className="h-4 w-4" />}
          </button></li>
        ))}
      </ul>
    </div>
  )
}

export function LijstKiezer({ boom, gekozen, onKies, zonder = 'Enkel in de agenda (geen lijst)' }: { boom: BoomData; gekozen: string | null; onKies: (id: string | null) => void; zonder?: string | null }) {
  const [q, setQ] = useState('')
  const z = q.trim().toLowerCase()
  const rijen = boom.lijsten.map((l) => ({ l, pad: padVan(boom, l.id) })).filter((x) => !z || x.pad.join(' ').toLowerCase().includes(z))
    .sort((a, b) => a.pad.join('/').localeCompare(b.pad.join('/')))
  return (
    <div className="w-full md:w-80 p-2">
      <div className="relative mb-1.5"><Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input {...zoekVeld()} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek een lijst, map of klant…" className="input-base !py-1.5 !pl-8 text-sm" aria-label="Zoek een lijst" />
      </div>
      <ul className="max-h-72 overflow-y-auto">
        {zonder && <li><button type="button" onClick={() => onKies(null)} className="w-full text-left rounded-lg px-2 py-1.5 text-sm text-gray-500 hover:bg-gray-50">{zonder}</button></li>}
        {rijen.slice(0, 200).map(({ l, pad }) => (
          <li key={l.id}><button type="button" onClick={() => onKies(l.id)} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
            <span className="flex-1 text-left min-w-0"><span className="block truncate font-medium">{l.naam}</span><span className="block truncate text-[11px] text-gray-500">{pad.slice(0, -1).join(' › ')}</span></span>
            {l.prive && <Lock className="h-3 w-3 text-gray-400" />}{gekozen === l.id && <Check className="h-4 w-4" />}
          </button></li>
        ))}
        {!rijen.length && <li className="px-2 py-3 text-xs text-gray-500">Niets gevonden.</li>}
      </ul>
    </div>
  )
}

const grootteTekst = (b: number | null) => (!b ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} kB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`)

/** Bestanden en documenten bij een taak: opladen (rechtstreeks naar de opslag), bekijken, weghalen. */
function Bijlagen({ d, mag, magToevoegen, herlaad, onDoc }: { d: Detail; mag: boolean; magToevoegen: boolean; herlaad: () => void; onDoc: (id: string) => void }) {
  const [bezig, setBezig] = useState<string | null>(null)
  const invoer = useRef<HTMLInputElement>(null)
  const laadOp = async (bestanden: FileList | null) => {
    if (!bestanden?.length) return
    for (const f of Array.from(bestanden)) {
      setBezig(f.name)
      try {
        const j = await actie<{ ok: true; pad: string; token: string; bucket: string }>({ actie: 'bijlage.upload', item_id: d.item.id, naam: f.name, grootte: f.size, type: f.type })
        const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: f.type || 'application/octet-stream', upsert: false })
        if (error) throw new Error(error.message)
        await actie({ actie: 'bijlage.bewaar', item_id: d.item.id, pad: j.pad, naam: f.name, grootte: f.size, type: f.type })
      } catch (e) { toast.error(`${f.name}: ${e instanceof Error ? e.message : 'opladen mislukt'}`) }
    }
    setBezig(null)
    if (invoer.current) invoer.current.value = ''
    herlaad()
  }
  const weg = async (b: Bijlage) => {
    if (!confirm(`"${b.naam}" uit deze taak halen?`)) return
    try { await actie({ actie: 'bijlage.verwijder', id: b.id }); herlaad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const nieuwDoc = async () => {
    try { const r = await actie({ actie: 'doc.nieuw', item_id: d.item.id, titel: `Notities: ${d.item.titel}`.slice(0, 300) }); if (r.id) onDoc(r.id) } catch (e) { toast.error(e instanceof Error ? e.message : 'Aanmaken mislukt') }
  }
  const leeg = !d.bijlagen.length && !d.docs.length
  if (leeg && !mag) return null
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="label-mono text-[10px] uppercase text-gray-500">Bijlagen en documenten {!leeg && <span className="text-gray-400">· {d.bijlagen.length + d.docs.length}</span>}</div>
        {mag && (
          <div className="flex gap-1.5">
            {magToevoegen && <button type="button" onClick={nieuwDoc} className="btn-secondary !py-1 !px-2.5 !text-xs"><FilePlus2 className="h-3.5 w-3.5" />Document</button>}
            <button type="button" disabled={!!bezig} onClick={() => invoer.current?.click()} className="btn-secondary !py-1 !px-2.5 !text-xs">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}Bestand</button>
            <input ref={invoer} type="file" multiple className="hidden" onChange={(e) => laadOp(e.target.files)} />
          </div>
        )}
      </div>
      {leeg ? (
        <button type="button" disabled={!mag || !!bezig} onClick={() => invoer.current?.click()}
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); laadOp(e.dataTransfer.files) }}
          className="w-full rounded-xl border border-dashed border-gray-200 px-4 py-5 text-sm text-gray-400 hover:border-gray-400 text-center">
          {bezig ? `Opladen: ${bezig}…` : 'Sleep hier een pdf, xml, Word- of Excelbestand, of klik om te kiezen'}
        </button>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (mag) laadOp(e.dataTransfer.files) }}>
          {d.docs.map((x) => (
            <li key={x.id} className="flex items-center gap-2.5 px-3 py-2">
              <FileText className="h-4 w-4 text-gray-500 shrink-0" />
              <button type="button" onClick={() => onDoc(x.id)} className="flex-1 min-w-0 text-left text-sm truncate hover:underline">{x.titel}</button>
              <span className="text-[11px] text-gray-400 shrink-0">document</span>
            </li>
          ))}
          {d.bijlagen.map((b) => (
            <li key={b.id} className="flex items-center gap-2.5 px-3 py-2">
              <Paperclip className="h-4 w-4 text-gray-500 shrink-0" />
              <a href={`/api/admin/agenda?bijlage=${b.id}`} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-0 text-sm truncate hover:underline" title={b.naam}>{b.naam}</a>
              <span className="text-[11px] text-gray-400 shrink-0 hidden sm:inline">{grootteTekst(b.grootte)}{b.geupload_door ? ` · ${b.geupload_door.split(' ')[0]}` : ''}</span>
              {mag && <button type="button" onClick={() => weg(b)} aria-label={`${b.naam} weghalen`} className={`h-7 w-7 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 flex items-center justify-center shrink-0 ${focusRing}`}><Trash2 className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
          {bezig && <li className="px-3 py-2 text-xs text-gray-500 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Opladen: {bezig}…</li>}
        </ul>
      )}
    </div>
  )
}
