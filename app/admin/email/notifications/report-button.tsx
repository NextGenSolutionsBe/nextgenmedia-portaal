'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

export function ReportNowButton() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const run = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/email/report-now', { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      toast.success('Rapportmail verzonden.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verzenden mislukt')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button onClick={run} disabled={loading} className="btn-primary text-sm">
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      Rapport nu versturen
    </button>
  )
}
