'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Check, Flag, Loader2, Trash2, ExternalLink, Video, MapPin, Lock, Plus, Tag, Users, Building2, ListTree, Palette, CalendarClock, ChevronRight, Pencil, Search,
} from 'lucide-react'
import { dag, uur, zoneNaarIso, plusDagen, vandaag, isKleur, type Item } from '@/lib/agenda/model'
import { zoekVeld } from '@/lib/zoekveld'
import { PersoonFoto } from '@/components/admin/persoon-foto'
import { actie, api, padVan, Lade, Popover, PersonenLijst, KleurKeuze, Schakel, Markdown, vinkRegel, focusRing, ApiFout, type BoomData } from './gedeeld'

type Detail = { item: Item; subtaken: Item[]; ouder: { id: string; titel: string } | null; gemaakt_door: string | null; gemaakt_op: string }

export function ItemVenster({ id, boom, onSluit, onGewijzigd, onVerwijderd, onOpen }: {
  id: string; boom: BoomData
  onSluit: () => void
  onGewijzigd: () => void
  onVerwijderd: (id: string) => void
  onOpen: (id: string) => void
}) {
  const [d, setD] = useState<Detail | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const versie = useRef<string | null>(null)
  const laad = useCallback(async () => {
    try {
      const j = await api<Detail>(`/api/admin/agenda?item=${id}`)
      setD(j); versie.current = j.item.updated_at; setFout(null)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [id])
  useEffect(() => { setD(null); laad() }, [laad])

  const mag = !!boom.rechten.aanpassen
  const personen = useMemo(() => new Map(boom.personen.map((p) => [p.id, p])), [boom.personen])

  const bewaar = async (velden: Record<string, unknown>) => {
    if (!d) return
    const vorige = d.item
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
    <Lade onSluit={onSluit}
      titel={<span className="flex items-center gap-1 min-w-0">{pad.length ? pad.map((s, n) => <span key={n} className="flex items-center gap-1 min-w-0"><span className="truncate">{s}</span>{n < pad.length - 1 && <ChevronRight className="h-3 w-3 shrink-0" />}</span>) : <span>Agenda</span>}</span>}
      acties={d && (
        <>
          {d.item.clickup_url && <a href={d.item.clickup_url} target="_blank" rel="noopener noreferrer" className={`h-8 px-2 rounded-lg hover:bg-gray-100 text-xs text-gray-600 flex items-center gap-1 ${focusRing}`} title="Openen in ClickUp"><ExternalLink className="h-3.5 w-3.5" />ClickUp</a>}
          {boom.rechten.verwijderen && <button type="button" onClick={verwijder} className={`h-8 w-8 rounded-lg hover:bg-red-50 text-gray-500 hover:text-red-600 flex items-center justify-center ${focusRing}`} aria-label="Verwijderen" title="Naar de prullenbak"><Trash2 className="h-4 w-4" /></button>}
        </>
      )}>
      {fout && <div className="m-5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 p-3">{fout}</div>}
      {!d && !fout && <div className="py-16 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {d && <Inhoud d={d} boom={boom} mag={mag} personen={personen} bewaar={bewaar} onOpen={onOpen} herlaad={laad} onGewijzigd={onGewijzigd} />}
    </Lade>
  )
}

function Inhoud({ d, boom, mag, personen, bewaar, onOpen, herlaad, onGewijzigd }: {
  d: Detail; boom: BoomData; mag: boolean; personen: Map<string, BoomData['personen'][number]>
  bewaar: (v: Record<string, unknown>) => Promise<void>; onOpen: (id: string) => void; herlaad: () => void; onGewijzigd: () => void
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
    <div className="px-5 sm:px-7 py-5 space-y-5">
      {d.ouder && <button type="button" onClick={() => onOpen(d.ouder!.id)} className="text-xs text-gray-500 hover:underline flex items-center gap-1"><ChevronRight className="h-3 w-3 rotate-180" />Subtaak van {d.ouder.titel}</button>}

      {/* Titel */}
      <div className="flex items-start gap-3">
        {i.soort !== 'meeting' && (
          <button type="button" disabled={!mag} onClick={() => bewaar({ status: klaar ? 'open' : 'klaar' })} aria-label={klaar ? 'Terug open zetten' : 'Afvinken'}
            className={`mt-1.5 h-6 w-6 shrink-0 rounded-full border-2 flex items-center justify-center ${klaar ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-400 hover:border-gray-900'} ${focusRing}`}>
            {klaar && <Check className="h-3.5 w-3.5" />}
          </button>
        )}
        {i.soort === 'meeting' && <Video className="h-5 w-5 mt-2 shrink-0 text-gray-500" />}
        <textarea value={titel} disabled={!mag} rows={1} onChange={(e) => setTitel(e.target.value.replace(/\n/g, ' '))}
          onBlur={() => { const t = titel.trim(); if (t && t !== i.titel) bewaar({ titel: t }); else setTitel(i.titel) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
          className={`flex-1 resize-none text-2xl font-bold leading-tight bg-transparent border-0 p-0 focus:ring-0 focus:outline-none ${klaar ? 'line-through text-gray-400' : 'text-gray-900'}`}
          style={{ fieldSizing: 'content' } as React.CSSProperties} aria-label="Titel" />
      </div>

      {/* Snelle knoppen */}
      <div className="flex flex-wrap items-center gap-2">
        {i.soort !== 'meeting' ? (
          <button type="button" disabled={!mag} onClick={() => bewaar({ status: klaar ? 'open' : 'klaar' })} className={`status-badge !text-xs ${klaar ? '!bg-gray-900 !text-white' : ''}`}>
            {klaar ? <><Check className="h-3 w-3" />Klaar</> : 'Open'}
          </button>
        ) : <span className="status-badge !text-xs"><Video className="h-3 w-3" />Meeting</span>}
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

      {/* Eigenschappen */}
      <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-3 text-sm items-start">
        <Kop icoon={<CalendarClock className="h-4 w-4" />}>Wanneer</Kop>
        <Tijden i={i} mag={mag} bewaar={bewaar} />

        <Kop icoon={<Users className="h-4 w-4" />}>Wie</Kop>
        <div className="relative">
          <button type="button" disabled={!mag} onClick={() => setOpen(open === 'mensen' ? null : 'mensen')} className={`flex flex-wrap items-center gap-1.5 min-h-8 rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-gray-50 text-left ${focusRing}`}>
            {i.toegewezen.length ? i.toegewezen.map((p) => (
              <span key={p} className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 pl-0.5 pr-2.5 py-0.5 text-xs"><PersoonFoto naam={personen.get(p)?.naam ?? '?'} maat={20} />{personen.get(p)?.naam ?? 'Onbekend'}</span>
            )) : <span className="text-gray-400">Niemand</span>}
          </button>
          <Popover open={open === 'mensen'} onSluit={sluit}>
            <PersonenLijst personen={boom.personen} ik={boom.ik} gekozen={i.toegewezen} onWissel={(p) => bewaar({ toegewezen: i.toegewezen.includes(p) ? i.toegewezen.filter((x) => x !== p) : [...i.toegewezen, p] })} />
          </Popover>
        </div>

        <Kop icoon={<Building2 className="h-4 w-4" />}>Klant</Kop>
        <div className="relative">
          <button type="button" disabled={!mag} onClick={() => setOpen(open === 'klant' ? null : 'klant')} className={`rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-gray-50 text-left ${focusRing}`}>
            {klant ? <span className="inline-flex items-center gap-1.5">{boom.klantKleuren[klant.id] && <span className="h-2.5 w-2.5 rounded-full" style={{ background: boom.klantKleuren[klant.id] }} />}{klant.naam}</span> : <span className="text-gray-400">Geen klant{lijst?.client_id || lijst?.map_id ? ' (volgt de map)' : ''}</span>}
          </button>
          <Popover open={open === 'klant'} onSluit={sluit}><KlantLijst boom={boom} gekozen={i.client_id} onKies={(k) => { bewaar({ client_id: k }); sluit() }} /></Popover>
        </div>

        <Kop icoon={<Tag className="h-4 w-4" />}>Labels</Kop>
        <div className="relative">
          <button type="button" disabled={!mag} onClick={() => setOpen(open === 'labels' ? null : 'labels')} className={`flex flex-wrap gap-1 min-h-7 rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-gray-50 ${focusRing}`}>
            {i.labels.filter((l) => labelsPer.has(l)).length ? i.labels.map((l) => labelsPer.get(l)).filter(Boolean).map((l) => (
              <span key={l!.id} className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: l!.kleur, color: '#0f0f0f' }}>{l!.naam}</span>
            )) : <span className="text-gray-400">Geen</span>}
          </button>
          <Popover open={open === 'labels'} onSluit={sluit}>
            <div className="w-56 p-2 max-h-72 overflow-y-auto">
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

        <Kop icoon={<ListTree className="h-4 w-4" />}>Lijst</Kop>
        <div className="relative">
          <button type="button" disabled={!mag} onClick={() => setOpen(open === 'lijst' ? null : 'lijst')} className={`rounded-lg px-1.5 py-1 -mx-1.5 hover:bg-gray-50 text-left ${focusRing}`}>
            {lijst ? padVan(boom, lijst.id).join(' › ') : <span className="text-gray-400">Enkel in de agenda</span>}
          </button>
          <Popover open={open === 'lijst'} onSluit={sluit}><LijstKiezer boom={boom} gekozen={i.lijst_id} onKies={(l) => { bewaar({ lijst_id: l }); sluit() }} /></Popover>
        </div>

        <Kop icoon={<Palette className="h-4 w-4" />}>Kleur</Kop>
        <KleurKeuze waarde={i.kleur} onKies={(k) => mag && bewaar({ kleur: k })} leeg="Automatisch" />

        {(i.soort === 'meeting' || i.locatie || i.meet_url) && <>
          <Kop icoon={<MapPin className="h-4 w-4" />}>Plaats</Kop>
          <TekstVeld waarde={i.locatie ?? ''} mag={mag} plaats="Adres of plaats" onBewaar={(v) => bewaar({ locatie: v || null })} />
          <Kop icoon={<Video className="h-4 w-4" />}>Link</Kop>
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex-1 min-w-0"><TekstVeld waarde={i.meet_url ?? ''} mag={mag} plaats="https://…" onBewaar={(v) => bewaar({ meet_url: v || null })} /></div>
            {i.meet_url && <a href={i.meet_url} target="_blank" rel="noopener noreferrer" className="btn-primary !py-1 !px-2.5 !text-xs shrink-0">Deelnemen</a>}
          </div>
        </>}
      </div>

      {/* Beschrijving */}
      <Beschrijving waarde={i.beschrijving ?? ''} mag={mag} bewaar={bewaar} />

      {/* Subtaken */}
      <Subtaken d={d} boom={boom} mag={mag && !!boom.rechten.toevoegen} personen={personen} onOpen={onOpen} herlaad={() => { herlaad(); onGewijzigd() }} />

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
        <div>Gemaakt{d.gemaakt_door ? ` door ${d.gemaakt_door}` : ''} op {new Date(d.gemaakt_op).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' })}</div>
        {i.afgerond_op && <div>Afgevinkt{i.afgerond_door ? ` door ${i.afgerond_door}` : ''} op {new Date(i.afgerond_op).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Brussels' })}</div>}
      </div>
    </div>
  )
}

function Kop({ icoon, children }: { icoon: React.ReactNode; children: React.ReactNode }) {
  return <div className="flex items-center gap-2 text-gray-500 pt-1.5">{icoon}<span>{children}</span></div>
}

function TekstVeld({ waarde, mag, plaats, onBewaar }: { waarde: string; mag: boolean; plaats: string; onBewaar: (v: string) => void }) {
  const [v, setV] = useState(waarde)
  useEffect(() => setV(waarde), [waarde])
  return <input value={v} disabled={!mag} placeholder={plaats} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== waarde) onBewaar(v.trim()) }}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} className="input-base !py-1.5 text-sm" />
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
  const inp = 'input-base !py-1 !px-2 text-sm w-auto'
  return (
    <div className="space-y-2">
      <Schakel aan={i.heel_dag} disabled={!mag} onWissel={() => zetHeleDag(!i.heel_dag)} label={<span className="text-xs text-gray-600">Hele dag (zonder uur)</span>} />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500 w-10">{i.heel_dag ? 'Start' : 'Van'}</span>
        <input type="date" disabled={!mag} value={sd} onChange={(e) => zetStart(e.target.value, st)} className={inp} aria-label="Startdatum" />
        {!i.heel_dag && <input type="time" step={300} disabled={!mag} value={st} onChange={(e) => e.target.value && zetStart(sd || ed || vandaag(), e.target.value)} className={inp} aria-label="Startuur" />}
        {i.heel_dag && sd && <button type="button" onClick={() => bewaar({ start_op: null })} className="text-xs text-gray-500 underline">wissen</button>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-gray-500 w-10">{i.heel_dag ? 'Tegen' : 'Tot'}</span>
        <input type="date" disabled={!mag} value={ed} onChange={(e) => zetEind(e.target.value, et)} className={inp} aria-label="Einddatum" />
        {!i.heel_dag && <input type="time" step={300} disabled={!mag} value={et} onChange={(e) => e.target.value && zetEind(ed || sd || vandaag(), e.target.value)} className={inp} aria-label="Einduur" />}
        {mag && !ed && <>
          <button type="button" onClick={() => zetEind(vandaag(), et)} className="text-xs rounded-full border border-gray-200 px-2 py-0.5 hover:border-gray-400">Vandaag</button>
          <button type="button" onClick={() => zetEind(plusDagen(vandaag(), 1), et)} className="text-xs rounded-full border border-gray-200 px-2 py-0.5 hover:border-gray-400">Morgen</button>
        </>}
      </div>
    </div>
  )
}

/** De beschrijving: lezen (afvinkvakjes werken) of bewerken. */
function Beschrijving({ waarde, mag, bewaar }: { waarde: string; mag: boolean; bewaar: (v: Record<string, unknown>) => Promise<void> }) {
  const [tekst, setTekst] = useState(waarde)
  const [bewerk, setBewerk] = useState(false)
  const [concept, setConcept] = useState('')
  useEffect(() => { if (!bewerk) setTekst(waarde) }, [waarde, bewerk])
  const opslaan = async () => {
    setBewerk(false)
    if (concept === tekst) return
    setTekst(concept)
    await bewaar({ beschrijving: concept })
  }
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="label-mono text-[10px] uppercase text-gray-500">Beschrijving</div>
        {mag && !bewerk && <button type="button" onClick={() => { setConcept(tekst); setBewerk(true) }} className="text-xs text-gray-600 flex items-center gap-1 hover:underline"><Pencil className="h-3 w-3" />Bewerken</button>}
      </div>
      {bewerk ? (
        <div className="space-y-2">
          <textarea autoFocus value={concept} onChange={(e) => setConcept(e.target.value)} rows={Math.min(24, Math.max(6, concept.split('\n').length + 2))}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); opslaan() } }}
            className="input-base text-sm font-mono leading-relaxed" placeholder={'Schrijf hier. Lijstjes met "- ", afvinken met "- [ ] ", vet met **zo**.'} />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setBewerk(false)} className="btn-secondary !py-1.5 !text-xs">Annuleren</button>
            <button type="button" onClick={opslaan} className="btn-primary !py-1.5 !text-xs">Bewaren</button>
          </div>
        </div>
      ) : tekst.trim() ? (
        <div className="rounded-xl border border-gray-100 bg-gray-50/50 p-3" onDoubleClick={() => { if (mag) { setConcept(tekst); setBewerk(true) } }}>
          <Markdown tekst={tekst} onVink={mag ? (n) => { const t = vinkRegel(tekst, n); setTekst(t); bewaar({ beschrijving: t }) } : undefined} />
        </div>
      ) : (
        <button type="button" disabled={!mag} onClick={() => { setConcept(''); setBewerk(true) }} className="w-full text-left rounded-xl border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-400 hover:border-gray-400">Voeg een beschrijving toe…</button>
      )}
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
    <div className="w-72 p-2">
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
    <div className="w-80 p-2">
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
