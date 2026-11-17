'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Download, Loader2, PenLine } from 'lucide-react'
import { HandtekeningVak } from '@/components/admin/handtekening-vak'
import { PdfVakken } from '@/components/esign/pdf-vakken'
import { datumRegel } from '@/lib/contracten/tegenhandtekening'
import type { Zone } from '@/lib/algemene-contracten/model'

const dag = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })

/**
 * De andere partij bekijkt het document en tekent op de plek die NextGenMedia
 * aanduidde (het blauwe vak): naam, handtekening, vinkje. Datum en uur komen
 * vanzelf. Daarna meteen de getekende versie downloaden.
 */
export function DocumentTekenen({ token, titel, moetTekenen, zone, onsGetekend, partijGetekend }: {
  token: string
  titel: string
  moetTekenen: boolean
  zone: Zone
  onsGetekend: { door: string | null; op: string } | null
  partijGetekend: { naam: string | null; op: string } | null
}) {
  const [naam, setNaam] = useState('')
  const [png, setPng] = useState<string | null>(null)
  const [akkoord, setAkkoord] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [getekend, setGetekend] = useState<{ naam: string | null; op: string } | null>(partijGetekend)
  const [versie, setVersie] = useState(0)
  const [datum, setDatum] = useState(() => datumRegel(new Date()))
  useEffect(() => { const t = setInterval(() => setDatum(datumRegel(new Date())), 15_000); return () => clearInterval(t) }, [])

  const pdf = `/api/document/${token}/pdf`
  const tekenNu = moetTekenen && !getekend

  const teken = async () => {
    setFout(null)
    if (naam.trim().length < 2) { setFout('Vul je volledige naam in.'); return }
    if (!png) { setFout('Teken eerst je handtekening.'); return }
    if (!akkoord) { setFout('Vink aan dat je het document gelezen hebt en ondertekent.'); return }
    setBezig(true)
    try {
      const r = await fetch(`/api/document/${token}/teken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam, handtekening: png, akkoord }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Ondertekenen mislukt')
      setGetekend({ naam: naam.trim(), op: j.op })
      setVersie((v) => v + 1)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Ondertekenen mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold break-words">{titel}</h1>
        <p className="text-sm text-gray-500 mt-1">
          {onsGetekend ? `Ondertekend door ${onsGetekend.door ?? 'NextGenMedia'} namens NextGenMedia op ${dag(onsGetekend.op)}.` : 'Van NextGenMedia.'}
          {getekend ? ` Door jou ondertekend${getekend.naam ? ` als ${getekend.naam}` : ''} op ${dag(getekend.op)}.` : ''}
        </p>
      </div>

      {getekend && (
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 flex items-start gap-2 flex-wrap">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span className="flex-1 min-w-[200px]">{moetTekenen || partijGetekend ? 'Ondertekend. Bedankt! NextGenMedia krijgt je handtekening meteen. Download hier je exemplaar.' : 'Hier is het document.'}</span>
          <a href={`${pdf}?download=1`} className="btn-primary text-sm"><Download className="h-4 w-4" />Getekende versie downloaden</a>
        </div>
      )}

      <div className={`grid gap-6 items-start ${tekenNu ? 'lg:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
        <PdfVakken key={versie} pdfUrl={pdf}
          vakken={tekenNu ? [{ key: 'partij', label: 'Jouw handtekening', kleur: 'blauw', zone, png, regels: [naam.trim() || 'Je naam', datum], bewerkbaar: false }] : []} />

        {tekenNu ? (
          <aside className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 space-y-4 lg:sticky lg:top-6">
            <div>
              <h2 className="font-semibold text-gray-900">Ondertekenen</h2>
              <p className="text-xs text-gray-500 mt-1">Je handtekening komt in het blauwe vak, met je naam en datum en uur eronder. Je hoeft niets af te drukken.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Volledige naam</label>
              <input className="input-base" value={naam} onChange={(e) => setNaam(e.target.value)} maxLength={80} autoComplete="name" placeholder="Voornaam en naam" />
            </div>
            <div>
              <span className="block text-xs font-medium text-gray-600 mb-1">Handtekening</span>
              <HandtekeningVak onChange={setPng} hoogte={150} />
            </div>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={akkoord} onChange={(e) => setAkkoord(e.target.checked)} className="h-4 w-4 mt-0.5 accent-gray-900" />
              <span>Ik heb het document gelezen en onderteken het.</span>
            </label>
            {fout && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2" role="alert">{fout}</p>}
            <button type="button" onClick={teken} disabled={bezig} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}Ondertekenen</button>
            <a href={`${pdf}?download=1`} className="block text-center text-xs text-gray-500 underline underline-offset-2 hover:text-black">Eerst downloaden en rustig nalezen</a>
          </aside>
        ) : !getekend && (
          <div className="flex justify-end"><a href={`${pdf}?download=1`} className="btn-primary text-sm"><Download className="h-4 w-4" />Document downloaden</a></div>
        )}
      </div>
    </div>
  )
}
