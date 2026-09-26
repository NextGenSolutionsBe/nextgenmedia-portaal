'use client'

import { useCallback, useRef, useState } from 'react'
import { CheckCircle2, Loader2, Send } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { FormulierWeergave, type Waarden } from '@/components/formulieren/formulier-weergave'
import { valideerAntwoorden, type Veld, type FormulierInstellingen, type BestandAntwoord } from '@/lib/formulieren/model'

/**
 * Het invulbare formulier. Valideert in de browser met dezelfde regels als de
 * server (valideerAntwoorden), uploadt bestanden rechtstreeks naar de opslag via
 * een door de server uitgegeven link, en toont daarna de bedanktekst.
 */
export function PubliekFormulier({ token, titel, beschrijving, velden, instellingen, klantNaam }: {
  token: string
  titel: string
  beschrijving: string | null
  velden: Veld[]
  instellingen: FormulierInstellingen
  klantNaam: string | null
}) {
  const [waarden, setWaarden] = useState<Waarden>({})
  const [fouten, setFouten] = useState<Record<string, string>>({})
  const [melding, setMelding] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [klaar, setKlaar] = useState(false)
  const [uploads, setUploads] = useState(0)
  const honeypot = useRef<HTMLInputElement>(null)

  const zetWaarde = useCallback((id: string, w: unknown) => {
    setWaarden((o) => ({ ...o, [id]: w }))
    setFouten((f) => { if (!f[id]) return f; const n = { ...f }; delete n[id]; return n })
  }, [])

  const uploader = useCallback(async (veldId: string, bestand: File): Promise<BestandAntwoord> => {
    setUploads((n) => n + 1)
    try {
      const r = await fetch(`/api/formulieren/${encodeURIComponent(token)}/upload`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ veld_id: veldId, naam: bestand.name, mimetype: bestand.type, grootte: bestand.size }),
      })
      const a = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(a.error ?? 'Upload kon niet starten.')
      const { error } = await createClient().storage.from(a.bucket).uploadToSignedUrl(a.pad, a.token, bestand, { contentType: bestand.type || undefined })
      if (error) throw new Error('Upload mislukt. Probeer het opnieuw.')
      return { pad: a.pad, naam: bestand.name.slice(0, 200), grootte: bestand.size, type: bestand.type }
    } finally {
      setUploads((n) => n - 1)
    }
  }, [token])

  const verstuur = async (e: React.FormEvent) => {
    e.preventDefault()
    if (bezig) return
    if (uploads > 0) { setMelding('Even geduld: er worden nog bestanden geüpload.'); return }
    setMelding(null)
    const v = valideerAntwoorden(velden, waarden)
    if (!v.ok) {
      setFouten(v.fouten)
      setMelding('Niet alle velden zijn correct ingevuld. Controleer de gemarkeerde velden.')
      const eerste = velden.find((x) => v.fouten[x.id])
      const blok = eerste ? document.querySelector<HTMLElement>(`[data-veld="${CSS.escape(eerste.id)}"]`) : null
      if (blok) {
        blok.scrollIntoView({ behavior: 'smooth', block: 'center' })
        blok.querySelector<HTMLElement>('input, textarea, select, button')?.focus({ preventScroll: true })
      }
      return
    }
    setBezig(true)
    try {
      const r = await fetch(`/api/formulieren/${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ antwoorden: waarden, website_hp: honeypot.current?.value ?? '' }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        if (j.fouten) setFouten(j.fouten)
        throw new Error(j.error ?? 'Versturen is niet gelukt.')
      }
      setKlaar(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setMelding(err instanceof Error ? err.message : 'Versturen is niet gelukt.')
    } finally {
      setBezig(false)
    }
  }

  if (klaar) {
    return (
      <div className="max-w-lg mx-auto bg-white border border-gray-200 rounded-2xl p-8 text-center">
        <div className="h-14 w-14 rounded-full bg-[#fff848] flex items-center justify-center mx-auto mb-4"><CheckCircle2 className="h-7 w-7 text-black" /></div>
        <h1 className="font-semibold text-xl mb-2">Verstuurd!</h1>
        <p className="text-sm text-gray-600 whitespace-pre-line">{instellingen.bedankt_tekst}</p>
      </div>
    )
  }

  return (
    <form onSubmit={verstuur} noValidate className="max-w-2xl mx-auto">
      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="h-1.5 bg-[#fff848]" />
        <div className="p-5 sm:p-8">
          {klantNaam && <p className="text-xs font-medium uppercase tracking-wide text-gray-400 mb-1">Voor {klantNaam}</p>}
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">{titel}</h1>
          {beschrijving && <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{beschrijving}</p>}
          <p className="text-xs text-gray-400 mt-3">Velden met <span className="text-red-500">*</span> zijn verplicht.</p>

          <div className="mt-6">
            <FormulierWeergave velden={velden} waarden={waarden} zetWaarde={zetWaarde} fouten={fouten} uploader={uploader} />
          </div>

          {/* Honeypot: onzichtbaar voor mensen, bots vullen het in. */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
            <label htmlFor="website_hp">Laat dit veld leeg</label>
            <input ref={honeypot} id="website_hp" name="website_hp" type="text" tabIndex={-1} autoComplete="off" />
          </div>

          {melding && <div role="alert" className="mt-6 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{melding}</div>}

          <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3">
            <button type="submit" disabled={bezig || uploads > 0} className="btn-primary w-full sm:w-auto px-6 py-3 text-base">
              {bezig || uploads > 0 ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {uploads > 0 ? 'Bestanden uploaden…' : instellingen.knop_tekst}
            </button>
            <p className="text-xs text-gray-400">Je gegevens worden enkel gebruikt om je aanvraag op te volgen.</p>
          </div>
        </div>
      </div>
    </form>
  )
}
