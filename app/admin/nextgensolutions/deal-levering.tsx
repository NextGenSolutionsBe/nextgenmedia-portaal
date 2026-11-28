'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Rocket, FileText, ArrowRight } from 'lucide-react'
import { KlantKiezer, type KlantOptie } from '@/components/admin/klant-kiezer'
import { projectFaseLabel, type ProjectFase } from '@/lib/ngs/levering'
import type { Deal } from '@/lib/ngs/model'
import { lbl } from './ui'
import { lever } from './levering/care'

/**
 * Fase 5 in het dealvenster: de deal aan een klant in de app koppelen (bestaand
 * of nieuw, met btw-opzoeking) en na Closed Won de volgende stappen: het
 * leveringsproject en een contract. De audit gebeurt vóór Closed Won. Alles op een klik, niets vanzelf.
 */
export function DealLevering({ deal, onVernieuw }: { deal: Deal; onVernieuw: () => void }) {
  const [klanten, setKlanten] = useState<KlantOptie[] | null>(null)
  const [klant, setKlant] = useState<string>(deal.client_id ?? '')
  const [project, setProject] = useState<{ id: string; fase: ProjectFase } | null | undefined>(undefined)
  const [bezig, setBezig] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/clients-list', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { clients: [] })).then((j) => setKlanten(j.clients ?? [])).catch(() => setKlanten([]))
  }, [])
  useEffect(() => {
    if (deal.fase !== 'won') return
    fetch(`/api/admin/nextgensolutions/levering?deal=${deal.id}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { project: null })).then((j) => setProject(j.project ?? null)).catch(() => setProject(null))
  }, [deal.id, deal.fase])

  const koppel = async (k: KlantOptie | null) => {
    const vorige = klant
    setKlant(k?.id ?? '')
    setBezig('klant')
    try { await lever({ actie: 'deal.klant', deal: deal.id, client_id: k?.id ?? null }); toast.success(k ? `Gekoppeld aan ${k.company_name}.` : 'Losgekoppeld.'); onVernieuw() }
    catch (e) { setKlant(vorige); toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  const start = async () => {
    setBezig('start')
    try { const j = await lever({ actie: 'project.start', deal: deal.id }); setProject({ id: String(j.id), fase: 'briefing' }); toast.success('Leveringsproject gestart.'); onVernieuw() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  return (
    <section className="rounded-xl border border-gray-100 p-3.5 space-y-3">
      <div>
        <span className={lbl}>Klant in de app <span className="font-normal text-gray-400">(optioneel; nodig voor contract en facturen)</span></span>
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0"><KlantKiezer klanten={klanten} waarde={klant} onKies={koppel} onNieuw={(k) => setKlanten((l) => [...(l ?? []), k])} leegLabel="Nog geen klant" bron="ngs" id={`ngs-klant-${deal.id}`} /></div>
          {bezig === 'klant' && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        </div>
      </div>
      {deal.fase === 'won' && (
        <div className="rounded-xl bg-green-50/60 border border-green-100 p-3 space-y-2">
          <div className="text-sm font-semibold text-green-900">Volgende stappen na Closed Won</div>
          <div className="flex flex-wrap gap-2">
            {project === undefined ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
              : project ? <Link href={`/admin/nextgensolutions/levering?project=${project.id}`} className="btn-primary !py-1.5 !text-sm">Project openen · {projectFaseLabel(project.fase)}<ArrowRight className="h-4 w-4" /></Link>
                : <button type="button" onClick={start} disabled={!!bezig} className="btn-primary !py-1.5 !text-sm">{bezig === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}Leveringsproject starten</button>}
            {klant
              ? <Link href={`/admin/contracts/templates?client=${klant}&deal=${deal.id}`} className="btn-secondary !py-1.5 !text-sm"><FileText className="h-4 w-4" />Contract opmaken</Link>
              : <span className="text-xs text-green-900 self-center">Koppel eerst een klant voor het contract.</span>}
            {/* De audit gebeurt vóór Closed Won (nieuwe werking, 28 nov 2026): hier enkel nog project en contract. */}
          </div>
          <p className="text-[11px] text-green-900/80">Na het tekenen zet de app de facturen van het contract klaar, zoals bij elk contract.</p>
        </div>
      )}
    </section>
  )
}
