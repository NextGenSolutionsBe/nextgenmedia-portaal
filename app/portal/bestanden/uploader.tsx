'use client'

import { useCallback, useRef, useState } from 'react'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  BUCKET, MAX_BYTES, STATUS_LABELS, isVideo, leesbareGrootte, mimeToegestaan, type Status,
} from '@/lib/client-uploads'
import {
  Upload, Trash2, CheckCircle2, AlertCircle, ImageIcon, Film, Loader2, Pencil, Check, X, FolderInput,
} from 'lucide-react'

export type Bestaand = {
  id: string
  titel: string
  beschrijving: string | null
  bestandsnaam: string
  mimetype: string | null
  grootte: number | null
  status: Status
  created_at: string
  url: string | null
  map_id?: string | null
}

export type MapKeuze = { id: string; naam: string }

/** Sentinel voor "geen map". Een map-id is een uuid, dus hier is geen botsing
 *  mogelijk. */
const LOS = '__los'

/** Een bestand dat nu onderweg is. Bewust alleen wat er op het scherm moet:
 *  de rest komt terug van de server zodra het binnen is. */
type Bezig = { sleutel: string; naam: string; klaar: boolean; fout: string | null }

const datum = (s: string) =>
  new Date(s).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })

export function Uploader({
  mapId, initieel, magUploaden, mappen,
}: {
  /** null = losse bestanden (geen map). */
  mapId: string | null
  initieel: Bestaand[]
  magUploaden: boolean
  mappen: MapKeuze[]
}) {
  const router = useRouter()
  const [lijst, setLijst] = useState<Bestaand[]>(initieel)
  const [onderweg, setOnderweg] = useState<Bezig[]>([])
  const [reeksTekst, setReeksTekst] = useState('')
  const [sleept, setSleept] = useState(false)
  const [melding, setMelding] = useState<string | null>(null)
  const [bewerkt, setBewerkt] = useState<string | null>(null)
  const invoer = useRef<HTMLInputElement>(null)

  const herlaad = useCallback(async () => {
    const r = await fetch(`/api/portal/uploads?map=${mapId ?? 'los'}`)
    const d = await r.json()
    if (r.ok) setLijst(d.uploads ?? [])
    router.refresh()
  }, [mapId, router])

  /** Eén bestand: link opvragen, rechtstreeks uploaden, dan bevestigen. */
  const verstuurEen = async (bestand: File) => {
    const aanvraag = await fetch('/api/portal/uploads/aanvragen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimetype: bestand.type, grootte: bestand.size }),
    })
    const a = await aanvraag.json()
    if (!aanvraag.ok) throw new Error(a.error ?? 'De upload kon niet gestart worden.')

    const supabase = createClient()
    const { error } = await supabase.storage.from(BUCKET)
      .uploadToSignedUrl(a.pad, a.token, bestand)
    if (error) throw new Error(error.message)

    const bevestig = await fetch('/api/portal/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pad: a.pad,
        // De bestandsnaam zonder extensie is een prima eerste titel. Bijschaven
        // kan achteraf; vooraf twintig velden invullen zou niemand doen.
        titel: bestand.name.replace(/\.[^.]+$/, '').slice(0, 200) || bestand.name,
        beschrijving: reeksTekst,
        mimetype: bestand.type,
        bestandsnaam: bestand.name,
        map_id: mapId,
      }),
    })
    const c = await bevestig.json()
    if (!bevestig.ok) throw new Error(c.error ?? 'Het bestand kon niet opgeslagen worden.')
  }

  /**
   * Alles wat erin gesleept wordt gaat METEEN naar boven. Dat is het verschil
   * tussen "een foto insturen" en "een shoot aanleveren".
   */
  const neemAan = useCallback(async (bestanden: FileList | File[]) => {
    const goed: File[] = []
    const geweigerd: string[] = []

    for (const b of Array.from(bestanden)) {
      if (!mimeToegestaan(b.type)) { geweigerd.push(`${b.name} (type niet ondersteund)`); continue }
      if (b.size > MAX_BYTES) { geweigerd.push(`${b.name} (${leesbareGrootte(b.size)} is te groot)`); continue }
      goed.push(b)
    }
    setMelding(geweigerd.length ? `Niet meegenomen: ${geweigerd.join(', ')}` : null)
    if (goed.length === 0) return

    const rijen: Bezig[] = goed.map((b, i) => ({
      sleutel: `${b.name}-${b.size}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      naam: b.name, klaar: false, fout: null,
    }))
    setOnderweg((o) => [...o, ...rijen])

    // Eén voor één, niet allemaal tegelijk: bij een reeks telefoonvideo's legt
    // parallel uploaden een gewone verbinding plat.
    for (let i = 0; i < goed.length; i++) {
      try {
        await verstuurEen(goed[i])
        setOnderweg((o) => o.map((x) => (x.sleutel === rijen[i].sleutel ? { ...x, klaar: true } : x)))
      } catch (e) {
        setOnderweg((o) => o.map((x) =>
          x.sleutel === rijen[i].sleutel ? { ...x, fout: (e as Error).message } : x))
      }
    }

    await herlaad()
    // Geslaagde regels verdwijnen; wat misging blijft staan zodat het opvalt.
    setOnderweg((o) => o.filter((x) => x.fout))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [herlaad, mapId, reeksTekst])

  const bewerk = async (id: string, velden: Record<string, unknown>) => {
    const r = await fetch('/api/portal/uploads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...velden }),
    })
    if (!r.ok) { setMelding((await r.json()).error ?? 'Bijwerken mislukt.'); return false }
    return true
  }

  const verplaats = async (id: string, naarMap: string) => {
    if (!(await bewerk(id, { map_id: naarMap || null }))) return
    setLijst((l) => l.filter((x) => x.id !== id))
    router.refresh()
  }

  const verwijder = async (id: string) => {
    const r = await fetch(`/api/portal/uploads?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) { setMelding((await r.json()).error ?? 'Verwijderen mislukt.'); return }
    setLijst((l) => l.filter((x) => x.id !== id))
    router.refresh()
  }

  const bezigNu = onderweg.filter((o) => !o.klaar && !o.fout).length

  return (
    <div className="space-y-6">
      {magUploaden && (
        <>
          {/* Optioneel: één toelichting voor de hele reeks. Scheelt hetzelfde
              twintig keer typen bij foto's van dezelfde shoot. */}
          <div>
            <label htmlFor="reeks" className="block text-xs font-semibold text-gray-500 mb-1.5">
              Toelichting voor alles wat je nu toevoegt <span className="font-normal text-gray-400">— optioneel</span>
            </label>
            <textarea
              id="reeks"
              value={reeksTekst}
              onChange={(e) => setReeksTekst(e.target.value)}
              rows={2}
              placeholder="Bv. “Foto's van de nieuwe toonzaal, gemaakt op 12 maart. Mogen allemaal gebruikt worden.”"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-black resize-none"
            />
          </div>

          {/* ── Neerzetvlak ── */}
          <div
            onDragOver={(e) => { e.preventDefault(); setSleept(true) }}
            onDragLeave={() => setSleept(false)}
            onDrop={(e) => { e.preventDefault(); setSleept(false); neemAan(e.dataTransfer.files) }}
            onClick={() => invoer.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-colors',
              sleept ? 'border-black bg-[#fff848]/20' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50',
            )}
          >
            <Upload className="h-8 w-8 mx-auto text-gray-400" />
            <p className="mt-3 font-semibold text-sm">Sleep hier je foto&apos;s en video&apos;s in</p>
            <p className="text-xs text-gray-500 mt-1">
              of klik om te kiezen — selecteer er gerust honderd tegelijk
            </p>
            <p className="text-[11px] text-gray-400 mt-3">
              JPG, PNG, WEBP, GIF, HEIC, MP4 of MOV · max {leesbareGrootte(MAX_BYTES)} per bestand
            </p>
            <input
              ref={invoer}
              type="file"
              multiple
              accept="image/*,video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => { if (e.target.files) neemAan(e.target.files); e.target.value = '' }}
            />
          </div>

          {melding && (
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{melding}</span>
            </div>
          )}

          {/* ── Voortgang ── */}
          {onderweg.length > 0 && (
            <div className="border border-gray-200 rounded-2xl divide-y divide-gray-100">
              {bezigNu > 0 && (
                <p className="px-4 py-2.5 text-xs font-semibold text-gray-500 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Nog {bezigNu} bezig — laat dit venster open staan
                </p>
              )}
              {onderweg.map((o) => (
                <div key={o.sleutel} className="px-4 py-2 flex items-center gap-2 text-xs">
                  {o.fout
                    ? <AlertCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    : o.klaar
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                      : <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 shrink-0" />}
                  <span className="truncate flex-1">{o.naam}</span>
                  {o.fout && <span className="text-red-600 shrink-0">{o.fout}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Wat er in deze map staat ── */}
      <div className="space-y-3">
        <h2 className="font-semibold text-sm">In deze map ({lijst.length})</h2>

        {lijst.length === 0 ? (
          <p className="text-sm text-gray-500 border border-gray-200 rounded-2xl px-4 py-10 text-center">
            Nog niets. Sleep hierboven je bestanden erin.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lijst.map((u) => (
              <Kaart
                key={u.id}
                upload={u}
                mappen={mappen}
                huidigeMap={mapId}
                magBewerken={magUploaden}
                inBewerking={bewerkt === u.id}
                openBewerking={(aan) => setBewerkt(aan ? u.id : null)}
                opBewaren={async (titel, beschrijving) => {
                  if (!(await bewerk(u.id, { titel, beschrijving }))) return
                  setLijst((l) => l.map((x) => (x.id === u.id ? { ...x, titel, beschrijving } : x)))
                  setBewerkt(null)
                }}
                opVerplaatsen={(naar) => verplaats(u.id, naar)}
                opVerwijderen={() => verwijder(u.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Kaart({
  upload: u, mappen, huidigeMap, magBewerken, inBewerking, openBewerking,
  opBewaren, opVerplaatsen, opVerwijderen,
}: {
  upload: Bestaand
  mappen: MapKeuze[]
  huidigeMap: string | null
  magBewerken: boolean
  inBewerking: boolean
  openBewerking: (aan: boolean) => void
  opBewaren: (titel: string, beschrijving: string) => void
  opVerplaatsen: (naar: string) => void
  opVerwijderen: () => void
}) {
  const [titel, setTitel] = useState(u.titel)
  const [tekst, setTekst] = useState(u.beschrijving ?? '')

  // Zodra wij ermee aan de slag zijn hangt het materiaal ergens aan vast;
  // wijzigen is dan geen bijschaven meer maar iets stukmaken.
  const vast = u.status === 'verwerkt'

  return (
    <div className="border border-gray-200 rounded-2xl overflow-hidden flex flex-col bg-white">
      <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center overflow-hidden">
        {u.url && !isVideo(u.mimetype)
          ? <Image src={u.url} alt={u.titel} width={400} height={300} unoptimized className="h-full w-full object-cover" />
          : isVideo(u.mimetype)
            ? <Film className="h-8 w-8 text-gray-400" />
            : <ImageIcon className="h-8 w-8 text-gray-400" />}
      </div>

      <div className="p-3 flex-1 flex flex-col gap-1.5">
        {inBewerking ? (
          <>
            <input
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
              className="w-full text-sm font-medium border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-black"
            />
            <textarea
              value={tekst}
              onChange={(e) => setTekst(e.target.value)}
              rows={3}
              placeholder="Beschrijving"
              className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:border-black resize-none"
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => opBewaren(titel.trim() || u.titel, tekst)}
                className="flex-1 text-xs font-semibold bg-[#fff848] text-black rounded-lg py-1.5 hover:brightness-95 flex items-center justify-center gap-1"
              >
                <Check className="h-3 w-3" />Bewaren
              </button>
              <button
                onClick={() => { setTitel(u.titel); setTekst(u.beschrijving ?? ''); openBewerking(false) }}
                className="px-3 text-xs font-semibold border border-gray-200 rounded-lg hover:bg-gray-50"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-sm leading-tight">{u.titel}</p>
              <span className={cn(
                'text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0',
                u.status === 'verwerkt' ? 'bg-green-100 text-green-700'
                  : u.status === 'gezien' ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-600',
              )}>
                {STATUS_LABELS[u.status] ?? u.status}
              </span>
            </div>

            {u.beschrijving && <p className="text-xs text-gray-600 line-clamp-3">{u.beschrijving}</p>}

            <div className="mt-auto pt-2 flex items-center justify-between gap-2 text-[11px] text-gray-400">
              <span className="truncate">{datum(u.created_at)} · {leesbareGrootte(u.grootte)}</span>

              {magBewerken && !vast && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => openBewerking(true)} className="hover:text-gray-700" aria-label="Bewerken">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  {mappen.length > 0 && (
                    <label className="relative flex items-center hover:text-gray-700 cursor-pointer">
                      <FolderInput className="h-3.5 w-3.5" />
                      <span className="sr-only">Verplaatsen naar een andere map</span>
                      <select
                        value=""
                        // LET OP: "losse bestanden" heeft een eigen waarde en niet
                        // de lege string. Met twee lege opties doet de keuze niets,
                        // want die is dan niet te onderscheiden van de tijdelijke tekst.
                        onChange={(e) => { if (e.target.value) opVerplaatsen(e.target.value === LOS ? '' : e.target.value) }}
                        className="absolute inset-0 opacity-0 cursor-pointer"
                      >
                        <option value="">Verplaats naar…</option>
                        {huidigeMap !== null && <option value={LOS}>Losse bestanden</option>}
                        {mappen.filter((m) => m.id !== huidigeMap).map((m) => (
                          <option key={m.id} value={m.id}>{m.naam}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button onClick={opVerwijderen} className="hover:text-red-600" aria-label="Verwijderen">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
              {vast && <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
