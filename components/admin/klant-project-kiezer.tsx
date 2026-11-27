'use client'

import { useEffect, useState } from 'react'
import { KlantKiezer, type KlantOptie } from '@/components/admin/klant-kiezer'

let klantenGeheugen: Promise<KlantOptie[]> | null = null
const laadKlanten = () => (klantenGeheugen ??= fetch('/api/admin/clients-list').then((r) => r.json()).then((j) => (j.clients ?? []) as KlantOptie[]).catch(() => []))

/**
 * Optioneel een klant en een project kiezen (verbeterplan fase 7, punt 80),
 * bv. bij een aankoop of een kost. Zo telt de kost mee in de marge van die
 * klant of dat project. Leeg = algemene kost.
 */
export function KlantProjectKiezer({ clientId, opdrachtId, onChange, id = 'kost-klant' }: {
  clientId: string | null; opdrachtId: string | null; onChange: (v: { client_id: string | null; opdracht_id: string | null }) => void; id?: string
}) {
  const [klanten, setKlanten] = useState<KlantOptie[] | null>(null)
  const [projecten, setProjecten] = useState<{ id: string; naam: string }[]>([])
  useEffect(() => { laadKlanten().then(setKlanten) }, [])
  useEffect(() => {
    if (!clientId) { setProjecten([]); return }
    let weg = false
    fetch(`/api/admin/purchases/projecten?client_id=${clientId}`).then((r) => r.json()).then((j) => { if (!weg) setProjecten(j.projecten ?? []) }).catch(() => null)
    return () => { weg = true }
  }, [clientId])
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div>
        <span className="block text-xs font-medium text-gray-600 mb-1">Klant (optioneel)</span>
        <KlantKiezer klanten={klanten} waarde={clientId ?? ''} onKies={(k) => onChange({ client_id: k?.id ?? null, opdracht_id: null })} leegLabel="Geen klant (algemene kost)" bron="kost" id={id} />
      </div>
      <label className="block">
        <span className="block text-xs font-medium text-gray-600 mb-1">Project (optioneel)</span>
        <select className="input-base" value={opdrachtId ?? ''} disabled={!clientId || !projecten.length} onChange={(e) => onChange({ client_id: clientId, opdracht_id: e.target.value || null })}>
          <option value="">{!clientId ? 'Kies eerst een klant' : projecten.length ? 'Geen project' : 'Geen projecten'}</option>
          {projecten.map((p) => <option key={p.id} value={p.id}>{p.naam}</option>)}
        </select>
      </label>
    </div>
  )
}
