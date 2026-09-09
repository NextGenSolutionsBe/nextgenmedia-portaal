'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Loader2, FileText, Users, Newspaper, Receipt, TrendingUp, ListChecks, UserSquare2, CornerDownLeft } from 'lucide-react'

type Result = { type: string; label: string; title: string; subtitle?: string; href: string }

const ICON: Record<string, React.ElementType> = {
  client: Users, contract: FileText, blog: Newspaper, invoice: Receipt,
  forecast: TrendingUp, task: ListChecks, partner: UserSquare2,
}

// Globale fuzzy zoekbalk met Cmd/Ctrl+K. Resultaten zijn direct klikbaar (deep-links).
export function GlobalSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  // Cmd/Ctrl+K opent, Escape sluit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen((v) => !v) }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 30) }, [open])

  const run = useCallback(async (term: string) => {
    const id = ++reqId.current
    if (term.trim().length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(term)}`)
      const j = await res.json()
      if (id === reqId.current) { setResults(j.results ?? []); setActive(0) }
    } catch { if (id === reqId.current) setResults([]) } finally { if (id === reqId.current) setLoading(false) }
  }, [])

  // Debounce de zoekopdracht.
  useEffect(() => { const t = setTimeout(() => run(q), 180); return () => clearTimeout(t) }, [q, run])

  const go = (r: Result) => { setOpen(false); setQ(''); setResults([]); router.push(r.href) }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]) }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 text-sm text-gray-400 bg-white border border-gray-200 rounded-lg px-3 py-2 hover:border-gray-300 transition-colors w-full max-w-xs"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left">Zoeken…</span>
        <kbd className="hidden sm:inline text-[10px] text-gray-400 border border-gray-200 rounded px-1">⌘K</kbd>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4 bg-black/30 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
              <Search className="h-4 w-4 text-gray-400" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Zoek klanten, contracten, blogs, facturen, prognose, taken, partners…"
                className="flex-1 text-sm outline-none"
              />
              {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </div>
            <div className="max-h-[55vh] overflow-y-auto">
              {q.trim().length < 2 ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">Typ minstens 2 tekens…</p>
              ) : results.length === 0 && !loading ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">Geen resultaten voor “{q}”.</p>
              ) : (
                <ul className="py-1">
                  {results.map((r, i) => {
                    const Icon = ICON[r.type] ?? FileText
                    return (
                      <li key={`${r.type}-${r.href}-${i}`}>
                        <button
                          onMouseEnter={() => setActive(i)}
                          onClick={() => go(r)}
                          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${i === active ? 'bg-[#fff848]/20' : 'hover:bg-gray-50'}`}
                        >
                          <span className="h-8 w-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0"><Icon className="h-4 w-4 text-gray-500" /></span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium truncate">{r.title}</span>
                            <span className="block text-xs text-gray-400 truncate">{r.label}{r.subtitle ? ` · ${r.subtitle}` : ''}</span>
                          </span>
                          {i === active && <CornerDownLeft className="h-3.5 w-3.5 text-gray-300 shrink-0" />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
