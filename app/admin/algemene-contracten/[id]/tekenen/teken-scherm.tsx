'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, MapPin, PenLine } from 'lucide-react'
import { HandtekeningVak } from '@/components/admin/handtekening-vak'
import { PdfVakken, type Vak } from '@/components/esign/pdf-vakken'
import { datumRegel } from '@/lib/contracten/tegenhandtekening'
import { namenLijst, type Zone } from '@/lib/algemene-contracten/model'

/** Zelfde sleutel als het tegentekenen: je handtekening van daarnet staat klaar (enkel in dit tabblad). */
const BEWAAR = 'ngm.tegenteken.handtekening'

/**
 * Links de PDF met het gele vak (jouw handtekening, met eronder naam en datum
 * en uur), grijs de plaats van collega's die nog tekenen en, als de andere
 * partij ook tekent, het blauwe vak voor hen. Geel en blauw zijn te verslepen.
 * Rechts enkel tekenen.
 */
export function AcTekenScherm({ contractId, pdfUrl, naam, tegenpartij, onsKan, reden, onsGetekend, anderen, partijPlaatsen, beginOns, beginPartij, volgendeId }: {
  contractId: string
  pdfUrl: string | null
  naam: string
  tegenpartij: string | null
  onsKan: boolean
  /** Waarom je niet (meer) tekent, als dat zo is. */
  reden: string | null
  /** Jouw eigen handtekening, als je al tekende. */
  onsGetekend: { door: string | null; op: string } | null
  /** Collega's die nog tekenen, met hun plaats. */
  anderen: { persoon: string; zone: Zone }[]
  partijPlaatsen: boolean
  beginOns: Zone
  beginPartij: Zone
  volgendeId: string | null
}) {
  const router = useRouter()
  const [ons, setOns] = useState<Zone>(beginOns)
  const [partij, setPartij] = useState<Zone>(beginPartij)
  const [actief, setActief] = useState<'ons' | 'partij'>(onsKan ? 'ons' : 'partij')
  const [png, setPng] = useState<string | null>(null)
  const [vorige, setVorige] = useState<string | null | undefined>(undefined)
  const [bezig, setBezig] = useState(false)
  const [datum, setDatum] = useState(() => datumRegel(new Date()))
  useEffect(() => { const t = setInterval(() => setDatum(datumRegel(new Date())), 15_000); return () => clearInterval(t) }, [])
  useEffect(() => { try { setVorige(sessionStorage.getItem(BEWAAR)) } catch { setVorige(null) } }, [])
  const kies = (v: string | null) => { setPng(v); try { if (v) sessionStorage.setItem(BEWAAR, v); else sessionStorage.removeItem(BEWAAR) } catch { /* geen opslag */ } }

  const naamPartij = tegenpartij || 'de andere partij'
  const vakken: Vak[] = [
    ...(onsKan ? [{ key: 'ons', label: 'Jouw handtekening', kleur: 'geel' as const, zone: ons, png, regels: [`${naam} · NextGen Agency BV`, datum], bewerkbaar: true }] : []),
    ...anderen.map((a) => ({ key: `ander-${a.persoon}`, label: `Plaats ${a.persoon}`, kleur: 'grijs' as const, zone: a.zone, regels: [a.persoon, 'Tekent nog'], bewerkbaar: false })),
    ...(partijPlaatsen ? [{ key: 'partij', label: `Handtekening ${naamPartij}`, kleur: 'blauw' as const, zone: partij, regels: ['Naam', 'Datum en uur'], bewerkbaar: true }] : []),
  ]
  const zetZone = (key: string, z: Zone) => (key === 'ons' ? setOns(z) : setPartij(z))

  const teken = async (doorgaan: boolean) => {
    if (!png) { toast.error('Teken eerst je handtekening.'); return }
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/algemene-contracten/${contractId}/tekenen`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handtekening: png, zone: ons, ...(partijPlaatsen ? { partij_zone: partij } : {}) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Tekenen mislukt')
      const nog: string[] = Array.isArray(j.nog) ? j.nog : []
      toast.success(nog.length ? `Ondertekend. Nog te tekenen door ${namenLijst(nog)}: die zien het bij hun taken.` : partijPlaatsen ? `Ondertekend. Stuur het nu naar ${naamPartij} om ook te tekenen.` : 'Ondertekend.')
      router.push(doorgaan && volgendeId ? `/admin/algemene-contracten/${volgendeId}/tekenen` : `/admin/algemene-contracten/${contractId}${partijPlaatsen && !nog.length ? '?versturen=1' : ''}`)
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Tekenen mislukt'); setBezig(false) }
  }

  const plaatsBewaren = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/algemene-contracten/${contractId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(onsKan ? { mijn_zone: ons } : {}), ...(partijPlaatsen ? { partij_zone: partij } : {}) }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      toast.success('Plaats bewaard.')
      router.push(`/admin/algemene-contracten/${contractId}${partijPlaatsen && !onsKan ? '?versturen=1' : ''}`)
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(false) }
  }

  if (!onsKan && !partijPlaatsen) {
    return (
      <div className="card-base text-sm text-gray-700 flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
        <span>{onsGetekend ? `Je tekende dit op ${new Date(onsGetekend.op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })}.` : reden ?? 'Hier moet niemand meer tekenen.'} <Link href={`/admin/algemene-contracten/${contractId}`} className="underline">Terug naar het contract</Link></span>
      </div>
    )
  }

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
      <PdfVakken pdfUrl={pdfUrl} vakken={vakken} actief={actief} onZone={zetZone} />
      <aside className="card-base space-y-4 lg:sticky lg:top-6">
        {onsKan && partijPlaatsen && (
          <div>
            <span className="block text-xs font-medium text-gray-600 mb-1">Je verplaatst</span>
            <div className="inline-flex rounded-full border border-gray-200 p-0.5 text-xs">
              <button type="button" onClick={() => setActief('ons')} className={`px-3 py-1 rounded-full ${actief === 'ons' ? 'bg-amber-400 text-gray-900' : 'text-gray-600'}`}>Jouw handtekening</button>
              <button type="button" onClick={() => setActief('partij')} className={`px-3 py-1 rounded-full ${actief === 'partij' ? 'bg-blue-500 text-white' : 'text-gray-600'}`}>{tegenpartij || 'Andere partij'}</button>
            </div>
          </div>
        )}
        {onsKan ? (
          <>
            <div>
              <h2 className="font-semibold text-gray-900">Namens NextGen Agency BV</h2>
              <p className="text-xs text-gray-500 mt-1">Je tekent als {naam}. Je naam en datum en uur komen vanzelf onder je handtekening.{anderen.length ? ` Grijs = de plaats van ${namenLijst(anderen.map((a) => a.persoon))}.` : ''}{partijPlaatsen ? ` Het blauwe vak is de plek voor ${naamPartij}; die tekent daarna via een link in de mail.` : ''}</p>
            </div>
            <div>
              <span className="block text-xs font-medium text-gray-600 mb-1">Handtekening</span>
              {vorige === undefined ? <div className="h-[150px] rounded-xl border border-dashed border-gray-300" /> : (
                <HandtekeningVak key={vorige ? 'vorige' : 'leeg'} onChange={kies} beginWaarde={vorige} hoogte={150} />
              )}
              {vorige && png === vorige && <p className="text-[11px] text-gray-500 mt-1">Je handtekening van daarnet staat klaar.</p>}
            </div>
            <div className="space-y-2">
              <button type="button" onClick={() => teken(false)} disabled={bezig || !png} className="btn-primary w-full">
                {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}Ondertekenen
              </button>
              {volgendeId && !partijPlaatsen && <button type="button" onClick={() => teken(true)} disabled={bezig || !png} className="btn-secondary w-full text-sm">Ondertekenen en volgende</button>}
              <button type="button" onClick={plaatsBewaren} disabled={bezig} className="w-full text-xs text-gray-500 hover:text-black underline underline-offset-2">Enkel de plaats bewaren, later tekenen</button>
            </div>
          </>
        ) : (
          <>
            <div>
              <h2 className="font-semibold text-gray-900">Plaats voor {naamPartij}</h2>
              <p className="text-xs text-gray-500 mt-1">{onsGetekend ? 'Je tekende al. ' : ''}Sleep het blauwe vak naar de plek waar {naamPartij} tekent. Daar komen hun handtekening, naam en datum en uur.</p>
            </div>
            <button type="button" onClick={plaatsBewaren} disabled={bezig} className="btn-primary w-full">
              {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}Plaats bewaren
            </button>
          </>
        )}
        <p className="text-[11px] text-gray-500">Staat een vak niet goed? Sleep het op de PDF naar de juiste plek, of trek aan het hoekje om het groter te maken.</p>
      </aside>
    </div>
  )
}
