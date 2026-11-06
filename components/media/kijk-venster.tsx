'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, X } from 'lucide-react'
import { tijdLabel } from '@/lib/opleveringen'

/**
 * Een video of foto uit een oplevering bekijken. De ondertekende link wordt
 * pas opgehaald als het venster opent; de video streamt (de browser haalt
 * enkel het stuk op dat hij afspeelt), dus ook 4K laadt niet in één keer.
 * `onTijd` geeft de huidige afspeeltijd door (voor feedback met tijdcode).
 */
export function KijkVenster({ titel, soort, haalUrl, startTijd, onSluit, onDownload, onTijd, onderaan }: {
  titel: string
  soort: 'video' | 'foto' | 'ander'
  haalUrl: () => Promise<string>
  startTijd?: number | null
  onSluit: () => void
  onDownload?: () => void
  onTijd?: (sec: number) => void
  onderaan?: React.ReactNode
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const ref = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    let weg = false
    haalUrl().then((u) => { if (!weg) setUrl(u) }).catch((e) => { if (!weg) setFout(e instanceof Error ? e.message : 'Laden mislukt') })
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    window.addEventListener('keydown', esc); document.body.style.overflow = 'hidden'
    return () => { weg = true; window.removeEventListener('keydown', esc); document.body.style.overflow = '' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fixed inset-0 z-[70] bg-black/90 flex flex-col" role="dialog" aria-modal="true" aria-label={titel}>
      <div className="flex items-center gap-3 px-4 py-3 text-white">
        <p className="font-semibold truncate flex-1 min-w-0">{titel}</p>
        {onDownload && <button type="button" onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-sm"><Download className="h-4 w-4" />Downloaden</button>}
        <button type="button" onClick={onSluit} aria-label="Sluiten" className="h-10 w-10 rounded-lg hover:bg-white/10 flex items-center justify-center"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 min-h-0 flex items-center justify-center px-2 sm:px-6 pb-2">
        {fout ? <p className="text-white/80 text-sm max-w-md text-center">{fout}</p>
          : !url ? <Loader2 className="h-7 w-7 animate-spin text-white/70" />
          : soort === 'video' ? (
            <video ref={ref} src={url} controls autoPlay playsInline preload="metadata" className="max-h-full max-w-full rounded-lg bg-black"
              onLoadedMetadata={() => { if (startTijd && ref.current) ref.current.currentTime = startTijd }}
              onTimeUpdate={() => { if (ref.current) onTijd?.(ref.current.currentTime) }} />
          ) : soort === 'foto' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={titel} className="max-h-full max-w-full object-contain rounded-lg" />
          ) : (
            <a href={url} className="rounded-xl bg-white text-gray-900 px-5 py-3 font-semibold inline-flex items-center gap-2"><Download className="h-4 w-4" />Bestand openen</a>
          )}
      </div>
      {onderaan && <div className="bg-white max-h-[45dvh] overflow-y-auto">{onderaan}</div>}
    </div>
  )
}

/** Tijdcode als knop: springt in de speler naar dat moment. */
export function TijdKnop({ sec, onKies }: { sec: number | null; onKies?: (sec: number) => void }) {
  if (sec === null || sec === undefined) return null
  return onKies
    ? <button type="button" onClick={() => onKies(sec)} className="shrink-0 font-mono text-xs font-semibold rounded-md bg-gray-900 text-white px-1.5 py-0.5 hover:bg-gray-700">{tijdLabel(sec)}</button>
    : <span className="shrink-0 font-mono text-xs font-semibold rounded-md bg-gray-900 text-white px-1.5 py-0.5">{tijdLabel(sec)}</span>
}
