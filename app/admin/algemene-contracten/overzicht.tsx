'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, Check, FileText, Folder, FolderPlus, Loader2, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { zoekVeld } from '@/lib/zoekveld'
import {
  ONDERTEKENAARS, STATUS_INFO, filter, labelsInGebruik, looptAf, statusLabel, statusVan,
  type AcStatus, type AlgemeenContract, type Map,
} from '@/lib/algemene-contracten/model'

const dag = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })
const vandaag = () => new Date().toISOString().slice(0, 10)

const STATUS_FILTERS: { key: AcStatus | 'loopt_af' | null; label: string }[] = [
  { key: null, label: 'Alle' },
  { key: 'wacht_op_ons', label: 'Wacht op ons' },
  { key: 'wacht_op_partij', label: 'Wacht op de andere partij' },
  { key: 'getekend', label: 'Getekend' },
  { key: 'loopt_af', label: 'Loopt binnenkort af' },
]

/**
 * Overzicht van de algemene contracten: mappen links (standaard en eigen),
 * zoeken, filteren op status en label. Een PDF opladen kan altijd; daarna
 * tekenen wij en eventueel de andere partij.
 */
export function AcOverzicht({ mappen, contracten, fout }: { mappen: Map[]; contracten: AlgemeenContract[]; fout: string | null }) {
  const router = useRouter()
  const [map, setMap] = useState<string | null>(null)
  const [status, setStatus] = useState<AcStatus | 'loopt_af' | null>(null)
  const [label, setLabel] = useState<string | null>(null)
  const [zoek, setZoek] = useState('')
  const [archief, setArchief] = useState(false)
  const [opladen, setOpladen] = useState(false)

  const mapNaam = (id: string | null) => mappen.find((m) => m.id === id)?.naam ?? null
  const lijst = useMemo(() => filter(contracten, { map, status, label, zoek, archief }, vandaag(), mapNaam), [contracten, map, status, label, zoek, archief]) // eslint-disable-line react-hooks/exhaustive-deps
  const labels = useMemo(() => labelsInGebruik(contracten), [contracten])
  const actief = contracten.filter((c) => !c.gearchiveerd_op)
  const perMap = (id: string | null) => actief.filter((c) => c.map_id === id).length
  const wachtOpOns = actief.filter((c) => statusVan(c) === 'wacht_op_ons').length
  const aantalArchief = contracten.length - actief.length

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Algemene contracten</h1>
          <p className="text-sm text-gray-500 mt-0.5">Huurovereenkomsten, verzekeringen, commissieregelingen, NDA's … van NextGenMedia zelf. Opladen, tekenen en terugsturen.</p>
        </div>
        <button type="button" onClick={() => setOpladen(true)} className="btn-primary"><Upload className="h-4 w-4" />PDF opladen</button>
      </div>

      {fout && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{fout}</div>}

      {wachtOpOns > 0 && (
        <button type="button" onClick={() => { setStatus('wacht_op_ons'); setArchief(false) }} className="w-full text-left rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <b className="font-semibold">{wachtOpOns === 1 ? '1 contract wacht' : `${wachtOpOns} contracten wachten`} op onze handtekening.</b> Klik om ze te tonen.
        </button>
      )}

      <div className="grid lg:grid-cols-[230px_minmax(0,1fr)] gap-5 items-start">
        <Mappen mappen={mappen} gekozen={map} onKies={(m) => { setMap(m); setArchief(false) }} perMap={perMap} totaal={actief.length} zonder={perMap(null)} onVeranderd={() => router.refresh()} />

        <section className="space-y-3 min-w-0">
          <div className="card-base space-y-3">
            <div className="relative">
              <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input {...zoekVeld('algemene-contracten')} className="input-base pl-9" value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek op titel, partij, label of notitie" aria-label="Zoeken" />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button key={f.label} type="button" onClick={() => { setStatus(f.key); setArchief(false) }} aria-pressed={!archief && status === f.key}
                  className={`text-xs px-3 py-1 rounded-full border ${!archief && status === f.key ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>{f.label}</button>
              ))}
              {aantalArchief > 0 && (
                <button type="button" onClick={() => { setArchief((a) => !a); setStatus(null) }} aria-pressed={archief}
                  className={`text-xs px-3 py-1 rounded-full border inline-flex items-center gap-1 ${archief ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}><Archive className="h-3 w-3" />Archief ({aantalArchief})</button>
              )}
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

          {lijst.length === 0 ? (
            <div className="card-base text-center py-10 space-y-2">
              <FileText className="h-8 w-8 text-gray-300 mx-auto" />
              <p className="text-sm text-gray-600">{contracten.length === 0 ? 'Nog geen algemene contracten. Laad een PDF op om te beginnen.' : 'Geen contracten voor deze keuze.'}</p>
              {contracten.length === 0 && <button type="button" onClick={() => setOpladen(true)} className="btn-secondary text-sm"><Upload className="h-4 w-4" />PDF opladen</button>}
            </div>
          ) : (
            <ul className="card-base p-0 divide-y divide-gray-100 overflow-hidden">
              {lijst.map((c) => {
                const s = statusVan(c)
                const af = looptAf(c, vandaag())
                return (
                  <li key={c.id}>
                    <Link href={`/admin/algemene-contracten/${c.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50">
                      <FileText className="h-5 w-5 text-gray-400 mt-0.5 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-gray-900 truncate">{c.titel}</div>
                        <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap gap-x-2">
                          {c.tegenpartij && <span>{c.tegenpartij}</span>}
                          {mapNaam(c.map_id) && <span className="inline-flex items-center gap-1"><Folder className="h-3 w-3" />{mapNaam(c.map_id)}</span>}
                          {c.eind_datum && <span className={af ? 'text-red-700 font-medium' : ''}>loopt tot {dag(c.eind_datum)}</span>}
                          <span>opgeladen {dag(c.created_at)}</span>
                        </div>
                        {c.labels.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">{c.labels.map((l) => <span key={l} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-700">{l}</span>)}</div>
                        )}
                      </div>
                      <span className={`status-badge border text-[11px] shrink-0 ${STATUS_INFO[s].cls}`}>{statusLabel(c)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {opladen && <OpladenVenster mappen={mappen} beginMap={map && map !== 'zonder' ? map : null} labels={labels.map((l) => l.label)} onSluit={() => setOpladen(false)}
        onKlaar={(id, tekenen) => { setOpladen(false); router.push(tekenen ? `/admin/algemene-contracten/${id}/tekenen` : `/admin/algemene-contracten/${id}`) }} />}
    </div>
  )
}

/** De mappen: kiezen, nieuwe map maken, hernoemen of verwijderen (de contracten blijven, zonder map). */
function Mappen({ mappen, gekozen, onKies, perMap, totaal, zonder, onVeranderd }: {
  mappen: Map[]; gekozen: string | null; onKies: (m: string | null) => void; perMap: (id: string | null) => number; totaal: number; zonder: number; onVeranderd: () => void
}) {
  const [nieuw, setNieuw] = useState<string | null>(null)
  const [bewerk, setBewerk] = useState<{ id: string; naam: string } | null>(null)
  const [bezig, setBezig] = useState(false)
  const actie = async (b: Record<string, unknown>) => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/algemene-contracten/mappen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      onVeranderd(); return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); return false } finally { setBezig(false) }
  }
  const knop = (aan: boolean) => `w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left ${aan ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'}`
  return (
    <aside className="card-base p-2 space-y-0.5">
      <div className="px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Mappen</div>
      <div className="flex lg:flex-col gap-0.5 overflow-x-auto lg:overflow-visible">
        <button type="button" onClick={() => onKies(null)} className={`${knop(gekozen === null)} shrink-0 lg:shrink`}><Folder className="h-4 w-4 shrink-0" /><span className="flex-1 whitespace-nowrap">Alle contracten</span><span className="text-xs opacity-60">{totaal}</span></button>
        {mappen.map((m) => bewerk?.id === m.id ? (
          <form key={m.id} onSubmit={async (e) => { e.preventDefault(); if (await actie({ actie: 'hernoem', id: m.id, naam: bewerk.naam })) setBewerk(null) }} className="flex items-center gap-1 px-1 shrink-0">
            <input autoFocus className="input-base py-1 text-sm" value={bewerk.naam} maxLength={60} onChange={(e) => setBewerk({ ...bewerk, naam: e.target.value })} aria-label="Naam van de map" />
            <button type="submit" disabled={bezig} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Bewaren"><Check className="h-4 w-4" /></button>
            <button type="button" onClick={() => setBewerk(null)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Annuleren"><X className="h-4 w-4" /></button>
          </form>
        ) : (
          <div key={m.id} className="group relative shrink-0 lg:shrink">
            <button type="button" onClick={() => onKies(m.id)} className={knop(gekozen === m.id)}><Folder className="h-4 w-4 shrink-0" /><span className="flex-1 whitespace-nowrap truncate">{m.naam}</span><span className="text-xs opacity-60 lg:group-hover:hidden">{perMap(m.id)}</span></button>
            <span className="hidden lg:group-hover:flex absolute right-1 top-1/2 -translate-y-1/2 gap-0.5">
              <button type="button" onClick={() => setBewerk({ id: m.id, naam: m.naam })} className="h-6 w-6 flex items-center justify-center rounded bg-white/90 text-gray-500 hover:text-black" aria-label={`${m.naam} hernoemen`}><Pencil className="h-3 w-3" /></button>
              <button type="button" disabled={bezig} onClick={() => { if (confirm(`Map “${m.naam}” verwijderen? De contracten erin blijven, zonder map.`)) { void actie({ actie: 'verwijder', id: m.id }); if (gekozen === m.id) onKies(null) } }} className="h-6 w-6 flex items-center justify-center rounded bg-white/90 text-gray-500 hover:text-red-600" aria-label={`${m.naam} verwijderen`}><Trash2 className="h-3 w-3" /></button>
            </span>
          </div>
        ))}
        {zonder > 0 && <button type="button" onClick={() => onKies('zonder')} className={`${knop(gekozen === 'zonder')} shrink-0 lg:shrink`}><Folder className="h-4 w-4 shrink-0 opacity-50" /><span className="flex-1 whitespace-nowrap">Zonder map</span><span className="text-xs opacity-60">{zonder}</span></button>}
      </div>
      {nieuw === null ? (
        <button type="button" onClick={() => setNieuw('')} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-100"><FolderPlus className="h-4 w-4" />Nieuwe map</button>
      ) : (
        <form onSubmit={async (e) => { e.preventDefault(); if (await actie({ actie: 'maak', naam: nieuw })) setNieuw(null) }} className="flex items-center gap-1 px-1 pt-1">
          <input autoFocus className="input-base py-1 text-sm" value={nieuw} maxLength={60} onChange={(e) => setNieuw(e.target.value)} placeholder="Naam van de map" aria-label="Naam van de nieuwe map" />
          <button type="submit" disabled={bezig || !nieuw.trim()} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Map maken">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</button>
          <button type="button" onClick={() => setNieuw(null)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Annuleren"><X className="h-4 w-4" /></button>
        </form>
      )}
    </aside>
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
                {mappen.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
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
                <select className="input-base py-1.5 text-sm" value={ondertekenaar} onChange={(e) => setOndertekenaar(e.target.value)} aria-label="Wie tekent namens ons">
                  <option value="">Wie tekent? (Marco of Bram)</option>
                  {ONDERTEKENAARS.map((o) => <option key={o} value={o}>{o === 'Gezamenlijke lead' ? 'Marco of Bram (maakt niet uit)' : o}</option>)}
                </select>
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
