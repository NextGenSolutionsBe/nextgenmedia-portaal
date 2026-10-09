'use client'

import { Download, FileText } from 'lucide-react'
import { isAntwoordVeld, antwoordTekst, leesbareGrootte, type Veld, type BestandAntwoord } from '@/lib/formulieren/model'

/**
 * Een inzending leesbaar tonen, op basis van de velden zoals ze waren op het
 * moment van insturen (velden_snapshot). Bestanden als downloadlink, kleuren
 * als stalen, meerkeuze als chips.
 */
export function AntwoordWeergave({ velden, antwoorden, bestanden = {} }: {
  velden: Veld[]
  antwoorden: Record<string, unknown>
  /** pad → tijdelijke downloadlink */
  bestanden?: Record<string, string>
}) {
  const bekend = new Set(velden.map((v) => v.id))
  const los = Object.keys(antwoorden).filter((k) => !bekend.has(k))
  return (
    <div className="space-y-4">
      {velden.map((v) => {
        if (v.type === 'sectie') return <h3 key={v.id} className="text-sm font-semibold text-gray-900 border-b-2 border-[#fff848] pb-1 pt-2 inline-block">{v.label}</h3>
        if (!isAntwoordVeld(v.type)) return null
        const w = antwoorden[v.id]
        if (w === undefined) return null
        return (
          <div key={v.id}>
            <div className="text-xs font-medium text-gray-500 mb-0.5">{v.label}</div>
            <Waarde veld={v} waarde={w} bestanden={bestanden} />
          </div>
        )
      })}
      {los.length > 0 && (
        <div className="pt-2 border-t border-gray-100 space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-gray-400">Overige antwoorden</div>
          {los.map((k) => (
            <div key={k}><div className="text-xs font-medium text-gray-500 mb-0.5">{k}</div><div className="text-sm text-gray-900 whitespace-pre-wrap break-words">{antwoordTekst({ type: 'kort' }, antwoorden[k])}</div></div>
          ))}
        </div>
      )}
    </div>
  )
}

function Waarde({ veld, waarde, bestanden }: { veld: Veld; waarde: unknown; bestanden: Record<string, string> }) {
  if (veld.type === 'kleur' && Array.isArray(waarde)) {
    return (
      <div className="flex flex-wrap gap-2">
        {(waarde as string[]).map((hex) => (
          <span key={hex} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-mono">
            <span className="h-4 w-4 rounded border border-black/10" style={{ backgroundColor: /^#[0-9a-f]{6}$/i.test(hex) ? hex : 'transparent' }} />{hex}
          </span>
        ))}
      </div>
    )
  }
  if (veld.type === 'meerkeuze' && Array.isArray(waarde)) {
    return <div className="flex flex-wrap gap-1.5">{(waarde as string[]).map((o) => <span key={o} className="status-badge bg-gray-100 text-gray-700">{o}</span>)}</div>
  }
  if (veld.type === 'bestand' && Array.isArray(waarde)) {
    return (
      <ul className="space-y-1">
        {(waarde as BestandAntwoord[]).map((b) => {
          const url = bestanden[b.pad]
          const isBeeld = /\.(jpe?g|png|webp|gif|svg)$/i.test(b.pad)
          return (
            <li key={b.pad} className="flex items-center gap-2 text-sm">
              {isBeeld && url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={url} alt="" className="h-10 w-10 rounded object-cover border border-gray-200" />
                : <FileText className="h-4 w-4 text-gray-400" />}
              <span className="min-w-0 truncate">{b.naam}</span>
              <span className="text-xs text-gray-400 shrink-0">{leesbareGrootte(b.grootte)}</span>
              {url
                ? <a href={url} className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-black underline shrink-0"><Download className="h-3.5 w-3.5" />Download</a>
                : <span className="ml-auto text-xs text-gray-400 shrink-0">niet beschikbaar</span>}
            </li>
          )
        })}
      </ul>
    )
  }
  if (veld.type === 'url' && typeof waarde === 'string') {
    return <a href={waarde} target="_blank" rel="noopener noreferrer nofollow" className="text-sm text-blue-700 underline break-all">{waarde}</a>
  }
  if (veld.type === 'email' && typeof waarde === 'string') {
    return <a href={`mailto:${waarde}`} className="text-sm text-blue-700 underline break-all">{waarde}</a>
  }
  if (veld.type === 'schaal') {
    return <div className="text-sm text-gray-900"><span className="font-semibold">{String(waarde)}</span> <span className="text-gray-400">/ {veld.max ?? 5}</span></div>
  }
  return <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">{antwoordTekst(veld, waarde) || '—'}</div>
}
