'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Het volgende externe factuurnummer (2026-124 …, vanaf januari 2027-001).
 * Het voorstel komt van de server (hoogste nummer van dit jaar + 1, of het
 * startnummer uit Instellingen → Facturatie); je kan het altijd aanpassen.
 */
export function useVolgendNummer(): { volgend: string | null; opnieuw: () => Promise<void> } {
  const [volgend, setVolgend] = useState<string | null>(null)
  const opnieuw = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/invoices/volgend-nummer', { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (r.ok && typeof j.nummer === 'string') setVolgend(j.nummer)
    } catch { /* geen voorstel: veld blijft leeg */ }
  }, [])
  useEffect(() => { void opnieuw() }, [opnieuw])
  return { volgend, opnieuw }
}
