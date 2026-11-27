'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus, Repeat } from 'lucide-react'
import { Kop, INP, Veld, Dialoog, Schakelaar, Badge, Laden } from './ui'
import { boom, EENHEDEN, dienstenLijst, type Catalogus, type DienstRij, type Eenheid, type BedrijfRij } from '@/lib/bedrijven/model'
import { deliverablesTekst, deliverableTekst, type Deliverable } from '@/lib/bedrijven/deliverables'

type Concept = {
  naam: string; bedrijf: string; parent_slug: string; omschrijving: string
  inbegrepen: string; niet_inbegrepen: string; eenheid: Eenheid; terugkerend: boolean; actief: boolean
  volgorde: string; min_prijs: string; min_marge_pct: string; kleur: string
  deliverables: string
}

const leegConcept = (bedrijf: string): Concept => ({
  naam: '', bedrijf, parent_slug: '', omschrijving: '', inbegrepen: '', niet_inbegrepen: '', eenheid: 'eenmalig',
  terugkerend: false, actief: true, volgorde: '', min_prijs: '', min_marge_pct: '', kleur: '#E5E7EB', deliverables: '',
})

const conceptVan = (x: DienstRij, d: Deliverable[] = []): Concept => ({
  naam: x.naam, bedrijf: x.bedrijf, parent_slug: x.parent_slug ?? '', omschrijving: x.omschrijving ?? '',
  inbegrepen: x.inbegrepen.join('\n'), niet_inbegrepen: x.niet_inbegrepen.join('\n'), eenheid: x.eenheid,
  terugkerend: x.terugkerend, actief: x.actief, volgorde: String(x.volgorde), min_prijs: x.min_prijs === null ? '' : String(x.min_prijs),
  min_marge_pct: x.min_marge_pct === null ? '' : String(x.min_marge_pct), kleur: x.kleur ?? '#E5E7EB',
  deliverables: deliverablesTekst(d),
})

const euro = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

/**
 * Instellingen → Diensten: de dienstencatalogus per bedrijf. Eén lijst voor
 * de hele app: projectkaarten, contracten, facturen en rapporten gebruiken
 * deze diensten. Een dienst uitzetten verbergt hem in keuzelijsten; wat al
 * bestaat houdt zijn dienst.
 */
export function SectieDiensten() {
  const [cat, setCat] = useState<Catalogus | null>(null)
  const [bewerk, setBewerk] = useState<{ slug: string | null; c: Concept } | null>(null)
  const [bezig, setBezig] = useState(false)
  const [inactief, setInactief] = useState(false)
  const [merk, setMerk] = useState<{ slug: string; v: Record<string, string> } | null>(null)
  const [deliv, setDeliv] = useState<Record<string, Deliverable[]>>({})

  const bewaarMerk = async () => {
    if (!merk) return
    setBezig(true)
    try {
      const r = await fetch('/api/admin/bedrijven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'bedrijf', slug: merk.slug, invoer: merk.v }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      setCat(j.catalogus); setMerk(null)
      toast.success('Merkgegevens bewaard.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
    finally { setBezig(false) }
  }
  const merkVan = (b: BedrijfRij) => ({
    naam: b.naam, handelsnaam: b.handelsnaam ?? '', kort: b.kort ?? '', kleur: b.kleur ?? '#111111',
    website: b.website ?? '', email: b.email ?? '', antwoord_email: b.antwoord_email ?? '', voettekst: b.voettekst ?? '',
  })

  const laad = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/bedrijven?deliverables=1', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      setCat(j.catalogus); setDeliv(j.deliverables ?? {})
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])

  const bewaar = async () => {
    if (!bewerk) return
    setBezig(true)
    try {
      const c = bewerk.c
      const invoer = {
        naam: c.naam, bedrijf: c.bedrijf, parent_slug: c.parent_slug || null, omschrijving: c.omschrijving,
        inbegrepen: c.inbegrepen, niet_inbegrepen: c.niet_inbegrepen, eenheid: c.eenheid, terugkerend: c.terugkerend, actief: c.actief,
        volgorde: c.volgorde === '' ? undefined : Number(c.volgorde), min_prijs: c.min_prijs, min_marge_pct: c.min_marge_pct, kleur: c.kleur,
      }
      const r = await fetch('/api/admin/bedrijven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'dienst', bestaand: bewerk.slug, invoer }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      setCat(j.catalogus)
      const slug: string | undefined = j.dienst?.slug ?? bewerk.slug ?? undefined
      if (slug && c.deliverables.trim() !== deliverablesTekst(deliv[bewerk.slug ?? ''] ?? []).trim()) {
        const d = await fetch('/api/admin/bedrijven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'deliverables', slug, tekst: c.deliverables }) })
        const dj = await d.json()
        if (!d.ok) toast.error(dj.error || 'Deliverables niet bewaard')
        else setDeliv(dj.deliverables ?? {})
      }
      setBewerk(null)
      toast.success(bewerk.slug ? 'Dienst aangepast.' : 'Dienst toegevoegd.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
    finally { setBezig(false) }
  }

  if (!cat) return <Laden />
  const groepen = boom(cat, inactief)
  const hoofddiensten = (bedrijf: string) => dienstenLijst(cat, { bedrijf, ookInactief: true }).filter((x) => !x.parent_slug && x.slug !== bewerk?.slug)
  const zet = (patch: Partial<Concept>) => setBewerk((b) => (b ? { ...b, c: { ...b.c, ...patch } } : b))

  const Rij = ({ x, sub }: { x: DienstRij; sub?: boolean }) => (
    <div className={`flex items-center gap-3 py-2 ${sub ? 'pl-7' : ''} ${x.actief ? '' : 'opacity-50'}`}>
      <span className="h-3 w-3 rounded-full shrink-0 border border-black/10" style={{ background: x.kleur ?? '#E5E7EB' }} />
      <div className="min-w-0 flex-1">
        <div className="text-sm text-gray-900 flex items-center gap-2 flex-wrap">
          <span className={sub ? '' : 'font-medium'}>{x.naam}</span>
          {x.terugkerend && <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><Repeat className="h-3 w-3" />terugkerend</span>}
          {!x.actief && <Badge kleur="grijs">uit</Badge>}
        </div>
        {x.omschrijving && <div className="text-xs text-gray-500 truncate">{x.omschrijving}</div>}
        {(deliv[x.slug] ?? []).length > 0 && <div className="text-xs text-gray-500 truncate">Standaard: {(deliv[x.slug] ?? []).map(deliverableTekst).join(' · ')}</div>}
      </div>
      <div className="hidden sm:block text-xs text-gray-500 text-right shrink-0">
        {EENHEDEN.find((e) => e.key === x.eenheid)?.label}
        {x.min_prijs !== null && <div>min. {euro(x.min_prijs)}</div>}
      </div>
      <button type="button" onClick={() => setBewerk({ slug: x.slug, c: conceptVan(x, deliv[x.slug]) })} className="h-8 w-8 rounded-lg hover:bg-gray-100 flex items-center justify-center shrink-0" aria-label={`${x.naam} aanpassen`}>
        <Pencil className="h-4 w-4 text-gray-500" />
      </button>
    </div>
  )

  return (
    <div className="space-y-4">
    <div className="card-base">
      <Kop titel="Bedrijven" tekst="Naam, handelsnaam en contactgegevens per bedrijf, zoals ze op documenten en mails komen." />
      <div className="grid sm:grid-cols-3 gap-3">
        {[...cat.bedrijven].sort((a, b) => a.volgorde - b.volgorde).map((b) => (
          <div key={b.slug} className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-full" style={{ background: b.kleur ?? '#111' }} />
              <span className="font-medium text-gray-900 text-sm flex-1 truncate">{b.naam}</span>
              <button type="button" onClick={() => setMerk({ slug: b.slug, v: merkVan(b) })} className="h-7 w-7 rounded-lg hover:bg-gray-100 flex items-center justify-center" aria-label={`${b.naam} aanpassen`}><Pencil className="h-3.5 w-3.5 text-gray-500" /></button>
            </div>
            <div className="text-xs text-gray-500 mt-1.5 space-y-0.5">
              {b.handelsnaam && <div>Handelsnaam {b.handelsnaam}</div>}
              {b.website && <div>{b.website}</div>}
              {b.antwoord_email && <div>Antwoorden naar {b.antwoord_email}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>

    <div className="card-base">
      <Kop titel="Diensten" tekst="De diensten van NextGen Media en NextGen Solutions. Deze lijst geldt overal in de app."
        rechts={<button type="button" className="btn-primary" onClick={() => setBewerk({ slug: null, c: leegConcept('nextgenmedia') })}><Plus className="h-4 w-4" />Dienst toevoegen</button>} />

      <label className="flex items-center gap-2 text-xs text-gray-500 mb-3">
        <Schakelaar aan={inactief} onChange={setInactief} label="Ook uitgezette diensten tonen" /> Ook uitgezette diensten tonen
      </label>

      <div className="space-y-5">
        {groepen.map((g) => (
          <div key={g.bedrijf.slug}>
            <div className="flex items-center gap-2 mb-1">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.bedrijf.kleur ?? '#111' }} />
              <h3 className="text-sm font-semibold text-gray-900">{g.bedrijf.naam}</h3>
            </div>
            <div className="divide-y divide-gray-100 border-t border-b border-gray-100">
              {g.diensten.map(({ dienst, sub }) => (
                <div key={dienst.slug}>
                  <Rij x={dienst} />
                  {sub.map((s) => <Rij key={s.slug} x={s} sub />)}
                </div>
              ))}
              {g.diensten.length === 0 && <div className="py-3 text-sm text-gray-400">Nog geen diensten.</div>}
            </div>
          </div>
        ))}
      </div>

      {bewerk && (
        <Dialoog titel={bewerk.slug ? 'Dienst aanpassen' : 'Dienst toevoegen'} onSluit={() => !bezig && setBewerk(null)} breed>
          <div className="grid sm:grid-cols-2 gap-3">
            <Veld label="Naam" breed><input className={INP} value={bewerk.c.naam} onChange={(e) => zet({ naam: e.target.value })} maxLength={80} autoFocus /></Veld>
            <Veld label="Bedrijf">
              <select className={INP} value={bewerk.c.bedrijf} onChange={(e) => zet({ bedrijf: e.target.value, parent_slug: '' })}>
                {cat.bedrijven.map((b) => <option key={b.slug} value={b.slug}>{b.naam}</option>)}
              </select>
            </Veld>
            <Veld label="Valt onder" hint="Leeg = hoofddienst. Een subdienst telt in rapporten bij zijn hoofddienst.">
              <select className={INP} value={bewerk.c.parent_slug} onChange={(e) => zet({ parent_slug: e.target.value })}>
                <option value="">Geen (hoofddienst)</option>
                {hoofddiensten(bewerk.c.bedrijf).map((x) => <option key={x.slug} value={x.slug}>{x.naam}</option>)}
              </select>
            </Veld>
            <Veld label="Omschrijving" breed><input className={INP} value={bewerk.c.omschrijving} onChange={(e) => zet({ omschrijving: e.target.value })} maxLength={500} /></Veld>
            <Veld label="Standaard inbegrepen" hint="Eén punt per regel."><textarea className={INP} rows={4} value={bewerk.c.inbegrepen} onChange={(e) => zet({ inbegrepen: e.target.value })} /></Veld>
            <Veld label="Niet inbegrepen" hint="Eén punt per regel."><textarea className={INP} rows={4} value={bewerk.c.niet_inbegrepen} onChange={(e) => zet({ niet_inbegrepen: e.target.value })} /></Veld>
            <Veld label="Standaard deliverables" hint="Eén per regel, bv. 12 posts per maand. De contentkalender toont het naast wat gepland staat." breed>
              <textarea className={INP} rows={3} value={bewerk.c.deliverables} onChange={(e) => zet({ deliverables: e.target.value })} placeholder={'12 posts per maand\n4 reels per maand'} />
            </Veld>
            <Veld label="Eenheid">
              <select className={INP} value={bewerk.c.eenheid} onChange={(e) => { const v = e.target.value as Eenheid; zet({ eenheid: v, terugkerend: v === 'maand' ? true : bewerk.c.terugkerend }) }}>
                {EENHEDEN.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </Veld>
            <Veld label="Volgorde" hint="Lager = hoger in de lijst."><input className={INP} inputMode="numeric" value={bewerk.c.volgorde} onChange={(e) => zet({ volgorde: e.target.value.replace(/[^0-9]/g, '') })} /></Veld>
            <Veld label="Minimumprijs (excl. btw)" hint="Optioneel. De offerte waarschuwt als je eronder gaat."><input className={INP} inputMode="decimal" value={bewerk.c.min_prijs} onChange={(e) => zet({ min_prijs: e.target.value })} placeholder="Bv. 750" /></Veld>
            <Veld label="Minimale marge (%)" hint="Optioneel."><input className={INP} inputMode="decimal" value={bewerk.c.min_marge_pct} onChange={(e) => zet({ min_marge_pct: e.target.value })} placeholder="Bv. 40" /></Veld>
            <Veld label="Kleur"><input type="color" className="h-9 w-16 rounded-lg border border-gray-200" value={bewerk.c.kleur} onChange={(e) => zet({ kleur: e.target.value })} /></Veld>
            <div className="flex flex-col gap-2 justify-end">
              <label className="flex items-center gap-2 text-sm text-gray-700"><Schakelaar aan={bewerk.c.terugkerend} onChange={(v) => zet({ terugkerend: v })} label="Terugkerend" /> Terugkerend (retainer)</label>
              <label className="flex items-center gap-2 text-sm text-gray-700"><Schakelaar aan={bewerk.c.actief} onChange={(v) => zet({ actief: v })} label="Actief" /> Actief in keuzelijsten</label>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-5">
            <button type="button" className="btn-secondary" onClick={() => setBewerk(null)} disabled={bezig}>Annuleren</button>
            <button type="button" className="btn-primary" onClick={bewaar} disabled={bezig || bewerk.c.naam.trim().length < 2}>
              {bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren
            </button>
          </div>
        </Dialoog>
      )}

      {merk && (
        <Dialoog titel="Merkgegevens" onSluit={() => !bezig && setMerk(null)} breed>
          <div className="grid sm:grid-cols-2 gap-3">
            {([['naam', 'Naam'], ['handelsnaam', 'Handelsnaam'], ['kort', 'Korte naam (in lijsten)'], ['website', 'Website'], ['email', 'Contactadres'], ['antwoord_email', 'Antwoordadres voor mails']] as const).map(([k, l]) => (
              <Veld key={k} label={l}><input className={INP} value={merk.v[k] ?? ''} onChange={(e) => setMerk((m) => (m ? { ...m, v: { ...m.v, [k]: e.target.value } } : m))} /></Veld>
            ))}
            <Veld label="Kleur"><input type="color" className="h-9 w-16 rounded-lg border border-gray-200" value={merk.v.kleur} onChange={(e) => setMerk((m) => (m ? { ...m, v: { ...m.v, kleur: e.target.value } } : m))} /></Veld>
            <Veld label="Voettekst onderaan elke mail" breed><textarea className={INP} rows={2} value={merk.v.voettekst} onChange={(e) => setMerk((m) => (m ? { ...m, v: { ...m.v, voettekst: e.target.value } } : m))} /></Veld>
          </div>
          <div className="flex justify-end gap-2 pt-5">
            <button type="button" className="btn-secondary" onClick={() => setMerk(null)} disabled={bezig}>Annuleren</button>
            <button type="button" className="btn-primary" onClick={bewaarMerk} disabled={bezig}>{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
          </div>
        </Dialoog>
      )}
    </div>
    </div>
  )
}
