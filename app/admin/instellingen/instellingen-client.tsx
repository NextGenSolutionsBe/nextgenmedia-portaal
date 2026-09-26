'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Users, LayoutGrid, Building2, Receipt, Plug, FileImage, ShieldCheck, ScrollText, AlertTriangle } from 'lucide-react'
import type { AlleInstellingen, InstellingenSleutel, ModuleInfo, Rol } from '@/lib/instellingen/model'
import { Laden, Bevestig } from './ui'
import { SectieMedewerkers } from './sectie-medewerkers'
import { SectieModules } from './sectie-modules'
import { SectieBedrijf } from './sectie-bedrijf'
import { SectieFacturatie } from './sectie-facturatie'
import { SectieIntegraties } from './sectie-integraties'
import { SectieDocumenten } from './sectie-documenten'
import { SectieRechten } from './sectie-rechten'
import { SectieLogboek } from './sectie-logboek'

export type Bijgewerkt = Record<string, { op: string; door: string | null }>

/** Wat elke sectie van de pagina krijgt. */
export type Ctx = {
  inst: AlleInstellingen
  modules: ModuleInfo[]
  isAdmin: boolean
  rol: Rol
  omgeving: { clickupLijstEnv: string | null; clickupAssigneeEnv: string | null }
  bijgewerkt: Bijgewerkt
  bezig: boolean
  /** Eén sleutel opslaan; geeft true als het gelukt is. Toont zelf de meldingen. */
  opslaan: (sleutel: InstellingenSleutel, waarde: unknown, bevestigingen?: string[]) => Promise<boolean>
  /** Meld of er niet-opgeslagen wijzigingen zijn (voor de waarschuwing bij verlaten). */
  zetVuil: (vuil: boolean) => void
  herlaad: () => Promise<void>
}

export const TABS = [
  { key: 'medewerkers', label: 'Medewerkers', icon: Users },
  { key: 'modules', label: 'Tabbladen en modules', icon: LayoutGrid },
  { key: 'bedrijf', label: 'Bedrijfsgegevens', icon: Building2 },
  { key: 'facturatie', label: 'Facturatie-instellingen', icon: Receipt },
  { key: 'integraties', label: 'Integraties', icon: Plug },
  { key: 'documenten', label: 'Documenten en branding', icon: FileImage },
  { key: 'rechten', label: 'Gebruikersrechten', icon: ShieldCheck },
  { key: 'logboek', label: 'Activiteitenlogboek', icon: ScrollText },
] as const
export type TabKey = (typeof TABS)[number]['key']

type Data = Pick<Ctx, 'inst' | 'modules' | 'isAdmin' | 'rol' | 'omgeving' | 'bijgewerkt'>

export function InstellingenClient({ tab, verborgen, isAdmin }: { tab: string; verborgen: string | null; isAdmin: boolean }) {
  const router = useRouter()
  const actief: TabKey = (TABS.some((t) => t.key === tab) ? tab : 'medewerkers') as TabKey
  const [data, setData] = useState<Data | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [vuil, setVuil] = useState(false)
  const [wilNaar, setWilNaar] = useState<TabKey | null>(null)
  // Dubbel opslaan voorkomen: een ref, want state loopt één klik achter.
  const slot = useRef(false)

  const herlaad = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/instellingen', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      setData({ inst: j.instellingen, modules: j.modules, isAdmin: j.persoon.isAdmin, rol: j.persoon.rol, omgeving: j.omgeving, bijgewerkt: j.bijgewerkt ?? {} })
      setFout(null)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { herlaad() }, [herlaad])

  // Waarschuwing bij het sluiten of herladen van de pagina met open wijzigingen.
  useEffect(() => {
    if (!vuil) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [vuil])
  useEffect(() => { setVuil(false) }, [actief])

  const opslaan = useCallback<Ctx['opslaan']>(async (sleutel, waarde, bevestigingen = []) => {
    if (slot.current) return false
    slot.current = true; setBezig(true)
    try {
      const r = await fetch('/api/admin/instellingen', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sleutel, waarde, bevestigingen }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Opslaan mislukt')
      setData((d) => (d ? { ...d, inst: j.instellingen, bijgewerkt: { ...d.bijgewerkt, [sleutel]: { op: new Date().toISOString(), door: null } } } : d))
      setVuil(false)
      toast.success('De instellingen werden succesvol opgeslagen.')
      router.refresh()   // de zijbalk volgt meteen
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
      return false
    } finally { slot.current = false; setBezig(false) }
  }, [router])

  const ga = (key: TabKey) => {
    if (key === actief) return
    if (vuil) { setWilNaar(key); return }
    router.push(`/admin/instellingen?tab=${key}`)
  }

  if (fout) return <div className="card-base text-sm text-red-700 bg-red-50 border-red-100">Instellingen laden mislukt: {fout}</div>
  if (!data) return <Laden />

  const ctx: Ctx = { ...data, isAdmin: data.isAdmin && isAdmin, bezig, opslaan, zetVuil: setVuil, herlaad }
  const verborgenLabel = verborgen ? data.modules.find((m) => m.key === verborgen)?.label ?? verborgen : null

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] md:grid-cols-[250px_minmax(0,1fr)] gap-5 items-start">
      <nav className="card-base p-2 md:sticky md:top-6">
        <div className="flex md:flex-col gap-0.5 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon
            const aan = t.key === actief
            return (
              <button key={t.key} type="button" onClick={() => ga(t.key)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap md:whitespace-normal text-left transition-colors ${aan ? 'bg-black text-white' : 'text-gray-700 hover:bg-gray-100'}`}>
                <Icon className="h-4 w-4 shrink-0" />{t.label}
              </button>
            )
          })}
        </div>
      </nav>

      <div className="min-w-0 space-y-4">
        {verborgenLabel && actief === 'modules' && (
          <div className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div>Het tabblad <b>{verborgenLabel}</b> is globaal verborgen; daarom kwam je hier terecht. Zet het hieronder weer aan en sla op.</div>
          </div>
        )}
        {actief === 'medewerkers' && <SectieMedewerkers isAdmin={ctx.isAdmin} />}
        {actief === 'modules' && <SectieModules ctx={ctx} />}
        {actief === 'bedrijf' && <SectieBedrijf ctx={ctx} />}
        {actief === 'facturatie' && <SectieFacturatie ctx={ctx} />}
        {actief === 'integraties' && <SectieIntegraties isAdmin={ctx.isAdmin} />}
        {actief === 'documenten' && <SectieDocumenten ctx={ctx} />}
        {actief === 'rechten' && <SectieRechten ctx={ctx} />}
        {actief === 'logboek' && <SectieLogboek />}
      </div>

      {wilNaar && (
        <Bevestig titel="Niet-opgeslagen wijzigingen"
          tekst={<>Je hebt wijzigingen die nog niet opgeslagen zijn. Wil je dit onderdeel verlaten? De wijzigingen gaan dan verloren.</>}
          bevestigLabel="Verlaten zonder opslaan" gevaarlijk
          onBevestig={() => { const k = wilNaar; setWilNaar(null); setVuil(false); router.push(`/admin/instellingen?tab=${k}`) }}
          onAnnuleer={() => setWilNaar(null)} />
      )}
    </div>
  )
}
