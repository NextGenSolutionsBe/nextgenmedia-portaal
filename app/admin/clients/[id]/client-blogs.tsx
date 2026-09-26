'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Newspaper, Loader2, Sparkles, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'

type Account = {
  id: string; name: string; client_id: string | null; active: boolean; framer_valid: boolean
  volgende_generatie_datum: string | null; published: number; review: number; failed: number
}

export function ClientBlogs({ clientId }: { clientId: string }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/blog-accounts'); const j = await res.json()
      if (res.ok) setAccount(((j.accounts ?? []) as Account[]).find((a) => a.client_id === clientId) ?? null)
    } catch { /* stil */ } finally { setLoading(false) }
  }, [clientId])
  useEffect(() => { load() }, [load])

  const generate = async () => {
    if (!account) return
    setBusy(true)
    try { const res = await fetch('/api/admin/blogs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', account_id: account.id }) }); const j = await res.json(); if (!res.ok) throw new Error(j.error); toast.success(`${j.created} blog(s) gegenereerd.`); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBusy(false) }
  }

  if (loading) return <div className="card-base"><div className="py-4 text-center text-gray-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div></div>

  return (
    <div className="card-base space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm text-gray-900 flex items-center gap-2"><Newspaper className="h-4 w-4 text-gray-400" />Blogs</h2>
        <Link href="/admin/blogaccounts" className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1">Blogaccounts <ArrowRight className="h-3 w-3" /></Link>
      </div>

      {!account ? (
        <div className="text-sm text-gray-500">
          Geen blogaccount gekoppeld aan deze klant.
          <Link href="/admin/blogaccounts" className="btn-secondary text-xs mt-2 inline-flex">Blogaccount aanmaken</Link>
        </div>
      ) : (
        <>
          <div className="text-sm flex items-center gap-2 flex-wrap">
            <span className="font-medium">{account.name}</span>
            {account.framer_valid ? <span className="inline-flex items-center gap-1 text-xs text-green-700">🟢 Framer gekoppeld</span> : <span className="inline-flex items-center gap-1 text-xs text-amber-700">🟠 Framer nog niet geconfigureerd</span>}
            {!account.active && <span className="status-badge bg-gray-100 text-gray-600 text-[10px]">inactief</span>}
          </div>
          <div className="text-xs text-gray-400">Volgende generatie: {account.volgende_generatie_datum ?? '—'}</div>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="status-badge bg-green-100 text-green-700">{account.published} gepubliceerd</span>
            <span className="status-badge bg-amber-100 text-amber-700">{account.review} review</span>
            {account.failed > 0 && <span className="status-badge bg-red-100 text-red-700">{account.failed} gefaald</span>}
          </div>
          <div className="flex gap-2 flex-wrap">
            <Link href={`/admin/blog-calendar?account=${account.id}`} className="btn-secondary text-sm">Kalender</Link>
            <Link href="/admin/blogaccounts" className="btn-secondary text-sm">Blogproject</Link>
            <button onClick={generate} disabled={busy} className="btn-primary text-sm">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Genereer nu</button>
          </div>
        </>
      )}
    </div>
  )
}
