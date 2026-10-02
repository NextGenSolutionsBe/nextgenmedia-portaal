'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { MAP_NAAM_MAX } from '@/lib/client-uploads'
import { Folder, FolderPlus, Files, AlertCircle, Trash2, Pencil, Check, X } from 'lucide-react'

export type MapRij = {
  id: string
  naam: string
  beschrijving: string | null
  aantal: number
  nieuw: number
  /** Eerste afbeelding in de map, als voorbeeld op de kaart. */
  voorbeeld: string | null
}

export function MappenOverzicht({
  mappen, losAantal, losVoorbeeld, magBeheren,
}: {
  mappen: MapRij[]
  losAantal: number
  losVoorbeeld: string | null
  magBeheren: boolean
}) {
  const router = useRouter()
  const [nieuwOpen, setNieuwOpen] = useState(false)
  const [naam, setNaam] = useState('')
  const [tekst, setTekst] = useState('')
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [bewerkt, setBewerkt] = useState<string | null>(null)

  const maak = async () => {
    setBezig(true); setFout(null)
    const r = await fetch('/api/portal/upload-mappen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naam, beschrijving: tekst }),
    })
    setBezig(false)
    if (!r.ok) { setFout((await r.json()).error ?? 'De map kon niet gemaakt worden.'); return }
    setNaam(''); setTekst(''); setNieuwOpen(false)
    router.refresh()
  }

  const hernoem = async (id: string, nieuweNaam: string) => {
    const r = await fetch('/api/portal/upload-mappen', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, naam: nieuweNaam }),
    })
    if (!r.ok) { setFout((await r.json()).error ?? 'Hernoemen mislukt.'); return }
    setBewerkt(null)
    router.refresh()
  }

  const verwijder = async (id: string, aantal: number) => {
    const waarschuwing = aantal > 0
      ? `Deze map bevat ${aantal} bestand(en). De map verdwijnt, de bestanden blijven staan bij "Losse bestanden". Doorgaan?`
      : 'Deze map verwijderen?'
    if (!confirm(waarschuwing)) return
    const r = await fetch(`/api/portal/upload-mappen?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!r.ok) { setFout((await r.json()).error ?? 'Verwijderen mislukt.'); return }
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {magBeheren && (
        <div>
          {nieuwOpen ? (
            <div className="border border-gray-200 rounded-2xl p-4 space-y-3 bg-white">
              <input
                autoFocus
                value={naam}
                maxLength={MAP_NAAM_MAX}
                onChange={(e) => setNaam(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && naam.trim()) maak() }}
                placeholder="Naam van de map, bv. “Toonzaal maart”"
                className="w-full text-sm font-medium border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-black"
              />
              <textarea
                value={tekst}
                onChange={(e) => setTekst(e.target.value)}
                rows={2}
                placeholder="Waar gaat deze map over? — optioneel"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-black resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={maak}
                  disabled={bezig || !naam.trim()}
                  className="bg-[#fff848] text-black font-semibold text-sm px-4 py-2 rounded-xl hover:brightness-95 disabled:opacity-50"
                >
                  {bezig ? 'Bezig…' : 'Map maken'}
                </button>
                <button
                  onClick={() => { setNieuwOpen(false); setFout(null) }}
                  className="text-sm px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50"
                >
                  Annuleren
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setNieuwOpen(true)}
              className="inline-flex items-center gap-2 bg-[#fff848] text-black font-semibold text-sm px-4 py-2.5 rounded-xl hover:brightness-95"
            >
              <FolderPlus className="h-4 w-4" />Nieuwe map
            </button>
          )}
        </div>
      )}

      {fout && (
        <p className="flex items-start gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />{fout}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mappen.map((m) => (
          <div key={m.id} className="border border-gray-200 rounded-2xl overflow-hidden bg-white flex flex-col">
            <Link href={`/portal/bestanden/${m.id}`} className="block">
              <div className="aspect-[16/9] bg-gray-100 flex items-center justify-center overflow-hidden relative">
                {m.voorbeeld
                  ? <Image src={m.voorbeeld} alt="" width={480} height={270} unoptimized className="h-full w-full object-cover" />
                  : <Folder className="h-8 w-8 text-gray-300" />}
                {m.nieuw > 0 && (
                  <span className="absolute top-2 right-2 bg-[#fff848] text-black text-[10px] font-bold px-2 py-0.5 rounded-full">
                    {m.nieuw} nieuw
                  </span>
                )}
              </div>
            </Link>

            <div className="p-3 flex-1 flex flex-col gap-1">
              {bewerkt === m.id ? (
                <HernoemVeld
                  begin={m.naam}
                  opBewaren={(v) => hernoem(m.id, v)}
                  opStoppen={() => setBewerkt(null)}
                />
              ) : (
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/portal/bestanden/${m.id}`} className="font-semibold text-sm leading-tight hover:underline">
                    {m.naam}
                  </Link>
                  {magBeheren && (
                    <div className="flex items-center gap-1.5 shrink-0 text-gray-400">
                      <button onClick={() => setBewerkt(m.id)} className="hover:text-gray-700" aria-label="Hernoemen">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => verwijder(m.id, m.aantal)} className="hover:text-red-600" aria-label="Map verwijderen">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {m.beschrijving && <p className="text-xs text-gray-600 line-clamp-2">{m.beschrijving}</p>}
              <p className="mt-auto pt-2 text-[11px] text-gray-400">
                {m.aantal === 0 ? 'Nog leeg' : `${m.aantal} bestand${m.aantal === 1 ? '' : 'en'}`}
              </p>
            </div>
          </div>
        ))}

        {/* Losse bestanden: geen echte map, maar wel een plek. Enkel tonen als
            er iets in staat — anders is het een lege kaart die niets doet. */}
        {losAantal > 0 && (
          <Link
            href="/portal/bestanden/los"
            className="border border-gray-200 rounded-2xl overflow-hidden bg-white flex flex-col hover:border-gray-300 transition-colors"
          >
            <div className="aspect-[16/9] bg-gray-100 flex items-center justify-center overflow-hidden">
              {losVoorbeeld
                ? <Image src={losVoorbeeld} alt="" width={480} height={270} unoptimized className="h-full w-full object-cover opacity-90" />
                : <Files className="h-8 w-8 text-gray-300" />}
            </div>
            <div className="p-3">
              <p className="font-semibold text-sm">Losse bestanden</p>
              <p className="text-[11px] text-gray-400 mt-1.5">
                {losAantal} bestand{losAantal === 1 ? '' : 'en'} zonder map
              </p>
            </div>
          </Link>
        )}
      </div>

      {mappen.length === 0 && losAantal === 0 && (
        <div className={cn(
          'border border-dashed border-gray-300 rounded-2xl px-4 py-12 text-center',
        )}>
          <Folder className="h-8 w-8 mx-auto text-gray-300" />
          <p className="text-sm font-medium mt-3">Nog geen mappen</p>
          <p className="text-xs text-gray-500 mt-1">
            Maak een map per shoot, pand of onderwerp — dan blijft het overzichtelijk.
          </p>
        </div>
      )}
    </div>
  )
}

function HernoemVeld({
  begin, opBewaren, opStoppen,
}: { begin: string; opBewaren: (v: string) => void; opStoppen: () => void }) {
  const [waarde, setWaarde] = useState(begin)
  return (
    <div className="flex items-center gap-1.5">
      <input
        autoFocus
        value={waarde}
        maxLength={MAP_NAAM_MAX}
        onChange={(e) => setWaarde(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && waarde.trim()) opBewaren(waarde.trim())
          if (e.key === 'Escape') opStoppen()
        }}
        className="flex-1 min-w-0 text-sm font-medium border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:border-black"
      />
      <button
        onClick={() => waarde.trim() && opBewaren(waarde.trim())}
        className="text-gray-400 hover:text-gray-700" aria-label="Bewaren"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button onClick={opStoppen} className="text-gray-400 hover:text-gray-700" aria-label="Annuleren">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
