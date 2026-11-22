'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, ChevronRight, FileText, Folder, FolderOpen, FolderPlus, Loader2, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { zoekVeld } from '@/lib/zoekveld'
import {
  ONDERTEKENAARS, STATUS_INFO, aantalIn, boom, filter, kinderen, labelsInGebruik, looptAf, magIn, nakomelingen, padNaam, padVan, statusLabel, statusVan,
  type AcStatus, type AlgemeenContract, type Map,
} from '@/lib/algemene-contracten/model'
import { PersoonKnop } from '@/components/admin/persoon-foto'

const dag = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })
const vandaag = () => new Date().toISOString().slice(0, 10)

const STATUS_FILTERS: { key: AcStatus | 'loopt_af' | null; label: string }[] = [
  { key: null, label: 'Alle' },
  { key: 'wacht_op_ons', label: 'Wacht op ons' },
  { key: 'wacht_op_partij', label: 'Wacht op de andere partij' },
  { key: 'getekend', label: 'Getekend' },
  { key: 'loopt_af', label: 'Loopt binnenkort af' },
]

/** Een contract in of uit het archief halen; geeft true als het lukte. */
async function archiveer(id: string, aan: boolean): Promise<boolean> {
  try {
    const r = await fetch(`/api/admin/algemene-contracten/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archief: aan }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
    return true
  } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); return false }
}

/**
 * Overzicht van de algemene contracten als verkenner: links de mappenboom,
 * bovenaan het pad en de submappen als tegels, daaronder de contracten in die
 * map. Zoeken of filteren zoekt in de map en alle submappen. Archiveren kan
 * vanuit de lijst; het archief staat altijd bovenaan.
 */
export function AcOverzicht({ mappen, contracten, fout, beginMap = null }: { mappen: Map[]; contracten: AlgemeenContract[]; fout: string | null; beginMap?: string | null }) {
  const router = useRouter()
  const [map, setMapState] = useState<string | null>(beginMap && mappen.some((m) => m.id === beginMap) ? beginMap : null)
  const [status, setStatus] = useState<AcStatus | 'loopt_af' | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [zoek, setZoek] = useState('')
  const [archief, setArchief] = useState(false)
  const [opladen, setOpladen] = useState(false)
  const [mapVenster, setMapVenster] = useState<{ modus: 'maak' } | { modus: 'bewerk'; map: Map } | null>(null)

  // De gekozen map in de adresbalk: terug vanuit een contract kom je in dezelfde map.
  const setMap = (id: string | null) => {
    setMapState(id)
    try { window.history.replaceState(null, '', id ? `?map=${id}` : window.location.pathname) } catch { /* geen geschiedenis */ }
  }
  // Map verwijderd (of niet meer te vinden): terug naar bovenaan.
  useEffect(() => { if (map && !mappen.some((m) => m.id === map)) setMap(null) }, [mappen]) // eslint-disable-line react-hooks/exhaustive-deps

  const zoekModus = !!zoek.trim() || !!status || !!label || archief
  const pad = padVan(mappen, map)
  const huidig = pad[pad.length - 1] ?? null
  const submappen = kinderen(mappen, map)
  const naamPad = (id: string | null) => padNaam(mappen, id)
  const labels = useMemo(() => labelsInGebruik(contracten), [contracten])
  const actief = contracten.filter((c) => !c.gearchiveerd_op)
  const wachtOpOns = actief.filter((c) => statusVan(c) === 'wacht_op_ons').length
  const aantalArchief = contracten.length - actief.length

  // Zoeken en filteren: in deze map en alle submappen (bovenaan: overal).
  const bereik = useMemo(() => (map ? new Set([map, ...Array.from(nakomelingen(mappen, map))]) : null), [map, mappen])
  // Het archief toont altijd alles, ongeacht de map.
  const resultaten = useMemo(() => filter(contracten, { status, label, zoek, archief }, vandaag(), naamPad).filter((c) => archief || !bereik || (c.map_id && bereik.has(c.map_id))), [contracten, status, label, zoek, archief, bereik]) // eslint-disable-line react-hooks/exhaustive-deps
  const hier = actief.filter((c) => (c.map_id ?? null) === map)

  const wisFilters = () => { setStatus(null); setLabel(null); setZoek(''); setArchief(false) }
  const openMap = (id: string | null) => { wisFilters(); setMap(id) }
  const archiveerRij = async (c: AlgemeenContract) => {
    const aan = !c.gearchiveerd_op
    if (!(await archiveer(c.id, aan))) return
    router.refresh()
    toast.success(aan ? `“${c.titel}” staat in het archief.` : `“${c.titel}” is terug uit het archief.`, {
      action: { label: 'Ongedaan maken', onClick: async () => { if (await archiveer(c.id, !aan)) router.refresh() } },
    })
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Algemene contracten</h1>
          <p className="text-sm text-gray-500 mt-0.5">Eigen contracten van NextGenMedia: opladen, tekenen en terugsturen.</p>
        </div>
        <button type="button" onClick={() => setOpladen(true)} className="btn-primary"><Upload className="h-4 w-4" />PDF opladen</button>
      </div>

      {fout && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{fout}</div>}

      {wachtOpOns > 0 && (
        <button type="button" onClick={() => { setMap(null); setLabel(null); setZoek(''); setArchief(false); setStatus('wacht_op_ons') }} className="w-full text-left rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <b className="font-semibold">{wachtOpOns === 1 ? '1 contract wacht' : `${wachtOpOns} contracten wachten`} op onze handtekening.</b> Klik om ze te tonen.
        </button>
      )}

      <div className="grid lg:grid-cols-[250px_minmax(0,1fr)] gap-5 items-start">
        <MappenBoom mappen={mappen} contracten={contracten} gekozen={archief ? null : map} onKies={openMap} onNieuw={() => setMapVenster({ modus: 'maak' })} />

        <section className="space-y-4 min-w-0">
          <div className="card-base space-y-3">
            <div className="relative">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input {...zoekVeld('algemene-contracten')} className="input-base pl-9" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder={huidig ? `Zoek in ${huidig.naam} en de submappen` : 'Zoek op titel, partij, label of notitie'} aria-label="Zoeken" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.label} type="button" onClick={() => { setStatus(f.key); setArchief(false) }} aria-pressed={!archief && status === f.key}
                  className={`text-xs px-3 py-1 rounded-full border ${!archief && status === f.key ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>{f.label}</button>
              ))}
              <button type="button" onClick={() => { setArchief((a) => !a); setStatus(null) }} aria-pressed={archief}
                className={`text-xs px-3 py-1 rounded-full border inline-flex items-center gap-1 ${archief ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}><Archive className="h-3 w-3" />Archief ({aantalArchief})</button>
            </div>
            {labels.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-gray-500 mr-0.5">Labels</span>
                {labels.map((l) => (
                  <button key={l.label} type="button" onClick={() => setLabel((x) => (x?.toLowerCase() === l.label.toLowerCase() ? null : l.label))} aria-pressed={label?.toLowerCase() === l.label.toLowerCase()}
                    className={`text-[11px] px-2 py-0.5 rounded-full border ${label?.toLowerCase() === l.label.toLowerCase() ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>{l.label} <span className="opacity-60">{l.aantal}</span></button>
                ))}
              </div>
            )}
          </div>

          {/* Pad: waar je nu bent, met de acties voor deze map. */}
          <div className="flex items-center gap-2 flex-wrap">
            <nav className="flex items-center gap-1 text-sm min-w-0 flex-wrap" aria-label="Map">
              <button type="button" onClick={() => openMap(null)} className={`px-1.5 py-0.5 rounded-md hover:bg-white ${!map && !archief ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>Alle mappen</button>
              {archief && <span className="inline-flex items-center gap-1"><ChevronRight className="h-3.5 w-3.5 text-gray-400" /><span className="px-1.5 font-semibold text-gray-900">Archief</span></span>}
              {!archief && pad.map((m, i) => (
                <span key={m.id} className="inline-flex items-center gap-1 min-w-0">
                  <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                  <button type="button" onClick={() => openMap(m.id)} className={`px-1.5 py-0.5 rounded-md hover:bg-white truncate ${i === pad.length - 1 ? 'font-semibold text-gray-900' : 'text-gray-500'}`}>{m.naam}</button>
                </span>
              ))}
              {zoekModus && <span className="text-gray-400 ml-1">· {resultaten.length} {resultaten.length === 1 ? 'resultaat' : 'resultaten'}</span>}
            </nav>
            <div className="ml-auto flex gap-1.5">
              {huidig && !zoekModus && <button type="button" onClick={() => setMapVenster({ modus: 'bewerk', map: huidig })} className="btn-secondary text-xs h-8"><Pencil className="h-3.5 w-3.5" />Map aanpassen</button>}
              {!zoekModus && <button type="button" onClick={() => setMapVenster({ modus: 'maak' })} className="btn-secondary text-xs h-8"><FolderPlus className="h-3.5 w-3.5" />{huidig ? 'Submap' : 'Nieuwe map'}</button>}
              {zoekModus && <button type="button" onClick={wisFilters} className="btn-secondary text-xs h-8"><X className="h-3.5 w-3.5" />Wis zoeken en filters</button>}
            </div>
          </div>

          {!zoekModus && submappen.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
              {submappen.map((m) => {
                const n = aantalIn(contracten, mappen, m.id)
                const sub = kinderen(mappen, m.id).length
                return (
                  <button key={m.id} type="button" onClick={() => openMap(m.id)} className="card-base text-left p-4 hover:shadow-md transition-shadow group">
                    <Folder className="h-7 w-7 text-amber-500 fill-amber-100 group-hover:fill-amber-200" />
                    <div className="mt-2 font-medium text-gray-900 truncate">{m.naam}</div>
                    <div className="text-xs text-gray-500">{n === 1 ? '1 contract' : `${n} contracten`}{sub ? ` · ${sub} ${sub === 1 ? 'submap' : 'submappen'}` : ''}</div>
                  </button>
                )
              })}
            </div>
          )}

          {zoekModus ? (
            <Lijst lijst={resultaten} naamPad={naamPad} toonPad leeg={archief ? 'Het archief is leeg.' : 'Geen contracten voor deze keuze.'} onArchiveer={archiveerRij} />
          ) : !huidig && hier.length === 0 && contracten.length > 0 ? null : (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{huidig ? `In ${huidig.naam}` : 'Zonder map'}</h2>
              {hier.length === 0 ? (
                <div className="card-base text-center py-8 space-y-2">
                  <FileText className="h-7 w-7 text-gray-300 mx-auto" />
                  <p className="text-sm text-gray-600">{huidig ? `Nog geen contracten in ${huidig.naam}.` : contracten.length === 0 ? 'Nog geen algemene contracten. Laad een PDF op om te beginnen.' : 'Alle contracten zitten in een map. Open een map hierboven.'}</p>
                  {(huidig || contracten.length === 0) && <button type="button" onClick={() => setOpladen(true)} className="btn-secondary text-sm"><Upload className="h-4 w-4" />PDF opladen{huidig ? ` in ${huidig.naam}` : ''}</button>}
                </div>
              ) : (
                <Lijst lijst={hier} naamPad={naamPad} leeg="" onArchiveer={archiveerRij} />
              )}
            </div>
          )}
        </section>
      </div>

      {opladen && <OpladenVenster mappen={mappen} beginMap={map} labels={labels.map((l) => l.label)} onSluit={() => setOpladen(false)}
        onKlaar={(id, tekenen) => { setOpladen(false); router.push(tekenen ? `/admin/algemene-contracten/${id}/tekenen` : `/admin/algemene-contracten/${id}`) }} />}
      {mapVenster && <MapVenster mappen={mappen} bewerk={mapVenster.modus === 'bewerk' ? mapVenster.map : null} beginOuder={mapVenster.modus === 'bewerk' ? mapVenster.map.parent_id ?? null : map}
        onSluit={() => setMapVenster(null)} onKlaar={(verwijderdNaar) => { setMapVenster(null); if (verwijderdNaar !== undefined) setMap(verwijderdNaar); router.refresh() }} />}
    </div>
  )
}

/** De contracten als lijst; met het mappad erbij bij zoeken. Archiveren met het icoontje rechts. */
function Lijst({ lijst, naamPad, toonPad = false, leeg, onArchiveer }: {
  lijst: AlgemeenContract[]; naamPad: (id: string | null) => string | null; toonPad?: boolean; leeg: string; onArchiveer: (c: AlgemeenContract) => void
}) {
  if (!lijst.length) return <div className="card-base text-center py-8 text-sm text-gray-600">{leeg}</div>
  return (
    <ul className="card-base p-0 divide-y divide-gray-100 overflow-hidden">
      {lijst.map((c) => {
        const s = statusVan(c)
        const af = looptAf(c, vandaag())
        const p = naamPad(c.map_id)
        return (
          <li key={c.id} className="group relative">
            <Link href={`/admin/algemene-contracten/${c.id}`} className="flex items-start gap-3 px-4 py-3 pr-12 hover:bg-gray-50">
              <FileText className="h-5 w-5 text-gray-400 mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 truncate">{c.titel}</div>
                <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                  {c.tegenpartij && <span>{c.tegenpartij}</span>}
                  {toonPad && <span className="inline-flex items-center gap-1"><Folder className="h-3 w-3" />{p ?? 'Zonder map'}</span>}
                  {c.eind_datum && <span className={af ? 'text-red-700 font-medium' : ''}>loopt tot {dag(c.eind_datum)}</span>}
                  {c.gearchiveerd_op ? <span>gearchiveerd {dag(c.gearchiveerd_op)}</span> : <span>opgeladen {dag(c.created_at)}</span>}
                </div>
                {c.labels.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">{c.labels.map((l) => <span key={l} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700">{l}</span>)}</div>
                )}
              </div>
              <span className={`status-badge border text-[11px] shrink-0 ${STATUS_INFO[s].cls}`}>{statusLabel(c)}</span>
            </Link>
            <button type="button" onClick={() => onArchiveer(c)} title={c.gearchiveerd_op ? 'Uit het archief halen' : 'Archiveren'} aria-label={c.gearchiveerd_op ? `${c.titel} uit het archief halen` : `${c.titel} archiveren`}
              className="absolute right-3 top-3 h-8 w-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-900 hover:bg-gray-100 lg:opacity-0 lg:group-hover:opacity-100 focus:opacity-100">
              {c.gearchiveerd_op ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** De mappenstructuur als boom: alle mappen en submappen, met hoeveel contracten erin zitten. */
function MappenBoom({ mappen, contracten, gekozen, onKies, onNieuw }: {
  mappen: Map[]; contracten: AlgemeenContract[]; gekozen: string | null; onKies: (id: string | null) => void; onNieuw: () => void
}) {
  const open = new Set(padVan(mappen, gekozen).map((m) => m.id))
  const [dicht, setDicht] = useState<Set<string>>(new Set())
  // Een dichtgeklapte map verbergt haar submappen, behalve op het pad naar de gekozen map.
  const zichtbaar = boom(mappen).filter(({ map }) => padVan(mappen, map.parent_id ?? null).every((o) => !dicht.has(o.id) || open.has(o.id)))
  const zonder = contracten.filter((c) => !c.gearchiveerd_op && !c.map_id).length
  return (
    <aside className="card-base p-2 hidden lg:block">
      <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Mappen</div>
      <button type="button" onClick={() => onKies(null)} className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-left ${gekozen === null ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
        <FolderOpen className="h-4 w-4 shrink-0" /><span className="flex-1">Alle mappen</span>{zonder > 0 && <span className="text-xs opacity-60" title="Contracten zonder map">{zonder}</span>}
      </button>
      <ul className="mt-0.5">
        {zichtbaar.map(({ map: m, diepte }) => {
          const heeftKind = mappen.some((x) => (x.parent_id ?? null) === m.id)
          const isDicht = dicht.has(m.id) && !open.has(m.id)
          return (
            <li key={m.id} className="flex items-center" style={{ paddingLeft: diepte * 14 }}>
              <button type="button" onClick={() => setDicht((d) => { const n = new Set(d); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })} disabled={!heeftKind}
                className="h-6 w-5 flex items-center justify-center text-gray-400 hover:text-gray-700 disabled:invisible" aria-label={isDicht ? `${m.naam} openklappen` : `${m.naam} dichtklappen`}>
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isDicht ? '' : 'rotate-90'}`} />
              </button>
              <button type="button" onClick={() => onKies(m.id)} className={`flex-1 min-w-0 flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-sm text-left ${gekozen === m.id ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
                <Folder className={`h-4 w-4 shrink-0 ${gekozen === m.id ? '' : 'text-amber-500 fill-amber-100'}`} />
                <span className="flex-1 truncate">{m.naam}</span>
                <span className="text-xs opacity-60">{aantalIn(contracten, mappen, m.id)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <button type="button" onClick={onNieuw} className="mt-1 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100"><FolderPlus className="h-4 w-4" />Nieuwe map</button>
    </aside>
  )
}

/** Map maken (in de huidige map of bovenaan) of aanpassen: naam, waar ze staat, verwijderen. */
function MapVenster({ mappen, bewerk, beginOuder, onSluit, onKlaar }: {
  mappen: Map[]; bewerk: Map | null; beginOuder: string | null; onSluit: () => void
  /** verwijderdNaar: na verwijderen de map om te openen (de bovenliggende). */
  onKlaar: (verwijderdNaar?: string | null) => void
}) {
  const [naam, setNaam] = useState(bewerk?.naam ?? '')
  const [ouder, setOuder] = useState<string>(beginOuder ?? '')
  const [bezig, setBezig] = useState(false)
  const opties = boom(mappen).filter(({ map }) => magIn(mappen, bewerk?.id ?? null, map.id))
  const actie = async (b: Record<string, unknown>) => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/algemene-contracten/mappen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); return false } finally { setBezig(false) }
  }
  const bewaar = async () => {
    if (!naam.trim()) return
    const ok = await actie(bewerk ? { actie: 'hernoem', id: bewerk.id, naam, parent_id: ouder || null } : { actie: 'maak', naam, parent_id: ouder || null })
    if (ok) { toast.success(bewerk ? 'Map aangepast.' : 'Map gemaakt.'); onKlaar() }
  }
  const verwijder = async () => {
    if (!bewerk) return
    const boven = padNaam(mappen, bewerk.parent_id ?? null) ?? 'Alle mappen'
    if (!confirm(`Map “${bewerk.naam}” verwijderen? De contracten en submappen erin gaan naar ${boven}. Er gaat niets verloren.`)) return
    if (await actie({ actie: 'verwijder', id: bewerk.id })) { toast.success('Map verwijderd.'); onKlaar(bewerk.parent_id ?? null) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onSluit}>
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={bewerk ? 'Map aanpassen' : 'Nieuwe map'}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h3 className="font-semibold">{bewerk ? 'Map aanpassen' : 'Nieuwe map'}</h3>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); void bewaar() }} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Naam</label>
            <input autoFocus className="input-base" value={naam} maxLength={60} onChange={(e) => setNaam(e.target.value)} placeholder="bv. Auto" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">In map</label>
            <select className="input-base" value={ouder} onChange={(e) => setOuder(e.target.value)}>
              <option value="">Bovenaan (geen bovenliggende map)</option>
              {opties.map(({ map, pad }) => <option key={map.id} value={map.id}>{pad}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            {bewerk && <button type="button" onClick={verwijder} disabled={bezig} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600 mr-auto"><Trash2 className="h-3.5 w-3.5" />Map verwijderen</button>}
            <button type="button" onClick={onSluit} className="btn-secondary text-sm ml-auto">Annuleren</button>
            <button type="submit" disabled={bezig || !naam.trim()} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : bewerk ? <Pencil className="h-4 w-4" /> : <FolderPlus className="h-4 w-4" />}{bewerk ? 'Bewaren' : 'Map maken'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Labels kiezen: bestaande aanklikken of zelf typen (Enter of komma). */
export function LabelsVeld({ waarde, onChange, voorstellen }: { waarde: string[]; onChange: (l: string[]) => void; voorstellen: string[] }) {
  const [tekst, setTekst] = useState('')
  const voeg = (t: string) => {
    const l = t.replace(/\s+/g, ' ').trim().slice(0, 30)
    if (l && !waarde.some((x) => x.toLowerCase() === l.toLowerCase()) && waarde.length < 10) onChange([...waarde, l])
    setTekst('')
  }
  const rest = voorstellen.filter((v) => !waarde.some((x) => x.toLowerCase() === v.toLowerCase())).slice(0, 12)
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1 items-center rounded-lg border border-gray-200 px-2 py-1.5 bg-white">
        {waarde.map((l) => (
          <span key={l} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-800">{l}
            <button type="button" onClick={() => onChange(waarde.filter((x) => x !== l))} aria-label={`${l} weghalen`} className="text-gray-500 hover:text-black"><X className="h-3 w-3" /></button>
          </span>
        ))}
        <input value={tekst} onChange={(e) => (e.target.value.endsWith(',') ? voeg(e.target.value.slice(0, -1)) : setTekst(e.target.value))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); voeg(tekst) } else if (e.key === 'Backspace' && !tekst && waarde.length) onChange(waarde.slice(0, -1)) }}
          onBlur={() => tekst.trim() && voeg(tekst)} placeholder={waarde.length ? '' : 'bv. kantoor, auto, Hasselt'} className="flex-1 min-w-[120px] text-sm outline-none py-0.5" aria-label="Label toevoegen" />
      </div>
      {rest.length > 0 && (
        <div className="flex flex-wrap gap-1">{rest.map((v) => <button key={v} type="button" onClick={() => voeg(v)} className="text-[11px] px-2 py-0.5 rounded-full border border-dashed border-gray-300 text-gray-600 hover:bg-gray-50"><Plus className="inline h-2.5 w-2.5 -mt-px" /> {v}</button>)}</div>
      )}
    </div>
  )
}

/** Een PDF opladen: rechtstreeks naar de opslag, daarna de gegevens en wie moet tekenen. */
function OpladenVenster({ mappen, beginMap, labels, onSluit, onKlaar }: {
  mappen: Map[]; beginMap: string | null; labels: string[]; onSluit: () => void; onKlaar: (id: string, tekenen: boolean) => void
}) {
  const [bestand, setBestand] = useState<File | null>(null)
  const [titel, setTitel] = useState('')
  const [mapId, setMapId] = useState<string>(beginMap ?? '')
  const [tegenpartij, setTegenpartij] = useState('')
  const [email, setEmail] = useState('')
  const [lbls, setLbls] = useState<string[]>([])
  const [begin, setBegin] = useState('')
  const [eind, setEind] = useState('')
  const [notitie, setNotitie] = useState('')
  const [onsNodig, setOnsNodig] = useState(true)
  const [ondertekenaar, setOndertekenaar] = useState('')
  const [partijNodig, setPartijNodig] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)
  const LBL = 'block text-xs font-medium text-gray-600 mb-1'

  const kies = (f: File | null) => {
    if (!f) return
    if (!/\.pdf$/i.test(f.name) && f.type !== 'application/pdf') { toast.error('Enkel PDF. Een Word-document sla je eerst op als PDF (Bestand → Opslaan als → PDF).'); return }
    if (f.size > 50 * 1024 * 1024) { toast.error('Het bestand is groter dan 50 MB.'); return }
    setBestand(f)
    if (!titel.trim()) setTitel(f.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim())
  }

  const bewaar = async () => {
    if (!bestand) { toast.error('Kies eerst een PDF.'); return }
    if (!titel.trim()) { toast.error('Geef het contract een titel.'); return }
    try {
      setBezig('Opladen…')
      const r1 = await fetch('/api/admin/algemene-contracten/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam: bestand.name.toLowerCase().endsWith('.pdf') ? bestand.name : `${bestand.name}.pdf`, grootte: bestand.size }) })
      const up = await r1.json(); if (!r1.ok) throw new Error(up.error || 'Opladen mislukt')
      const { error } = await createClient().storage.from(up.bucket).uploadToSignedUrl(up.pad, up.token, bestand, { contentType: 'application/pdf', upsert: false })
      if (error) throw new Error(error.message)
      setBezig('Bewaren…')
      const r2 = await fetch('/api/admin/algemene-contracten', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pad: up.pad, bestand_naam: bestand.name, titel, map_id: mapId || null, tegenpartij, tegenpartij_email: email, labels: lbls, begin_datum: begin || null, eind_datum: eind || null, notitie, ons_nodig: onsNodig, ondertekenaar: onsNodig ? ondertekenaar || null : null, partij_nodig: partijNodig }),
      })
      const j = await r2.json(); if (!r2.ok) throw new Error(j.error || 'Bewaren mislukt')
      toast.success(onsNodig ? 'Opgeladen. Zet nu je handtekening.' : 'Opgeladen.')
      onKlaar(j.id, onsNodig || partijNodig)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt'); setBezig(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onSluit}>
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="PDF opladen">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 className="font-semibold">Contract opladen</h3>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <label className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center cursor-pointer ${bestand ? 'border-gray-300 bg-gray-50' : 'border-gray-300 hover:bg-gray-50'}`}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); kies(e.dataTransfer.files?.[0] ?? null) }}>
            <Upload className="h-6 w-6 text-gray-400" />
            {bestand ? <span className="text-sm font-medium text-gray-800 break-all">{bestand.name} · {(bestand.size / 1024 / 1024).toFixed(1)} MB</span> : <span className="text-sm text-gray-700">Sleep een PDF hierheen of klik om te kiezen</span>}
            <span className="text-[11px] text-gray-500">Enkel PDF, tot 50 MB. Een Word-document sla je eerst op als PDF.</span>
            <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => kies(e.target.files?.[0] ?? null)} />
          </label>

          <div>
            <label className={LBL}>Titel</label>
            <input className="input-base" value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} placeholder="bv. Huurovereenkomst kantoor Corda Campus" />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className={LBL}>Map</label>
              <select className="input-base" value={mapId} onChange={(e) => setMapId(e.target.value)}>
                <option value="">Zonder map</option>
                {boom(mappen).map(({ map: m, pad }) => <option key={m.id} value={m.id}>{pad}</option>)}
              </select>
            </div>
            <div>
              <label className={LBL}>Andere partij</label>
              <input className="input-base" value={tegenpartij} onChange={(e) => setTegenpartij(e.target.value)} maxLength={200} placeholder="bv. AG Insurance" />
            </div>
            <div>
              <label className={LBL}>E-mail andere partij <span className="text-gray-400 font-normal">(optioneel)</span></label>
              <input type="email" className="input-base" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} placeholder="naam@bedrijf.be" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className={LBL}>Begin</label><input type="date" className="input-base" value={begin} onChange={(e) => setBegin(e.target.value)} /></div>
              <div><label className={LBL}>Loopt tot</label><input type="date" className="input-base" value={eind} onChange={(e) => setEind(e.target.value)} /></div>
            </div>
          </div>
          <div>
            <label className={LBL}>Labels</label>
            <LabelsVeld waarde={lbls} onChange={setLbls} voorstellen={labels} />
          </div>

          <fieldset className="rounded-xl border border-gray-200 p-3 space-y-2.5">
            <legend className="px-1 text-xs font-medium text-gray-600">Wie moet tekenen?</legend>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={onsNodig} onChange={(e) => setOnsNodig(e.target.checked)} className="h-4 w-4 mt-0.5 accent-gray-900" />
              <span><b className="font-medium">Wij (NextGenMedia)</b><span className="block text-xs text-gray-500">Met je handtekening, je naam en datum en uur eronder.</span></span>
            </label>
            {onsNodig && (
              <div className="ml-6">
                <p className="text-xs text-gray-500 mb-1">Wie tekent?</p>
                <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label="Wie tekent namens ons">
                  {ONDERTEKENAARS.map((o) => <PersoonKnop key={o} naam={o} label={o === 'Gezamenlijke lead' ? 'Marco of Bram' : o} klein aan={ondertekenaar === o} onClick={() => setOndertekenaar(o)} />)}
                </div>
              </div>
            )}
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={partijNodig} onChange={(e) => setPartijNodig(e.target.checked)} className="h-4 w-4 mt-0.5 accent-gray-900" />
              <span><b className="font-medium">De andere partij</b><span className="block text-xs text-gray-500">Krijgt een persoonlijke link per mail en tekent op de plek die jij aanduidt.</span></span>
            </label>
            {!onsNodig && !partijNodig && <p className="text-xs text-gray-500">Niemand tekent: het contract wordt gewoon bewaard (bv. een al getekende polis).</p>}
          </fieldset>

          <div>
            <label className={LBL}>Notitie <span className="text-gray-400 font-normal">(optioneel)</span></label>
            <textarea className="input-base min-h-[70px]" value={notitie} onChange={(e) => setNotitie(e.target.value)} maxLength={4000} placeholder="bv. Opzeggen 3 maanden voor de einddatum." />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onSluit} className="btn-secondary text-sm">Annuleren</button>
            <button type="button" onClick={bewaar} disabled={!!bezig || !bestand} className="btn-primary text-sm">{bezig ? <><Loader2 className="h-4 w-4 animate-spin" />{bezig}</> : <><Upload className="h-4 w-4" />{onsNodig || partijNodig ? 'Opladen en verder' : 'Opladen'}</>}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
