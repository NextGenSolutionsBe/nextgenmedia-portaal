'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ChevronLeft, Loader2, Save, ListChecks, Share2, Inbox, Settings, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useVuilMelder } from '@/lib/vuil-register'
import { dienstLabel, FORMULIER_STATUS_INFO } from '@/lib/formulieren/model'
import { naarConcept, type Concept, type Formulier, type Link as DeelLink } from './types'
import { VeldenBuilder } from './velden-builder'
import { DelenTab } from './delen-tab'
import { InzendingenTab } from './inzendingen-tab'
import { InstellingenTab } from './instellingen-tab'

export type Tab = 'velden' | 'delen' | 'inzendingen' | 'instellingen'

export function FormulierEditor({ id, startTab, klantId }: { id: string; startTab: Tab; klantId: string | null }) {
  const [formulier, setFormulier] = useState<Formulier | null>(null)
  const [concept, setConcept] = useState<Concept | null>(null)
  const [links, setLinks] = useState<DeelLink[]>([])
  const [aantallen, setAantallen] = useState({ totaal: 0, nieuw: 0 })
  const [fout, setFout] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(startTab)
  const [bewaren, setBewaren] = useState(false)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/formulieren/${id}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setFormulier(j.formulier); setConcept(naarConcept(j.formulier)); setLinks(j.links ?? []); setAantallen(j.aantallen ?? { totaal: 0, nieuw: 0 })
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [id])
  useEffect(() => { laad() }, [laad])

  /** Enkel links + tellingen verversen (na een link aanmaken of intrekken), zonder het concept te overschrijven. */
  const herlaadLinks = useCallback(async () => {
    const r = await fetch(`/api/admin/formulieren/${id}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (r.ok) { setLinks(j.links ?? []); setAantallen(j.aantallen ?? { totaal: 0, nieuw: 0 }) }
  }, [id])

  const vuil = useMemo(() => !!formulier && !!concept && JSON.stringify(naarConcept(formulier)) !== JSON.stringify(concept), [formulier, concept])

  const opslaan = useCallback(async (extra?: Partial<Concept> & { gearchiveerd?: boolean }): Promise<boolean> => {
    if (!concept) return false
    setBewaren(true)
    try {
      const body = { ...concept, ...(extra ?? {}) }
      const r = await fetch(`/api/admin/formulieren/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setFormulier(j.formulier); setConcept(naarConcept(j.formulier))
      toast.success('Formulier opgeslagen')
      herlaadLinks()
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt'); return false } finally { setBewaren(false) }
  }, [concept, id, herlaadLinks])

  const opslaanVoorRegister = useCallback(() => opslaan(), [opslaan])
  useVuilMelder(`formulier-${id}`, 'Formulier', vuil, opslaanVoorRegister)

  // Browser sluiten/herladen met niet-opgeslagen wijzigingen: vragen.
  useEffect(() => {
    if (!vuil) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [vuil])

  const wisselTab = (t: Tab) => {
    setTab(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url.toString())
  }

  const wijzig = useCallback((p: Partial<Concept>) => setConcept((c) => (c ? { ...c, ...p } : c)), [])

  if (fout) return (
    <div className="space-y-4">
      <Link href="/admin/formulieren" className="btn-secondary w-fit"><ChevronLeft className="h-4 w-4" />Formulieren</Link>
      <div className="card-base text-sm text-red-700">{fout}</div>
    </div>
  )
  if (!formulier || !concept) return <div className="card-base empty-state"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>

  const tabs: { key: Tab; label: string; icon: React.ElementType; badge?: number }[] = [
    { key: 'velden', label: 'Velden', icon: ListChecks },
    { key: 'delen', label: 'Delen', icon: Share2 },
    { key: 'inzendingen', label: 'Inzendingen', icon: Inbox, badge: aantallen.nieuw },
    { key: 'instellingen', label: 'Instellingen', icon: Settings },
  ]
  const statusInfo = FORMULIER_STATUS_INFO[formulier.status]

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/admin/formulieren" className="btn-secondary px-2" aria-label="Terug naar formulieren"><ChevronLeft className="h-4 w-4" /></Link>
        <div className="flex-1 min-w-[12rem]">
          <h1 className="text-2xl font-bold truncate">{formulier.titel}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap text-xs">
            <span className={cn('status-badge', statusInfo.kleur)}>{statusInfo.label}</span>
            <span className="status-badge bg-gray-100 text-gray-700">{dienstLabel(formulier.dienst)}</span>
            {formulier.doel && <span className="text-gray-500">{formulier.doel}</span>}
            {formulier.gearchiveerd_op && <span className="status-badge bg-gray-200 text-gray-600">Gearchiveerd</span>}
            <span className="text-gray-400">{aantallen.totaal} inzending{aantallen.totaal === 1 ? '' : 'en'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {vuil && <span className="text-xs text-amber-600 font-medium">Niet-opgeslagen wijzigingen</span>}
          <button onClick={() => opslaan()} disabled={!vuil || bewaren} className="btn-primary">
            {bewaren ? <Loader2 className="h-4 w-4 animate-spin" /> : vuil ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {vuil ? 'Opslaan' : 'Opgeslagen'}
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => wisselTab(t.key)}
            className={cn('px-3 sm:px-4 py-2.5 text-sm font-medium flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap transition-colors', tab === t.key ? 'border-[#fff848] text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}
          >
            <t.icon className="h-4 w-4" />{t.label}
            {!!t.badge && <span className="ml-0.5 status-badge bg-[#fff848] text-black">{t.badge}</span>}
          </button>
        ))}
      </div>

      {tab === 'velden' && <VeldenBuilder concept={concept} wijzig={wijzig} />}
      {tab === 'delen' && (
        <DelenTab
          formulier={formulier} links={links} klantId={klantId} vuil={vuil}
          onLinksGewijzigd={herlaadLinks}
          activeer={() => { wijzig({ status: 'actief' }); return opslaan({ status: 'actief' }) }}
        />
      )}
      {tab === 'inzendingen' && <InzendingenTab formulier={formulier} onTellingGewijzigd={herlaadLinks} />}
      {tab === 'instellingen' && (
        <InstellingenTab
          formulier={formulier} concept={concept} wijzig={wijzig} aantalInzendingen={aantallen.totaal}
          archiveer={(aan) => opslaan({ gearchiveerd: aan })}
        />
      )}
    </div>
  )
}
