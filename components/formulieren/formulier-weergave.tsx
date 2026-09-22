'use client'

import { useRef, useState } from 'react'
import { Upload, X, Loader2, Plus, FileText, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  isZichtbaar, isAntwoordVeld, leesbareGrootte, BESTAND_ACCEPT, BESTAND_EXT_TEKST, BESTAND_MAX_BYTES, BESTAND_MAX_AANTAL,
  type Veld, type BestandAntwoord,
} from '@/lib/formulieren/model'

/**
 * Eén weergave voor een formulier: de publieke pagina (/f/<token>) en het
 * live voorbeeld in de builder gebruiken exact deze component, zodat wat je
 * bouwt ook echt is wat de klant ziet.
 */

export type Waarden = Record<string, unknown>
export type Uploader = (veldId: string, bestand: File) => Promise<BestandAntwoord>

export function FormulierWeergave({
  velden, waarden, zetWaarde, fouten = {}, uploader, voorbeeld = false,
}: {
  velden: Veld[]
  waarden: Waarden
  zetWaarde: (id: string, waarde: unknown) => void
  fouten?: Record<string, string>
  /** Ontbreekt in het voorbeeld: dan kan er niet echt geüpload worden. */
  uploader?: Uploader
  voorbeeld?: boolean
}) {
  const zichtbaar = velden.filter((v) => isZichtbaar(v, velden, waarden))
  return (
    <div className="space-y-5">
      {zichtbaar.map((veld) => (
        <div key={veld.id} data-veld={veld.id}>
          <VeldWeergave veld={veld} waarde={waarden[veld.id]} zet={(w) => zetWaarde(veld.id, w)} fout={fouten[veld.id]} uploader={uploader} voorbeeld={voorbeeld} />
        </div>
      ))}
      {zichtbaar.length === 0 && <p className="text-sm text-gray-400 text-center py-6">Nog geen velden.</p>}
    </div>
  )
}

function Label({ veld, htmlFor, as = 'label' }: { veld: Veld; htmlFor?: string; as?: 'label' | 'legend' }) {
  const inhoud = (
    <>
      {veld.label}
      {veld.verplicht && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
      {veld.verplicht && <span className="sr-only"> (verplicht)</span>}
    </>
  )
  return as === 'legend'
    ? <legend className="block text-sm font-medium text-gray-900 mb-1">{inhoud}</legend>
    : <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-900 mb-1">{inhoud}</label>
}

function Hulp({ veld }: { veld: Veld }) {
  return veld.hulptekst ? <p id={`${veld.id}-hulp`} className="text-xs text-gray-500 mb-1.5 whitespace-pre-line">{veld.hulptekst}</p> : null
}

function Fout({ id, fout }: { id: string; fout?: string }) {
  return fout ? <p id={`${id}-fout`} role="alert" className="mt-1 text-xs text-red-600 flex items-center gap-1"><AlertCircle className="h-3.5 w-3.5 shrink-0" />{fout}</p> : null
}

function VeldWeergave({ veld, waarde, zet, fout, uploader, voorbeeld }: {
  veld: Veld; waarde: unknown; zet: (w: unknown) => void; fout?: string; uploader?: Uploader; voorbeeld: boolean
}) {
  const inputId = `veld-${veld.id}`
  const beschrijving = [veld.hulptekst ? `${veld.id}-hulp` : '', fout ? `${veld.id}-fout` : ''].filter(Boolean).join(' ') || undefined
  const invoerKlasse = cn('input-base', fout && 'border-red-300 focus:ring-red-200')
  const aria = { 'aria-invalid': fout ? true : undefined, 'aria-describedby': beschrijving, 'aria-required': veld.verplicht || undefined }
  const tekst = typeof waarde === 'string' || typeof waarde === 'number' ? String(waarde) : ''

  if (veld.type === 'sectie') {
    return (
      <div className="pt-2">
        <h2 className="text-base font-semibold text-gray-900 border-b-2 border-[#fff848] pb-1.5 inline-block">{veld.label}</h2>
        {veld.hulptekst && <p className="text-sm text-gray-500 mt-2 whitespace-pre-line">{veld.hulptekst}</p>}
      </div>
    )
  }
  if (veld.type === 'uitleg') {
    return (
      <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
        {veld.label && <p className="text-sm font-medium text-gray-900 mb-1">{veld.label}</p>}
        <p className="text-sm text-gray-600 whitespace-pre-line">{veld.hulptekst}</p>
      </div>
    )
  }
  if (!isAntwoordVeld(veld.type)) return null

  switch (veld.type) {
    case 'kort': case 'email': case 'telefoon': case 'url': case 'getal': case 'datum': {
      const type = { kort: 'text', email: 'email', telefoon: 'tel', url: 'url', getal: 'number', datum: 'date' }[veld.type]
      const autocomplete = veld.type === 'email' ? 'email' : veld.type === 'telefoon' ? 'tel' : veld.type === 'url' ? 'url' : undefined
      return (
        <div>
          <Label veld={veld} htmlFor={inputId} />
          <Hulp veld={veld} />
          <input
            id={inputId} type={type} className={invoerKlasse} value={tekst} placeholder={veld.placeholder}
            onChange={(e) => zet(e.target.value)} autoComplete={autocomplete}
            inputMode={veld.type === 'getal' ? 'decimal' : undefined}
            min={veld.type === 'getal' ? veld.min : undefined} max={veld.type === 'getal' ? veld.max : undefined} step={veld.type === 'getal' ? 'any' : undefined}
            {...aria}
          />
          <Fout id={veld.id} fout={fout} />
        </div>
      )
    }
    case 'lang':
      return (
        <div>
          <Label veld={veld} htmlFor={inputId} />
          <Hulp veld={veld} />
          <textarea id={inputId} rows={4} className={invoerKlasse} value={tekst} placeholder={veld.placeholder} onChange={(e) => zet(e.target.value)} {...aria} />
          <Fout id={veld.id} fout={fout} />
        </div>
      )
    case 'dropdown':
      return (
        <div>
          <Label veld={veld} htmlFor={inputId} />
          <Hulp veld={veld} />
          <select id={inputId} className={invoerKlasse} value={tekst} onChange={(e) => zet(e.target.value)} {...aria}>
            <option value="">— Kies —</option>
            {(veld.opties ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <Fout id={veld.id} fout={fout} />
        </div>
      )
    case 'keuze': case 'meerkeuze': {
      const multi = veld.type === 'meerkeuze'
      const gekozen = multi ? (Array.isArray(waarde) ? (waarde as string[]) : []) : []
      return (
        <fieldset aria-describedby={beschrijving}>
          <Label veld={veld} as="legend" />
          <Hulp veld={veld} />
          <div className="grid sm:grid-cols-2 gap-2">
            {(veld.opties ?? []).map((o) => {
              const aan = multi ? gekozen.includes(o) : tekst === o
              return (
                <label key={o} className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm cursor-pointer transition-colors', aan ? 'border-gray-900 bg-[#fff848]/25' : 'border-gray-200 bg-white hover:border-gray-300')}>
                  <input
                    type={multi ? 'checkbox' : 'radio'} name={inputId} value={o} checked={aan} className="accent-black h-4 w-4 shrink-0"
                    onChange={() => zet(multi ? (aan ? gekozen.filter((x) => x !== o) : [...gekozen, o]) : o)}
                  />
                  <span className="min-w-0 break-words">{o}</span>
                </label>
              )
            })}
          </div>
          <Fout id={veld.id} fout={fout} />
        </fieldset>
      )
    }
    case 'jaNee':
      return (
        <fieldset aria-describedby={beschrijving}>
          <Label veld={veld} as="legend" />
          <Hulp veld={veld} />
          <div className="flex gap-2">
            {(['ja', 'nee'] as const).map((o) => (
              <label key={o} className={cn('flex-1 sm:flex-none sm:min-w-[110px] flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium cursor-pointer transition-colors', tekst === o ? 'border-gray-900 bg-[#fff848]/25' : 'border-gray-200 bg-white hover:border-gray-300')}>
                <input type="radio" name={inputId} value={o} checked={tekst === o} onChange={() => zet(o)} className="accent-black h-4 w-4" />
                {o === 'ja' ? 'Ja' : 'Nee'}
              </label>
            ))}
          </div>
          <Fout id={veld.id} fout={fout} />
        </fieldset>
      )
    case 'schaal': {
      const lo = veld.min ?? 1, hi = veld.max ?? 5
      const punten = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)
      return (
        <fieldset aria-describedby={beschrijving}>
          <Label veld={veld} as="legend" />
          <Hulp veld={veld} />
          <div className="flex flex-wrap gap-1.5" role="radiogroup">
            {punten.map((p) => {
              const aan = tekst === String(p)
              return (
                <label key={p} className={cn('h-10 min-w-[2.5rem] px-2 flex items-center justify-center rounded-lg border text-sm font-semibold cursor-pointer transition-colors', aan ? 'border-gray-900 bg-[#fff848]' : 'border-gray-200 bg-white hover:border-gray-300')}>
                  <input type="radio" name={inputId} value={p} checked={aan} onChange={() => zet(p)} className="sr-only" />
                  {p}
                </label>
              )
            })}
          </div>
          {(veld.minLabel || veld.maxLabel) && (
            <div className="flex justify-between text-xs text-gray-500 mt-1 max-w-md"><span>{veld.minLabel}</span><span>{veld.maxLabel}</span></div>
          )}
          <Fout id={veld.id} fout={fout} />
        </fieldset>
      )
    }
    case 'kleur':
      return <KleurVeld veld={veld} waarde={waarde} zet={zet} fout={fout} beschrijving={beschrijving} />
    case 'bestand':
      return <BestandVeld veld={veld} waarde={waarde} zet={zet} fout={fout} uploader={uploader} voorbeeld={voorbeeld} beschrijving={beschrijving} />
  }
  return null
}

function KleurVeld({ veld, waarde, zet, fout, beschrijving }: { veld: Veld; waarde: unknown; zet: (w: unknown) => void; fout?: string; beschrijving?: string }) {
  const lijst = Array.isArray(waarde) ? (waarde as string[]) : []
  const max = veld.max ?? 3
  const zetOp = (i: number, hex: string) => zet(lijst.map((x, j) => (j === i ? hex : x)))
  return (
    <fieldset aria-describedby={beschrijving}>
      <Label veld={veld} as="legend" />
      <Hulp veld={veld} />
      <div className="flex flex-wrap gap-2">
        {lijst.map((hex, i) => {
          const geldig = /^#[0-9a-f]{6}$/i.test(hex)
          return (
            <div key={i} className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white pl-1.5 pr-1 py-1">
              <input type="color" aria-label={`Kleur ${i + 1}`} value={geldig ? hex : '#000000'} onChange={(e) => zetOp(i, e.target.value)} className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
              <input
                aria-label={`Hexcode kleur ${i + 1}`} value={hex} maxLength={7}
                onChange={(e) => { let t = e.target.value.trim(); if (t && !t.startsWith('#')) t = `#${t}`; zetOp(i, t) }}
                className={cn('w-[5.5rem] text-sm font-mono px-1.5 py-1 rounded border', geldig ? 'border-transparent' : 'border-red-300')}
              />
              <button type="button" onClick={() => zet(lijst.filter((_, j) => j !== i))} className="h-7 w-7 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400" aria-label={`Kleur ${i + 1} verwijderen`}><X className="h-3.5 w-3.5" /></button>
            </div>
          )
        })}
        {lijst.length < max && (
          <button type="button" onClick={() => zet([...lijst, '#fff848'])} className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-600 hover:border-gray-400 hover:bg-gray-50">
            <Plus className="h-4 w-4" />Kleur toevoegen
          </button>
        )}
      </div>
      <p className="text-[11px] text-gray-400 mt-1">Maximaal {max} kleur{max === 1 ? '' : 'en'}.</p>
      <Fout id={veld.id} fout={fout} />
    </fieldset>
  )
}

type Bezig = { sleutel: string; naam: string; fout: string | null }

function BestandVeld({ veld, waarde, zet, fout, uploader, voorbeeld, beschrijving }: {
  veld: Veld; waarde: unknown; zet: (w: unknown) => void; fout?: string; uploader?: Uploader; voorbeeld: boolean; beschrijving?: string
}) {
  const lijst = Array.isArray(waarde) ? (waarde as BestandAntwoord[]) : []
  const max = Math.min(veld.max ?? BESTAND_MAX_AANTAL, BESTAND_MAX_AANTAL)
  const [bezig, setBezig] = useState<Bezig[]>([])
  const invoer = useRef<HTMLInputElement>(null)
  // Uploads lopen parallel; de laatste stand van de lijst bijhouden zodat
  // gelijktijdige uploads elkaar niet overschrijven.
  const huidige = useRef<BestandAntwoord[]>(lijst)
  huidige.current = lijst

  const kies = async (files: FileList | null) => {
    if (!files || !uploader) return
    const ruimte = max - lijst.length - bezig.filter((b) => !b.fout).length
    const gekozen = Array.from(files).slice(0, Math.max(0, ruimte))
    for (const f of gekozen) {
      const sleutel = `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`
      if (f.size > BESTAND_MAX_BYTES) { setBezig((b) => [...b, { sleutel, naam: f.name, fout: `Te groot (max ${leesbareGrootte(BESTAND_MAX_BYTES)})` }]); continue }
      setBezig((b) => [...b, { sleutel, naam: f.name, fout: null }])
      try {
        const resultaat = await uploader(veld.id, f)
        const nieuw = [...huidige.current, resultaat]
        huidige.current = nieuw
        zet(nieuw)
        setBezig((b) => b.filter((x) => x.sleutel !== sleutel))
      } catch (e) {
        setBezig((b) => b.map((x) => (x.sleutel === sleutel ? { ...x, fout: e instanceof Error ? e.message : 'Upload mislukt' } : x)))
      }
    }
    if (invoer.current) invoer.current.value = ''
  }

  const vol = lijst.length >= max
  return (
    <fieldset aria-describedby={beschrijving}>
      <Label veld={veld} as="legend" />
      <Hulp veld={veld} />
      {!vol && (
        <button
          type="button" disabled={voorbeeld || !uploader}
          onClick={() => invoer.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (!voorbeeld) kies(e.dataTransfer.files) }}
          className={cn('w-full rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors', fout ? 'border-red-300' : 'border-gray-200', voorbeeld ? 'cursor-not-allowed opacity-70' : 'hover:border-gray-400 hover:bg-gray-50')}
        >
          <Upload className="h-5 w-5 mx-auto text-gray-400 mb-1" />
          <span className="block text-sm font-medium text-gray-700">{voorbeeld ? 'Uploaden kan in het echte formulier' : 'Klik of sleep bestanden hierheen'}</span>
          <span className="block text-xs text-gray-400 mt-0.5">{BESTAND_EXT_TEKST} · max {leesbareGrootte(BESTAND_MAX_BYTES)} per bestand · max {max} bestand{max === 1 ? '' : 'en'}</span>
        </button>
      )}
      <input ref={invoer} type="file" multiple={max > 1} accept={BESTAND_ACCEPT} className="hidden" onChange={(e) => kies(e.target.files)} tabIndex={-1} />
      {(lijst.length > 0 || bezig.length > 0) && (
        <ul className="mt-2 space-y-1.5">
          {lijst.map((b) => (
            <li key={b.pad} className="flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm">
              <FileText className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="flex-1 min-w-0 truncate">{b.naam}</span>
              <span className="text-xs text-gray-400 shrink-0">{leesbareGrootte(b.grootte)}</span>
              <button type="button" onClick={() => zet(lijst.filter((x) => x.pad !== b.pad))} className="h-7 w-7 flex items-center justify-center rounded hover:bg-gray-200 text-gray-500" aria-label={`${b.naam} verwijderen`}><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
          {bezig.map((b) => (
            <li key={b.sleutel} className={cn('flex items-center gap-2 rounded-lg border px-3 py-2 text-sm', b.fout ? 'bg-red-50 border-red-100 text-red-700' : 'bg-gray-50 border-gray-100')}>
              {b.fout ? <AlertCircle className="h-4 w-4 shrink-0" /> : <Loader2 className="h-4 w-4 animate-spin text-gray-400 shrink-0" />}
              <span className="flex-1 min-w-0 truncate">{b.naam}{b.fout ? ` — ${b.fout}` : ''}</span>
              {b.fout && <button type="button" onClick={() => setBezig((x) => x.filter((y) => y.sleutel !== b.sleutel))} className="h-7 w-7 flex items-center justify-center rounded hover:bg-red-100" aria-label="Melding sluiten"><X className="h-3.5 w-3.5" /></button>}
            </li>
          ))}
        </ul>
      )}
      <Fout id={veld.id} fout={fout} />
    </fieldset>
  )
}
