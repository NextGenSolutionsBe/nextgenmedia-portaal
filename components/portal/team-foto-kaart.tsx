'use client'

import { Check, Sparkles } from 'lucide-react'

/**
 * Een teamlid kiezen met een grote foto: bij "Kies jouw expert" (aanvragen)
 * en "Met wie?" (meeting boeken). De klant kiest een persoon, dus die mag je
 * goed zien. Zonder foto: de initialen op een rustig vlak.
 */
export function TeamFotoKaart({ naam, sub, foto, tags, gekozen, onKies, label }: {
  naam: string; sub?: string | null; foto?: string | null; tags?: string[]; gekozen: boolean; onKies: () => void; label?: string | null
}) {
  const initialen = naam.split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase()
  return (
    <button type="button" role="radio" aria-checked={gekozen} onClick={onKies}
      className={`group text-left rounded-3xl border overflow-hidden flex flex-col bg-white transition focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 ${gekozen ? 'border-gray-900 ring-2 ring-gray-900 shadow-lg' : 'border-gray-200 hover:border-gray-400 hover:shadow-md'}`}>
      <span className="relative block aspect-[3/4] bg-gradient-to-br from-gray-100 to-gray-200 overflow-hidden">
        {foto
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={foto} alt={naam} loading="lazy" className="absolute inset-0 h-full w-full object-cover object-top transition duration-500 group-hover:scale-[1.03]" />
          : <span className="absolute inset-0 flex items-center justify-center text-5xl font-semibold text-gray-400">{initialen}</span>}
        <span className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/50 to-transparent" />
        {label && <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-gray-900 shadow"><Sparkles className="h-3 w-3" />{label}</span>}
        {gekozen && <span className="absolute top-3 right-3 h-8 w-8 rounded-full bg-gray-900 text-white flex items-center justify-center shadow-lg"><Check className="h-4 w-4" /></span>}
        <span className="absolute inset-x-0 bottom-0 p-3 sm:p-4">
          <span className="block text-base sm:text-lg font-semibold text-white leading-tight drop-shadow">{naam}</span>
          {sub && <span className="block text-xs sm:text-sm text-white/85 truncate">{sub}</span>}
        </span>
      </span>
      {tags && tags.length > 0 && (
        <span className="flex flex-wrap gap-1 p-3">{tags.map((x) => <span key={x} className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700">{x}</span>)}</span>
      )}
    </button>
  )
}

/** "Maakt niet uit" / "Geen voorkeur": klein en duidelijk, zodat de foto's de aandacht krijgen. */
export function GeenVoorkeur({ tekst, sub, gekozen, onKies }: { tekst: string; sub: string; gekozen: boolean; onKies: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={gekozen} onClick={onKies}
      className={`w-full flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${gekozen ? 'border-gray-900 ring-2 ring-gray-900' : 'border-gray-200 hover:border-gray-400'}`}>
      <span className={`h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center ${gekozen ? 'border-gray-900' : 'border-gray-300'}`}>{gekozen && <span className="h-2.5 w-2.5 rounded-full bg-gray-900" />}</span>
      <span className="min-w-0"><span className="block text-sm font-semibold">{tekst}</span><span className="block text-xs text-gray-600">{sub}</span></span>
    </button>
  )
}
