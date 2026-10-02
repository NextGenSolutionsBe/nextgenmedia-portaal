'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Lock, Pencil, Plus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Dialoog, Bevestig, INP } from '@/app/admin/instellingen/ui'
import { NIET_TOEGEWEZEN, MAX_TYPE_LENGTE, gelijkType, normaliseerType } from '@/lib/contracten/types'

type TypeRij = { id: string | null; naam: string; actief: boolean; aantal: number }

/**
 * "Types beheren": contracttypes toevoegen, hernoemen en verwijderen.
 * Hernoemen neemt alle contracten met die naam mee (zie PATCH in de API).
 * Verwijderen kan enkel voor een type dat door geen enkel contract gebruikt
 * wordt; 'Niet toegewezen' is de terugval en blijft altijd bestaan.
 */
export function ContracttypesBeheer({ onSluit, onHernoemd, onGewijzigd }: {
  onSluit: () => void
  onHernoemd?: (van: string, naar: string) => void
  onGewijzigd?: () => void
}) {
  const [rijen, setRijen] = useState<TypeRij[] | null>(null)
  const [tabelAanwezig, setTabelAanwezig] = useState(true)
  const [bewerk, setBewerk] = useState<{ van: string; naar: string } | null>(null)
  const [nieuw, setNieuw] = useState('')
  const [bezig, setBezig] = useState<string | null>(null)
  const [weg, setWeg] = useState<TypeRij | null>(null)

  const laad = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/contracts/types', { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Contracttypes laden mislukt')
      setRijen((j.types ?? []) as TypeRij[])
      setTabelAanwezig(j.tabelAanwezig !== false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Contracttypes laden mislukt')
      setRijen([])
    }
  }, [])
  useEffect(() => { void laad() }, [laad])

  const toevoegen = async () => {
    const naam = normaliseerType(nieuw)
    if (!naam) return
    setBezig('__nieuw')
    try {
      const res = await fetch('/api/admin/contracts/types', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Toevoegen mislukt')
      if (j.bestond) toast.info(`"${j.naam}" bestaat al.`)
      else if (j.bewaard === false) toast.info('De lijst bewaren kan pas na de databasemigratie.')
      else toast.success(`Contracttype "${j.naam}" toegevoegd.`)
      setNieuw('')
      await laad(); onGewijzigd?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(null) }
  }

  const hernoemen = async () => {
    if (!bewerk) return
    const naar = normaliseerType(bewerk.naar)
    if (!naar) { toast.error('Geef een naam voor het contracttype.'); return }
    if (naar === bewerk.van) { setBewerk(null); return }
    setBezig(bewerk.van)
    try {
      const res = await fetch('/api/admin/contracts/types', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ van: bewerk.van, naar }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Hernoemen mislukt')
      toast.success(`Hernoemd naar "${j.naam}"${j.gewijzigd ? ` — ${j.gewijzigd} contract${j.gewijzigd === 1 ? '' : 'en'} bijgewerkt` : ''}.`)
      onHernoemd?.(bewerk.van, j.naam as string)
      setBewerk(null)
      await laad(); onGewijzigd?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Hernoemen mislukt') } finally { setBezig(null) }
  }

  const vraagVerwijderen = (t: TypeRij) => {
    if (t.aantal > 0) {
      toast.error(`"${t.naam}" wordt gebruikt door ${t.aantal} contract${t.aantal === 1 ? '' : 'en'}. Hernoem het type of geef die contracten eerst een ander type.`)
      return
    }
    setWeg(t)
  }

  const verwijderen = async () => {
    if (!weg) return
    setBezig(weg.naam)
    try {
      const res = await fetch(`/api/admin/contracts/types?naam=${encodeURIComponent(weg.naam)}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Verwijderen mislukt')
      toast.success(`Contracttype "${weg.naam}" verwijderd.`)
      setWeg(null)
      await laad(); onGewijzigd?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBezig(null) }
  }

  return (
    <>
      <Dialoog titel="Contracttypes beheren" onSluit={onSluit}>
        <div className="space-y-4">
          {!tabelAanwezig && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              De databasemigratie voor contracttypes is nog niet gedraaid: hernoemen werkt op de contracten, maar toevoegen en verwijderen worden pas bewaard na de migratie.
            </p>
          )}

          <div className="flex gap-2">
            <input
              className={INP} value={nieuw} maxLength={MAX_TYPE_LENGTE} placeholder="Nieuw contracttype…"
              onChange={(e) => setNieuw(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void toevoegen() } }}
            />
            <button type="button" onClick={() => void toevoegen()} disabled={!normaliseerType(nieuw) || bezig !== null} className="btn-primary shrink-0 disabled:opacity-40">
              {bezig === '__nieuw' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Toevoegen
            </button>
          </div>

          {rijen === null ? (
            <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : rijen.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">Geen contracttypes gevonden.</p>
          ) : (
            <ul className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
              {rijen.map((t) => {
                const vast = gelijkType(t.naam, NIET_TOEGEWEZEN)
                const inBewerking = bewerk && bewerk.van === t.naam
                return (
                  <li key={t.naam} className="px-3 py-2.5">
                    {inBewerking ? (
                      <div className="space-y-1.5">
                        <div className="flex gap-2">
                          <input
                            autoFocus className={INP} value={bewerk.naar} maxLength={MAX_TYPE_LENGTE}
                            onChange={(e) => setBewerk({ van: t.naam, naar: e.target.value })}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') { e.preventDefault(); void hernoemen() }
                              if (e.key === 'Escape') { e.stopPropagation(); setBewerk(null) }
                            }}
                            aria-label={`Nieuwe naam voor ${t.naam}`}
                          />
                          <button type="button" onClick={() => void hernoemen()} disabled={bezig !== null} className="btn-primary shrink-0 px-3" aria-label="Opslaan">
                            {bezig === t.naam ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </button>
                          <button type="button" onClick={() => setBewerk(null)} disabled={bezig !== null} className="btn-secondary shrink-0 px-3" aria-label="Annuleren">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {t.aantal > 0 && (
                          <p className="text-[11px] text-gray-500">{t.aantal} contract{t.aantal === 1 ? '' : 'en'} krijg{t.aantal === 1 ? 't' : 'en'} de nieuwe naam.</p>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex-1 min-w-[140px]">
                          <div className="text-sm font-medium text-gray-900 break-words flex items-center gap-1.5">
                            {vast && <Lock className="h-3.5 w-3.5 text-gray-400 shrink-0" />}{t.naam}
                          </div>
                          <div className="text-[11px] text-gray-400">
                            {t.aantal === 0 ? 'Niet in gebruik' : `${t.aantal} contract${t.aantal === 1 ? '' : 'en'}`}
                            {vast && ' · terugval, vast type'}
                          </div>
                        </div>
                        {!vast && (
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => setBewerk({ van: t.naam, naar: t.naam })} disabled={bezig !== null} className="btn-secondary text-xs px-2.5 py-1.5">
                              <Pencil className="h-3.5 w-3.5" />Hernoemen
                            </button>
                            <button type="button" onClick={() => vraagVerwijderen(t)} disabled={bezig !== null} className="btn-secondary text-xs px-2.5 py-1.5 text-red-600">
                              <Trash2 className="h-3.5 w-3.5" />Verwijderen
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <p className="text-[11px] text-gray-400">
            Een type dat nog op contracten staat kan je niet verwijderen: hernoem het of geef die contracten eerst een ander type. &quot;{NIET_TOEGEWEZEN}&quot; blijft altijd bestaan.
          </p>
        </div>
      </Dialoog>

      {weg && (
        <Bevestig
          titel="Contracttype verwijderen"
          tekst={<>Het contracttype <strong>{weg.naam}</strong> verwijderen? Het verdwijnt uit de keuzelijst. Er staat geen enkel contract op dit type.</>}
          bevestigLabel="Verwijderen" gevaarlijk bezig={bezig === weg.naam}
          onBevestig={() => void verwijderen()} onAnnuleer={() => setWeg(null)}
        />
      )}
    </>
  )
}
