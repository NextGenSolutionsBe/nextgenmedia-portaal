'use client'

import { useMemo, useState } from 'react'
import {
  Type, AlignLeft, AtSign, Phone, Link as LinkIcon, Hash, CalendarDays, CircleDot, ListChecks, SquareChevronDown,
  ToggleLeft, Gauge, Palette, Paperclip, Heading, Pilcrow, GripVertical, ArrowUp, ArrowDown, Copy, Trash2,
  ChevronDown, ChevronRight, Plus, Sparkles, Eye, EyeOff, GitBranch, AlertTriangle, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import {
  VELD_TYPES, VELD_TYPE_INFO, nieuwVeld, heeftOpties, isAntwoordVeld, kanVoorwaardeBron, voegVeldenSamen, normaliseerVelden,
  MAX_VELDEN, BESTAND_MAX_AANTAL, type Veld, type VeldType,
} from '@/lib/formulieren/model'
import { FormulierWeergave, type Waarden } from '@/components/formulieren/formulier-weergave'
import { AiVoorstelPaneel } from '@/components/formulieren/ai-voorstel'
import type { Concept } from './types'

export const TYPE_ICOON: Record<VeldType, React.ElementType> = {
  kort: Type, lang: AlignLeft, email: AtSign, telefoon: Phone, url: LinkIcon, getal: Hash, datum: CalendarDays,
  keuze: CircleDot, meerkeuze: ListChecks, dropdown: SquareChevronDown, jaNee: ToggleLeft, schaal: Gauge,
  kleur: Palette, bestand: Paperclip, sectie: Heading, uitleg: Pilcrow,
}

export function VeldenBuilder({ concept, wijzig }: { concept: Concept; wijzig: (p: Partial<Concept>) => void }) {
  const velden = concept.velden
  const [open, setOpen] = useState<string | null>(null)
  const [palet, setPalet] = useState(false)
  const [aiOpen, setAiOpen] = useState(velden.length === 0)
  const [voorbeeldMobiel, setVoorbeeldMobiel] = useState(false)
  const [voorbeeldWaarden, setVoorbeeldWaarden] = useState<Waarden>({})
  const [sleep, setSleep] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  const zet = (nieuw: Veld[]) => wijzig({ velden: nieuw })
  const pasAan = (id: string, p: Partial<Veld>) => zet(velden.map((v) => (v.id === id ? { ...v, ...p } : v)))
  const verplaats = (van: number, naar: number) => {
    if (naar < 0 || naar >= velden.length || van === naar) return
    const kopie = [...velden]
    const [x] = kopie.splice(van, 1)
    kopie.splice(naar, 0, x)
    zet(kopie)
  }
  const voegToe = (type: VeldType) => {
    if (velden.length >= MAX_VELDEN) { toast.error(`Maximaal ${MAX_VELDEN} velden per formulier.`); return }
    const v = nieuwVeld(type, velden.map((x) => x.id))
    const na = open ? velden.findIndex((x) => x.id === open) : -1
    const kopie = [...velden]
    kopie.splice(na >= 0 ? na + 1 : kopie.length, 0, v)
    zet(kopie); setOpen(v.id); setPalet(false)
  }
  const dupliceer = (i: number) => {
    if (velden.length >= MAX_VELDEN) { toast.error(`Maximaal ${MAX_VELDEN} velden per formulier.`); return }
    const bron = velden[i]
    const kopie: Veld = { ...bron, opties: bron.opties ? [...bron.opties] : undefined, id: nieuwVeld(bron.type, velden.map((x) => x.id)).id, label: bron.label ? `${bron.label} (kopie)` : bron.label }
    const lijst = [...velden]; lijst.splice(i + 1, 0, kopie); zet(lijst); setOpen(kopie.id)
  }
  const verwijder = (id: string) => {
    const afhankelijk = velden.filter((v) => v.voorwaarde?.veld === id)
    zet(velden.filter((v) => v.id !== id).map((v) => (v.voorwaarde?.veld === id ? { ...v, voorwaarde: null } : v)))
    if (afhankelijk.length) toast.info(`${afhankelijk.length} voorwaarde${afhankelijk.length === 1 ? '' : 'n'} verwijderd die naar dit veld verwees${afhankelijk.length === 1 ? '' : 'en'}.`)
  }

  const zetVoorbeeld = (id: string, w: unknown) => setVoorbeeldWaarden((o) => ({ ...o, [id]: w }))

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] gap-5 items-start">
      <div className="space-y-4 min-w-0">
        {/* AI */}
        <div className="card-base !p-4">
          <button type="button" onClick={() => setAiOpen((o) => !o)} className="w-full flex items-center justify-between text-left">
            <span className="font-semibold text-sm flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-500" />Velden laten voorstellen door AI</span>
            {aiOpen ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronRight className="h-4 w-4 text-gray-400" />}
          </button>
          {aiOpen && (
            <div className="mt-3">
              <AiVoorstelPaneel
                compact standaardDienst={concept.dienst} standaardDoel={concept.doel ?? ''}
                acties={(v, ctx) => (
                  <>
                    <button type="button" className="btn-primary" onClick={() => {
                      if (velden.length > 0 && !confirm('Alle huidige velden vervangen door het voorstel?')) return
                      wijzig({ velden: normaliseerVelden(v.velden), ...(concept.velden.length === 0 || !concept.beschrijving ? { beschrijving: v.beschrijving || concept.beschrijving } : {}) })
                      toast.success('Voorstel overgenomen — vergeet niet op te slaan'); ctx.wis(); setOpen(null)
                    }}>Vervangen</button>
                    <button type="button" className="btn-secondary" onClick={() => {
                      const samen = voegVeldenSamen(velden, v.velden)
                      if (samen.length < velden.length + v.velden.length) toast.info(`Maximaal ${MAX_VELDEN} velden: niet alles paste erbij.`)
                      wijzig({ velden: samen }); toast.success('Velden toegevoegd — vergeet niet op te slaan'); ctx.wis()
                    }}>Toevoegen aan huidige velden</button>
                    <button type="button" className="btn-secondary" onClick={ctx.wis}>Annuleren</button>
                  </>
                )}
              />
            </div>
          )}
        </div>

        {/* Velden */}
        <div className="space-y-2">
          {velden.length === 0 && (
            <div className="card-base empty-state">
              <p className="text-sm">Nog geen velden. Voeg er een toe of laat AI een voorstel maken.</p>
            </div>
          )}
          {velden.map((veld, i) => (
            <div
              key={veld.id}
              onDragOver={(e) => { if (sleep !== null) { e.preventDefault(); setOver(i) } }}
              onDrop={(e) => { e.preventDefault(); if (sleep !== null) verplaats(sleep, i); setSleep(null); setOver(null) }}
              className={cn('rounded-2xl transition-shadow', over === i && sleep !== null && sleep !== i && 'ring-2 ring-[#fff848]')}
            >
              <VeldKaart
                veld={veld} index={i} velden={velden} open={open === veld.id}
                onToggle={() => setOpen((o) => (o === veld.id ? null : veld.id))}
                onPasAan={(p) => pasAan(veld.id, p)}
                onOmhoog={() => verplaats(i, i - 1)} onOmlaag={() => verplaats(i, i + 1)}
                onDupliceer={() => dupliceer(i)} onVerwijder={() => verwijder(veld.id)}
                onSleepStart={() => setSleep(i)} onSleepEinde={() => { setSleep(null); setOver(null) }}
                laatste={i === velden.length - 1}
              />
            </div>
          ))}
        </div>

        {/* Toevoegen */}
        <div className="card-base !p-4">
          {!palet ? (
            <button type="button" onClick={() => setPalet(true)} className="w-full btn-secondary border-dashed"><Plus className="h-4 w-4" />Veld toevoegen{open ? ' (onder het geopende veld)' : ''}</button>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold">Kies een veldtype</span>
                <button type="button" onClick={() => setPalet(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {VELD_TYPES.map((t) => {
                  const Icoon = TYPE_ICOON[t]
                  return (
                    <button key={t} type="button" onClick={() => voegToe(t)} title={VELD_TYPE_INFO[t].uitleg} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-left hover:border-gray-900 hover:bg-[#fff848]/10">
                      <Icoon className="h-4 w-4 text-gray-500 shrink-0" /><span className="truncate">{VELD_TYPE_INFO[t].label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <button type="button" onClick={() => setVoorbeeldMobiel((o) => !o)} className="lg:hidden btn-secondary w-full">
          {voorbeeldMobiel ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}{voorbeeldMobiel ? 'Voorbeeld verbergen' : 'Voorbeeld tonen'}
        </button>
      </div>

      {/* Live voorbeeld — dezelfde component als de publieke pagina */}
      <div className={cn('lg:sticky lg:top-4 min-w-0', !voorbeeldMobiel && 'hidden lg:block')}>
        <div className="rounded-2xl border border-gray-200 bg-gray-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><Eye className="h-3.5 w-3.5" />Voorbeeld</span>
            <button type="button" onClick={() => setVoorbeeldWaarden({})} className="text-xs text-gray-500 hover:text-gray-900 underline">Leegmaken</button>
          </div>
          <div className="p-4 max-h-[calc(100dvh-10rem)] overflow-y-auto">
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="h-1 bg-[#fff848]" />
              <div className="p-4">
                <h2 className="text-lg font-bold text-gray-900">{concept.titel}</h2>
                {concept.beschrijving && <p className="text-xs text-gray-600 mt-1 whitespace-pre-line">{concept.beschrijving}</p>}
                <div className="mt-4">
                  <FormulierWeergave velden={velden} waarden={voorbeeldWaarden} zetWaarde={zetVoorbeeld} voorbeeld />
                </div>
                <button type="button" disabled className="btn-primary mt-5 opacity-80">{concept.instellingen.knop_tekst}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function VeldKaart({ veld, index, velden, open, onToggle, onPasAan, onOmhoog, onOmlaag, onDupliceer, onVerwijder, onSleepStart, onSleepEinde, laatste }: {
  veld: Veld; index: number; velden: Veld[]; open: boolean
  onToggle: () => void; onPasAan: (p: Partial<Veld>) => void
  onOmhoog: () => void; onOmlaag: () => void; onDupliceer: () => void; onVerwijder: () => void
  onSleepStart: () => void; onSleepEinde: () => void; laatste: boolean
}) {
  const Icoon = TYPE_ICOON[veld.type]
  const antwoord = isAntwoordVeld(veld.type)
  const bronnen = useMemo(() => velden.slice(0, index).filter((v) => kanVoorwaardeBron(v.type)), [velden, index])
  const bron = veld.voorwaarde ? velden.find((v) => v.id === veld.voorwaarde!.veld) : undefined
  const bronIndex = bron ? velden.indexOf(bron) : -1
  const voorwaardeOngeldig = !!veld.voorwaarde && (bronIndex < 0 || bronIndex >= index)

  return (
    <div className={cn('card-base !p-0 overflow-hidden', open && 'ring-2 ring-gray-900/10', veld.type === 'sectie' && 'bg-gray-50')}>
      <div className="flex items-center gap-1 px-2 py-2">
        <span
          draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', veld.id); onSleepStart() }} onDragEnd={onSleepEinde}
          className="h-8 w-6 flex items-center justify-center text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing shrink-0" title="Slepen om te verplaatsen" aria-hidden="true"
        ><GripVertical className="h-4 w-4" /></span>
        <button type="button" onClick={onToggle} className="flex-1 min-w-0 flex items-center gap-2 text-left py-1" aria-expanded={open}>
          <Icoon className="h-4 w-4 text-gray-500 shrink-0" />
          <span className={cn('truncate text-sm', veld.type === 'sectie' ? 'font-semibold' : 'font-medium', !veld.label && 'text-gray-400 italic')}>
            {veld.label || (veld.type === 'uitleg' ? (veld.hulptekst?.slice(0, 60) || 'Uitleg') : 'Zonder label')}
          </span>
          {veld.verplicht && <span className="text-red-500 text-sm shrink-0">*</span>}
          {veld.voorwaarde && <GitBranch className={cn('h-3.5 w-3.5 shrink-0', voorwaardeOngeldig ? 'text-amber-500' : 'text-blue-500')} aria-label="Heeft een voorwaarde" />}
          <span className="text-[11px] text-gray-400 shrink-0 hidden sm:inline ml-auto">{VELD_TYPE_INFO[veld.type].label}</span>
        </button>
        <div className="flex items-center shrink-0">
          <IconKnop onClick={onOmhoog} disabled={index === 0} label="Omhoog"><ArrowUp className="h-3.5 w-3.5" /></IconKnop>
          <IconKnop onClick={onOmlaag} disabled={laatste} label="Omlaag"><ArrowDown className="h-3.5 w-3.5" /></IconKnop>
          <IconKnop onClick={onDupliceer} label="Dupliceren"><Copy className="h-3.5 w-3.5" /></IconKnop>
          <IconKnop onClick={onVerwijder} label="Verwijderen" gevaar><Trash2 className="h-3.5 w-3.5" /></IconKnop>
        </div>
      </div>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4 space-y-3 bg-white">
          <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
            <Veldje label={veld.type === 'sectie' ? 'Titel van de sectie' : veld.type === 'uitleg' ? 'Titel (optioneel)' : 'Vraag / label'}>
              <input className="input-base" value={veld.label} maxLength={200} onChange={(e) => onPasAan({ label: e.target.value })} autoFocus />
            </Veldje>
            {antwoord && (
              <label className="flex items-center gap-2 text-sm pb-2 cursor-pointer select-none">
                <input type="checkbox" checked={veld.verplicht} onChange={(e) => onPasAan({ verplicht: e.target.checked })} className="accent-black h-4 w-4" />Verplicht
              </label>
            )}
          </div>

          <Veldje label={veld.type === 'uitleg' ? 'Tekst' : veld.type === 'sectie' ? 'Toelichting (optioneel)' : 'Hulptekst (optioneel)'}>
            <textarea className="input-base" rows={veld.type === 'uitleg' ? 4 : 2} maxLength={1500} value={veld.hulptekst ?? ''} onChange={(e) => onPasAan({ hulptekst: e.target.value })} />
          </Veldje>

          {['kort', 'lang', 'email', 'telefoon', 'url', 'getal'].includes(veld.type) && (
            <Veldje label="Voorbeeldtekst in het veld (optioneel)">
              <input className="input-base" maxLength={150} value={veld.placeholder ?? ''} onChange={(e) => onPasAan({ placeholder: e.target.value })} />
            </Veldje>
          )}

          {heeftOpties(veld.type) && (
            <Veldje label="Opties — één per regel">
              <textarea
                className="input-base font-mono text-xs" rows={Math.min(10, Math.max(3, (veld.opties?.length ?? 2) + 1))}
                value={(veld.opties ?? []).join('\n')}
                onChange={(e) => onPasAan({ opties: e.target.value.split('\n').map((x) => x.slice(0, 200)).slice(0, 50) })}
                onBlur={(e) => onPasAan({ opties: [...new Set(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))].slice(0, 50) })}
              />
            </Veldje>
          )}

          {veld.type === 'getal' && (
            <div className="grid grid-cols-2 gap-3">
              <Veldje label="Minimum"><input type="number" className="input-base" value={veld.min ?? ''} onChange={(e) => onPasAan({ min: e.target.value === '' ? undefined : Number(e.target.value) })} /></Veldje>
              <Veldje label="Maximum"><input type="number" className="input-base" value={veld.max ?? ''} onChange={(e) => onPasAan({ max: e.target.value === '' ? undefined : Number(e.target.value) })} /></Veldje>
            </div>
          )}

          {veld.type === 'schaal' && (
            <div className="grid sm:grid-cols-3 gap-3">
              <Veldje label="Schaal">
                <select className="input-base" value={`${veld.min ?? 1}-${veld.max ?? 5}`} onChange={(e) => { const [a, b] = e.target.value.split('-').map(Number); onPasAan({ min: a, max: b }) }}>
                  <option value="1-5">1 tot 5</option><option value="1-10">1 tot 10</option><option value="0-10">0 tot 10</option>
                </select>
              </Veldje>
              <Veldje label="Tekst laagste"><input className="input-base" maxLength={60} value={veld.minLabel ?? ''} onChange={(e) => onPasAan({ minLabel: e.target.value })} placeholder="bv. Helemaal niet" /></Veldje>
              <Veldje label="Tekst hoogste"><input className="input-base" maxLength={60} value={veld.maxLabel ?? ''} onChange={(e) => onPasAan({ maxLabel: e.target.value })} placeholder="bv. Helemaal wel" /></Veldje>
            </div>
          )}

          {(veld.type === 'bestand' || veld.type === 'kleur') && (
            <Veldje label={veld.type === 'bestand' ? 'Maximaal aantal bestanden' : 'Maximaal aantal kleuren'}>
              <select className="input-base w-auto" value={veld.max ?? (veld.type === 'bestand' ? BESTAND_MAX_AANTAL : 3)} onChange={(e) => onPasAan({ max: Number(e.target.value) })}>
                {Array.from({ length: veld.type === 'bestand' ? BESTAND_MAX_AANTAL : 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </Veldje>
          )}

          {/* Voorwaarde */}
          <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 space-y-2">
            <div className="text-xs font-medium text-gray-600 flex items-center gap-1.5"><GitBranch className="h-3.5 w-3.5" />Enkel tonen als…</div>
            {bronnen.length === 0 && !veld.voorwaarde ? (
              <p className="text-xs text-gray-400">Er staat geen geschikt veld boven dit veld (bv. een ja/nee- of keuzevraag).</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-2">
                <select
                  className="input-base" value={veld.voorwaarde?.veld ?? ''}
                  onChange={(e) => {
                    const doel = velden.find((v) => v.id === e.target.value)
                    if (!doel) { onPasAan({ voorwaarde: null }); return }
                    const standaard = doel.type === 'jaNee' ? 'ja' : doel.opties?.[0] ?? ''
                    onPasAan({ voorwaarde: { veld: doel.id, waarde: standaard } })
                  }}
                  aria-label="Voorwaarde: veld"
                >
                  <option value="">Altijd tonen</option>
                  {bronnen.map((b) => <option key={b.id} value={b.id}>{b.label || b.id}</option>)}
                  {bron && !bronnen.includes(bron) && <option value={bron.id}>{bron.label || bron.id} (ongeldig)</option>}
                </select>
                {veld.voorwaarde && bron && (
                  bron.type === 'jaNee' ? (
                    <select className="input-base" value={veld.voorwaarde.waarde} onChange={(e) => onPasAan({ voorwaarde: { veld: bron.id, waarde: e.target.value } })} aria-label="Voorwaarde: waarde">
                      <option value="ja">is Ja</option><option value="nee">is Nee</option>
                    </select>
                  ) : heeftOpties(bron.type) ? (
                    <select className="input-base" value={veld.voorwaarde.waarde} onChange={(e) => onPasAan({ voorwaarde: { veld: bron.id, waarde: e.target.value } })} aria-label="Voorwaarde: waarde">
                      {(bron.opties ?? []).map((o) => <option key={o} value={o}>{bron.type === 'meerkeuze' ? `bevat "${o}"` : `is "${o}"`}</option>)}
                    </select>
                  ) : (
                    <input className="input-base" value={veld.voorwaarde.waarde} maxLength={200} placeholder="gelijk aan…" onChange={(e) => onPasAan({ voorwaarde: { veld: bron.id, waarde: e.target.value } })} aria-label="Voorwaarde: waarde" />
                  )
                )}
              </div>
            )}
            {voorwaardeOngeldig && (
              <p className="text-xs text-amber-700 flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" />Het bronveld staat niet (meer) boven dit veld — deze voorwaarde wordt bij opslaan verwijderd.</p>
            )}
          </div>
          <div className="text-[11px] text-gray-400">Veld-id: <code>{veld.id}</code></div>
        </div>
      )}
    </div>
  )
}

function IconKnop({ onClick, disabled, label, gevaar, children }: { onClick: () => void; disabled?: boolean; label: string; gevaar?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label}
      className={cn('h-8 w-8 flex items-center justify-center rounded-lg text-gray-500 disabled:opacity-30 disabled:pointer-events-none', gevaar ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-gray-100 hover:text-gray-900')}>
      {children}
    </button>
  )
}

function Veldje({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  )
}
