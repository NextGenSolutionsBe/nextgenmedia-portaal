'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, ChevronDown, ChevronRight, Circle, Loader2, Pencil, PenLine, Plus, Trash2, X } from 'lucide-react'
import { leesGetal } from '@/lib/getal'
import { FREQUENTIES } from '@/lib/vesting'
import { maandTekst, type Vennoot } from '@/lib/vesting-akkoord'
import type { WamWeergave } from '@/lib/vesting-weergave'
import { TekenStand, api, datumKort, eur } from './delen'
import { Gegevens, NieuweTermijn, WAM_VERLOOP } from './wam-venster'

type Termijn = WamWeergave['termijnen'][number]
type Klant = { sleutel: string; naam: string; clientId: string | null; contracten: WamWeergave[] }

/** De WAM-contracten per klant (The VIBE met drie delen = één klant), alfabetisch. */
function perKlant(lijst: WamWeergave[]): Klant[] {
  const map = new Map<string, Klant>()
  for (const w of lijst) {
    const sleutel = w.client_id ?? w.klant.trim().toLowerCase()
    const k = map.get(sleutel) ?? { sleutel, naam: w.klant.trim(), clientId: w.client_id, contracten: [] }
    k.contracten.push(w)
    map.set(sleutel, k)
  }
  const nr = (w: WamWeergave) => Number(w.nr.replace(/\D/g, '')) || 0
  return Array.from(map.values())
    .map((k) => ({ ...k, contracten: k.contracten.sort((a, b) => nr(a) - nr(b)) }))
    .sort((a, b) => a.naam.localeCompare(b.naam, 'nl', { sensitivity: 'base' }))
}

function schemaTekst(w: WamWeergave): string {
  const f = FREQUENTIES.find((x) => x.key === w.schema.frequentie)
  if (!f) return ''
  if (f.key === 'eenmalig') return 'Eenmalig'
  const duur = w.schema.maanden ? ` · ${w.schema.maanden % 12 === 0 ? `${w.schema.maanden / 12} jaar` : `${w.schema.maanden} maanden`}` : ''
  return `${f.label}${w.schema.bedrag ? ` ${eur(w.schema.bedrag)}` : ''}${duur}`
}

/**
 * Alle WAM-klanten bij elkaar: per klant wat er binnenkwam en wat nog komt,
 * met de contracten en termijnen meteen aan te passen. Elke wijziging aan
 * cijfers of betalingen tekenen Marco, Bram en Chiara opnieuw (in het venster).
 */
export function WamKlanten({ wam, vennoten, onTekenen, onVernieuw }: {
  wam: WamWeergave[]
  vennoten: Record<Vennoot, string>
  onTekenen: (id: string) => void
  onVernieuw: () => void
}) {
  const klanten = useMemo(() => perKlant(wam), [wam])
  const [open, setOpen] = useState<Set<string>>(new Set())
  const alleOpen = klanten.length > 0 && klanten.every((k) => open.has(k.sleutel))
  const actief = wam.filter((w) => !w.geschrapt)
  const totaal = {
    waarde: actief.reduce((s, w) => s + w.contractwaarde, 0),
    ontvangen: actief.reduce((s, w) => s + w.ontvangen, 0),
    nog: actief.reduce((s, w) => s + w.nogBinnen, 0),
    telt: actief.reduce((s, w) => s + w.teltMee, 0),
  }
  const wissel = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n })

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {[
          ['Klanten', `${klanten.length}`, `${actief.length} contracten`],
          ['Contractwaarde', eur(totaal.waarde), 'excl. btw'],
          ['Ontvangen', eur(totaal.ontvangen), totaal.nog > 0 ? `nog ${eur(totaal.nog)} te komen` : 'alles binnen'],
          ['Telt mee voor Marco', eur(totaal.telt), 'volgens de laatste cijfers'],
        ].map(([l, w, s]) => (
          <div key={l} className="stat-card">
            <p className="label-mono">{l}</p>
            <p className="text-xl font-semibold text-gray-900 tabular-nums mt-1">{w}</p>
            <p className="text-[11px] text-gray-500">{s}</p>
          </div>
        ))}
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen(alleOpen ? new Set() : new Set(klanten.map((k) => k.sleutel)))} className="text-xs text-gray-500 hover:text-black">
          {alleOpen ? 'Alles dichtklappen' : 'Alles openklappen'}
        </button>
      </div>

      <ul className="space-y-2">
        {klanten.map((k) => <KlantKaart key={k.sleutel} k={k} open={open.has(k.sleutel)} onWissel={() => wissel(k.sleutel)} vennoten={vennoten} onTekenen={onTekenen} onVernieuw={onVernieuw} />)}
      </ul>
    </div>
  )
}

function KlantKaart({ k, open, onWissel, vennoten, onTekenen, onVernieuw }: {
  k: Klant; open: boolean; onWissel: () => void; vennoten: Record<Vennoot, string>; onTekenen: (id: string) => void; onVernieuw: () => void
}) {
  const actief = k.contracten.filter((w) => !w.geschrapt)
  const waarde = actief.reduce((s, w) => s + w.contractwaarde, 0)
  const ontvangen = actief.reduce((s, w) => s + w.ontvangen, 0)
  const nog = actief.reduce((s, w) => s + w.nogBinnen, 0)
  const loopt = actief.some((w) => w.status === 'actief')
  const teTekenen = k.contracten.filter((w) => !w.akkoord.stand.volledig).length
  const volgende = actief.flatMap((w) => w.termijnen).filter((t) => t.status === 'gepland' || t.status === 'gefactureerd')
    .sort((a, b) => a.factuurdatum.localeCompare(b.factuurdatum))[0]
  // Tegenover de contractwaarde: zo valt op als er minder ingepland is dan afgesproken.
  const noemer = Math.max(waarde, ontvangen + nog)
  const deel = noemer > 0 ? Math.min(1, ontvangen / noemer) : 1
  const zonderTermijn = Math.round(waarde - ontvangen - nog)

  return (
    <li className="rounded-[14px] border border-black/[0.05] bg-white shadow-md overflow-hidden">
      <button type="button" onClick={onWissel} aria-expanded={open} className="w-full text-left p-3.5 sm:p-4 hover:bg-gray-50 transition-colors">
        <div className="flex items-start gap-3">
          {open ? <ChevronDown className="h-4 w-4 mt-1 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-1 text-gray-400 shrink-0" />}
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-gray-900 truncate">{k.naam}</div>
            <div className="text-xs text-gray-500 truncate">
              {k.contracten.length > 1 ? `${k.contracten.length} contracten · ` : ''}{k.contracten.map((w) => w.nr).join(', ')}
              {volgende ? ` · volgende termijn ${datumKort(volgende.factuurdatum)}` : ''}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-semibold tabular-nums text-gray-900">{eur(ontvangen)}</div>
            <div className="text-[11px] text-gray-500 tabular-nums">van {eur(waarde)}</div>
          </div>
        </div>
        <div className="mt-2 ml-7 h-1.5 rounded-full bg-gray-100 overflow-hidden" aria-hidden>
          <div className="h-full bg-gray-900" style={{ width: `${Math.round(deel * 100)}%` }} />
        </div>
        <div className="mt-2 ml-7 flex flex-wrap gap-1.5">
          <Chip>{loopt ? 'Loopt' : 'Voltooid'}</Chip>
          {nog > 0 && <Chip>Nog {eur(nog)} te komen</Chip>}
          {zonderTermijn > 0 && <Chip zwak>{eur(zonderTermijn)} van de waarde zit in geen termijn</Chip>}
          {teTekenen > 0 && <Chip zwak>{teTekenen === k.contracten.length ? 'Nog te tekenen' : `${teTekenen} nog te tekenen`}</Chip>}
        </div>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-2.5 sm:px-4 py-3 space-y-4 bg-gray-50/50">
          {k.clientId && <Link href={`/admin/clients/${k.clientId}`} prefetch={false} className="text-xs text-gray-500 hover:text-black underline-offset-2 hover:underline">Klantfiche openen</Link>}
          {k.contracten.map((w) => <ContractBlok key={w.id} w={w} vennoten={vennoten} onTekenen={() => onTekenen(w.id)} onVernieuw={onVernieuw} />)}
        </div>
      )}
    </li>
  )
}

function ContractBlok({ w, vennoten, onTekenen, onVernieuw }: { w: WamWeergave; vennoten: Record<Vennoot, string>; onTekenen: () => void; onVernieuw: () => void }) {
  const [bewerk, setBewerk] = useState(false)
  const [nieuw, setNieuw] = useState(false)
  const geldig = w.termijnen.filter((t) => t.status !== 'geannuleerd')
  const betaald = geldig.filter((t) => t.status === 'betaald').length

  return (
    <div className={`rounded-xl border bg-white p-2.5 sm:p-3 ${w.geschrapt ? 'border-dashed border-gray-300 opacity-70' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">
            {w.geschrapt && <span className="text-red-700">Geschrapt · </span>}{w.nr}{w.omschrijving ? ` · ${w.omschrijving}` : ''}
          </div>
          <div className="text-[11px] text-gray-500">
            {[schemaTekst(w), WAM_VERLOOP[w.status], `${betaald} van ${geldig.length} betaald`, `waarde ${eur(w.contractwaarde)}`].filter(Boolean).join(' · ')}
          </div>
          {w.notitie && <div className="text-[11px] text-gray-500 mt-0.5">{w.notitie}</div>}
        </div>
        {!bewerk && !w.geschrapt && (
          <button type="button" onClick={() => setBewerk(true)} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Pencil className="h-3 w-3" />Gegevens aanpassen</button>
        )}
      </div>

      {bewerk && <div className="mt-3"><Gegevens w={w} onKlaar={() => { setBewerk(false); onVernieuw() }} onAnnuleer={() => setBewerk(false)} /></div>}

      <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100">
        {w.termijnen.map((t) => <TermijnRij key={t.id} t={t} uit={w.geschrapt} onVernieuw={onVernieuw} />)}
        {w.termijnen.length === 0 && <li className="px-3 py-2.5 text-sm text-gray-500">Nog geen termijnen.</li>}
      </ul>
      {!w.geschrapt && (nieuw
        ? <NieuweTermijn wamId={w.id} onKlaar={() => { setNieuw(false); onVernieuw() }} onAnnuleer={() => setNieuw(false)} />
        : <button type="button" onClick={() => setNieuw(true)} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black"><Plus className="h-3 w-3" />Termijn toevoegen</button>)}

      <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <TekenStand akkoord={w.akkoord} vennoten={vennoten} />
        <button type="button" onClick={onTekenen} className="inline-flex items-center gap-1 text-xs text-gray-700 hover:text-black">
          <PenLine className="h-3.5 w-3.5" />{w.akkoord.stand.volledig ? 'Bekijken' : 'Tekenen'}
        </button>
      </div>
    </div>
  )
}

function TermijnRij({ t, uit, onVernieuw }: { t: Termijn; uit: boolean; onVernieuw: () => void }) {
  const [bewerk, setBewerk] = useState(false)
  const [datum, setDatum] = useState(t.factuurdatum)
  const [bedrag, setBedrag] = useState(String(t.bedrag).replace('.', ','))
  const [betaaldOp, setBetaaldOp] = useState(t.betaald_op ?? '')
  const [bezig, setBezig] = useState<'bewaar' | 'betaald' | 'weg' | null>(null)
  const geannuleerd = t.status === 'geannuleerd'

  const patch = async (body: Record<string, unknown>, wat: 'bewaar' | 'betaald', melding: string) => {
    setBezig(wat)
    try {
      await api('/api/admin/vesting', { method: 'PATCH', body: JSON.stringify({ resource: 'termijn', id: t.id, ...body }) })
      toast.success(melding)
      setBewerk(false)
      onVernieuw()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  const bewaar = () => {
    const x = leesGetal(bedrag)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) { toast.error('Kies de datum.'); return }
    if (x === null || x <= 0) { toast.error('Vul het bedrag in (excl. btw).'); return }
    const body: Record<string, unknown> = {}
    if (!t.heeftFactuur) { body.factuurdatum = datum; body.bedrag_excl = x }
    if (t.status === 'betaald' && /^\d{4}-\d{2}-\d{2}$/.test(betaaldOp)) body.betaald_op = betaaldOp
    void patch(body, 'bewaar', 'Aangepast. Iedereen tekent opnieuw als de cijfers veranderden.')
  }
  const weg = async () => {
    if (!window.confirm(`De termijn van ${maandTekst(t.periode)} (${eur(t.bedrag, true)}) verwijderen?`)) return
    setBezig('weg')
    try {
      await api(`/api/admin/vesting?resource=termijn&id=${t.id}`, { method: 'DELETE' })
      toast.success('Termijn verwijderd.')
      onVernieuw()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBezig(null) }
  }

  if (bewerk) {
    return (
      <li className="px-3 py-2.5 space-y-2">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <label className="block text-[11px] text-gray-500">Factuurdatum
            <input type="date" className="input-base mt-1" value={datum} disabled={t.heeftFactuur} onChange={(e) => setDatum(e.target.value)} />
          </label>
          <label className="block text-[11px] text-gray-500">Bedrag (excl. btw)
            <input className="input-base mt-1" inputMode="decimal" value={bedrag} disabled={t.heeftFactuur} onChange={(e) => setBedrag(e.target.value)} />
          </label>
          {t.status === 'betaald' && (
            <label className="block text-[11px] text-gray-500">Betaald op
              <input type="date" className="input-base mt-1" value={betaaldOp} onChange={(e) => setBetaaldOp(e.target.value)} />
            </label>
          )}
        </div>
        {t.heeftFactuur && <p className="text-[11px] text-gray-500">Er is een factuur voor deze termijn: bedrag en datum pas je aan in Facturen.</p>}
        <div className="flex gap-2">
          <button type="button" onClick={bewaar} disabled={!!bezig} className="btn-primary text-xs h-8">{bezig === 'bewaar' && <Loader2 className="h-3 w-3 animate-spin" />}Bewaren</button>
          <button type="button" onClick={() => setBewerk(false)} className="btn-secondary text-xs h-8"><X className="h-3 w-3" />Annuleren</button>
        </div>
      </li>
    )
  }

  const acties = !geannuleerd && !uit ? (
    <>
      {t.status === 'betaald'
        ? <button type="button" onClick={() => patch({ status: 'gepland' }, 'betaald', 'Niet meer betaald. Iedereen tekent opnieuw.')} disabled={!!bezig} title="Toch niet betaald"
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-green-200 bg-green-50 text-green-800 text-[11px] h-7 w-[84px] shrink-0 hover:bg-green-100">
            {bezig === 'betaald' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Betaald
          </button>
        : <button type="button" onClick={() => patch({ status: 'betaald' }, 'betaald', 'Als betaald aangeduid. Iedereen tekent opnieuw.')} disabled={!!bezig}
            className="btn-secondary text-[11px] h-7 w-[84px] shrink-0 justify-center px-2">
            {bezig === 'betaald' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Circle className="h-3 w-3" />}Betaald?
          </button>}
      <button type="button" onClick={() => setBewerk(true)} aria-label="Termijn aanpassen" className="p-1.5 text-gray-400 hover:text-black shrink-0"><Pencil className="h-3.5 w-3.5" /></button>
      {t.status === 'gepland' && !t.heeftFactuur
        ? <button type="button" onClick={weg} disabled={!!bezig} aria-label="Termijn verwijderen" className="p-1.5 text-gray-400 hover:text-red-600 shrink-0">
            {bezig === 'weg' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        : <span className="w-[26px] shrink-0" aria-hidden />}
    </>
  ) : null

  return (
    <li className="px-3 py-2 text-sm">
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className={`whitespace-nowrap ${geannuleerd ? 'line-through text-gray-400' : 'text-gray-900'}`}>{maandTekst(t.periode)}</div>
          <div className="text-[11px] text-gray-500">
            {t.status === 'betaald' ? `Betaald${t.betaald_op ? ` op ${datumKort(t.betaald_op)}` : ''}` : geannuleerd ? 'Geannuleerd' : t.status === 'gefactureerd' ? 'Gefactureerd, nog niet betaald' : `Factuur op ${datumKort(t.factuurdatum)}`}
          </div>
        </div>
        <div className="tabular-nums text-gray-800 shrink-0">{eur(t.bedrag, true)}</div>
        {acties && <div className="hidden sm:flex items-center gap-1">{acties}</div>}
      </div>
      {acties && <div className="flex sm:hidden items-center justify-end gap-1 mt-1.5">{acties}</div>}
    </li>
  )
}

function Chip({ children, zwak = false }: { children: React.ReactNode; zwak?: boolean }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] ${zwak ? 'border border-amber-200 bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>{children}</span>
}
