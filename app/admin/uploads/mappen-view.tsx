'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { AlertTriangle, Folder, Search } from 'lucide-react'

export type KlantMap = {
  id: string
  naam: string
  aantal: number
  /** ISO-datum van de jongste upload, of null als de map leeg is. */
  laatste: string | null
}

const datum = (s: string) =>
  new Date(s).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Het mappenoverzicht: zoeken op klantnaam, alfabetisch of op jongste upload.
 * Puur weergave — de data komt van de serverpagina.
 */
export function MappenView({ mappen, wees }: { mappen: KlantMap[]; wees: KlantMap | null }) {
  const [zoek, setZoek] = useState('')
  const [recentEerst, setRecentEerst] = useState(false)

  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase()
    const lijst = q ? mappen.filter((m) => m.naam.toLowerCase().includes(q)) : [...mappen]
    lijst.sort((a, b) => {
      if (recentEerst) {
        // Lege mappen achteraan; daarbinnen weer op naam.
        if (a.laatste !== b.laatste) {
          if (!a.laatste) return 1
          if (!b.laatste) return -1
          return b.laatste.localeCompare(a.laatste)
        }
      }
      return a.naam.localeCompare(b.naam, 'nl')
    })
    return lijst
  }, [mappen, zoek, recentEerst])

  const totaal = mappen.reduce((s, m) => s + m.aantal, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            placeholder="Zoek een klant…"
            className="w-full text-sm border border-gray-200 rounded-xl pl-9 pr-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-[#fff848]"
          />
        </label>

        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setRecentEerst(false)}
            className={cn('text-xs font-semibold px-3 py-2 rounded-xl border',
              !recentEerst ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50')}
          >
            A → Z
          </button>
          <button
            type="button"
            onClick={() => setRecentEerst(true)}
            className={cn('text-xs font-semibold px-3 py-2 rounded-xl border',
              recentEerst ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50')}
          >
            Meest recente upload eerst
          </button>
        </div>

        <p className="ml-auto text-xs text-gray-500">
          {mappen.length} klantmappen · {totaal} bestanden
        </p>
      </div>

      {wees && (
        <Link
          href={`/admin/uploads/${wees.id}`}
          className="flex items-center gap-3 border border-amber-200 bg-amber-50 rounded-2xl px-4 py-3 hover:bg-amber-100 transition-colors"
        >
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-sm">Niet toegewezen</p>
            <p className="text-xs text-amber-800">
              {wees.aantal} bestand{wees.aantal === 1 ? '' : 'en'} zonder bestaande klant
              {wees.laatste && ` · laatste ${datum(wees.laatste)}`}. Open de map om ze aan een klant te koppelen.
            </p>
          </div>
        </Link>
      )}

      {zichtbaar.length === 0 ? (
        <p className="text-sm text-gray-500 border border-gray-200 rounded-2xl px-4 py-12 text-center">
          {mappen.length === 0 ? 'Nog geen klanten.' : 'Geen klant gevonden met deze naam.'}
        </p>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {zichtbaar.map((m) => (
            <Link
              key={m.id}
              href={`/admin/uploads/${m.id}`}
              className="group border border-gray-200 bg-white rounded-2xl p-4 flex items-start gap-3 hover:border-black hover:shadow-sm transition-all"
            >
              <span className={cn(
                'h-11 w-11 rounded-xl flex items-center justify-center shrink-0',
                m.aantal > 0 ? 'bg-[#fff848] text-black' : 'bg-gray-100 text-gray-400',
              )}>
                <Folder className="h-5 w-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-sm leading-tight truncate group-hover:underline">{m.naam}</span>
                {m.aantal > 0 ? (
                  <>
                    <span className="block text-xs text-gray-600 mt-1">
                      {m.aantal} bestand{m.aantal === 1 ? '' : 'en'}
                    </span>
                    {m.laatste && (
                      <span className="block text-[11px] text-gray-400 mt-0.5">Laatste upload {datum(m.laatste)}</span>
                    )}
                  </>
                ) : (
                  <span className="block text-xs text-gray-400 mt-1">Nog geen uploads</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
