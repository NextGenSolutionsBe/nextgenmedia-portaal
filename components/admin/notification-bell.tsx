'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Loader2, Check } from 'lucide-react'

type Notif = { id: string; kind: string; priority: 'high' | 'med' | 'low'; title: string; date: string | null; href: string }

const DOT: Record<string, string> = { high: 'bg-red-500', med: 'bg-amber-500', low: 'bg-blue-500' }
const READ_KEY = 'ngm.readNotifs'

// Eén notificatiecentrum: aggregeert alle modulemeldingen (afgeleid uit data).
// Gelezen-status in localStorage (geen DB). Alles klikbaar via deep-link.
export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)
  const [read, setRead] = useState<Set<string>>(new Set())
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try { setRead(new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]'))) } catch { /* */ }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/notifications')
      const j = await res.json()
      setItems(j.notifications ?? [])
    } catch { /* */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const persist = (s: Set<string>) => { setRead(new Set(s)); try { localStorage.setItem(READ_KEY, JSON.stringify([...s])) } catch { /* */ } }
  const unread = items.filter((n) => !read.has(n.id))
  const markAll = () => persist(new Set(items.map((n) => n.id)))
  const go = (n: Notif) => { const s = new Set(read); s.add(n.id); persist(s); setOpen(false); router.push(n.href) }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="relative h-9 w-9 flex items-center justify-center rounded-lg bg-white border border-gray-200 hover:border-gray-300" title="Meldingen">
        <Bell className="h-4 w-4 text-gray-600" />
        {unread.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{unread.length > 99 ? '99+' : unread.length}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
            <span className="text-sm font-semibold">Meldingen {unread.length > 0 && <span className="text-gray-400 font-normal">({unread.length})</span>}</span>
            {unread.length > 0 && <button onClick={markAll} className="text-xs text-gray-500 hover:text-black flex items-center gap-1"><Check className="h-3 w-3" />Alles gelezen</button>}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <div className="py-6 text-center text-gray-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
            ) : items.length === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">Geen openstaande meldingen 🎉</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {items.map((n) => {
                  const isRead = read.has(n.id)
                  return (
                    <li key={n.id}>
                      <button onClick={() => go(n)} className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 ${isRead ? 'opacity-60' : ''}`}>
                        <span className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${DOT[n.priority]}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-800 leading-snug">{n.title}</span>
                          {n.date && <span className="block text-[11px] text-gray-400">{new Date(n.date + (n.date.length === 7 ? '-01' : '')).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                        </span>
                        {!isRead && <span className="h-1.5 w-1.5 rounded-full bg-[#fff848] mt-1.5 shrink-0" />}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
