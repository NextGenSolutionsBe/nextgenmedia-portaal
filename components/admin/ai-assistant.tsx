'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, X, Send, Loader2, Check, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'

type PlanStep = { tool: string; params: Record<string, unknown>; summary: string; label: string; destructive: boolean }
type Result = { tool: string; ok: boolean; label: string; detail?: string }
type Msg = {
  role: 'user' | 'assistant'
  content: string
  needsInput?: string | null
  plan?: PlanStep[]
  hasDestructive?: boolean
  executed?: boolean
  running?: boolean
  results?: Result[]
  confirmText?: string
}

const SUGGESTIONS = [
  'Maak een taak "Logo aanleveren" voor …',
  'Welke klanten hebben nog geen contract?',
  'Maak een eenmalige factuur van €750 voor …',
  'Welke facturen moeten vandaag verstuurd worden?',
]

// ✨ NextGen AI — bereidt acties voor, voert ze uit ná bevestiging (tools roepen
// bestaande API's aan). Destructieve acties vereisen "VERWIJDEREN".
export function AiAssistant() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [msgs, loading])

  const send = async (text: string) => {
    const q = text.trim()
    if (!q || loading) return
    const next: Msg[] = [...msgs, { role: 'user', content: q }]
    setMsgs(next); setInput(''); setLoading(true)
    try {
      const res = await fetch('/api/admin/ai-assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setMsgs((m) => [...m, {
        role: 'assistant', content: j.answer || '', needsInput: j.needs_input || null,
        plan: j.plan ?? [], hasDestructive: !!j.hasDestructive, confirmText: '',
      }])
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', content: e instanceof Error ? e.message : 'Er ging iets mis.' }])
    } finally { setLoading(false) }
  }

  const setMsg = (idx: number, patch: Partial<Msg>) => setMsgs((m) => m.map((x, i) => i === idx ? { ...x, ...patch } : x))

  const execute = async (idx: number) => {
    const msg = msgs[idx]
    if (!msg.plan?.length) return
    if (msg.hasDestructive && msg.confirmText !== 'VERWIJDEREN') return
    setMsg(idx, { running: true })
    try {
      const res = await fetch('/api/admin/ai-execute', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steps: msg.plan.map((s) => ({ tool: s.tool, params: s.params })), confirmation: msg.confirmText || undefined }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setMsg(idx, { running: false, executed: true, results: j.results ?? [] })
      router.refresh()
    } catch (e) {
      setMsg(idx, { running: false, executed: true, results: [{ tool: '', ok: false, label: 'Fout', detail: e instanceof Error ? e.message : 'Fout' }] })
    }
  }

  return (
    <>
      {!open && (
        <button onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-gray-900 text-white pl-3.5 pr-4 py-2.5 shadow-md hover:bg-black transition-colors">
          <Sparkles className="h-4 w-4" /><span className="text-sm font-medium">NextGen AI</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[min(440px,calc(100vw-2.5rem))] h-[min(640px,calc(100vh-2.5rem))] bg-white border border-gray-200 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-900 text-white">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><span className="font-medium text-sm">NextGen AI</span></div>
            <button onClick={() => setOpen(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-white/10"><X className="h-4 w-4" /></button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {msgs.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">Vraag iets of geef een opdracht. Ik bereid acties voor; jij bevestigt, ik voer uit.</p>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((sug) => (
                    <button key={sug} onClick={() => setInput(sug)} className="w-full text-left text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50">{sug}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${m.role === 'user' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-800'}`}>
                  {m.content && <div className="whitespace-pre-wrap">{m.content}</div>}
                  {m.needsInput && <div className="whitespace-pre-wrap text-gray-700">{m.needsInput}</div>}

                  {/* Actieplan */}
                  {m.plan && m.plan.length > 0 && (
                    <div className="mt-2 rounded-xl border border-gray-200 bg-white p-2.5 space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />Voorstel — bevestiging vereist</div>
                      <ol className="space-y-1">
                        {m.plan.map((step, j) => {
                          const r = m.results?.[j]
                          return (
                            <li key={j} className="flex items-start gap-2 text-xs">
                              {m.executed
                                ? (r?.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />)
                                : <span className="h-3.5 w-3.5 rounded-full border border-gray-300 mt-0.5 shrink-0" />}
                              <span className="min-w-0">
                                <span className="font-medium">{step.label}</span>{step.destructive && <span className="ml-1 text-[10px] text-red-600">DESTRUCTIEF</span>}
                                <span className="block text-gray-500">{step.summary}</span>
                                {m.executed && r && !r.ok && <span className="block text-red-600">{r.detail}</span>}
                              </span>
                            </li>
                          )
                        })}
                      </ol>

                      {!m.executed && (
                        <>
                          {m.hasDestructive && (
                            <input
                              value={m.confirmText ?? ''} onChange={(e) => setMsg(i, { confirmText: e.target.value })}
                              placeholder='Typ VERWIJDEREN om te bevestigen'
                              className="w-full px-2 py-1.5 text-xs border border-red-200 rounded-lg"
                            />
                          )}
                          <div className="flex gap-2">
                            <button
                              onClick={() => execute(i)}
                              disabled={m.running || (m.hasDestructive && m.confirmText !== 'VERWIJDEREN')}
                              className="btn-primary text-xs flex-1 justify-center disabled:opacity-40"
                            >
                              {m.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Bevestigen
                            </button>
                            <button onClick={() => setMsg(i, { executed: true, results: [], plan: [] })} className="btn-secondary text-xs">Annuleren</button>
                          </div>
                        </>
                      )}
                      {m.executed && m.results && m.results.length > 0 && (
                        <div className="text-[11px] text-gray-500">{m.results.filter((r) => r.ok).length}/{m.results.length} uitgevoerd</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && <div className="flex justify-start"><div className="bg-gray-100 rounded-2xl px-3 py-2 flex items-center gap-2 text-xs text-gray-500"><Loader2 className="h-4 w-4 animate-spin" />Denken…</div></div>}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(input) }} className="p-3 border-t border-gray-100 flex items-center gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Vraag of opdracht…" className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-gray-200" />
            <button type="submit" disabled={loading || !input.trim()} className="btn-primary px-3 disabled:opacity-40"><Send className="h-4 w-4" /></button>
          </form>
        </div>
      )}
    </>
  )
}
