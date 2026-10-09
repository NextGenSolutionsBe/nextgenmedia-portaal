'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Search, Loader2, Camera, Package, ArrowUpRight, Undo2, Users, History, Pencil, Archive, RotateCcw, Mail, AlertTriangle, Layers } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import { STATUS, ACTIVITEIT_LABEL, MAIL_LABEL, itemStatus, typeLabel, naamVan, datumKort, datumTijd, datumLang, vandaagBE, type ItemStatus } from '@/lib/materiaal/model'
import { Modal, UitleenDialoog, TerugDialoog, ItemFormulier, OntlenerFormulier, CorrectieDialoog, focusRing } from './dialogen'
import type { Activiteit, Data, Doe, Item, Ontlener, Uitlening } from './types'

/**
 * Materiaalbeheer — wat hebben we, wat is beschikbaar, wie heeft wat sinds
 * wanneer. Kern: Beschikbaar → Uitlenen → medewerker → Bevestigen;
 * Uitgeleend → Terugnemen → Bevestigen. Vier tabbladen, geen extra pagina's.
 */

type Tab = 'materiaal' | 'uitgeleend' | 'medewerkers' | 'activiteiten'
const TABS: { key: Tab; label: string; icon: typeof Package }[] = [
  { key: 'materiaal', label: 'Materiaal', icon: Package }, { key: 'uitgeleend', label: 'Uitgeleend', icon: ArrowUpRight },
  { key: 'medewerkers', label: 'Medewerkers', icon: Users }, { key: 'activiteiten', label: 'Activiteiten', icon: History },
]
type Venster =
  | { soort: 'uitlenen'; items: Item[]; ontlenerId?: string; meerdere?: boolean }
  | { soort: 'terug'; uitlening: Uitlening }
  | { soort: 'item'; id: string }
  | { soort: 'itemForm'; item: Item | null }
  | { soort: 'ontlener'; id: string }
  | { soort: 'ontlenerForm'; ontlener: Ontlener | null }
  | { soort: 'activiteit'; a: Activiteit }
  | { soort: 'correctie'; uitlening: Uitlening }
  | null

function StatusChip({ s }: { s: ItemStatus }) {
  const i = STATUS[s]
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${i.cls}`}><span className={`h-1.5 w-1.5 rounded-full ${i.stip}`} />{i.label}</span>
}
function Foto({ item, groot }: { item: Item; groot?: boolean }) {
  return item.foto_url
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={item.foto_url} alt="" className={`${groot ? 'h-40 w-full sm:w-56' : 'h-9 w-9'} rounded-lg object-cover bg-gray-100 shrink-0`} />
    : <div className={`${groot ? 'h-40 w-full sm:w-56' : 'h-9 w-9'} rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 shrink-0`}><Camera className={groot ? 'h-8 w-8' : 'h-4 w-4'} /></div>
}
function MailStatus({ s, fout }: { s: string | null; fout?: string | null }) {
  if (!s) return null
  const m = MAIL_LABEL[s] ?? { label: s, cls: 'text-gray-600' }
  return <span className={`inline-flex items-center gap-1 text-[11px] ${m.cls}`} title={fout ?? undefined}><Mail className="h-3 w-3" />{m.label}</span>
}

export function MateriaalClient({ startData = null, startTab }: { startData?: Data | null; startTab?: Tab } = {}) {
  const [data, setData] = useState<Data | null>(startData)
  const [fout, setFout] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(startTab ?? 'materiaal')
  const [venster, setVenster] = useState<Venster>(null)
  const [zoek, setZoek] = useState('')
  const [filter, setFilter] = useState<'alles' | 'beschikbaar' | 'uitgeleend'>('alles')
  const [toonArchief, setToonArchief] = useState(false)
  const vandaag = vandaagBE()

  const laad = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/materiaal', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      setData(j); setFout(null)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])
  useEffect(() => { try { const t = sessionStorage.getItem('ngm-materiaal-tab') as Tab | null; if (t && TABS.some((x) => x.key === t)) setTab(t) } catch { /* */ } }, [])
  useEffect(() => { try { sessionStorage.setItem('ngm-materiaal-tab', tab) } catch { /* */ } }, [tab])

  const doe: Doe = useCallback(async (actie, body = {}, opts = {}) => {
    try {
      const r = await fetch('/api/admin/materiaal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie, ...body }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Mislukt')
      if (!opts.stil) toast.success('Bewaard.')
      await laad()
      return j
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); await laad(); return null }
  }, [laad])

  // ── Afgeleid ──
  const actiefPerItem = useMemo(() => new Map((data?.uitleningen ?? []).filter((u) => !u.teruggebracht_op && !u.geannuleerd_op).map((u) => [u.item_id, u])), [data])
  const ontlenerMap = useMemo(() => new Map((data?.ontleners ?? []).map((o) => [o.id, o])), [data])
  const itemMap = useMemo(() => new Map((data?.items ?? []).map((i) => [i.id, i])), [data])
  const catMap = useMemo(() => new Map((data?.categorieen ?? []).map((c) => [c.id, c.naam])), [data])
  const statusVan = useCallback((i: Item) => itemStatus(i, actiefPerItem.get(i.id), vandaag), [actiefPerItem, vandaag])
  const actieveItems = (data?.items ?? []).filter((i) => !i.gearchiveerd_op)
  const uitgeleend = actieveItems.filter((i) => actiefPerItem.has(i.id))
  const teLaat = uitgeleend.filter((i) => statusVan(i) === 'te_laat').length
  const q = zoek.trim().toLowerCase()
  const zichtbaar = (data?.items ?? []).filter((i) => {
    if (i.gearchiveerd_op && !toonArchief) return false
    const s = statusVan(i)
    if (filter === 'beschikbaar' && s !== 'beschikbaar') return false
    if (filter === 'uitgeleend' && s !== 'uitgeleend' && s !== 'te_laat') return false
    if (!q) return true
    const u = actiefPerItem.get(i.id)
    return `${i.naam} ${i.merk ?? ''} ${i.model ?? ''} ${i.serienummer ?? ''} ${catMap.get(i.categorie_id ?? '') ?? ''} ${u ? naamVan(ontlenerMap.get(u.ontlener_id)) : ''}`.toLowerCase().includes(q)
  })
  const kan = data?.kan

  const ActieKnop = ({ i }: { i: Item }) => {
    if (!kan?.uitlenen || i.gearchiveerd_op) return null
    const u = actiefPerItem.get(i.id)
    return u
      ? <button type="button" onClick={(e) => { e.stopPropagation(); setVenster({ soort: 'terug', uitlening: u }) }} className={`btn-secondary text-xs whitespace-nowrap ${focusRing}`}><Undo2 className="h-3.5 w-3.5" />Terugnemen</button>
      : <button type="button" onClick={(e) => { e.stopPropagation(); setVenster({ soort: 'uitlenen', items: [i] }) }} className={`btn-primary text-xs whitespace-nowrap ${focusRing}`}><ArrowUpRight className="h-3.5 w-3.5" />Uitlenen</button>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Materiaalbeheer</h1>
          <p className="text-sm text-gray-500">Wat hebben we, wat is beschikbaar en wie heeft wat sinds wanneer.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {kan?.uitlenen && <button type="button" onClick={() => setVenster({ soort: 'uitlenen', items: [], meerdere: true })} className={`btn-secondary text-sm ${focusRing}`}><Layers className="h-4 w-4" />Meerdere uitlenen</button>}
          {kan?.beheren && <button type="button" onClick={() => setVenster({ soort: 'itemForm', item: null })} className={`btn-primary text-sm ${focusRing}`}><Plus className="h-4 w-4" />Materiaal toevoegen</button>}
        </div>
      </div>

      {/* KPI's */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[
          { label: 'Totaal materiaal', waarde: actieveItems.length, cls: 'text-gray-900', f: 'alles' as const },
          { label: 'Beschikbaar', waarde: actieveItems.length - uitgeleend.length, cls: 'text-green-700', f: 'beschikbaar' as const },
          { label: 'Uitgeleend', waarde: uitgeleend.length, cls: 'text-orange-700', f: 'uitgeleend' as const, sub: teLaat ? `${teLaat} te laat` : null },
        ].map((k) => (
          <button key={k.label} type="button" onClick={() => { setTab('materiaal'); setFilter(k.f) }} className={`card-base p-3 text-left hover:border-gray-400 ${focusRing}`}>
            <div className="text-[11px] sm:text-xs text-gray-500">{k.label}</div>
            <div className={`text-2xl font-bold tabular-nums ${k.cls}`}>{data ? k.waarde : '—'}</div>
            {k.sub && <div className="text-[11px] text-red-700 font-medium flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{k.sub}</div>}
          </button>
        ))}
      </div>

      <div role="tablist" aria-label="Materiaalbeheer" className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 max-w-full overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${tab === t.key ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'} ${focusRing}`}><t.icon className="h-4 w-4" />{t.label}{t.key === 'uitgeleend' && uitgeleend.length > 0 && <span className={`text-xs ${tab === t.key ? 'text-[#fff848]' : 'text-gray-500'}`}>{uitgeleend.length}</span>}</button>
        ))}
      </div>

      {fout && <div className="card-base text-sm text-red-700 bg-red-50 border-red-100 flex items-center gap-2">{fout}<button type="button" onClick={laad} className="btn-secondary text-xs ml-auto">Opnieuw</button></div>}
      {!data && !fout && <div className="card-base py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>}

      {data && tab === 'materiaal' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md"><Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" /><input className={`${INP} pl-9`} placeholder="Zoek materiaal of medewerker…" value={zoek} onChange={(e) => setZoek(e.target.value)} aria-label="Zoeken" /></div>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {(['alles', 'beschikbaar', 'uitgeleend'] as const).map((f) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize ${filter === f ? 'bg-black text-white' : 'text-gray-600 hover:bg-white'} ${focusRing}`}>{f}</button>)}
            </div>
            <label className="text-xs text-gray-600 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={toonArchief} onChange={(e) => setToonArchief(e.target.checked)} />Gearchiveerd tonen</label>
          </div>
          {zichtbaar.length === 0 ? (
            <div className="card-base py-10 text-center text-sm text-gray-500">{data.items.length === 0 ? <>Nog geen materiaal geregistreerd.{kan?.beheren && <> Klik op <b>Materiaal toevoegen</b>.</>}</> : 'Niets gevonden.'}</div>
          ) : (
            <>
              {/* Computer: tabel */}
              <div className="hidden md:block card-base p-0 overflow-hidden">
                <table className="w-full text-sm">
                  <thead><tr className="bg-gray-50 border-b border-gray-200 text-left text-xs text-gray-500"><th className="px-3 py-2 font-medium">Materiaal</th><th className="px-3 py-2 font-medium">Categorie</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Momenteel bij</th><th className="px-3 py-2 font-medium text-right">Actie</th></tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {zichtbaar.map((i) => {
                      const u = actiefPerItem.get(i.id)
                      return (
                        <tr key={i.id} onClick={() => setVenster({ soort: 'item', id: i.id })} className="hover:bg-gray-50 cursor-pointer">
                          <td className="px-3 py-2"><div className="flex items-center gap-2.5"><Foto item={i} /><div className="min-w-0"><div className="font-medium truncate">{i.naam}</div><div className="text-[11px] text-gray-500 truncate">{[i.merk, i.model, i.serienummer].filter(Boolean).join(' · ')}</div></div></div></td>
                          <td className="px-3 py-2 text-gray-600">{catMap.get(i.categorie_id ?? '') ?? '—'}</td>
                          <td className="px-3 py-2"><StatusChip s={statusVan(i)} /></td>
                          <td className="px-3 py-2">{u ? <div><div className="font-medium">{naamVan(ontlenerMap.get(u.ontlener_id))}</div><div className="text-[11px] text-gray-500">sinds {datumKort(u.uitgeleend_op)}{u.verwacht_terug ? ` · terug ${datumKort(u.verwacht_terug)}` : ''}</div></div> : <span className="text-gray-400">—</span>}</td>
                          <td className="px-3 py-2 text-right"><ActieKnop i={i} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Telefoon: kaarten */}
              <div className="md:hidden space-y-2">
                {zichtbaar.map((i) => {
                  const u = actiefPerItem.get(i.id)
                  return (
                    <div key={i.id} onClick={() => setVenster({ soort: 'item', id: i.id })} className="card-base p-3 flex items-center gap-3 cursor-pointer">
                      <Foto item={i} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate">{i.naam}</div>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap"><StatusChip s={statusVan(i)} />{u && <span className="text-[11px] text-gray-600 truncate">{naamVan(ontlenerMap.get(u.ontlener_id))} · {datumKort(u.uitgeleend_op)}</span>}</div>
                      </div>
                      <ActieKnop i={i} />
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {data && tab === 'uitgeleend' && <UitgeleendTab data={data} actiefPerItem={actiefPerItem} itemMap={itemMap} statusVan={statusVan} onTerug={(u) => setVenster({ soort: 'terug', uitlening: u })} onOntlener={(id) => setVenster({ soort: 'ontlener', id })} onMeer={(id) => setVenster({ soort: 'uitlenen', items: [], ontlenerId: id, meerdere: true })} />}
      {data && tab === 'medewerkers' && <MedewerkersTab data={data} onOpen={(id) => setVenster({ soort: 'ontlener', id })} onNieuw={() => setVenster({ soort: 'ontlenerForm', ontlener: null })} />}
      {data && tab === 'activiteiten' && <ActiviteitenTab data={data} itemMap={itemMap} ontlenerMap={ontlenerMap} onOpen={(a) => setVenster({ soort: 'activiteit', a })} />}

      {/* ── Vensters ── */}
      {data && venster?.soort === 'uitlenen' && <UitleenDialoog data={data} items={venster.items} ontlenerId={venster.ontlenerId} meerdere={venster.meerdere} doe={doe} onSluit={() => setVenster(null)} />}
      {data && venster?.soort === 'terug' && itemMap.get(venster.uitlening.item_id) && <TerugDialoog item={itemMap.get(venster.uitlening.item_id)!} uitlening={venster.uitlening} ontlener={ontlenerMap.get(venster.uitlening.ontlener_id)} doe={doe} onSluit={() => setVenster(null)} />}
      {data && venster?.soort === 'itemForm' && <ItemFormulier data={data} item={venster.item} doe={doe} onSluit={() => setVenster(null)} />}
      {data && venster?.soort === 'ontlenerForm' && <OntlenerFormulier ontlener={venster.ontlener} doe={doe} onSluit={() => setVenster(null)} />}
      {data && venster?.soort === 'correctie' && <CorrectieDialoog uitlening={venster.uitlening} item={itemMap.get(venster.uitlening.item_id)} doe={doe} onSluit={() => setVenster(null)} />}
      {data && venster?.soort === 'item' && itemMap.get(venster.id) && (
        <ItemDetail data={data} item={itemMap.get(venster.id)!} status={statusVan(itemMap.get(venster.id)!)} catNaam={catMap.get(itemMap.get(venster.id)!.categorie_id ?? '') ?? '—'} ontlenerMap={ontlenerMap} doe={doe}
          onSluit={() => setVenster(null)} onVenster={setVenster} />
      )}
      {data && venster?.soort === 'ontlener' && ontlenerMap.get(venster.id) && (
        <OntlenerDetail data={data} o={ontlenerMap.get(venster.id)!} itemMap={itemMap} doe={doe} onSluit={() => setVenster(null)} onVenster={setVenster} />
      )}
      {data && venster?.soort === 'activiteit' && (
        <ActiviteitDetail data={data} a={venster.a} itemMap={itemMap} ontlenerMap={ontlenerMap} doe={doe} onSluit={() => setVenster(null)} onVenster={setVenster} />
      )}
    </div>
  )
}

// ── Uitgeleend: wat ligt bij wie ────────────────────────────────────────────
function UitgeleendTab({ data, actiefPerItem, itemMap, statusVan, onTerug, onOntlener, onMeer }: {
  data: Data; actiefPerItem: Map<string, Uitlening>; itemMap: Map<string, Item>; statusVan: (i: Item) => ItemStatus
  onTerug: (u: Uitlening) => void; onOntlener: (id: string) => void; onMeer: (id: string) => void
}) {
  const perPersoon = new Map<string, Uitlening[]>()
  for (const u of actiefPerItem.values()) { const l = perPersoon.get(u.ontlener_id) ?? []; l.push(u); perPersoon.set(u.ontlener_id, l) }
  const groepen = [...perPersoon.entries()].map(([id, l]) => ({ o: data.ontleners.find((x) => x.id === id), l: l.sort((a, b) => a.uitgeleend_op.localeCompare(b.uitgeleend_op)) })).sort((a, b) => naamVan(a.o).localeCompare(naamVan(b.o), 'nl'))
  if (!groepen.length) return <div className="card-base py-10 text-center text-sm text-gray-500">Er is momenteel niets uitgeleend.</div>
  return (
    <div className="grid md:grid-cols-2 gap-3">
      {groepen.map(({ o, l }) => (
        <section key={o?.id ?? 'x'} className="card-base p-0 overflow-hidden">
          <div className="px-3 py-2.5 bg-orange-50 border-b border-orange-100 flex items-center gap-2">
            <button type="button" onClick={() => o && onOntlener(o.id)} className={`font-semibold text-sm hover:underline text-left ${focusRing} rounded`}>{naamVan(o)}</button>
            {o?.type && <span className="text-[11px] text-gray-600">{typeLabel(o.type)}</span>}
            <span className="ml-auto text-[11px] text-orange-800">{l.length} item{l.length === 1 ? '' : 's'}</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {l.map((u) => { const i = itemMap.get(u.item_id); return (
              <li key={u.id} className="px-3 py-2 flex items-center gap-2.5">
                {i && <Foto item={i} />}
                <div className="min-w-0 flex-1"><div className="text-sm font-medium truncate">{i?.naam ?? 'Materiaal'}</div><div className="text-[11px] text-gray-500">sinds {datumKort(u.uitgeleend_op)}{u.verwacht_terug ? ` · terug ${datumKort(u.verwacht_terug)}` : ''}</div></div>
                {i && statusVan(i) === 'te_laat' && <StatusChip s="te_laat" />}
                {data.kan.uitlenen && <button type="button" onClick={() => onTerug(u)} className={`btn-secondary text-xs ${focusRing}`}><Undo2 className="h-3.5 w-3.5" />Terugnemen</button>}
              </li>
            ) })}
          </ul>
          {data.kan.uitlenen && o && <div className="px-3 py-2 border-t border-gray-100"><button type="button" onClick={() => onMeer(o.id)} className="text-xs underline text-gray-600">Meer materiaal uitlenen aan {o.voornaam}</button></div>}
        </section>
      ))}
    </div>
  )
}

// ── Medewerkers ─────────────────────────────────────────────────────────────
function MedewerkersTab({ data, onOpen, onNieuw }: { data: Data; onOpen: (id: string) => void; onNieuw: () => void }) {
  const [q, setQ] = useState('')
  const [archief, setArchief] = useState(false)
  const inGebruik = new Map<string, number>()
  for (const u of data.uitleningen) if (!u.teruggebracht_op && !u.geannuleerd_op) inGebruik.set(u.ontlener_id, (inGebruik.get(u.ontlener_id) ?? 0) + 1)
  const lijst = data.ontleners.filter((o) => (archief || !o.gearchiveerd_op) && `${naamVan(o)} ${o.email ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md"><Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" /><input className={`${INP} pl-9`} placeholder="Zoek medewerker…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Zoek medewerker" /></div>
        <label className="text-xs text-gray-600 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={archief} onChange={(e) => setArchief(e.target.checked)} />Gearchiveerd tonen</label>
        {data.kan.beheren && <button type="button" onClick={onNieuw} className={`btn-primary text-sm ml-auto ${focusRing}`}><Plus className="h-4 w-4" />Medewerker toevoegen</button>}
      </div>
      <p className="text-[11px] text-gray-500">Iedereen uit Personeel staat hier automatisch. Externe freelancers zonder account voeg je zelf toe.</p>
      <div className="card-base p-0 divide-y divide-gray-100">
        {lijst.map((o) => (
          <button key={o.id} type="button" onClick={() => onOpen(o.id)} className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-center gap-3 flex-wrap ${o.gearchiveerd_op ? 'opacity-60' : ''} ${focusRing}`}>
            <div className="min-w-0 flex-1"><div className="text-sm font-medium">{naamVan(o)}{o.gearchiveerd_op && <span className="text-[11px] text-gray-500"> · gearchiveerd</span>}</div><div className="text-[11px] text-gray-500 truncate">{[typeLabel(o.type), o.email ?? 'geen e-mailadres', o.personeel_id ? 'uit Personeel' : 'extern'].filter(Boolean).join(' · ')}</div></div>
            {(inGebruik.get(o.id) ?? 0) > 0 ? <span className="rounded-full border border-orange-300 bg-orange-50 px-2 py-0.5 text-[11px] text-orange-800">{inGebruik.get(o.id)} in gebruik</span> : <span className="text-[11px] text-gray-400">niets in gebruik</span>}
          </button>
        ))}
        {lijst.length === 0 && <div className="px-3 py-8 text-center text-sm text-gray-500">Niemand gevonden.</div>}
      </div>
    </div>
  )
}

// ── Activiteiten (alleen-lezen) ─────────────────────────────────────────────
function ActiviteitenTab({ data, itemMap, ontlenerMap, onOpen }: { data: Data; itemMap: Map<string, Item>; ontlenerMap: Map<string, Ontlener>; onOpen: (a: Activiteit) => void }) {
  const [f, setF] = useState({ ontlener: '', item: '', soort: '', van: '', tot: '' })
  const lijst = data.activiteiten.filter((a) => {
    if (f.ontlener && a.ontlener_id !== f.ontlener) return false
    if (f.item && a.item_id !== f.item) return false
    if (f.soort && a.soort !== f.soort) return false
    const d = vandaagBE(new Date(a.op))
    if (f.van && d < f.van) return false
    if (f.tot && d > f.tot) return false
    return true
  })
  const icoon = (s: string) => s === 'uitgeleend' ? <span className="h-7 w-7 rounded-full bg-orange-100 text-orange-700 flex items-center justify-center shrink-0"><ArrowUpRight className="h-3.5 w-3.5" /></span>
    : s === 'teruggebracht' ? <span className="h-7 w-7 rounded-full bg-green-100 text-green-700 flex items-center justify-center shrink-0"><Undo2 className="h-3.5 w-3.5" /></span>
    : <span className="h-7 w-7 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center shrink-0"><History className="h-3.5 w-3.5" /></span>
  const sel = `${INP} w-auto py-1.5 text-xs`
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <select className={sel} value={f.ontlener} onChange={(e) => setF({ ...f, ontlener: e.target.value })} aria-label="Filter op medewerker"><option value="">Alle medewerkers</option>{data.ontleners.map((o) => <option key={o.id} value={o.id}>{naamVan(o)}</option>)}</select>
        <select className={sel} value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} aria-label="Filter op materiaal"><option value="">Alle materiaal</option>{data.items.map((i) => <option key={i.id} value={i.id}>{i.naam}</option>)}</select>
        <select className={sel} value={f.soort} onChange={(e) => setF({ ...f, soort: e.target.value })} aria-label="Filter op activiteit"><option value="">Alle activiteiten</option>{Object.entries(ACTIVITEIT_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <input type="date" className={sel} value={f.van} onChange={(e) => setF({ ...f, van: e.target.value })} aria-label="Vanaf" />
        <input type="date" className={sel} value={f.tot} onChange={(e) => setF({ ...f, tot: e.target.value })} aria-label="Tot" />
      </div>
      <div className="card-base p-0 divide-y divide-gray-100">
        {lijst.map((a) => (
          <button key={a.id} type="button" onClick={() => onOpen(a)} className={`w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-center gap-3 ${focusRing}`}>
            {icoon(a.soort)}
            <div className="min-w-0 flex-1">
              <div className="text-sm"><b className="font-medium">{a.item_id ? itemMap.get(a.item_id)?.naam ?? 'Materiaal' : a.ontlener_id ? naamVan(ontlenerMap.get(a.ontlener_id)) : '—'}</b>{a.item_id && a.ontlener_id && <span className="text-gray-600"> · {naamVan(ontlenerMap.get(a.ontlener_id))}</span>}</div>
              <div className="text-[11px] text-gray-500">{ACTIVITEIT_LABEL[a.soort] ?? a.soort}{a.door ? ` · door ${a.door}` : ''}</div>
            </div>
            <span className="text-[11px] text-gray-500 whitespace-nowrap tabular-nums">{datumTijd(a.op)}</span>
          </button>
        ))}
        {lijst.length === 0 && <div className="px-3 py-8 text-center text-sm text-gray-500">Nog geen activiteiten.</div>}
      </div>
      <p className="text-[11px] text-gray-500">De activiteitenlog is alleen-lezen. Correcties komen er als nieuwe regel bij; niets wordt overschreven.</p>
    </div>
  )
}

/** Eén uitlening in een historie, met mailstatus en (voor bevoegden) opnieuw verzenden en corrigeren. */
function UitleningRegel({ u, titel, data, doe, onVenster }: { u: Uitlening; titel: string; data: Data; doe: Doe; onVenster: (v: Venster) => void }) {
  const opnieuw = (soort: 'uit' | 'terug') => doe('mail.opnieuw', { uitlening_id: u.id, soort }, { stil: true }).then((r) => r && toast[r.mail === 'verzonden' ? 'success' : 'error'](r.mail === 'verzonden' ? 'Mail opnieuw verzonden.' : 'De mail is opnieuw mislukt.'))
  return (
    <li className={`px-3 py-2 text-sm ${u.geannuleerd_op ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{titel}{u.geannuleerd_op && <span className="text-[11px] text-red-700"> · geannuleerd ({u.annuleer_reden})</span>}</div>
          <div className="text-[12px] text-gray-600">{datumKort(u.uitgeleend_op)} uitgeleend{u.uitgeleend_door ? ` door ${u.uitgeleend_door}` : ''}{u.teruggebracht_op ? ` · ${datumKort(u.teruggebracht_op)} teruggebracht${u.teruggenomen_door ? ` (${u.teruggenomen_door})` : ''}` : !u.geannuleerd_op ? ' · nog in gebruik' : ''}</div>
          {(u.opmerking || u.terug_opmerking) && <div className="text-[11px] text-gray-500">{[u.opmerking, u.terug_opmerking && `Bij terugkomst: ${u.terug_opmerking}`].filter(Boolean).join(' · ')}</div>}
          <div className="flex gap-3 flex-wrap mt-0.5">
            <MailStatus s={u.mail_uit_status} fout={u.mail_uit_fout} />
            {u.teruggebracht_op && <MailStatus s={u.mail_terug_status} fout={u.mail_terug_fout} />}
          </div>
        </div>
        {data.kan.uitlenen && (
          <div className="flex gap-1 flex-wrap">
            {['mislukt', 'geen_email'].includes(u.mail_uit_status ?? '') && <button type="button" onClick={() => opnieuw('uit')} className="text-[11px] underline">uitleenmail opnieuw</button>}
            {u.teruggebracht_op && ['mislukt', 'geen_email'].includes(u.mail_terug_status ?? '') && <button type="button" onClick={() => opnieuw('terug')} className="text-[11px] underline">retourmail opnieuw</button>}
            {!u.geannuleerd_op && <button type="button" onClick={() => onVenster({ soort: 'correctie', uitlening: u })} className="text-[11px] underline text-gray-500">corrigeren</button>}
          </div>
        )}
      </div>
    </li>
  )
}

function ItemDetail({ data, item, status, catNaam, ontlenerMap, doe, onSluit, onVenster }: { data: Data; item: Item; status: ItemStatus; catNaam: string; ontlenerMap: Map<string, Ontlener>; doe: Doe; onSluit: () => void; onVenster: (v: Venster) => void }) {
  const historie = data.uitleningen.filter((u) => u.item_id === item.id).sort((a, b) => b.uitgeleend_op.localeCompare(a.uitgeleend_op))
  const actief = historie.find((u) => !u.teruggebracht_op && !u.geannuleerd_op)
  return (
    <Modal titel={item.naam} sub={catNaam} onSluit={onSluit} breed
      voet={<>
        {data.kan.beheren && (item.gearchiveerd_op
          ? <button type="button" onClick={() => doe('item.herstel', { id: item.id }, { stil: true }).then((r) => r && toast.success('Materiaal hersteld.'))} className="btn-secondary text-sm mr-auto"><RotateCcw className="h-4 w-4" />Herstellen</button>
          : <button type="button" disabled={!!actief} title={actief ? 'Eerst terugnemen' : 'Archiveren (historie blijft)'} onClick={() => { if (confirm(`${item.naam} archiveren? De uitleengeschiedenis blijft bewaard.`)) doe('item.archiveer', { id: item.id }, { stil: true }).then((r) => { if (r) { toast.success('Gearchiveerd.'); onSluit() } }) }} className="btn-secondary text-sm mr-auto"><Archive className="h-4 w-4" />Archiveren</button>)}
        {data.kan.beheren && <button type="button" onClick={() => onVenster({ soort: 'itemForm', item })} className="btn-secondary text-sm"><Pencil className="h-4 w-4" />Bewerken</button>}
        {data.kan.uitlenen && !item.gearchiveerd_op && (actief
          ? <button type="button" onClick={() => onVenster({ soort: 'terug', uitlening: actief })} className="btn-primary text-sm"><Undo2 className="h-4 w-4" />Terugnemen</button>
          : <button type="button" onClick={() => onVenster({ soort: 'uitlenen', items: [item] })} className="btn-primary text-sm"><ArrowUpRight className="h-4 w-4" />Uitlenen</button>)}
      </>}>
      <div className="flex flex-col sm:flex-row gap-4">
        <Foto item={item} groot />
        <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm flex-1 content-start">
          <dt className="text-gray-500">Status</dt><dd><StatusChip s={status} /></dd>
          {actief && <><dt className="text-gray-500">Bij</dt><dd className="font-medium">{naamVan(ontlenerMap.get(actief.ontlener_id))}</dd><dt className="text-gray-500">Sinds</dt><dd>{datumLang(actief.uitgeleend_op)}</dd>{actief.verwacht_terug && <><dt className="text-gray-500">Verwacht terug</dt><dd>{datumLang(actief.verwacht_terug)}</dd></>}</>}
          {(item.merk || item.model) && <><dt className="text-gray-500">Merk / model</dt><dd>{[item.merk, item.model].filter(Boolean).join(' ')}</dd></>}
          {item.serienummer && <><dt className="text-gray-500">Serienummer</dt><dd>{item.serienummer}</dd></>}
          {item.aankoopdatum && <><dt className="text-gray-500">Aankoop</dt><dd>{datumKort(item.aankoopdatum)}{item.aankoopwaarde !== null ? ` · € ${String(item.aankoopwaarde).replace('.', ',')}` : ''}</dd></>}
          {item.opmerkingen && <><dt className="text-gray-500">Opmerkingen</dt><dd className="whitespace-pre-line">{item.opmerkingen}</dd></>}
        </dl>
      </div>
      <section>
        <h4 className="text-sm font-semibold mb-1.5">Uitleengeschiedenis</h4>
        {historie.length === 0 ? <p className="text-sm text-gray-500">Nog nooit uitgeleend.</p> : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {historie.map((u) => <UitleningRegel key={u.id} u={u} titel={naamVan(ontlenerMap.get(u.ontlener_id))} data={data} doe={doe} onVenster={onVenster} />)}
          </ul>
        )}
      </section>
    </Modal>
  )
}

function OntlenerDetail({ data, o, itemMap, doe, onSluit, onVenster }: { data: Data; o: Ontlener; itemMap: Map<string, Item>; doe: Doe; onSluit: () => void; onVenster: (v: Venster) => void }) {
  const historie = data.uitleningen.filter((u) => u.ontlener_id === o.id).sort((a, b) => b.uitgeleend_op.localeCompare(a.uitgeleend_op))
  const nu = historie.filter((u) => !u.teruggebracht_op && !u.geannuleerd_op)
  const vroeger = historie.filter((u) => u.teruggebracht_op || u.geannuleerd_op)
  return (
    <Modal titel={`${naamVan(o)}${o.type ? ` — ${typeLabel(o.type)}` : ''}`} sub={[o.email ?? 'geen e-mailadres', o.telefoon, o.personeel_id ? 'uit Personeel' : 'extern'].filter(Boolean).join(' · ')} onSluit={onSluit} breed
      voet={<>
        {data.kan.beheren && <button type="button" onClick={() => { const arch = !o.gearchiveerd_op; if (!arch || confirm(`${naamVan(o)} archiveren? De historie blijft bewaard.`)) doe(arch ? 'ontlener.archiveer' : 'ontlener.herstel', { id: o.id }, { stil: true }).then((r) => r && toast.success(arch ? 'Gearchiveerd.' : 'Hersteld.')) }} disabled={!o.gearchiveerd_op && nu.length > 0} className="btn-secondary text-sm mr-auto">{o.gearchiveerd_op ? <><RotateCcw className="h-4 w-4" />Herstellen</> : <><Archive className="h-4 w-4" />Archiveren</>}</button>}
        {data.kan.beheren && <button type="button" onClick={() => onVenster({ soort: 'ontlenerForm', ontlener: o })} className="btn-secondary text-sm"><Pencil className="h-4 w-4" />Bewerken</button>}
        {data.kan.uitlenen && !o.gearchiveerd_op && <button type="button" onClick={() => onVenster({ soort: 'uitlenen', items: [], ontlenerId: o.id, meerdere: true })} className="btn-primary text-sm"><ArrowUpRight className="h-4 w-4" />Materiaal uitlenen</button>}
      </>}>
      <section>
        <h4 className="text-sm font-semibold mb-1.5">Momenteel in gebruik ({nu.length})</h4>
        {nu.length === 0 ? <p className="text-sm text-gray-500">Niets.</p> : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {nu.map((u) => { const i = itemMap.get(u.item_id); return (
              <li key={u.id} className="px-3 py-2 flex items-center gap-2.5">
                {i && <Foto item={i} />}
                <div className="flex-1 min-w-0"><div className="text-sm font-medium truncate">{i?.naam ?? 'Materiaal'}</div><div className="text-[11px] text-gray-500">sinds {datumKort(u.uitgeleend_op)}{u.verwacht_terug ? ` · terug ${datumKort(u.verwacht_terug)}` : ''}</div></div>
                {data.kan.uitlenen && <button type="button" onClick={() => onVenster({ soort: 'terug', uitlening: u })} className="btn-secondary text-xs"><Undo2 className="h-3.5 w-3.5" />Terugnemen</button>}
              </li>
            ) })}
          </ul>
        )}
      </section>
      <section>
        <h4 className="text-sm font-semibold mb-1.5">Eerdere uitleningen</h4>
        {vroeger.length === 0 ? <p className="text-sm text-gray-500">Geen.</p> : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">
            {vroeger.map((u) => <UitleningRegel key={u.id} u={u} titel={itemMap.get(u.item_id)?.naam ?? 'Materiaal'} data={data} doe={doe} onVenster={onVenster} />)}
          </ul>
        )}
      </section>
    </Modal>
  )
}

function ActiviteitDetail({ data, a, itemMap, ontlenerMap, doe, onSluit, onVenster }: { data: Data; a: Activiteit; itemMap: Map<string, Item>; ontlenerMap: Map<string, Ontlener>; doe: Doe; onSluit: () => void; onVenster: (v: Venster) => void }) {
  const u = a.uitlening_id ? data.uitleningen.find((x) => x.id === a.uitlening_id) : undefined
  const rij = (k: string, v: React.ReactNode) => <><dt className="text-gray-500">{k}</dt><dd className="min-w-0 break-words">{v}</dd></>
  const meta = a.meta ?? {}
  return (
    <Modal titel={ACTIVITEIT_LABEL[a.soort] ?? a.soort} sub={datumTijd(a.op)} onSluit={onSluit}>
      <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-sm">
        {a.item_id && rij('Materiaal', itemMap.get(a.item_id)?.naam ?? '—')}
        {a.ontlener_id && rij('Medewerker', naamVan(ontlenerMap.get(a.ontlener_id)))}
        {rij('Datum en tijd', datumTijd(a.op))}
        {rij('Handeling', ACTIVITEIT_LABEL[a.soort] ?? a.soort)}
        {rij('Uitgevoerd door', a.door ?? '—')}
        {a.opmerking && rij(a.soort === 'correctie' || a.soort === 'geannuleerd' ? 'Reden' : 'Opmerking', a.opmerking)}
        {a.soort === 'uitgeleend' && u && rij('Bevestigingsmail', <MailStatus s={u.mail_uit_status} fout={u.mail_uit_fout} />)}
        {a.soort === 'teruggebracht' && u && rij('Bevestigingsmail', <MailStatus s={u.mail_terug_status} fout={u.mail_terug_fout} />)}
        {a.soort === 'correctie' && rij('Gewijzigd', <span className="text-xs">{Object.keys((meta.nieuw as Record<string, unknown>) ?? {}).map((k) => `${k}: ${String((meta.oud as Record<string, unknown>)?.[k] ?? '—')} → ${String((meta.nieuw as Record<string, unknown>)[k] ?? '—')}`).join(' · ')}</span>)}
      </dl>
      {u && (
        <ul className="rounded-lg border border-gray-100"><UitleningRegel u={u} titel="Deze uitlening" data={data} doe={doe} onVenster={(v) => { onSluit(); onVenster(v) }} /></ul>
      )}
    </Modal>
  )
}
