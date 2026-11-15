'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, Sparkles, X } from 'lucide-react'
import { formatEuro } from '@/lib/utils'
import { leesGetal } from '@/lib/getal'

/** Eén factuur uit het contract, zoals de server ze voorstelt. */
export type SlimFactuur = {
  sleutel: string; periode: string; van: string; tot: string; datum: string
  titel: string; omschrijving: string; bedrag: number; btw: number; eenheid: 'maand' | 'forfait'; post: number; bestaat: boolean
}
type Voorstel = {
  facturen: SlimFactuur[]; totaal: number; ontbreekt: string[]; opmerkingen: string[]
  getekend: boolean; bestelbon: string | null; klantId: string | null; gelezen: boolean
}
type Rij = SlimFactuur & { gekozen: boolean; open: boolean; bedragTekst: string }

const kort = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const cel = 'w-full px-2 py-1 text-xs border border-gray-200 rounded-md bg-white'

/**
 * Slim invullen: de app leest het contract en stelt de facturen voor (titel,
 * omschrijving, bedrag, datum; maandelijks = één per maand met de maand in de
 * titel; hosting of onderhoud apart). Je kiest, past aan en voegt toe als
 * "Te factureren", of vult er één in dit venster in. Wat er al staat, is aangeduid.
 */
export function SlimInvullen({ contractId, onInvullen, onToegevoegd, onSluit }: {
  contractId: string
  onInvullen: (f: SlimFactuur, extra: { bestelbon: string | null; klantId: string | null }) => void
  onToegevoegd: (aantal: number) => void
  onSluit: () => void
}) {
  const [v, setV] = useState<Voorstel | null>(null)
  const [rijen, setRijen] = useState<Rij[]>([])
  const [fout, setFout] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    let weg = false
    fetch(`/api/admin/contracts/${contractId}/facturen-plannen?voorstel=1`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Lezen mislukt'); return j as Voorstel })
      .then((j) => { if (weg) return; setV(j); setRijen(j.facturen.map((f) => ({ ...f, gekozen: !f.bestaat, open: false, bedragTekst: String(f.bedrag).replace('.', ',') }))) })
      .catch((e) => { if (!weg) setFout(e instanceof Error ? e.message : 'Lezen mislukt') })
    return () => { weg = true }
  }, [contractId])

  const zet = (i: number, deel: Partial<Rij>) => setRijen((l) => l.map((r, j) => (j === i ? { ...r, ...deel } : r)))
  const gekozen = rijen.filter((r) => r.gekozen)
  const metBedrag = (r: Rij): SlimFactuur => ({ ...r, bedrag: leesGetal(r.bedragTekst) ?? 0 })
  const somGekozen = gekozen.reduce((s, r) => s + (leesGetal(r.bedragTekst) ?? 0), 0)
  const ongeldig = gekozen.find((r) => !r.titel.trim() || !(leesGetal(r.bedragTekst) ?? 0) || !/^\d{4}-\d{2}-\d{2}$/.test(r.datum))

  const toevoegen = async () => {
    if (ongeldig) { toast.error(`Kijk "${ongeldig.titel || 'de titel'}" na: titel, datum en bedrag zijn nodig.`); return }
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturen-plannen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facturen: gekozen.map(metBedrag).map(({ sleutel, periode, van, tot, datum, titel, omschrijving, bedrag, btw, eenheid, post }) => ({ sleutel, periode, van, tot, datum, titel, omschrijving, bedrag, btw, eenheid, post })) }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Toevoegen mislukt')
      toast.success(j.toegevoegd
        ? `${j.toegevoegd} ${j.toegevoegd === 1 ? 'factuur staat' : 'facturen staan'} bij Te factureren${j.overgeslagen ? ` (${j.overgeslagen} stond${j.overgeslagen === 1 ? '' : 'en'} er al)` : ''}.`
        : 'Die facturen stonden er al.')
      onToegevoegd(j.toegevoegd ?? 0)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-violet-700" />
        <div className="text-sm font-semibold text-gray-900 flex-1">Slim invullen uit het contract</div>
        <button type="button" onClick={onSluit} className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-white" aria-label="Sluiten"><X className="h-4 w-4" /></button>
      </div>

      {!v && !fout && <p className="text-sm text-gray-600 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Het contract wordt gelezen. Dat duurt tot 20 seconden.</p>}
      {fout && <p className="text-sm text-red-700">{fout}</p>}

      {v && (
        <>
          <div className="space-y-1 text-xs">
            {!v.getekend && <p className="text-amber-800 flex items-start gap-1"><AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />Het contract is nog niet getekend. Voeg pas facturen toe als je zeker bent.</p>}
            {!v.gelezen && <p className="text-amber-800">De pdf kon niet gelezen worden: dit voorstel komt uit de gegevens in de app.</p>}
            {v.bestelbon && <p className="text-gray-700">Bestelbon <b>{v.bestelbon}</b> komt op elke factuur.</p>}
            {v.opmerkingen.map((o, i) => <p key={i} className="text-gray-600">{o}</p>)}
            {v.ontbreekt.length > 0 && <p className="text-amber-800">Nog niet gevonden: {v.ontbreekt.join(', ')}. Vul die in bij het contract of maak de factuur hieronder zelf.</p>}
          </div>

          {rijen.length > 0 && (
            <ul className="divide-y divide-violet-100 rounded-lg border border-violet-100 bg-white">
              {rijen.map((r, i) => (
                <li key={r.sleutel} className="px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" checked={r.gekozen} onChange={(e) => zet(i, { gekozen: e.target.checked })} className="h-4 w-4 accent-gray-900 shrink-0" aria-label={`${r.titel} kiezen`} />
                    <input className={`${cel} flex-1 min-w-0 font-medium`} value={r.titel} onChange={(e) => zet(i, { titel: e.target.value })} aria-label="Titel" />
                    <input type="date" className={`${cel} w-32 shrink-0`} value={r.datum} onChange={(e) => zet(i, { datum: e.target.value })} aria-label="Factuurdatum" />
                    <input className={`${cel} w-24 shrink-0 text-right`} inputMode="decimal" value={r.bedragTekst} onChange={(e) => zet(i, { bedragTekst: e.target.value })} aria-label="Bedrag excl. btw" />
                    <button type="button" onClick={() => zet(i, { open: !r.open })} className="h-7 w-7 flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 shrink-0" title="Omschrijving" aria-label="Omschrijving tonen">
                      {r.open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <div className="mt-0.5 ml-6 text-[11px] text-gray-500">
                    {kort(r.datum)} · {r.btw}% btw{r.bestaat && <span className="ml-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 px-1.5">staat er al</span>}
                  </div>
                  {r.open && <textarea rows={6} className={`${cel} mt-2 ml-6 w-[calc(100%-1.5rem)] leading-relaxed`} value={r.omschrijving} onChange={(e) => zet(i, { omschrijving: e.target.value })} aria-label="Omschrijving op de factuur" />}
                </li>
              ))}
            </ul>
          )}

          {rijen.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-600 mr-auto">{gekozen.length} gekozen · {formatEuro(somGekozen)} excl. btw</span>
              {gekozen.length === 1 && (
                <button type="button" onClick={() => onInvullen(metBedrag(gekozen[0]), { bestelbon: v.bestelbon, klantId: v.klantId })} className="btn-secondary text-sm">In dit venster invullen</button>
              )}
              <button type="button" onClick={toevoegen} disabled={bezig || !gekozen.length} className="btn-primary text-sm">
                {bezig && <Loader2 className="h-4 w-4 animate-spin" />}{gekozen.length === 1 ? 'Toevoegen als te factureren' : `${gekozen.length} toevoegen als te factureren`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
