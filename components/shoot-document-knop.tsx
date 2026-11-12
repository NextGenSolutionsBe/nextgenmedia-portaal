'use client'

import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

/** Bestandsnaam uit Content-Disposition (eerst RFC 5987 filename*, dan filename="…"). */
function bestandsnaamUit(header: string | null): string | null {
  if (!header) return null
  const ster = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (ster) { try { return decodeURIComponent(ster[1].trim()) } catch { /* val terug */ } }
  const gewoon = /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header)
  return gewoon ? gewoon[1].trim() : null
}

/**
 * Knop "Shootdocument downloaden". Haalt de PDF op via `href`, toont een
 * spinner tijdens het maken, geeft de foutmelding van de server (bv. 409 als
 * er nog geen scripts zijn) als toast en start anders een blob-download met de
 * bestandsnaam uit de header.
 */
export function ShootDocumentKnop({
  href, label = 'Shootdocument downloaden', variant = 'secondary', className = '', title,
}: {
  href: string
  label?: string
  variant?: 'primary' | 'secondary'
  className?: string
  title?: string
}) {
  const [bezig, setBezig] = useState(false)

  const start = async () => {
    if (bezig) return
    setBezig(true)
    try {
      const res = await fetch(href, { credentials: 'same-origin' })
      if (!res.ok) {
        let melding = 'Het shootdocument kon niet gemaakt worden. Probeer het later opnieuw.'
        try { const j = await res.json(); if (j?.error) melding = String(j.error) } catch { /* geen json */ }
        toast.error(melding)
        return
      }
      const blob = await res.blob()
      const naam = bestandsnaamUit(res.headers.get('content-disposition')) ?? 'Shootvoorbereiding.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = naam; a.rel = 'noopener'
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 15_000)
      toast.success('Shootdocument gedownload.')
    } catch {
      toast.error('Het shootdocument kon niet gedownload worden. Controleer je verbinding en probeer opnieuw.')
    } finally {
      setBezig(false)
    }
  }

  return (
    <button
      type="button"
      onClick={start}
      disabled={bezig}
      aria-busy={bezig}
      title={title ?? 'Print-klare checklist met alle scripts en medianotities voor de shoot'}
      className={`${variant === 'primary' ? 'btn-primary' : 'btn-secondary'} disabled:opacity-60 disabled:cursor-wait ${className}`}
    >
      {bezig ? <Loader2 className="h-4 w-4 animate-spin shrink-0" /> : <FileDown className="h-4 w-4 shrink-0" />}
      <span className="whitespace-nowrap">{bezig ? 'Shootdocument maken…' : label}</span>
    </button>
  )
}
