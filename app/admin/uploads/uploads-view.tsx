'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { STATUSSEN, STATUS_LABELS, isVideo, leesbareGrootte, type Status } from '@/lib/client-uploads'
import { maakZipSchrijver, verdeelInDelen, uniekeNaam, zipBestandsnaam, zipSegment } from '@/lib/zip-browser'
import { Archive, CheckSquare, Download, Film, FolderInput, ImageIcon, Loader2, Square, Trash2, ExternalLink, X } from 'lucide-react'
import { AdminUploader } from './admin-uploader'

export type AdminUpload = {
  id: string
  client_id: string
  client_naam: string
  /** Naam van de map, of "Losse bestanden" als er geen map is. */
  map_naam: string
  map_id?: string | null
  titel: string
  beschrijving: string | null
  bestandsnaam: string
  mimetype: string | null
  grootte: number | null
  status: Status
  admin_notitie: string | null
  door_naam: string | null
  door_email: string | null
  created_at: string
  url: string | null
}

const datum = (s: string) =>
  new Date(s).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })

type Voortgang = { klaar: number; totaal: number; bytes: number; fase: string }
type Doel = { schrijf: (d: Uint8Array) => Promise<void>; sluit: (afgebroken: boolean) => Promise<void> }

/**
 * Waar de ZIP naartoe gaat. Kan de browser rechtstreeks naar een bestand op
 * schijf schrijven (Chrome/Edge), dan stroomt alles daarheen en blijft het
 * geheugen leeg. Anders verzamelen we de delen en bieden we het geheel aan als
 * één download. Moet in de klik zelf gebeuren: het opslagvenster mag enkel
 * open na een handeling van de gebruiker.
 */
async function openDoel(naam: string): Promise<Doel> {
  type Schrijfbaar = { write: (d: Uint8Array) => Promise<void>; close: () => Promise<void>; abort: () => Promise<void> }
  const w = window as unknown as { showSaveFilePicker?: (o: unknown) => Promise<{ createWritable: () => Promise<Schrijfbaar> }> }
  if (typeof w.showSaveFilePicker === 'function') {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName: naam, types: [{ description: 'ZIP-archief', accept: { 'application/zip': ['.zip'] } }] })
      const ws = await handle.createWritable()
      return { schrijf: (d) => ws.write(d), sluit: async (afgebroken) => { if (afgebroken) await ws.abort(); else await ws.close() } }
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') throw new Error('Opslaan geannuleerd.')
      // Geen toestemming of niet beschikbaar: terugvallen op een gewone download.
    }
  }
  const delen: Uint8Array[] = []
  return {
    schrijf: async (d) => { delen.push(d) },
    sluit: async (afgebroken) => {
      if (afgebroken) return
      const blob = new Blob(delen as unknown as BlobPart[], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = naam
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    },
  }
}

const KLEUR: Record<Status, string> = {
  nieuw: 'bg-[#fff848] text-black',
  gezien: 'bg-blue-100 text-blue-700',
  verwerkt: 'bg-green-100 text-green-700',
}

/**
 * Het raster met klantuploads.
 *
 * Zonder `clientId` (oude situatie) staat er een klantfilter bij. In een
 * klantmap (`clientId` = uuid) valt die filter weg en komt er een uploadknop
 * bij; in de map "Niet toegewezen" (`clientId` = null, `klantKeuze` gevuld)
 * kan elk bestand aan een klant gekoppeld worden.
 */
export function UploadsView({
  initieel, clientId, klantNaam, mappen: submappen = [], klantKeuze,
}: {
  initieel: AdminUpload[]
  /** uuid = map van één klant; null = map "Niet toegewezen"; weggelaten = alle klanten. */
  clientId?: string | null
  klantNaam?: string
  /** Submappen van de klant, voor de mapkeuze bij het uploaden. */
  mappen?: { id: string; naam: string }[]
  /** Klanten om een weesbestand aan te koppelen. */
  klantKeuze?: { id: string; naam: string }[]
}) {
  const router = useRouter()
  const inMap = clientId !== undefined
  const [lijst, setLijst] = useState(initieel)
  const [klant, setKlant] = useState('')
  const [mapNaam, setMapNaam] = useState('')
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState<AdminUpload | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [bulk, setBulk] = useState<Voortgang | null>(null)
  const stopRef = useRef<{ nu: boolean } | null>(null)
  const [selectie, setSelectie] = useState<Set<string>>(new Set())
  const [doelKlant, setDoelKlant] = useState('')
  const [toewijzen, setToewijzen] = useState(false)

  // Na een upload haalt de serverpagina de lijst opnieuw op (router.refresh);
  // dan moet het scherm die verse lijst ook echt overnemen.
  useEffect(() => { setLijst(initieel) }, [initieel])

  /**
   * Een geopende foto krijgt een eigen plek in de browsergeschiedenis. Zo
   * sluit de terugknop de foto in plaats van de hele pagina te verlaten —
   * dat was de reden dat je na "terug" op de startpagina belandde.
   */
  const openFoto = (u: AdminUpload) => {
    setOpen(u)
    try { window.history.pushState({ ngmUpload: u.id }, '') } catch { /* privémodus */ }
  }
  const sluitFoto = () => {
    let viaGeschiedenis = false
    try { viaGeschiedenis = !!(window.history.state as { ngmUpload?: string } | null)?.ngmUpload } catch { /* */ }
    if (viaGeschiedenis) window.history.back()
    else setOpen(null)
  }
  useEffect(() => {
    const terug = () => setOpen(null)
    window.addEventListener('popstate', terug)
    return () => window.removeEventListener('popstate', terug)
  }, [])

  const toggleSelectie = (id: string) => setSelectie((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const klanten = useMemo(
    () => [...new Set(lijst.map((u) => u.client_naam))].sort((a, b) => a.localeCompare(b)),
    [lijst],
  )

  // Mappen van de gekozen klant. Alle mappen van iedereen door elkaar in één
  // keuzelijst zou onbruikbaar zijn zodra er twee klanten "Gevel" gebruiken.
  const mappen = useMemo(() => {
    const relevant = klant ? lijst.filter((u) => u.client_naam === klant) : lijst
    return [...new Set(relevant.map((u) => u.map_naam))].sort((a, b) => a.localeCompare(b))
  }, [lijst, klant])

  const zichtbaar = lijst.filter(
    (u) => (!klant || u.client_naam === klant)
      && (!mapNaam || u.map_naam === mapNaam)
      && (!status || u.status === status),
  )

  const nieuwAantal = lijst.filter((u) => u.status === 'nieuw').length

  const wijzigStatus = async (id: string, nieuw: Status) => {
    setFout(null)
    // Meteen tonen, en terugdraaien als het misgaat: anders voelt elke klik traag.
    const vorige = lijst
    setLijst((l) => l.map((u) => (u.id === id ? { ...u, status: nieuw } : u)))
    const r = await fetch('/api/admin/uploads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: nieuw }),
    })
    if (!r.ok) {
      setLijst(vorige)
      setFout((await r.json()).error ?? 'Bijwerken mislukt.')
    }
  }

  /**
   * Alles wat nu zichtbaar is (dus binnen de gekozen klant/map/status) in één
   * keer downloaden als ZIP met de structuur Klant/Map/bestand. De browser
   * haalt de bestanden zelf op via verse getekende links en pakt ze in —
   * zonder servergrens op grootte of duur, met voortgang en een stopknop.
   */
  const downloadLijst = async (lijst: AdminUpload[], basis: string) => {
    if (lijst.length === 0 || bulk) return
    setFout(null)
    const stop = { nu: false }; stopRef.current = stop
    const meld = (deel: Partial<Voortgang>) => setBulk((b) => ({ ...(b ?? { klaar: 0, totaal: lijst.length, bytes: 0, fase: '' }), ...deel }))
    const mislukt: string[] = []
    let klaar = 0, bytes = 0
    try {
      // De verdeling in delen kennen we vooraf (de groottes staan in de lijst),
      // zodat het opslagvenster voor deel 1 nog binnen de klik kan openen.
      const delenVooraf = verdeelInDelen(lijst)
      const eersteDoel = await openDoel(zipBestandsnaam(basis, 1, delenVooraf.length, new Date()))
      meld({ fase: 'Downloadlinks ophalen…', totaal: lijst.length })

      const r = await fetch('/api/admin/uploads/download', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: lijst.map((u) => u.id) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Kon de bestanden niet ophalen.')
      const bestanden = (j.bestanden ?? []) as { id: string; pad: string; url: string | null; grootte: number | null }[]
      const delen = verdeelInDelen(bestanden)

      for (let d = 0; d < delen.length; d++) {
        if (stop.nu) break
        const doel = d === 0 ? eersteDoel : await openDoel(zipBestandsnaam(basis, d + 1, delen.length, new Date()))
        const zip = maakZipSchrijver(doel.schrijf)
        const gebruikt = new Set<string>()
        try {
          for (const b of delen[d]) {
            if (stop.nu) break
            meld({ fase: `${d + 1}/${delen.length} · ${b.pad}`, klaar, bytes })
            if (!b.url) { mislukt.push(b.pad); klaar++; continue }
            try {
              const res = await fetch(b.url)
              if (!res.ok) throw new Error(String(res.status))
              const data = new Uint8Array(await res.arrayBuffer())
              await zip.voegToe(uniekeNaam(gebruikt, b.pad), data)
              bytes += data.length
            } catch { mislukt.push(b.pad) }
            klaar++
            meld({ klaar, bytes })
          }
          if (!stop.nu) await zip.sluit()
        } finally {
          await doel.sluit(stop.nu)
        }
      }
      if (stop.nu) setFout('Download gestopt.')
      else if (mislukt.length > 0) setFout(`${mislukt.length} bestand(en) konden niet opgehaald worden en zitten niet in de ZIP: ${mislukt.slice(0, 5).join(', ')}${mislukt.length > 5 ? ' …' : ''}`)
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Downloaden mislukt.')
    } finally {
      setBulk(null); stopRef.current = null
    }
  }

  const naamBasis = (klant || (inMap && klantNaam)) ? `klantuploads-${zipSegment(klant || klantNaam || '')}` : 'klantuploads'
  const downloadAlles = () => downloadLijst(zichtbaar, naamBasis)
  const downloadSelectie = () => downloadLijst(zichtbaar.filter((u) => selectie.has(u.id)), `${naamBasis}-selectie`)
  const geselecteerdZichtbaar = zichtbaar.filter((u) => selectie.has(u.id))

  const verwijder = async (id: string) => {
    if (!confirm('Dit bestand definitief verwijderen? Ook uit de opslag.')) return
    const r = await fetch(`/api/admin/uploads?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) { setFout((await r.json()).error ?? 'Verwijderen mislukt.'); return }
    setLijst((l) => l.filter((u) => u.id !== id))
    setSelectie((sel) => { const n = new Set(sel); n.delete(id); return n })
    sluitFoto()
  }

  /**
   * Een weesbestand aan een klant hangen. Het bestand blijft waar het staat in
   * de opslag; enkel de koppeling verandert. Daarna hoort het niet meer in
   * deze map thuis, dus het verdwijnt uit de lijst.
   */
  const wijsToe = async (id: string) => {
    if (!doelKlant || toewijzen) return
    setFout(null); setToewijzen(true)
    try {
      const r = await fetch('/api/admin/uploads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, client_id: doelKlant }),
      })
      if (!r.ok) { setFout((await r.json()).error ?? 'Toewijzen mislukt.'); return }
      setLijst((l) => l.filter((u) => u.id !== id))
      setSelectie((sel) => { const n = new Set(sel); n.delete(id); return n })
      sluitFoto()
      router.refresh()
    } finally {
      setToewijzen(false)
    }
  }

  const standaardMapId = submappen.find((m) => m.naam === mapNaam)?.id ?? null

  return (
    <div className="space-y-5">
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        {!inMap && (
          <select
            value={klant}
            // Bij een andere klant vervalt de mapkeuze: die map bestaat daar
            // waarschijnlijk niet, en je zou naar een lege lijst kijken.
            onChange={(e) => { setKlant(e.target.value); setMapNaam('') }}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white"
          >
            <option value="">Alle klanten</option>
            {klanten.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        )}

        <select
          value={mapNaam} onChange={(e) => setMapNaam(e.target.value)}
          className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white"
        >
          <option value="">Alle mappen</option>
          {mappen.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        <div className="flex gap-1">
          <button
            onClick={() => setStatus('')}
            className={cn('text-xs font-semibold px-3 py-2 rounded-xl border',
              status === '' ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50')}
          >
            Alles ({lijst.length})
          </button>
          {STATUSSEN.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={cn('text-xs font-semibold px-3 py-2 rounded-xl border',
                status === s ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50')}
            >
              {STATUS_LABELS[s]}
              {s === 'nieuw' && nieuwAantal > 0 && ` (${nieuwAantal})`}
            </button>
          ))}
        </div>

        {clientId && (
          <span className="ml-auto">
            <AdminUploader
              clientId={clientId}
              mappen={submappen}
              standaardMapId={standaardMapId}
              onKlaar={() => router.refresh()}
            />
          </span>
        )}

        <button
          type="button"
          onClick={downloadAlles}
          disabled={zichtbaar.length === 0 || !!bulk}
          title={klant || mapNaam || status ? 'Downloadt alles binnen de gekozen filters als één ZIP (Klant/Map/bestand).' : 'Downloadt alle klantuploads als één ZIP (Klant/Map/bestand).'}
          className={cn('text-xs font-semibold px-3 py-2 rounded-xl bg-[#fff848] text-black hover:brightness-95 disabled:opacity-50 disabled:hover:brightness-100 flex items-center gap-1.5', !clientId && 'ml-auto')}
        >
          {bulk ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
          Alles downloaden ({zichtbaar.length} · {leesbareGrootte(zichtbaar.reduce((s, u) => s + (Number(u.grootte) || 0), 0))})
        </button>
      </div>

      {/* Selectie: meerdere foto's kiezen en in één keer downloaden. */}
      <div className="flex items-center gap-2 flex-wrap text-sm">
        <button type="button" onClick={() => setSelectie(new Set(zichtbaar.map((u) => u.id)))} disabled={zichtbaar.length === 0}
          className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
          Alles zichtbaar selecteren
        </button>
        {selectie.size > 0 && (
          <>
            <button type="button" onClick={() => setSelectie(new Set())} className="text-xs font-semibold px-3 py-1.5 rounded-xl border border-gray-200 hover:bg-gray-50">
              Selectie wissen
            </button>
            <button type="button" onClick={downloadSelectie} disabled={geselecteerdZichtbaar.length === 0 || !!bulk}
              className="text-xs font-semibold px-3 py-1.5 rounded-xl bg-black text-white hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1.5">
              <Download className="h-3.5 w-3.5" />
              Selectie downloaden ({geselecteerdZichtbaar.length} · {leesbareGrootte(geselecteerdZichtbaar.reduce((s, u) => s + (Number(u.grootte) || 0), 0))})
            </button>
            {geselecteerdZichtbaar.length < selectie.size && (
              <span className="text-[11px] text-gray-500">{selectie.size - geselecteerdZichtbaar.length} geselecteerde foto's vallen buiten de huidige filters.</span>
            )}
          </>
        )}
      </div>

      {bulk && (
        <div className="rounded-xl border border-gray-200 px-4 py-3 text-sm flex items-center gap-3 bg-white">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">ZIP maken · {bulk.klaar} van {bulk.totaal} bestanden · {leesbareGrootte(bulk.bytes)}</p>
            <p className="text-xs text-gray-500 truncate">{bulk.fase}</p>
            <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div className="h-full bg-[#fff848] transition-all" style={{ width: `${bulk.totaal ? Math.round((bulk.klaar / bulk.totaal) * 100) : 0}%` }} />
            </div>
          </div>
          <button
            type="button"
            onClick={() => { if (stopRef.current) stopRef.current.nu = true }}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 shrink-0"
          >
            Stoppen
          </button>
        </div>
      )}

      {fout && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{fout}</p>
      )}

      {/* ── Raster ── */}
      {zichtbaar.length === 0 ? (
        <p className="text-sm text-gray-500 border border-gray-200 rounded-2xl px-4 py-12 text-center">
          {lijst.length === 0 && inMap ? 'Nog geen uploads in deze map.' : 'Niets gevonden met deze filters.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {zichtbaar.map((u) => (
            <div key={u.id} className={cn('border rounded-2xl overflow-hidden flex flex-col bg-white relative', selectie.has(u.id) ? 'border-black ring-2 ring-[#fff848]' : 'border-gray-200')}>
              <button
                onClick={() => openFoto(u)}
                className="aspect-[4/3] bg-gray-100 flex items-center justify-center overflow-hidden group relative"
              >
                {u.url && !isVideo(u.mimetype)
                  ? <Image src={u.url} alt={u.titel} width={400} height={300} unoptimized
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform" />
                  : isVideo(u.mimetype)
                    ? <Film className="h-8 w-8 text-gray-400" />
                    : <ImageIcon className="h-8 w-8 text-gray-400" />}
                <span className={cn(
                  'absolute top-2 left-2 text-[10px] font-bold px-2 py-0.5 rounded-full',
                  KLEUR[u.status],
                )}>
                  {STATUS_LABELS[u.status]}
                </span>
              </button>
              {/* Selecteren voor een gebundelde download. Los van de kaartknop,
                  zodat een vinkje de foto niet opent. */}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleSelectie(u.id) }}
                className={cn('absolute top-2 right-2 h-7 w-7 rounded-lg flex items-center justify-center border shadow-sm',
                  selectie.has(u.id) ? 'bg-[#fff848] border-black text-black' : 'bg-white/90 border-gray-200 text-gray-500 hover:text-black')}
                title={selectie.has(u.id) ? 'Uit selectie halen' : 'Selecteren'}
                aria-pressed={selectie.has(u.id)}
              >
                {selectie.has(u.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
              </button>

              <div className="p-3 flex-1 flex flex-col gap-1">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide truncate">
                  {clientId ? u.map_naam : `${u.client_naam} · ${u.map_naam}`}
                </p>
                <p className="font-semibold text-sm leading-tight">{u.titel}</p>
                {u.beschrijving && (
                  <p className="text-xs text-gray-600 line-clamp-2">{u.beschrijving}</p>
                )}
                <p className="mt-auto pt-2 text-[11px] text-gray-400">
                  {datum(u.created_at)} · {leesbareGrootte(u.grootte)}
                  {u.door_naam && ` · ${u.door_naam}`}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Detail ── */}
      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={sluitFoto}
        >
          <div
            className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                  {clientId ? open.map_naam : `${open.client_naam} · ${open.map_naam}`}
                </p>
                <h2 className="font-bold text-lg leading-tight">{open.titel}</h2>
              </div>
              <button onClick={sluitFoto} className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="bg-gray-100 flex items-center justify-center max-h-[50vh] overflow-hidden">
              {open.url && !isVideo(open.mimetype) && (
                <Image src={open.url} alt={open.titel} width={1200} height={800} unoptimized
                  className="max-h-[50vh] w-auto object-contain" />
              )}
              {open.url && isVideo(open.mimetype) && (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video src={open.url} controls className="max-h-[50vh] w-auto" />
              )}
            </div>

            <div className="p-4 space-y-4">
              {open.beschrijving && (
                <div>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
                    Wat de klant erbij zei
                  </p>
                  <p className="text-sm whitespace-pre-wrap">{open.beschrijving}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-gray-400">Aangeleverd door</p>
                  <p className="font-medium">{open.door_naam ?? open.door_email ?? '—'}</p>
                </div>
                <div>
                  <p className="text-gray-400">Bestand</p>
                  <p className="font-medium truncate">{open.bestandsnaam} · {leesbareGrootte(open.grootte)}</p>
                </div>
              </div>

              {klantKeuze && klantKeuze.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                  <FolderInput className="h-4 w-4 text-gray-400 shrink-0" />
                  <select
                    value={doelKlant}
                    onChange={(e) => setDoelKlant(e.target.value)}
                    className="text-sm border border-gray-200 rounded-xl px-3 py-1.5 bg-white flex-1 min-w-[180px]"
                  >
                    <option value="">Kies een klant…</option>
                    {klantKeuze.map((k) => <option key={k.id} value={k.id}>{k.naam}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => wijsToe(open.id)}
                    disabled={!doelKlant || toewijzen}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-black text-white hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {toewijzen && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Toewijzen aan klant
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
                {STATUSSEN.map((s) => (
                  <button
                    key={s}
                    onClick={() => { wijzigStatus(open.id, s); setOpen({ ...open, status: s }) }}
                    className={cn('text-xs font-semibold px-3 py-1.5 rounded-lg border',
                      open.status === s ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50')}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}

                <div className="ml-auto flex items-center gap-2">
                  {open.url && (
                    <>
                      <a
                        href={open.url} target="_blank" rel="noopener noreferrer"
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1.5"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />Openen
                      </a>
                      <a
                        href={open.url} download={open.bestandsnaam}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#fff848] text-black hover:brightness-95 flex items-center gap-1.5"
                      >
                        <Download className="h-3.5 w-3.5" />Downloaden
                      </a>
                    </>
                  )}
                  <button
                    onClick={() => verwijder(open.id)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 flex items-center gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />Verwijderen
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
