'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'
import { useEffect, useRef, useTransition } from 'react'
import { zoekVeld } from '@/lib/zoekveld'

export function ClientsSearch({ defaultValue }: { defaultValue?: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const zoek = useSearchParams()
  const [, startTransition] = useTransition()
  // Pas zoeken als je even stopt met typen: elke letter liet de server de hele
  // klantenlijst opnieuw ophalen.
  const klok = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (klok.current) clearTimeout(klok.current) }, [])

  return (
    <div className="relative max-w-xs">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
      <input {...zoekVeld()}
        type="search"
        defaultValue={defaultValue}
        placeholder="Zoek klant..."
        className="input-base pl-9"
        onChange={(e) => {
          const waarde = e.target.value
          if (klok.current) clearTimeout(klok.current)
          klok.current = setTimeout(() => {
            startTransition(() => {
              // De filter "klant van" blijft staan tijdens het zoeken.
              const params = new URLSearchParams(zoek.toString())
              if (waarde) params.set('q', waarde); else params.delete('q')
              router.replace(`${pathname}?${params.toString()}`)
            })
          }, 250)
        }}
      />
    </div>
  )
}
