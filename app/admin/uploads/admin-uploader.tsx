'use client'

import { useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { BUCKET, LOSSE_BESTANDEN, MAX_BYTES, TOEGESTAAN, leesbareGrootte, mimeToegestaan } from '@/lib/client-uploads'
import { CheckCircle2, AlertCircle, Loader2, Upload, X } from 'lucide-react'

type Bezig = { sleutel: string; naam: string; klaar: boolean; fout: string | null }

/**
 * Bestanden uploaden als medewerker, rechtstreeks in de map van een klant.
 *
 * Zelfde tweetrapsschema als het portaal (link opvragen → rechtstreeks naar de
 * opslag → bevestigen), maar dan via de admin-routes: het pad wordt op de
 * server gebouwd met het client_id van deze map, nooit vanuit de browser.
 */
export function AdminUploader({
  clientId, mappen, standaardMapId, onKlaar,
}: {
  clientId: string
  mappen: { id: string; naam: string }[]
  /** Voorkeuzemap, bv. de map waarop nu gefilterd wordt. */
  standaardMapId: string | null
  onKlaar: () => void
}) {
  const [open, setOpen] = useState(false)
  const [mapId, setMapId] = useState<string>(standaardMapId ?? '')
  const [onderweg, setOnderweg] = useState<Bezig[]>([])
  const [melding, setMelding] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const invoer = useRef<HTMLInputElement>(null)

  const openPaneel = () => { setMapId(standaardMapId ?? ''); setOnderweg([]); setMelding(null); setOpen(true) }

  const verstuurEen = async (bestand: File) => {
    const aanvraag = await fetch('/api/admin/uploads/aanvragen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, bestandsnaam: bestand.name, mimetype: bestand.type, grootte: bestand.size, map_id: mapId || null }),
    })
    const a = await aanvraag.json().catch(() => ({}))
    if (!aanvraag.ok) throw new Error(a.error ?? 'De upload kon niet gestart worden.')

    const supabase = createClient()
    const { error } = await supabase.storage.from(BUCKET).uploadToSignedUrl(a.pad, a.token, bestand)
    if (error) throw new Error(error.message)

    const bevestig = await fetch('/api/admin/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        pad: a.pad,
        titel: bestand.name.replace(/\.[^.]+$/, '').slice(0, 200) || bestand.name,
        mimetype: bestand.type,
        bestandsnaam: bestand.name,
        map_id: mapId || null,
      }),
    })
    const c = await bevestig.json().catch(() => ({}))
    if (!bevestig.ok) throw new Error(c.error ?? 'Het bestand kon niet opgeslagen worden.')
  }

  const neemAan = async (bestanden: FileList | null) => {
    if (!bestanden || bestanden.length === 0) return
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
    setBezig(true)

    // Drie tegelijk: sneller dan één voor één, zonder de verbinding dicht te
    // trekken bij een map vol video's.
    let volgende = 0
    const werker = async () => {
      while (volgende < goed.length) {
        const i = volgende++
        try {
          await verstuurEen(goed[i])
          setOnderweg((o) => o.map((r) => (r.sleutel === rijen[i].sleutel ? { ...r, klaar: true } : r)))
        } catch (e) {
          const fout = e instanceof Error ? e.message : 'Mislukt'
          setOnderweg((o) => o.map((r) => (r.sleutel === rijen[i].sleutel ? { ...r, fout } : r)))
        }
      }
    }
    await Promise.all([werker(), werker(), werker()])
    setBezig(false)
    onKlaar()
  }

  const soorten = [...new Set(Object.values(TOEGESTAAN))].join(', ')
  const geslaagd = onderweg.filter((r) => r.klaar).length
  const mislukt = onderweg.filter((r) => r.fout).length

  return (
    <>
      <button
        type="button"
        onClick={openPaneel}
        className="text-xs font-semibold px-3 py-2 rounded-xl bg-black text-white hover:bg-gray-800 flex items-center gap-1.5"
      >
        <Upload className="h-3.5 w-3.5" />Bestanden uploaden
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => { if (!bezig) setOpen(false) }}
        >
          <div className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between p-4 border-b border-gray-100">
              <div>
                <h2 className="font-bold text-lg leading-tight">Bestanden uploaden</h2>
                <p className="text-xs text-gray-500 mt-0.5">Komen in deze klantmap terecht, gemarkeerd als &quot;Gezien&quot;.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={bezig}
                className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center shrink-0 disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <label className="block text-sm">
                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Submap</span>
                <select
                  value={mapId}
                  onChange={(e) => setMapId(e.target.value)}
                  disabled={bezig}
                  className="mt-1 w-full text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white"
                >
                  <option value="">{LOSSE_BESTANDEN}</option>
                  {mappen.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}
                </select>
              </label>

              <input
                ref={invoer}
                type="file"
                multiple
                accept={Object.keys(TOEGESTAAN).join(',')}
                className="hidden"
                onChange={(e) => { void neemAan(e.target.files); e.target.value = '' }}
              />
              <button
                type="button"
                onClick={() => invoer.current?.click()}
                disabled={bezig}
                className={cn(
                  'w-full border-2 border-dashed rounded-2xl px-4 py-8 text-center transition-colors',
                  bezig ? 'border-gray-200 text-gray-400' : 'border-gray-300 hover:border-black hover:bg-gray-50',
                )}
              >
                {bezig
                  ? <Loader2 className="h-6 w-6 mx-auto animate-spin" />
                  : <Upload className="h-6 w-6 mx-auto text-gray-400" />}
                <span className="block text-sm font-semibold mt-2">{bezig ? 'Bezig met uploaden…' : 'Kies bestanden'}</span>
                <span className="block text-xs text-gray-500 mt-1">{soorten} · max. {leesbareGrootte(MAX_BYTES)} per bestand</span>
              </button>

              {melding && (
                <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{melding}</p>
              )}

              {onderweg.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-gray-500">
                    {geslaagd} van {onderweg.length} klaar{mislukt > 0 && ` · ${mislukt} mislukt`}
                  </p>
                  <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-[#fff848] transition-all" style={{ width: `${Math.round(((geslaagd + mislukt) / onderweg.length) * 100)}%` }} />
                  </div>
                  <ul className="max-h-48 overflow-auto divide-y divide-gray-100 border border-gray-100 rounded-xl">
                    {onderweg.map((r) => (
                      <li key={r.sleutel} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                        {r.klaar
                          ? <CheckCircle2 className="h-3.5 w-3.5 text-green-600 shrink-0" />
                          : r.fout
                            ? <AlertCircle className="h-3.5 w-3.5 text-red-600 shrink-0" />
                            : <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400 shrink-0" />}
                        <span className="truncate flex-1">{r.naam}</span>
                        {r.fout && <span className="text-red-600 truncate max-w-[45%]" title={r.fout}>{r.fout}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!bezig && onderweg.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="w-full text-xs font-semibold px-3 py-2 rounded-xl bg-[#fff848] text-black hover:brightness-95"
                >
                  Sluiten
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
