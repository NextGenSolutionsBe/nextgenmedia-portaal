'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Briefcase, Check, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { parseBedragCents, somOpdrachten, type LeadOpdracht } from '@/lib/sales/opdrachten-model'
import { euro } from './types'

/**
 * Opdrachten van één lead in het detailpaneel: titel + bedrag excl. btw,
 * inline toevoegen, aanpassen en verwijderen, met het totaal. Dat totaal is de
 * waarde van de lead op het bord.
 */
export function LeadOpdrachten({ leadId, verversSleutel, onChanged }: {
  leadId: string
  verversSleutel?: number
  onChanged: () => void
}) {
  const [lijst, setLijst] = useState<LeadOpdracht[] | null>(null)
  const [beschikbaar, setBeschikbaar] = useState(true)
  const [bezig, setBezig] = useState(false)
  const [nieuw, setNieuw] = useState({ titel: '', bedrag: '' })
  const [bewerk, setBewerk] = useState<{ id: string; titel: string; bedrag: string; notitie: string } | null>(null)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/sales/leads/${leadId}/opdrachten`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Laden mislukt')
      setLijst((j.opdrachten ?? []) as LeadOpdracht[])
      setBeschikbaar(j.beschikbaar !== false)
    } catch { setLijst([]) }
  }, [leadId])
  useEffect(() => { laad() }, [laad, verversSleutel])

  const stuur = async (url: string, method: string, body?: Record<string, unknown>, ok?: string): Promise<boolean> => {
    setBezig(true)
    try {
      const r = await fetch(url, {
        method, headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      if (ok) toast.success(ok, { duration: 1500 })
      await laad()
      onChanged()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
      return false
    } finally { setBezig(false) }
  }

  const controleer = (titel: string, bedrag: string): boolean => {
    if (!titel.trim()) { toast.error('Geef de opdracht een titel.'); return false }
    if (bedrag.trim() && parseBedragCents(bedrag) === null) { toast.error('Het bedrag klopt niet (bv. 3.250 of 3250,50).'); return false }
    return true
  }

  const voegToe = async () => {
    if (!controleer(nieuw.titel, nieuw.bedrag)) return
    if (await stuur(`/api/admin/sales/leads/${leadId}/opdrachten`, 'POST', { titel: nieuw.titel.trim(), bedrag: nieuw.bedrag.trim() }, 'Opdracht toegevoegd.')) {
      setNieuw({ titel: '', bedrag: '' })
    }
  }

  const bewaar = async () => {
    if (!bewerk || !controleer(bewerk.titel, bewerk.bedrag)) return
    if (await stuur(`/api/admin/sales/leads/${leadId}/opdrachten/${bewerk.id}`, 'PATCH', { titel: bewerk.titel.trim(), bedrag: bewerk.bedrag.trim(), notitie: bewerk.notitie.trim() }, 'Opdracht aangepast.')) {
      setBewerk(null)
    }
  }

  const verwijder = async (o: LeadOpdracht) => {
    if (!window.confirm(`Opdracht "${o.titel}" loskoppelen van deze lead? De opdracht blijft bestaan op de Opdrachten-pagina.`)) return
    await stuur(`/api/admin/sales/leads/${leadId}/opdrachten/${o.id}`, 'DELETE', undefined, 'Opdracht losgekoppeld.')
  }

  const bedragTekst = (cents: number) => (cents / 100).toLocaleString('nl-BE', { maximumFractionDigits: 2 })
  const totaal = somOpdrachten(lijst ?? [])

  return (
    <section>
      <h3 className="text-[11px] uppercase tracking-wide text-gray-400 font-bold mb-2 flex items-center gap-1">
        <Briefcase className="h-3 w-3" />Opdrachten
        {lijst && lijst.length > 0 && <span className="ml-auto normal-case tracking-normal text-xs font-semibold text-gray-900 tabular-nums">Totaal {euro(totaal)}</span>}
      </h3>
      <p className="text-[11px] text-gray-500 mb-2">Status, deadline, contract en factuur beheer je op de <a href="/admin/opdrachten" className="underline hover:text-black">Opdrachten-pagina</a>; nieuwe opdrachten hier komen daar ook bij.</p>

      {!beschikbaar ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          Opdrachten werken zodra de databankmigratie gedraaid is.
        </p>
      ) : lijst === null ? (
        <div className="py-2 text-center text-gray-300"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
      ) : (
        <div className="space-y-1.5">
          {lijst.length === 0 && <p className="text-xs text-gray-400">Nog geen opdrachten voor deze klant. Voeg er een toe met titel en bedrag.</p>}
          {lijst.map((o) => (
            <div key={o.id} className="rounded-lg border border-gray-100 bg-gray-50 px-2.5 py-1.5">
              {bewerk?.id === o.id ? (
                <form className="space-y-1.5" onSubmit={(e) => { e.preventDefault(); void bewaar() }}>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <input autoFocus className="input-base text-sm flex-1 min-w-[8rem]" value={bewerk.titel}
                      onChange={(e) => setBewerk({ ...bewerk, titel: e.target.value })} aria-label="Titel" />
                    <input className="input-base text-sm w-28" inputMode="decimal" value={bewerk.bedrag}
                      onChange={(e) => setBewerk({ ...bewerk, bedrag: e.target.value })} aria-label="Bedrag excl. btw" />
                  </div>
                  <textarea rows={2} className="input-base text-sm" value={bewerk.notitie} maxLength={2000}
                    placeholder="Omschrijving (optioneel)" aria-label="Omschrijving"
                    onChange={(e) => setBewerk({ ...bewerk, notitie: e.target.value })} />
                  <div className="flex gap-1.5">
                    <button type="submit" disabled={bezig} className="btn-primary text-xs"><Check className="h-3.5 w-3.5" />Bewaren</button>
                    <button type="button" onClick={() => setBewerk(null)} className="btn-secondary text-xs"><X className="h-3.5 w-3.5" />Annuleer</button>
                  </div>
                </form>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-[13px] text-gray-900 flex-1 min-w-0 truncate" title={o.notitie ?? undefined}>{o.titel}</span>
                  <span className="text-[13px] font-semibold tabular-nums">{euro(o.bedrag_cents)}</span>
                  <button onClick={() => setBewerk({ id: o.id, titel: o.titel, bedrag: bedragTekst(o.bedrag_cents), notitie: o.notitie ?? '' })} disabled={bezig}
                    className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-black" title="Aanpassen"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => verwijder(o)} disabled={bezig}
                    className="h-7 w-7 flex items-center justify-center rounded-md text-red-500 hover:bg-red-50 hover:text-red-700" title="Loskoppelen van deze lead"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              )}
              {o.notitie && bewerk?.id !== o.id && <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">{o.notitie}</p>}
            </div>
          ))}
          <form className="flex gap-1.5 items-center" onSubmit={(e) => { e.preventDefault(); void voegToe() }}>
            <input className="input-base text-sm flex-1 min-w-0" placeholder="Opdracht, bv. Nieuwe website" value={nieuw.titel}
              onChange={(e) => setNieuw((n) => ({ ...n, titel: e.target.value }))} aria-label="Nieuwe opdracht: titel" />
            <input className="input-base text-sm w-28" inputMode="decimal" placeholder="€ excl. btw" value={nieuw.bedrag}
              onChange={(e) => setNieuw((n) => ({ ...n, bedrag: e.target.value }))} aria-label="Nieuwe opdracht: bedrag excl. btw" />
            <button type="submit" disabled={bezig || !nieuw.titel.trim()} className="btn-secondary text-sm" title="Opdracht toevoegen">
              {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </button>
          </form>
        </div>
      )}
    </section>
  )
}
