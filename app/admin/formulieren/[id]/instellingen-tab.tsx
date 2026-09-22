'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DIENSTEN, FORMULIER_STATUSSEN, FORMULIER_STATUS_INFO } from '@/lib/formulieren/model'
import type { Concept, Formulier } from './types'

const STATUS_UITLEG: Record<string, string> = {
  concept: 'Nog in opbouw: links tonen "niet beschikbaar".',
  actief: 'Klanten kunnen het formulier via een geldige link invullen.',
  gesloten: 'Afgesloten: geen nieuwe inzendingen meer, bestaande blijven bewaard.',
}

export function InstellingenTab({ formulier, concept, wijzig, aantalInzendingen, archiveer }: {
  formulier: Formulier
  concept: Concept
  wijzig: (p: Partial<Concept>) => void
  aantalInzendingen: number
  archiveer: (aan: boolean) => Promise<boolean>
}) {
  const router = useRouter()
  const [verwijderen, setVerwijderen] = useState(false)
  const inst = concept.instellingen
  const zetInst = (p: Partial<Concept['instellingen']>) => wijzig({ instellingen: { ...inst, ...p } })

  const verwijder = async () => {
    if (!confirm(`"${formulier.titel}" definitief verwijderen? Dit kan niet ongedaan gemaakt worden.`)) return
    setVerwijderen(true)
    try {
      const r = await fetch(`/api/admin/formulieren/${formulier.id}`, { method: 'DELETE' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Formulier verwijderd')
      router.push('/admin/formulieren')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt'); setVerwijderen(false) }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="card-base space-y-4">
        <h2 className="font-semibold text-sm">Algemeen</h2>
        <Veld label="Titel (zichtbaar voor de klant)">
          <input className="input-base" value={concept.titel} maxLength={200} onChange={(e) => wijzig({ titel: e.target.value })} />
        </Veld>
        <Veld label="Beschrijving (zichtbaar bovenaan het formulier)">
          <textarea className="input-base" rows={3} value={concept.beschrijving ?? ''} maxLength={2000} onChange={(e) => wijzig({ beschrijving: e.target.value })} />
        </Veld>
        <div className="grid sm:grid-cols-2 gap-4">
          <Veld label="Voor welke dienst?">
            <select className="input-base" value={concept.dienst} onChange={(e) => wijzig({ dienst: e.target.value })}>
              {DIENSTEN.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </Veld>
          <Veld label="Doel (intern label)">
            <input className="input-base" value={concept.doel ?? ''} maxLength={120} onChange={(e) => wijzig({ doel: e.target.value })} placeholder="bv. Intake huisstijl" />
          </Veld>
        </div>
      </div>

      <div className="card-base space-y-3">
        <h2 className="font-semibold text-sm">Status</h2>
        <div className="grid sm:grid-cols-3 gap-2">
          {FORMULIER_STATUSSEN.map((s) => (
            <button key={s} type="button" onClick={() => wijzig({ status: s })} className={cn('text-left rounded-xl border p-3 transition-colors', concept.status === s ? 'border-gray-900 bg-[#fff848]/15' : 'border-gray-200 hover:border-gray-300')}>
              <span className={cn('status-badge', FORMULIER_STATUS_INFO[s].kleur)}>{FORMULIER_STATUS_INFO[s].label}</span>
              <p className="text-xs text-gray-500 mt-1.5">{STATUS_UITLEG[s]}</p>
            </button>
          ))}
        </div>
      </div>

      <div className="card-base space-y-4">
        <h2 className="font-semibold text-sm">Na het invullen</h2>
        <Veld label="Tekst van de verstuurknop">
          <input className="input-base" value={inst.knop_tekst} maxLength={60} onChange={(e) => zetInst({ knop_tekst: e.target.value })} />
        </Veld>
        <Veld label="Bedanktekst">
          <textarea className="input-base" rows={3} value={inst.bedankt_tekst} maxLength={2000} onChange={(e) => zetInst({ bedankt_tekst: e.target.value })} />
        </Veld>
        <p className="text-xs text-gray-500">Een formulier kan onbeperkt opnieuw ingevuld worden; elke inzending komt apart binnen.</p>
        <p className="text-xs text-gray-400">Wijzigingen worden bewaard met de knop <strong>Opslaan</strong> bovenaan.</p>
      </div>

      <div className="card-base space-y-3">
        <h2 className="font-semibold text-sm">Archiveren of verwijderen</h2>
        {formulier.gearchiveerd_op ? (
          <button onClick={() => archiveer(false)} className="btn-secondary"><ArchiveRestore className="h-4 w-4" />Uit archief halen</button>
        ) : (
          <button onClick={() => { if (confirm('Formulier archiveren? Links werken dan niet meer; inzendingen blijven bewaard.')) archiveer(true) }} className="btn-secondary"><Archive className="h-4 w-4" />Archiveren</button>
        )}
        {aantalInzendingen === 0 ? (
          <div>
            <button onClick={verwijder} disabled={verwijderen} className="btn-danger">{verwijderen ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Definitief verwijderen</button>
            <p className="text-xs text-gray-400 mt-1">Kan enkel zolang er geen inzendingen zijn.</p>
          </div>
        ) : (
          <p className="text-xs text-gray-500">Dit formulier heeft {aantalInzendingen} inzending{aantalInzendingen === 1 ? '' : 'en'} en kan daarom niet verwijderd worden — archiveer het in de plaats.</p>
        )}
      </div>
    </div>
  )
}

function Veld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  )
}
