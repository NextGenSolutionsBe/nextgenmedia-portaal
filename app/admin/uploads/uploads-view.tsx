'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { STATUSSEN, STATUS_LABELS, isVideo, leesbareGrootte, type Status } from '@/lib/client-uploads'
import { Download, Film, ImageIcon, Trash2, ExternalLink, X } from 'lucide-react'

export type AdminUpload = {
  id: string
  client_id: string
  client_naam: string
  /** Naam van de map, of "Losse bestanden" als er geen map is. */
  map_naam: string
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

const KLEUR: Record<Status, string> = {
  nieuw: 'bg-[#fff848] text-black',
  gezien: 'bg-blue-100 text-blue-700',
  verwerkt: 'bg-green-100 text-green-700',
}

export function UploadsView({ initieel }: { initieel: AdminUpload[] }) {
  const [lijst, setLijst] = useState(initieel)
  const [klant, setKlant] = useState('')
  const [mapNaam, setMapNaam] = useState('')
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState<AdminUpload | null>(null)
  const [fout, setFout] = useState<string | null>(null)

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

  const verwijder = async (id: string) => {
    if (!confirm('Dit bestand definitief verwijderen? Ook uit de opslag.')) return
    const r = await fetch(`/api/admin/uploads?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) { setFout((await r.json()).error ?? 'Verwijderen mislukt.'); return }
    setLijst((l) => l.filter((u) => u.id !== id))
    setOpen(null)
  }

  return (
    <div className="space-y-5">
      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
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
      </div>

      {fout && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{fout}</p>
      )}

      {/* ── Raster ── */}
      {zichtbaar.length === 0 ? (
        <p className="text-sm text-gray-500 border border-gray-200 rounded-2xl px-4 py-12 text-center">
          Niets gevonden met deze filters.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {zichtbaar.map((u) => (
            <div key={u.id} className="border border-gray-200 rounded-2xl overflow-hidden flex flex-col bg-white">
              <button
                onClick={() => setOpen(u)}
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

              <div className="p-3 flex-1 flex flex-col gap-1">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide truncate">
                  {u.client_naam} · {u.map_naam}
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
          onClick={() => setOpen(null)}
        >
          <div
            className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                  {open.client_naam} · {open.map_naam}
                </p>
                <h2 className="font-bold text-lg leading-tight">{open.titel}</h2>
              </div>
              <button onClick={() => setOpen(null)} className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center shrink-0">
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
