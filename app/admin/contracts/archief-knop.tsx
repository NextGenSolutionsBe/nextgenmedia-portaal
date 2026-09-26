'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Archive, Loader2, ShieldCheck } from 'lucide-react'
import { maakZipSchrijver, uniekeNaam, zipBestandsnaam } from '@/lib/zip-browser'

type Item = { contract_id: string; titel: string | null; bestanden: { pad: string; url: string | null }[] }

/**
 * Het contractarchief als één ZIP: per klant een map, per contract het
 * getekende PDF, het ondertekeningscertificaat en het dossier. De browser
 * haalt de bestanden zelf op (tijdelijke links) en pakt ze in — geen
 * servergrens op grootte of duur.
 */
export function ArchiefKnop() {
  const [bezig, setBezig] = useState<string | null>(null)

  const download = async () => {
    setBezig('Archief ophalen…')
    try {
      const eerste = await fetch('/api/admin/contracts/archief', { cache: 'no-store' })
      let j = await eerste.json()
      if (!eerste.ok) throw new Error(j.error)
      // Oudere handtekeningen die nog niet in het archief zitten: eerst inhalen.
      if ((j.nogNietGearchiveerd ?? []).length > 0) {
        setBezig(`${j.nogNietGearchiveerd.length} oudere contracten archiveren…`)
        const r = await fetch('/api/admin/contracts/archief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'inhalen' }) })
        const rj = await r.json(); if (!r.ok) throw new Error(rj.error)
        const mislukt = (rj.verwerkt ?? []).filter((x: { ok: boolean }) => !x.ok)
        if (mislukt.length) toast.warning(`${mislukt.length} contract(en) konden niet gearchiveerd worden: ${mislukt.map((x: { titel: string | null }) => x.titel).join(', ')}`)
        const opnieuw = await fetch('/api/admin/contracts/archief', { cache: 'no-store' })
        j = await opnieuw.json(); if (!opnieuw.ok) throw new Error(j.error)
      }
      const items = (j.items ?? []) as Item[]
      if (items.length === 0) { toast.info('Er staan nog geen getekende contracten in het archief.'); return }

      const delen: Uint8Array[] = []
      const zip = maakZipSchrijver((d) => { delen.push(d) })
      const gebruikt = new Set<string>()
      let n = 0
      const totaal = items.reduce((t, i) => t + i.bestanden.length, 0)
      const fouten: string[] = []
      for (const item of items) {
        for (const b of item.bestanden) {
          n++; setBezig(`ZIP maken · ${n} van ${totaal}`)
          if (!b.url) { fouten.push(b.pad); continue }
          try {
            const res = await fetch(b.url); if (!res.ok) throw new Error(String(res.status))
            await zip.voegToe(uniekeNaam(gebruikt, b.pad), new Uint8Array(await res.arrayBuffer()))
          } catch { fouten.push(b.pad) }
        }
      }
      await zip.sluit()
      const blob = new Blob(delen as unknown as BlobPart[], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = zipBestandsnaam('contractarchief', 1, 1, new Date())
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      if (fouten.length) toast.warning(`${fouten.length} bestand(en) ontbreken in de ZIP.`)
      else toast.success(`Contractarchief gedownload: ${items.length} contract(en).`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Downloaden mislukt') }
    finally { setBezig(null) }
  }

  return (
    <button type="button" onClick={download} disabled={!!bezig} className="btn-secondary shrink-0"
      title="Alle getekende contracten met certificaat en dossier als één ZIP, uit het beschermde contractarchief.">
      {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
      <span className="hidden sm:inline">{bezig ?? 'Contractarchief'}</span>
      {!bezig && <ShieldCheck className="h-3.5 w-3.5 text-green-600 hidden sm:inline" />}
    </button>
  )
}
