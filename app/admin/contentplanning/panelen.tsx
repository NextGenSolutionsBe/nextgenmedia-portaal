'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Trash2, Plus, ExternalLink, Pause, Play, Archive, X } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import {
  REEKSEN, ACTIVITEIT_RITME_LABEL, verwachteDatum, ritmeVan, beurten, isKlaar, FASE_KEYS, FASE_LABEL, DAG_KORT,
  type ActiviteitRitme, type CpInstellingen, type Onderdeel, type Status, type Routine, type Link as CpLink, type Reeks, type Ritme,
} from '@/lib/contentplanning/model'
import { Paneel, Notities, StatusBadge, TaakKaart, focusRing } from './bouwstenen'
import type { Batch, Contactpersoon, CpData, Doe, Taak } from './types'
import { MAANDEN, datumNl, maandNaam } from './types'

const lbl = 'block text-xs font-medium text-gray-700 mb-1'

// ── Taak toevoegen / bewerken ───────────────────────────────────────────────
export function TaakPaneel({ taak, standaard, data, doe, onSluit }: {
  taak: Taak | null; standaard?: Partial<Taak>; data: CpData; doe: Doe; onSluit: () => void
}) {
  const inst = data.instellingen
  const [v, setV] = useState({
    titel: taak?.titel ?? standaard?.titel ?? '', client_id: taak?.client_id ?? standaard?.client_id ?? '', onderdeel: taak?.onderdeel ?? standaard?.onderdeel ?? 'los',
    reeks: String(taak?.reeks ?? standaard?.reeks ?? ''), werkdatum: taak?.werkdatum ?? standaard?.werkdatum ?? '', deadline: taak?.deadline ?? '', startmoment: taak?.startmoment ?? '',
    verantwoordelijke: taak?.verantwoordelijke ?? standaard?.verantwoordelijke ?? '', status: taak?.status ?? (standaard?.werkdatum ? 'ingepland' : 'nog_in_te_plannen'),
  })
  const [bezig, setBezig] = useState(false)
  const set = <K extends keyof typeof v>(k: K, w: (typeof v)[K]) => setV((p) => ({ ...p, [k]: w }))
  const cp = data.cpKlanten.find((k) => k.client_id === v.client_id)
  const termijn = v.onderdeel === 'feedback' ? (cp?.goedkeuring_werkdagen ?? inst.goedkeuring_werkdagen) : v.onderdeel === 'aanpassingen' ? inst.aanpassing_werkdagen : null
  const verwacht = verwachteDatum(v.startmoment || null, termijn)
  const startLabel = v.onderdeel === 'feedback' ? 'Verstuurd voor goedkeuring op' : v.onderdeel === 'aanpassingen' ? 'Feedback ontvangen op' : 'Startmoment'
  const klantNaam = data.klanten.find((k) => k.id === v.client_id)?.company_name
  const kiesOnderdeel = (key: string) => {
    const o = inst.onderdelen.find((x) => x.key === key)
    setV((p) => ({ ...p, onderdeel: key, reeks: o?.reeks ? String(o.reeks) : p.reeks, titel: p.titel || o?.label || '' }))
  }
  const bewaar = async () => {
    setBezig(true)
    const body = { ...v, client_id: v.client_id || null, reeks: v.reeks ? Number(v.reeks) : null, werkdatum: v.werkdatum || null, deadline: v.deadline || null, startmoment: v.startmoment || null, verantwoordelijke: v.verantwoordelijke || null }
    const r = taak ? await doe('taak.wijzig', { id: taak.id, ...body }, { melding: 'Taak bewaard.' }) : await doe('taak.maak', { ...body, cyclus_id: standaard?.cyclus_id ?? null }, { melding: 'Taak toegevoegd.' })
    setBezig(false)
    if (r) onSluit()
  }
  return (
    <Paneel titel={taak ? taak.titel : 'Taak toevoegen'} sub={klantNaam ?? 'Losse taak'} onSluit={onSluit}>
      <div className="space-y-3">
        <div><label className={lbl}>Wat moet er gebeuren? *</label><input className={INP} value={v.titel} onChange={(e) => set('titel', e.target.value)} placeholder="bv. Script schrijven" autoFocus={!taak} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Klant</label>
            <select className={INP} value={v.client_id} onChange={(e) => set('client_id', e.target.value)}>
              <option value="">— Geen klant (losse taak) —</option>
              {data.klanten.map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Onderdeel</label>
            <select className={INP} value={v.onderdeel} onChange={(e) => kiesOnderdeel(e.target.value)}>
              <option value="los">Losse taak</option>
              {inst.onderdelen.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Werkdatum <span className="text-gray-400 font-normal">— wanneer je eraan werkt</span></label><input type="date" className={INP} value={v.werkdatum} onChange={(e) => set('werkdatum', e.target.value)} /></div>
          <div><label className={lbl}>Deadline <span className="text-gray-400 font-normal">— afgesproken</span></label><input type="date" className={INP} value={v.deadline} onChange={(e) => set('deadline', e.target.value)} /></div>
          <div><label className={lbl}>Verantwoordelijke</label>
            <input className={INP} list="cp-mensen" value={v.verantwoordelijke} onChange={(e) => set('verantwoordelijke', e.target.value)} placeholder="bv. Chiara" />
            <datalist id="cp-mensen">{data.mensen.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <div><label className={lbl}>Reeks</label>
            <select className={INP} value={v.reeks} onChange={(e) => set('reeks', e.target.value)}><option value="">—</option>{REEKSEN.map((r) => <option key={r.nr} value={r.nr}>{r.label}</option>)}</select>
          </div>
          <div className="col-span-2"><label className={lbl}>Status</label>
            <div className="flex gap-1 flex-wrap">{inst.statussen.map((s) => (
              <button key={s.key} type="button" onClick={() => set('status', s.key)} aria-pressed={v.status === s.key} className={`rounded-full border px-2.5 py-1 text-xs font-medium ${v.status === s.key ? 'ring-2 ring-black' : ''} ${s.kleur} ${focusRing}`}>{s.label}</button>
            ))}</div>
          </div>
        </div>
        {(v.onderdeel === 'feedback' || v.onderdeel === 'aanpassingen' || v.startmoment) && (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-3 items-end">
              <div><label className={lbl}>{startLabel}</label><input type="date" className={INP} value={v.startmoment} onChange={(e) => set('startmoment', e.target.value)} /></div>
              <div className="text-sm">
                {termijn === null ? <span className="text-amber-700">{v.onderdeel === 'feedback' ? 'Goedkeuringstermijn van deze klant is nog niet ingesteld (klantfiche).' : ''}</span>
                  : verwacht ? <>Verwacht: <b>{datumNl(verwacht)}</b> <span className="text-gray-500">({termijn} werkdagen)</span>{!v.deadline && <button type="button" onClick={() => set('deadline', verwacht)} className="block text-xs underline mt-0.5">als deadline overnemen</button>}</>
                  : <span className="text-gray-500">Vul het moment in; de termijn ({termijn} werkdagen) telt pas vanaf dan.</span>}
              </div>
            </div>
            {v.onderdeel === 'feedback' && <p className="text-[11px] text-gray-500">Een verstreken termijn betekent niet dat de content goedgekeurd is.</p>}
          </div>
        )}
        <div className="flex items-center gap-2 justify-between">
          {taak ? <button type="button" onClick={async () => { if (await doe('taak.verwijder', { id: taak.id }, { melding: 'Taak verwijderd.' })) onSluit() }} className="btn-secondary text-sm text-red-600"><Trash2 className="h-4 w-4" />Verwijderen</button> : <span />}
          <div className="flex gap-2"><button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button><button type="button" onClick={bewaar} disabled={bezig || !v.titel.trim()} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}{taak ? 'Bewaren' : 'Toevoegen'}</button></div>
        </div>
      </div>
      {taak && <Notities titel="Notities bij deze taak" notities={data.notities.filter((n) => n.taak_id === taak.id)} standaard={{ taak_id: taak.id, client_id: taak.client_id, cyclus_id: taak.cyclus_id, soort: 'cyclus' }} doe={doe} kanSchrijven={data.kan.aanpassen || data.kan.beheren} />}
      {taak && <p className="text-[11px] text-gray-400">Aangemaakt door {taak.created_by ?? 'onbekend'} · laatst gewijzigd {new Date(taak.updated_at).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>}
    </Paneel>
  )
}

// ── Klantfiche ──────────────────────────────────────────────────────────────
export function KlantFiche({ clientId, maand, data, doe, vandaag, onSluit, onTaak }: {
  clientId: string; maand: string; data: CpData; doe: Doe; vandaag: string; onSluit: () => void; onTaak: (t: Taak | null, standaard?: Partial<Taak>) => void
}) {
  const inst = data.instellingen
  const klant = data.klanten.find((k) => k.id === clientId)
  const cp = data.cpKlanten.find((k) => k.client_id === clientId) ?? null
  const cyclus = data.cycli.find((c) => c.client_id === clientId && c.maand === maand) ?? null
  const eerder = data.cycli.filter((c) => c.client_id === clientId && c.maand < maand).sort((a, b) => b.maand.localeCompare(a.maand))
  const batch = data.batches.find((b) => b.id === klant?.batch_id) ?? null
  const kanBeheren = data.kan.beheren
  const [scopeVraag, setScopeVraag] = useState<Record<string, unknown> | null>(null)
  const [v, setV] = useState({
    verantwoordelijke: cp?.verantwoordelijke ?? '', goedkeuring_werkdagen: cp?.goedkeuring_werkdagen === null || cp?.goedkeuring_werkdagen === undefined ? '' : String(cp.goedkeuring_werkdagen),
    afspraken: cp?.afspraken ?? '',
  })
  const [contacten, setContacten] = useState<Contactpersoon[]>(cp?.contactpersonen ?? [])
  const [links, setLinks] = useState<CpLink[]>(cp?.links ?? [])
  const effRitme = (cyclus?.instellingen.ritme ?? cp?.ritme ?? null) as Ritme | null
  const effAct = { ...(cp?.activiteiten ?? {}), ...(cyclus?.instellingen.activiteiten ?? {}) }
  const taken = data.taken.filter((t) => t.cyclus_id && t.cyclus_id === cyclus?.id)
  const losse = data.taken.filter((t) => t.client_id === clientId && !t.cyclus_id && (!t.werkdatum || t.werkdatum.startsWith(maand)))
  const bt = beurten(maand, inst.onderdelen, { ritme: effRitme, activiteiten: effAct, batch_start_maand: batch?.start_month ?? null })
  const ontbreekt = bt.find((x) => x.aanDeBeurt === null)?.reden

  /** Ritme/activiteiten zijn terugkerend: vraag "alleen deze cyclus" of "ook toekomstige". */
  const terugkerend = (wijziging: Record<string, unknown>) => {
    if (cyclus) setScopeVraag(wijziging)
    else doe('klant.wijzig', { client_id: clientId, scope: 'toekomst', ...wijziging }, { melding: 'Ingesteld voor toekomstige cyclussen.' })
  }
  const bewaarFiche = () => doe('klant.wijzig', { client_id: clientId, verantwoordelijke: v.verantwoordelijke || null, goedkeuring_werkdagen: v.goedkeuring_werkdagen === '' ? null : Number(v.goedkeuring_werkdagen), afspraken: v.afspraken || null, contactpersonen: contacten, links }, { melding: 'Klantfiche bewaard.' })

  if (!klant) return null
  return (
    <Paneel breed titel={klant.company_name} sub={<>{cp?.actief === false ? 'Niet (meer) in de contentplanning' : `Contentplanning · ${maandNaam(maand)}`} · <Link href={`/admin/clients/${clientId}`} className="underline">klanthub</Link></>} onSluit={onSluit}>
      {!cp?.actief && kanBeheren && <button type="button" onClick={() => doe('klant.voegtoe', { client_id: clientId }, { melding: 'Toegevoegd aan de contentplanning.' })} className="btn-primary text-sm"><Plus className="h-4 w-4" />Aan de contentplanning toevoegen</button>}
      {ontbreekt && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Nog in te vullen: {ontbreekt}</div>}

      {/* Ritme en batch */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Ritme en batch</h4>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Ritme</label>
            <select className={INP} disabled={!kanBeheren} value={effRitme ?? ''} onChange={(e) => terugkerend({ ritme: e.target.value || null })}>
              <option value="">— In te vullen —</option><option value="maandelijks">Maandelijks</option><option value="driemaandelijks">Driemaandelijks</option>
            </select>
          </div>
          <div><label className={lbl}>Batch</label>
            <select className={INP} disabled={!kanBeheren} value={klant.batch_id ?? ''} onChange={(e) => doe('klant.wijzig', { client_id: clientId, batch_id: e.target.value || null }, { melding: 'Batch aangepast.' })}>
              <option value="">— Geen batch —</option>{data.batches.map((b) => <option key={b.id} value={b.id}>{b.name} · start {MAANDEN[b.start_month]}</option>)}
            </select>
          </div>
        </div>
        <details className="rounded-xl border border-gray-200 p-3">
          <summary className={`text-sm font-medium cursor-pointer ${focusRing}`}>Afspraken per activiteit</summary>
          <p className="text-[11px] text-gray-500 mt-1 mb-2">Bv. een kwartaalshoot, terwijl statistieken elke maand gebeuren. Leeg = volgt het ritme van de klant.</p>
          <div className="space-y-1.5">
            {inst.onderdelen.filter((o) => o.actief).map((o) => {
              const r = ritmeVan(o, { ritme: effRitme, activiteiten: effAct, batch_start_maand: null })
              return (
                <div key={o.key} className="grid grid-cols-[1fr_170px] gap-2 items-center text-sm">
                  <span>{o.label}{!effAct[o.key] && r ? <span className="text-gray-400 text-xs"> · {ACTIVITEIT_RITME_LABEL[r].toLowerCase()} (ritme)</span> : null}</span>
                  <select className={`${INP} py-1`} disabled={!kanBeheren} value={effAct[o.key] ?? ''} onChange={(e) => { const a = { ...effAct }; if (e.target.value) a[o.key] = e.target.value as ActiviteitRitme; else delete a[o.key]; terugkerend({ activiteiten: a }) }}>
                    <option value="">Volgt ritme</option>{(Object.keys(ACTIVITEIT_RITME_LABEL) as ActiviteitRitme[]).map((k) => <option key={k} value={k}>{ACTIVITEIT_RITME_LABEL[k]}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
        </details>
      </section>

      {/* Cyclus van deze maand */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Cyclus {maandNaam(maand)}{cyclus && cyclus.status !== 'actief' ? ` · ${cyclus.status}` : ''}</h4>
          <div className="flex gap-1.5">
            {kanBeheren && !cyclus && cp?.actief && <button type="button" onClick={() => doe('cyclus.klaarzetten', { maand, client_id: clientId }, { melding: 'Taken klaargezet.' })} className="btn-secondary text-xs">Taken klaarzetten</button>}
            {kanBeheren && cyclus && cyclus.status === 'actief' && <button type="button" onClick={() => doe('cyclus.status', { id: cyclus.id, status: 'gepauzeerd' }, { melding: 'Cyclus gepauzeerd.' })} className="btn-secondary text-xs"><Pause className="h-3.5 w-3.5" />Pauzeren</button>}
            {kanBeheren && cyclus && cyclus.status !== 'actief' && <button type="button" onClick={() => doe('cyclus.status', { id: cyclus.id, status: 'actief' }, { melding: 'Cyclus weer actief.' })} className="btn-secondary text-xs"><Play className="h-3.5 w-3.5" />Heractiveren</button>}
            {kanBeheren && cyclus && cyclus.status !== 'gearchiveerd' && <button type="button" onClick={() => doe('cyclus.status', { id: cyclus.id, status: 'gearchiveerd' }, { melding: 'Cyclus gearchiveerd.' })} className="btn-secondary text-xs"><Archive className="h-3.5 w-3.5" />Archiveren</button>}
            <button type="button" onClick={() => onTaak(null, { client_id: clientId, cyclus_id: cyclus?.id ?? null })} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Taak</button>
          </div>
        </div>
        {!cyclus && <p className="text-sm text-gray-500">Nog geen taken voor deze maand.</p>}
        <div className="space-y-1.5">
          {[...taken, ...losse].sort((a, b) => a.volgorde - b.volgorde).map((t) => (
            <TaakKaart key={t.id} t={t} klant={null} statussen={inst.statussen} vandaag={vandaag} aantalNotities={data.notities.filter((n) => n.taak_id === t.id).length} toonDatum
              onOpen={() => onTaak(t)} onVink={data.kan.aanpassen || kanBeheren ? () => doe('taak.wijzig', { id: t.id, status: isKlaar(t.status, inst.statussen) ? (t.werkdatum ? 'ingepland' : 'nog_in_te_plannen') : 'afgerond' }, { stil: true }) : undefined} />
          ))}
        </div>
      </section>

      {/* Fiche */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Afspraken en gegevens</h4>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Verantwoordelijke</label><input className={INP} list="cp-mensen-k" disabled={!kanBeheren} value={v.verantwoordelijke} onChange={(e) => setV({ ...v, verantwoordelijke: e.target.value })} /><datalist id="cp-mensen-k">{data.mensen.map((m) => <option key={m} value={m} />)}</datalist></div>
          <div><label className={lbl}>Goedkeuringstermijn (werkdagen)</label><input className={INP} inputMode="numeric" disabled={!kanBeheren} value={v.goedkeuring_werkdagen} onChange={(e) => setV({ ...v, goedkeuring_werkdagen: e.target.value.replace(/[^0-9]/g, '') })} placeholder={inst.goedkeuring_werkdagen !== null ? `standaard ${inst.goedkeuring_werkdagen}` : 'in te vullen'} /></div>
          <div className="col-span-2"><label className={lbl}>Klantspecifieke afspraken</label><textarea rows={3} className={INP} disabled={!kanBeheren} value={v.afspraken} onChange={(e) => setV({ ...v, afspraken: e.target.value })} placeholder="bv. Shoots altijd op dinsdag; content via WhatsApp." /></div>
        </div>
        <div>
          <div className="flex items-center justify-between"><label className={lbl}>Contactpersonen</label>{kanBeheren && <button type="button" onClick={() => setContacten([...contacten, { naam: '', rol: null, email: null, telefoon: null }])} className="text-xs underline">+ contact</button>}</div>
          {klant.contact_name && <p className="text-[11px] text-gray-500 mb-1">Uit de klantenlijst: {klant.contact_name}{klant.email ? ` · ${klant.email}` : ''}</p>}
          <div className="space-y-1.5">{contacten.map((c, i) => (
            <div key={i} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] gap-1.5">
              <input className={INP} placeholder="Naam" value={c.naam} disabled={!kanBeheren} onChange={(e) => setContacten(contacten.map((x, j) => (j === i ? { ...x, naam: e.target.value } : x)))} />
              <input className={INP} placeholder="Rol" value={c.rol ?? ''} disabled={!kanBeheren} onChange={(e) => setContacten(contacten.map((x, j) => (j === i ? { ...x, rol: e.target.value } : x)))} />
              <input className={INP} placeholder="E-mail" value={c.email ?? ''} disabled={!kanBeheren} onChange={(e) => setContacten(contacten.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
              <input className={INP} placeholder="Telefoon" value={c.telefoon ?? ''} disabled={!kanBeheren} onChange={(e) => setContacten(contacten.map((x, j) => (j === i ? { ...x, telefoon: e.target.value } : x)))} />
              {kanBeheren && <button type="button" onClick={() => setContacten(contacten.filter((_, j) => j !== i))} className={`h-9 w-9 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center ${focusRing}`} aria-label="Contact verwijderen"><X className="h-4 w-4" /></button>}
            </div>
          ))}</div>
        </div>
        <div>
          <div className="flex items-center justify-between"><label className={lbl}>Links naar content, mappen en tools</label>{kanBeheren && <button type="button" onClick={() => setLinks([...links, { label: '', url: '' }])} className="text-xs underline">+ link</button>}</div>
          <div className="space-y-1.5">{links.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_2fr_auto_auto] gap-1.5 items-center">
              <input className={INP} placeholder="bv. Drive-map" value={l.label} disabled={!kanBeheren} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <input className={INP} placeholder="https://…" value={l.url} disabled={!kanBeheren} onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
              {/^https?:\/\//.test(l.url) ? <a href={l.url} target="_blank" rel="noreferrer" className={`h-9 w-9 rounded-lg hover:bg-gray-100 flex items-center justify-center ${focusRing}`} aria-label="Openen"><ExternalLink className="h-4 w-4" /></a> : <span />}
              {kanBeheren && <button type="button" onClick={() => setLinks(links.filter((_, j) => j !== i))} className={`h-9 w-9 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center ${focusRing}`} aria-label="Link verwijderen"><X className="h-4 w-4" /></button>}
            </div>
          ))}</div>
        </div>
        {kanBeheren && <div className="flex justify-end"><button type="button" onClick={bewaarFiche} className="btn-primary text-sm">Klantfiche bewaren</button></div>}
      </section>

      <Notities titel="Notities en herinneringen" notities={data.notities.filter((n) => n.client_id === clientId && !n.taak_id && (n.soort !== 'cyclus' || !n.maand || n.maand === maand))}
        standaard={{ client_id: clientId, cyclus_id: cyclus?.id ?? null, maand, soort: 'cyclus' }} doe={doe} kanSchrijven={data.kan.aanpassen || kanBeheren} />

      {eerder.length > 0 && (
        <section>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Eerdere cyclussen</h4>
          <ul className="text-sm divide-y divide-gray-100 rounded-xl border border-gray-200">{eerder.map((c) => {
            const tk = data.taken.filter((t) => t.cyclus_id === c.id)
            return <li key={c.id} className="px-3 py-2 flex justify-between gap-2"><span className="capitalize">{maandNaam(c.maand)}{c.status !== 'actief' ? ` · ${c.status}` : ''}</span><span className="text-gray-500">{tk.filter((t) => isKlaar(t.status, inst.statussen)).length}/{tk.length} afgerond</span></li>
          })}</ul>
        </section>
      )}

      {kanBeheren && cp?.actief && <button type="button" onClick={async () => { if (await doe('klant.verwijder', { client_id: clientId }, { melding: `${klant.company_name} uit de contentplanning gehaald. De klant blijft in de rest van de app.` })) onSluit() }} className="text-xs text-red-600 underline">Uit de contentplanning halen</button>}

      {scopeVraag && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/30" role="dialog" aria-modal="true">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <h4 className="font-semibold">Voor welke cyclussen?</h4>
            <p className="text-sm text-gray-600">Dit is een terugkerende instelling. Eerdere cyclussen veranderen nooit.</p>
            <div className="grid gap-2">
              <button type="button" className="btn-secondary text-sm justify-center" onClick={async () => { await doe('klant.wijzig', { client_id: clientId, scope: 'cyclus', cyclus_id: cyclus!.id, ...scopeVraag }, { melding: `Enkel voor ${maandNaam(maand)} aangepast.` }); setScopeVraag(null) }}>Alleen deze cyclus ({maandNaam(maand)})</button>
              <button type="button" className="btn-primary text-sm justify-center" onClick={async () => { await doe('klant.wijzig', { client_id: clientId, scope: 'toekomst', ...scopeVraag }, { melding: 'Aangepast, ook voor toekomstige cyclussen.' }); setScopeVraag(null) }}>Ook toekomstige cyclussen</button>
              <button type="button" className="text-xs text-gray-500 underline" onClick={() => setScopeVraag(null)}>Annuleren</button>
            </div>
          </div>
        </div>
      )}
    </Paneel>
  )
}

// ── Instellingen (apart paneel) ─────────────────────────────────────────────
const KLEUREN: { label: string; cls: string }[] = [
  { label: 'Wit', cls: 'bg-white text-gray-800 border-gray-300' }, { label: 'Blauw', cls: 'bg-blue-50 text-blue-800 border-blue-300' },
  { label: 'Geel', cls: 'bg-amber-50 text-amber-900 border-amber-300' }, { label: 'Paars', cls: 'bg-purple-50 text-purple-800 border-purple-300' },
  { label: 'Rood', cls: 'bg-red-50 text-red-800 border-red-300' }, { label: 'Donkergroen', cls: 'bg-[#166534] text-white border-[#166534]' }, { label: 'Grijs', cls: 'bg-gray-100 text-gray-500 border-gray-200' },
]
const VASTE_STATUSSEN = ['nog_in_te_plannen', 'ingepland', 'in_uitvoering', 'wacht_op_klant', 'afgerond', 'nvt']

export function InstellingenPaneel({ data, doe, onSluit }: { data: CpData; doe: Doe; onSluit: () => void }) {
  const [tab, setTab] = useState<'onderdelen' | 'statussen' | 'termijnen' | 'reeksen' | 'batches' | 'routine'>('onderdelen')
  const [v, setV] = useState<CpInstellingen>(data.instellingen)
  const [bezig, setBezig] = useState(false)
  const vuil = useMemo(() => JSON.stringify(v) !== JSON.stringify(data.instellingen), [v, data.instellingen])
  const zetO = (i: number, d: Partial<Onderdeel>) => setV({ ...v, onderdelen: v.onderdelen.map((o, j) => (j === i ? { ...o, ...d } : o)) })
  const zetS = (i: number, d: Partial<Status>) => setV({ ...v, statussen: v.statussen.map((s, j) => (j === i ? { ...s, ...d } : s)) })
  const zetR = (i: number, d: Partial<Routine>) => setV({ ...v, routine: v.routine.map((r, j) => (j === i ? { ...r, ...d } : r)) })
  const bewaar = async () => { setBezig(true); await doe('instellingen.opslaan', { instellingen: v }, { melding: 'Instellingen bewaard.' }); setBezig(false) }
  const TABS = [['onderdelen', 'Onderdelen'], ['statussen', 'Statussen'], ['termijnen', 'Termijnen'], ['reeksen', 'Reeksen'], ['batches', 'Batches'], ['routine', v.routine_naam || 'Routine']] as const
  return (
    <Paneel breed titel="Instellingen contentplanning" sub="Een aanpasbaar vertrekpunt — enkel voor wie de planning beheert." onSluit={onSluit}>
      <div className="flex gap-1 flex-wrap">{TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${tab === k ? 'bg-black text-white' : 'bg-gray-100 text-gray-700'} ${focusRing}`}>{l}</button>)}</div>

      {tab === 'onderdelen' && (
        <section className="space-y-2">
          <p className="text-[11px] text-gray-500">Onderdelen worden per cyclus als taken klaargezet. Wijzigingen gelden voor cyclussen die nog klaargezet worden; bestaande taken blijven zoals ze zijn.</p>
          {v.onderdelen.map((o, i) => (
            <div key={o.key} className="grid grid-cols-[auto_1fr_110px_130px_auto] gap-1.5 items-center">
              <input type="checkbox" checked={o.actief} onChange={(e) => zetO(i, { actief: e.target.checked })} aria-label={`${o.label} actief`} />
              <input className={INP} value={o.label} onChange={(e) => zetO(i, { label: e.target.value })} />
              <select className={INP} value={o.reeks ?? ''} onChange={(e) => zetO(i, { reeks: e.target.value ? (Number(e.target.value) as Reeks) : null })}><option value="">Geen reeks</option>{REEKSEN.map((r) => <option key={r.nr} value={r.nr}>{r.kort}</option>)}</select>
              <select className={INP} value={o.standaard} onChange={(e) => zetO(i, { standaard: e.target.value as ActiviteitRitme })}>{(Object.keys(ACTIVITEIT_RITME_LABEL) as ActiviteitRitme[]).map((k) => <option key={k} value={k}>{ACTIVITEIT_RITME_LABEL[k]}</option>)}</select>
              <button type="button" onClick={() => setV({ ...v, onderdelen: v.onderdelen.filter((_, j) => j !== i) })} className={`h-9 w-9 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center ${focusRing}`} aria-label="Onderdeel verwijderen"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <button type="button" onClick={() => setV({ ...v, onderdelen: [...v.onderdelen, { key: `eigen_${Date.now().toString(36)}`, label: 'Nieuw onderdeel', reeks: null, standaard: 'elke_cyclus', actief: true }] })} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Onderdeel toevoegen</button>
        </section>
      )}
      {tab === 'statussen' && (
        <section className="space-y-2">
          <p className="text-[11px] text-gray-500">Labels en kleuren zijn vrij. De zes standaardstatussen blijven bestaan (je kunt ze hernoemen); eigen statussen kun je toevoegen en verwijderen. “Telt als klaar” = afgevinkt.</p>
          {v.statussen.map((s, i) => (
            <div key={s.key} className="grid grid-cols-[1fr_130px_auto_auto] gap-1.5 items-center">
              <input className={INP} value={s.label} onChange={(e) => zetS(i, { label: e.target.value })} />
              <select className={INP} value={s.kleur} onChange={(e) => zetS(i, { kleur: e.target.value })}>{KLEUREN.map((k) => <option key={k.cls} value={k.cls}>{k.label}</option>)}{!KLEUREN.some((k) => k.cls === s.kleur) && <option value={s.kleur}>Eigen</option>}</select>
              <label className="text-xs flex items-center gap-1"><input type="checkbox" checked={s.klaar} disabled={VASTE_STATUSSEN.includes(s.key)} onChange={(e) => zetS(i, { klaar: e.target.checked })} />klaar</label>
              {VASTE_STATUSSEN.includes(s.key) ? <span className="w-9" /> : <button type="button" onClick={() => setV({ ...v, statussen: v.statussen.filter((_, j) => j !== i) })} className={`h-9 w-9 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center ${focusRing}`} aria-label="Status verwijderen"><Trash2 className="h-4 w-4" /></button>}
            </div>
          ))}
          <div className="flex items-center gap-2"><button type="button" onClick={() => setV({ ...v, statussen: [...v.statussen, { key: `eigen_${Date.now().toString(36)}`, label: 'Nieuwe status', kleur: KLEUREN[0].cls, klaar: false }] })} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Status toevoegen</button>
            <span className="text-xs text-gray-500">Voorbeeld: {v.statussen.slice(0, 3).map((s) => <StatusBadge key={s.key} status={s.key} statussen={v.statussen} klein />)}</span></div>
        </section>
      )}
      {tab === 'termijnen' && (
        <section className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Termijn voor aanpassingen (werkdagen)</label><input className={INP} inputMode="numeric" value={String(v.aanpassing_werkdagen)} onChange={(e) => setV({ ...v, aanpassing_werkdagen: Number(e.target.value.replace(/[^0-9]/g, '') || 0) })} /><p className="text-[11px] text-gray-500 mt-1">Telt vanaf het moment dat je bij de taak “feedback ontvangen op” invult.</p></div>
          <div><label className={lbl}>Standaard goedkeuringstermijn (werkdagen)</label><input className={INP} inputMode="numeric" value={v.goedkeuring_werkdagen === null ? '' : String(v.goedkeuring_werkdagen)} onChange={(e) => setV({ ...v, goedkeuring_werkdagen: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9]/g, '') || 0) })} placeholder="per klant" /><p className="text-[11px] text-gray-500 mt-1">Leeg = per klant in te vullen (klantfiche). Telt vanaf “verstuurd voor goedkeuring”.</p></div>
        </section>
      )}
      {tab === 'reeksen' && (
        <section className="space-y-2">
          <p className="text-[11px] text-gray-500">De reeksen per dag komen uit de Maandplanning (welke fase op welke werkdag). Hier kies je welke fase bij welke reeks hoort.</p>
          {FASE_KEYS.map((f) => (
            <div key={f} className="grid grid-cols-[1fr_140px] gap-2 items-center text-sm">
              <span>{FASE_LABEL[f]}</span>
              <select className={INP} value={v.fase_reeks[f] ?? ''} onChange={(e) => { const m = { ...v.fase_reeks }; if (e.target.value) m[f] = Number(e.target.value) as Reeks; else delete m[f]; setV({ ...v, fase_reeks: m }) }}><option value="">Geen</option>{REEKSEN.map((r) => <option key={r.nr} value={r.nr}>{r.kort}</option>)}</select>
            </div>
          ))}
          <Link href="/admin/maandplanning" className="btn-secondary text-xs w-fit"><ExternalLink className="h-3.5 w-3.5" />Reeksen per dag aanpassen (Maandplanning)</Link>
        </section>
      )}
      {tab === 'batches' && <BatchBeheer batches={data.batches} doe={doe} />}
      {tab === 'routine' && (
        <section className="space-y-3">
          <div><label className={lbl}>Naam van de routine</label><input className={INP} value={v.routine_naam} onChange={(e) => setV({ ...v, routine_naam: e.target.value })} /></div>
          {v.routine.map((r, i) => (
            <div key={r.key} className="rounded-xl border border-gray-200 p-2.5 space-y-1.5">
              <div className="flex gap-1.5"><input className={INP} value={r.titel} onChange={(e) => zetR(i, { titel: e.target.value })} /><button type="button" onClick={() => setV({ ...v, routine: v.routine.filter((_, j) => j !== i) })} className={`h-9 w-9 shrink-0 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center ${focusRing}`} aria-label="Check verwijderen"><Trash2 className="h-4 w-4" /></button></div>
              <div className="flex gap-1 flex-wrap">{DAG_KORT.map((d, j) => { const nr = j + 1; const aan = r.dagen.includes(nr); return <button key={d} type="button" aria-pressed={aan} onClick={() => zetR(i, { dagen: aan ? r.dagen.filter((x) => x !== nr) : [...r.dagen, nr].sort() })} className={`h-7 w-9 rounded-md text-xs font-medium border ${aan ? 'bg-black text-white border-black' : 'bg-white border-gray-200'} ${focusRing}`}>{d}</button> })}</div>
            </div>
          ))}
          <button type="button" onClick={() => setV({ ...v, routine: [...v.routine, { key: `r_${Date.now().toString(36)}`, titel: 'Nieuwe check', dagen: [1, 2, 3, 4, 5] }] })} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Check toevoegen</button>
          <div>
            <div className="flex items-center justify-between"><label className={lbl}>Links</label><button type="button" onClick={() => setV({ ...v, routine_links: [...v.routine_links, { label: '', url: '' }] })} className="text-xs underline">+ link</button></div>
            <div className="space-y-1.5">{v.routine_links.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-1.5"><input className={INP} value={l.label} onChange={(e) => setV({ ...v, routine_links: v.routine_links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /><input className={INP} value={l.url} onChange={(e) => setV({ ...v, routine_links: v.routine_links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} /><button type="button" onClick={() => setV({ ...v, routine_links: v.routine_links.filter((_, j) => j !== i) })} className={`h-9 w-9 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center ${focusRing}`} aria-label="Link verwijderen"><X className="h-4 w-4" /></button></div>
            ))}</div>
            <p className="text-[11px] text-gray-500 mt-1">Vervang de algemene links door jullie eigen werkruimte (bv. de Notion-pagina). De app kent de inhoud of ‘Ready’-status daar niet; je registreert je controle zelf.</p>
          </div>
        </section>
      )}
      {tab !== 'batches' && <div className="flex justify-end gap-2 border-t border-gray-100 pt-3"><button type="button" onClick={() => setV(data.instellingen)} disabled={!vuil} className="btn-secondary text-sm">Wijzigingen terugdraaien</button><button type="button" onClick={bewaar} disabled={!vuil || bezig} className="btn-primary text-sm">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button></div>}
    </Paneel>
  )
}

function BatchBeheer({ batches, doe }: { batches: Batch[]; doe: Doe }) {
  const [nieuw, setNieuw] = useState({ name: '', color: '#112546', start_month: '' })
  return (
    <section className="space-y-2">
      <p className="text-[11px] text-gray-500">Batches groeperen klanten per kwartaal. De startmaand bepaalt welke maanden kwartaalmaanden zijn (start + 3, + 6, + 9).</p>
      {batches.map((b) => (
        <div key={b.id} className="grid grid-cols-[40px_1fr_140px_auto] gap-1.5 items-center">
          <input type="color" defaultValue={b.color} onBlur={(e) => e.target.value !== b.color && doe('batch.wijzig', { id: b.id, color: e.target.value }, { stil: true })} className="h-9 w-10 rounded" aria-label="Kleur" />
          <input className={INP} defaultValue={b.name} onBlur={(e) => e.target.value !== b.name && doe('batch.wijzig', { id: b.id, name: e.target.value }, { melding: 'Batch bewaard.' })} />
          <select className={INP} defaultValue={b.start_month} onChange={(e) => doe('batch.wijzig', { id: b.id, start_month: Number(e.target.value) }, { melding: 'Startmaand bewaard.' })}>{MAANDEN.map((m, i) => <option key={m} value={i}>start {m}</option>)}</select>
          <button type="button" onClick={() => doe('batch.verwijder', { id: b.id }, { melding: 'Batch verwijderd.' })} className={`h-9 w-9 rounded-lg hover:bg-red-50 text-red-600 flex items-center justify-center ${focusRing}`} aria-label="Batch verwijderen"><Trash2 className="h-4 w-4" /></button>
        </div>
      ))}
      <div className="grid grid-cols-[40px_1fr_140px_auto] gap-1.5 items-center pt-2 border-t border-gray-100">
        <input type="color" value={nieuw.color} onChange={(e) => setNieuw({ ...nieuw, color: e.target.value })} className="h-9 w-10 rounded" aria-label="Kleur nieuwe batch" />
        <input className={INP} placeholder="Nieuwe batch" value={nieuw.name} onChange={(e) => setNieuw({ ...nieuw, name: e.target.value })} />
        <select className={INP} value={nieuw.start_month} onChange={(e) => setNieuw({ ...nieuw, start_month: e.target.value })}><option value="">Startmaand…</option>{MAANDEN.map((m, i) => <option key={m} value={i}>start {m}</option>)}</select>
        <button type="button" disabled={!nieuw.name.trim() || nieuw.start_month === ''} onClick={async () => { if (await doe('batch.maak', { name: nieuw.name, color: nieuw.color, start_month: Number(nieuw.start_month) }, { melding: 'Batch toegevoegd.' })) setNieuw({ name: '', color: '#112546', start_month: '' }) }} className="btn-primary text-xs"><Plus className="h-3.5 w-3.5" />Toevoegen</button>
      </div>
    </section>
  )
}

