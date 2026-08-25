'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  BUCKET, MAX_BYTES, STATUS_LABELS, isVideo, leesbareGrootte, mimeToegestaan,
  type Status,
} from '@/lib/client-uploads'
import { Upload, X, Trash2, CheckCircle2, AlertCircle, ImageIcon, Film, Loader2 } from 'lucide-react'

export type Bestaand = {
  id: string
  titel: string
  beschrijving: string | null
  bestandsnaam: string
  mimetype: string | null
  grootte: number | null
  status: Status
  door_naam: string | null
  created_at: string
  url: string | null
}

/** Een bestand dat klaarstaat om verstuurd te worden. */
type InWachtrij = {
  sleutel: string
  bestand: File
  titel: string
  beschrijving: string
  voorbeeld: string | null
  bezig: boolean
  fout: string | null
}

const datum = (s: string) =>
  new Date(s).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })

export function Uploader({
  initieel, magUploaden,
}: { initieel: Bestaand[]; magUploaden: boolean }) {
  const [lijst, setLijst] = useState<Bestaand[]>(initieel)
  const [wachtrij, setWachtrij] = useState<InWachtrij[]>([])
  const [sleept, setSleept] = useState(false)
  const [melding, setMelding] = useState<string | null>(null)
  const invoer = useRef<HTMLInputElement>(null)

  // Voorbeeldafbeeldingen zijn blob-URL's; die moeten weer vrijgegeven worden,
  // anders blijft het geheugen vollopen bij wie veel foto's achter elkaar kiest.
  useEffect(() => () => {
    wachtrij.forEach((w) => { if (w.voorbeeld) URL.revokeObjectURL(w.voorbeeld) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const voegToe = useCallback((bestanden: FileList | File[]) => {
    const nieuw: InWachtrij[] = []
    const geweigerd: string[] = []

    for (const b of Array.from(bestanden)) {
      if (!mimeToegestaan(b.type)) { geweigerd.push(`${b.name} (type niet ondersteund)`); continue }
      if (b.size > MAX_BYTES) { geweigerd.push(`${b.name} (${leesbareGrootte(b.size)} is te groot)`); continue }
      nieuw.push({
        sleutel: `${b.name}-${b.size}-${b.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        bestand: b,
        // De bestandsnaam zonder extensie is meestal een bruikbare eerste titel;
        // dat scheelt typewerk bij een reeks foto's.
        titel: b.name.replace(/\.[^.]+$/, '').slice(0, 200),
        beschrijving: '',
        voorbeeld: b.type.startsWith('image/') ? URL.createObjectURL(b) : null,
        bezig: false,
        fout: null,
      })
    }

    if (nieuw.length) setWachtrij((w) => [...w, ...nieuw])
    setMelding(geweigerd.length ? `Niet toegevoegd: ${geweigerd.join(', ')}` : null)
  }, [])

  const wijzig = (sleutel: string, veld: 'titel' | 'beschrijving', waarde: string) =>
    setWachtrij((w) => w.map((x) => (x.sleutel === sleutel ? { ...x, [veld]: waarde } : x)))

  const haalWeg = (sleutel: string) =>
    setWachtrij((w) => {
      const x = w.find((i) => i.sleutel === sleutel)
      if (x?.voorbeeld) URL.revokeObjectURL(x.voorbeeld)
      return w.filter((i) => i.sleutel !== sleutel)
    })

  /** Eén bestand: link opvragen, rechtstreeks uploaden, dan bevestigen. */
  const verstuurEen = async (item: InWachtrij): Promise<Bestaand | null> => {
    const aanvraag = await fetch('/api/portal/uploads/aanvragen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimetype: item.bestand.type, grootte: item.bestand.size }),
    })
    const a = await aanvraag.json()
    if (!aanvraag.ok) throw new Error(a.error ?? 'De upload kon niet gestart worden.')

    const supabase = createClient()
    const { error } = await supabase.storage.from(BUCKET)
      .uploadToSignedUrl(a.pad, a.token, item.bestand)
    if (error) throw new Error(error.message)

    const bevestig = await fetch('/api/portal/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pad: a.pad,
        titel: item.titel.trim() || item.bestand.name,
        beschrijving: item.beschrijving,
        mimetype: item.bestand.type,
        bestandsnaam: item.bestand.name,
      }),
    })
    const c = await bevestig.json()
    if (!bevestig.ok) throw new Error(c.error ?? 'Het bestand kon niet opgeslagen worden.')
    return null
  }

  const verstuurAlles = async () => {
    const zonderTitel = wachtrij.some((w) => !w.titel.trim())
    if (zonderTitel) { setMelding('Geef elk bestand een titel.'); return }

    setMelding(null)
    // Eén voor één, niet allemaal tegelijk: bij een reeks telefoonvideo's legt
    // parallel uploaden een gewone verbinding plat.
    for (const item of wachtrij) {
      setWachtrij((w) => w.map((x) => (x.sleutel === item.sleutel ? { ...x, bezig: true, fout: null } : x)))
      try {
        await verstuurEen(item)
        haalWeg(item.sleutel)
      } catch (e) {
        setWachtrij((w) => w.map((x) =>
          x.sleutel === item.sleutel ? { ...x, bezig: false, fout: (e as Error).message } : x))
      }
    }
    await herlaad()
  }

  const herlaad = async () => {
    const r = await fetch('/api/portal/uploads')
    const d = await r.json()
    if (r.ok) setLijst(d.uploads ?? [])
  }

  const verwijder = async (id: string) => {
    const r = await fetch(`/api/portal/uploads?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const d = await r.json()
    if (!r.ok) { setMelding(d.error ?? 'Verwijderen mislukt.'); return }
    setLijst((l) => l.filter((x) => x.id !== id))
  }

  return (
    <div className="space-y-8">
      {magUploaden && (
        <>
          {/* ── Neerzetvlak ── */}
          <div
            onDragOver={(e) => { e.preventDefault(); setSleept(true) }}
            onDragLeave={() => setSleept(false)}
            onDrop={(e) => { e.preventDefault(); setSleept(false); voegToe(e.dataTransfer.files) }}
            onClick={() => invoer.current?.click()}
            className={cn(
              'border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-colors',
              sleept ? 'border-black bg-[#fff848]/20' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50',
            )}
          >
            <Upload className="h-8 w-8 mx-auto text-gray-400" />
            <p className="mt-3 font-semibold text-sm">Sleep foto&apos;s of video&apos;s hierheen</p>
            <p className="text-xs text-gray-500 mt-1">of klik om te kiezen — meerdere tegelijk mag</p>
            <p className="text-[11px] text-gray-400 mt-3">
              JPG, PNG, WEBP, GIF, HEIC, MP4 of MOV · max {leesbareGrootte(MAX_BYTES)} per bestand
            </p>
            <input
              ref={invoer}
              type="file"
              multiple
              accept="image/*,video/mp4,video/quicktime"
              className="hidden"
              onChange={(e) => { if (e.target.files) voegToe(e.target.files); e.target.value = '' }}
            />
          </div>

          {melding && (
            <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{melding}</span>
            </div>
          )}

          {/* ── Wachtrij: titel en beschrijving invullen ── */}
          {wachtrij.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-sm">
                  Klaar om te versturen ({wachtrij.length})
                </h2>
                <button
                  onClick={verstuurAlles}
                  disabled={wachtrij.some((w) => w.bezig)}
                  className="bg-[#fff848] text-black font-semibold text-sm px-4 py-2 rounded-xl hover:brightness-95 disabled:opacity-50 transition"
                >
                  {wachtrij.some((w) => w.bezig) ? 'Bezig…' : 'Versturen'}
                </button>
              </div>

              {wachtrij.map((w) => (
                <div key={w.sleutel} className="border border-gray-200 rounded-2xl p-4 flex gap-4">
                  <div className="h-20 w-20 shrink-0 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center">
                    {w.voorbeeld
                      ? <Image src={w.voorbeeld} alt="" width={80} height={80} unoptimized className="h-full w-full object-cover" />
                      : <Film className="h-6 w-6 text-gray-400" />}
                  </div>

                  <div className="flex-1 min-w-0 space-y-2">
                    <input
                      value={w.titel}
                      onChange={(e) => wijzig(w.sleutel, 'titel', e.target.value)}
                      placeholder="Titel"
                      disabled={w.bezig}
                      className="w-full text-sm font-medium border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-black"
                    />
                    <textarea
                      value={w.beschrijving}
                      onChange={(e) => wijzig(w.sleutel, 'beschrijving', e.target.value)}
                      placeholder="Beschrijving — waar is dit, wat zien we, waarvoor mag het gebruikt worden?"
                      rows={2}
                      disabled={w.bezig}
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-black resize-none"
                    />
                    <div className="flex items-center gap-3 text-[11px] text-gray-400">
                      <span className="truncate">{w.bestand.name}</span>
                      <span>·</span>
                      <span>{leesbareGrootte(w.bestand.size)}</span>
                    </div>
                    {w.fout && (
                      <p className="text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />{w.fout}
                      </p>
                    )}
                  </div>

                  <button
                    onClick={() => haalWeg(w.sleutel)}
                    disabled={w.bezig}
                    className="h-8 w-8 shrink-0 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 flex items-center justify-center disabled:opacity-40"
                    aria-label="Uit de lijst halen"
                  >
                    {w.bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Wat er al ingestuurd is ── */}
      <div className="space-y-3">
        <h2 className="font-semibold text-sm">Ingestuurd ({lijst.length})</h2>

        {lijst.length === 0 ? (
          <p className="text-sm text-gray-500 border border-gray-200 rounded-2xl px-4 py-8 text-center">
            Er is nog niets ingestuurd.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {lijst.map((u) => (
              <div key={u.id} className="border border-gray-200 rounded-2xl overflow-hidden flex flex-col">
                <div className="aspect-[4/3] bg-gray-100 flex items-center justify-center overflow-hidden">
                  {u.url && !isVideo(u.mimetype)
                    ? <Image src={u.url} alt={u.titel} width={400} height={300} unoptimized className="h-full w-full object-cover" />
                    : isVideo(u.mimetype)
                      ? <Film className="h-8 w-8 text-gray-400" />
                      : <ImageIcon className="h-8 w-8 text-gray-400" />}
                </div>

                <div className="p-3 flex-1 flex flex-col gap-1.5">
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

                  <div className="mt-auto pt-2 flex items-center justify-between text-[11px] text-gray-400">
                    <span>{datum(u.created_at)} · {leesbareGrootte(u.grootte)}</span>
                    {magUploaden && u.status !== 'verwerkt' && (
                      <button
                        onClick={() => verwijder(u.id)}
                        className="text-gray-400 hover:text-red-600 transition"
                        aria-label="Verwijderen"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {u.status === 'verwerkt' && <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
