'use client'

import { useState } from 'react'
import { MessageSquare, Send, Loader2, Check } from 'lucide-react'

export type Feedback = {
  id: string
  author_role: string
  message: string
  resolved: boolean
  created_at: string
}

export function ShootFeedback({ shootId, initialFeedback }: { shootId: string; initialFeedback: Feedback[] }) {
  const [list, setList] = useState<Feedback[]>(initialFeedback)
  const [msg, setMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!msg.trim()) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/portal/shoot-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shoot_id: shootId, message: msg.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Versturen mislukt')
      setList((l) => [...l, {
        id: `tmp-${Date.now()}`, author_role: 'client', message: msg.trim(), resolved: false, created_at: new Date().toISOString(),
      }])
      setMsg('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout')
    } finally { setLoading(false) }
  }

  return (
    <div className="border-t border-gray-100 pt-3 space-y-3">
      <div className="flex items-center gap-1.5 text-xs text-gray-500">
        <MessageSquare className="h-3.5 w-3.5" /> Feedback / opmerkingen
      </div>

      {list.length > 0 && (
        <div className="space-y-2">
          {list.map((f) => (
            <div key={f.id} className={`text-sm rounded-lg px-3 py-2 border ${
              f.author_role === 'admin' ? 'bg-gray-50 border-gray-200' : 'bg-blue-50/60 border-blue-100'
            }`}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[11px] font-medium text-gray-500">
                  {f.author_role === 'admin' ? 'NextGenMedia' : 'U'}
                </span>
                {f.resolved && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded-full">
                    <Check className="h-2.5 w-2.5" /> Verwerkt
                  </span>
                )}
              </div>
              <p className="text-gray-700 whitespace-pre-wrap">{f.message}</p>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-2">
        <textarea
          rows={2}
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder="Een opmerking of feedback op deze briefing…"
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]"
        />
        <button
          onClick={submit}
          disabled={loading || !msg.trim()}
          className="btn-primary text-sm shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Versturen
        </button>
      </div>
      {error && <div className="text-xs text-red-600">{error}</div>}
    </div>
  )
}
