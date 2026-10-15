'use client'

import { useState } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Werkmap } from '@/lib/excel/spec'

/**
 * "Exporteren naar Excel" — één knop voor alle dashboards.
 *
 * Twee smaken:
 *  - `werkmap`: het scherm bouwt de werkmap uit zijn eigen, al geladen cijfers
 *    (dus exact wat er op het scherm staat, filters inbegrepen) en de server
 *    zet ze om naar .xlsx via POST /api/admin/export/xlsx;
 *  - `url`: een serverroute die de werkmap zelf samenstelt (voor pagina's die
 *    op de server renderen, zoals Financiën), met de filters in de querystring.
 */
export function ExportKnop({ werkmap, url, label = 'Exporteren naar Excel', className = 'btn-secondary text-sm', title }: {
  werkmap?: () => Werkmap | Promise<Werkmap>
  url?: string
  label?: string
  className?: string
  title?: string
}) {
  const [bezig, setBezig] = useState(false)

  const exporteer = async () => {
    if (bezig) return
    setBezig(true)
    try {
      let r: Response
      if (werkmap) {
        const w = await werkmap()
        r = await fetch('/api/admin/export/xlsx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ werkmap: w }) })
      } else if (url) {
        r = await fetch(url, { cache: 'no-store' })
      } else {
        throw new Error('Geen export ingesteld.')
      }
      if (!r.ok) {
        let fout = 'Export mislukt'
        try { fout = (await r.json()).error ?? fout } catch { }
        throw new Error(fout)
      }
      const blob = await r.blob()
      const kop = r.headers.get('X-Bestandsnaam')
      const naam = kop ? decodeURIComponent(kop) : 'NextGenMedia_Export.xlsx'
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href; a.download = naam; a.rel = 'noopener'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(href), 10_000)
      toast.success(`Excel-bestand klaar: ${naam}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export mislukt')
    } finally {
      setBezig(false)
    }
  }

  return (
    <button type="button" onClick={exporteer} disabled={bezig} className={className} title={title ?? 'Alle gegevens van dit dashboard als .xlsx, met formules en de actieve filters'}>
      {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
      {label}
    </button>
  )
}
