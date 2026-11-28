'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCcw } from 'lucide-react'

/** Dit merk nu bij Metricool ophalen (anders doet de planner het binnen 6 uur vanzelf). */
export function BijwerkenKnop({ blogId }: { blogId: string }) {
  const router = useRouter()
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const doe = async () => {
    setBezig(true); setFout(null)
    try {
      const r = await fetch('/api/admin/metricool/statistieken', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blog_id: blogId }),
      })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(j.error || 'Bijwerken mislukt')
      router.refresh()
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Bijwerken mislukt')
    } finally {
      setBezig(false)
    }
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" onClick={doe} disabled={bezig} className="btn-secondary">
        <RefreshCcw className={`h-4 w-4 ${bezig ? 'animate-spin' : ''}`} />{bezig ? 'Bezig, even geduld…' : 'Nu bijwerken'}
      </button>
      {fout && <p className="text-xs text-red-600">{fout}</p>}
    </div>
  )
}
