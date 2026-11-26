'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, ChevronRight, ExternalLink, Loader2, Tags } from 'lucide-react'
import { KLASSIFICATIE_TABELLEN, dienstenLijst, vindDienst, vindBedrijf, type Catalogus, type KlassificatieRij } from '@/lib/bedrijven/model'
import { cn } from '@/lib/utils'

const dagKort = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Brussels' }) : '')

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/bedrijven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j
}

/**
 * Te classificeren (verbeterplan fase 1): records zonder zeker bedrijf of
 * dienst. Per regel een voorstel; één klik bevestigt, of je kiest iets
 * anders. Per soort kan je alle voorstellen in één keer bevestigen.
 * Enkel voor de zaakvoerders, enkel als er iets openstaat.
 */
export function TeClassificeren({ aantal }: { aantal: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [data, setData] = useState<{ catalogus: Catalogus; wachtrij: KlassificatieRij[] } | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [keuzes, setKeuzes] = useState<Record<string, string>>({})
  const [over, setOver] = useState(aantal)

  const laad = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/bedrijven?wachtrij=1', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      setData(j); setOver(j.wachtrij.length)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])

  const groepen = useMemo(() => {
    const m = new Map<string, KlassificatieRij[]>()
    for (const r of data?.wachtrij ?? []) {
      const k = `${r.tabel}:${r.veld}`
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return [...m.entries()]
  }, [data])

  if (over <= 0) return null

  const wissel = () => { const n = !open; setOpen(n); if (n && !data) laad() }

  const bevestig = async (r: KlassificatieRij, keuze: string) => {
    setBezig(r.id)
    try {
      await post({ actie: 'klassificeer', id: r.id, keuze })
      setData((d) => (d ? { ...d, wachtrij: d.wachtrij.filter((x) => x.id !== r.id) } : d))
      setOver((n) => n - 1)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
    finally { setBezig(null) }
  }

  const alles = async (tabel: string, veld: string, n: number) => {
    setBezig(`${tabel}:${veld}`)
    try {
      const j = await post({ actie: 'bevestig_alle', tabel, veld })
      toast.success(`${j.aantal} van ${n} bevestigd.`)
      await laad()
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
    finally { setBezig(null) }
  }

  const cat = data?.catalogus
  const label = (veld: string, waarde: string | null) => {
    if (!cat || !waarde) return '—'
    return veld === 'bedrijf' ? (vindBedrijf(cat, waarde)?.kort ?? waarde) : (vindDienst(cat, waarde)?.naam ?? waarde)
  }

  return (
    <div className="card-base">
      <button type="button" onClick={wissel} aria-expanded={open} className="w-full flex items-center gap-2 text-left">
        <Tags className="h-4 w-4 text-gray-500" />
        <span className="min-w-0 flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
          <span className="font-semibold text-gray-900 whitespace-nowrap">Te classificeren</span>
          <span className="text-sm text-gray-500">{over} {over === 1 ? 'record' : 'records'} zonder zeker bedrijf of dienst</span>
        </span>
        <ChevronRight className={cn('h-4 w-4 text-gray-400 ml-auto transition-transform', open && 'rotate-90')} />
      </button>

      {open && !data && <div className="mt-3 text-sm text-gray-400 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Laden…</div>}

      {open && data && cat && (
        <div className="mt-4 space-y-5">
          {groepen.map(([sleutel, rijen]) => {
            const [tabel, veld] = sleutel.split(':')
            const info = KLASSIFICATIE_TABELLEN[tabel]
            const metVoorstel = rijen.filter((r) => r.voorstel).length
            return (
              <div key={sleutel}>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                  <h3 className="text-sm font-semibold text-gray-900">{info?.meervoud ?? tabel} <span className="font-normal text-gray-500">· {veld === 'bedrijf' ? 'bedrijf' : 'dienst'} · {rijen.length}</span></h3>
                  {metVoorstel > 1 && (
                    <button type="button" className="btn-secondary !py-1 !text-xs" disabled={!!bezig} onClick={() => alles(tabel, veld, metVoorstel)}>
                      {bezig === sleutel ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Alle {metVoorstel} voorstellen bevestigen
                    </button>
                  )}
                </div>
                <div className="divide-y divide-gray-100 border-t border-b border-gray-100">
                  {rijen.map((r) => {
                    const keuze = keuzes[r.id] ?? r.voorstel ?? ''
                    return (
                      <div key={r.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                        <div className="min-w-0 flex-1 basis-60">
                          <div className="text-sm text-gray-900 truncate">
                            {r.link ? <Link href={r.link} className="hover:underline" prefetch={false}>{r.titel}</Link> : r.titel}
                            {r.link && <ExternalLink className="inline h-3 w-3 ml-1 text-gray-400" />}
                          </div>
                          <div className="text-xs text-gray-500 truncate">{[r.klant, dagKort(r.datum), r.reden].filter(Boolean).join(' · ')}</div>
                        </div>
                        {veld === 'bedrijf' ? (
                          <div className="flex gap-1">
                            {cat.bedrijven.map((b) => (
                              <button key={b.slug} type="button" disabled={!!bezig} onClick={() => bevestig(r, b.slug)}
                                className={cn('px-2.5 py-1 rounded-lg text-xs border transition-colors',
                                  r.voorstel === b.slug ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50')}
                                title={r.voorstel === b.slug ? 'Voorstel: klik om te bevestigen' : undefined}>
                                {bezig === r.id && r.voorstel === b.slug ? <Loader2 className="h-3 w-3 animate-spin inline" /> : b.kort ?? b.naam}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="flex gap-1.5 items-center">
                            <select className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white max-w-[13rem]" value={keuze} onChange={(e) => setKeuzes((k) => ({ ...k, [r.id]: e.target.value }))}>
                              <option value="">Kies een dienst…</option>
                              {cat.bedrijven.map((b) => (
                                <optgroup key={b.slug} label={b.naam}>
                                  {dienstenLijst(cat, { bedrijf: b.slug }).map((x) => <option key={x.slug} value={x.slug}>{x.parent_slug ? `  ${x.naam}` : x.naam}</option>)}
                                </optgroup>
                              ))}
                            </select>
                            <button type="button" className="btn-primary !py-1 !text-xs" disabled={!keuze || !!bezig} onClick={() => bevestig(r, keuze)}>
                              {bezig === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{keuze === r.voorstel ? 'Bevestigen' : 'Bewaren'}
                            </button>
                          </div>
                        )}
                        {veld === 'dienst' && r.voorstel && <div className="w-full text-[11px] text-gray-400 -mt-1">Voorstel: {label('dienst', r.voorstel)}</div>}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
          {groepen.length === 0 && <div className="text-sm text-gray-500">Alles is geclassificeerd.</div>}
        </div>
      )}
    </div>
  )
}
