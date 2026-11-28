'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, Plus, RefreshCw, AlertTriangle, Receipt, Phone, Mail, Smartphone } from 'lucide-react'
import { OVERDRACHT_STAPPEN, SUPPORT_KANALEN } from '@/lib/ngs/care'
import type { CareDetail } from '@/lib/ngs/care-server'
import { Venster, inp, lbl, dagKort, eur, tijdstip } from '../ui'
import { lever } from './care'

const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const KANAAL_ICOON = { telefoon: Phone, mail: Mail, klantapp: Smartphone } as const

function Blok({ titel, sub, children, waarschuwing }: { titel: string; sub?: string; children: React.ReactNode; waarschuwing?: boolean }) {
  return (
    <section className="rounded-xl border border-gray-100 p-3.5 space-y-2.5">
      <div className="flex items-baseline gap-2">
        <h3 className="text-sm font-semibold flex-1">{titel}{waarschuwing && <AlertTriangle className="h-3.5 w-3.5 inline ml-1.5 text-amber-600" />}</h3>
        {sub && <span className="text-xs text-gray-500">{sub}</span>}
      </div>
      {children}
    </section>
  )
}

function Balk({ label, gebruikt, limiet, pct }: { label: string; gebruikt: number | null; limiet: number; pct: number | null }) {
  return (
    <div>
      <div className="flex justify-between text-xs"><span>{label}</span><span className={`tabular-nums ${pct !== null && pct >= 80 ? 'text-amber-800 font-medium' : 'text-gray-600'}`}>{gebruikt === null ? 'nog niet gemeten' : `${gebruikt.toLocaleString('nl-BE')} van ${limiet} GB${pct !== null ? ` (${pct.toLocaleString('nl-BE')}%)` : ''}`}</span></div>
      <div className="h-1.5 rounded-full bg-gray-100 mt-1 overflow-hidden">{pct !== null && <div className={`h-full rounded-full ${pct >= 80 ? 'bg-amber-600' : 'bg-gray-900'}`} style={{ width: `${Math.min(100, pct)}%` }} />}</div>
    </div>
  )
}

/** Care van één klant (nieuwe werking fase 6): pakket, opslag, uren, support, monitoring, factuur en overdracht. */
export function CareDetailVenster({ id, onSluit, onVernieuw }: { id: string; onSluit: () => void; onVernieuw: () => void }) {
  const [d, setD] = useState<CareDetail | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const laad = useCallback(async () => {
    const r = await fetch(`/api/admin/nextgensolutions/levering?care=${id}`, { cache: 'no-store' })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j.error || 'Laden mislukt'); onSluit(); return }
    setD(j as CareDetail)
  }, [id, onSluit])
  useEffect(() => { void laad() }, [laad])
  const doe = async (body: Record<string, unknown>, sleutel: string, ok?: string) => {
    setBezig(sleutel)
    try { const j = await lever({ id, ...body }); if (ok) toast.success(ok); await laad(); onVernieuw(); return j } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); return null } finally { setBezig(null) }
  }
  if (!d) return <Venster titel="Care" onSluit={onSluit} breed><div className="py-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div></Venster>
  return (
    <Venster breed titel={d.care.naam} sub={d.pakket ? `Care ${d.pakket.naam} · ${eur(d.pakket.prijs)} per maand · reactie binnen ${d.reactie}` : 'Nog geen pakket gekozen'} onSluit={onSluit}>
      <Pakket d={d} bezig={bezig} doe={doe} />
      <Opslag d={d} bezig={bezig} doe={doe} />
      <Uren d={d} bezig={bezig} doe={doe} />
      <Support d={d} bezig={bezig} doe={doe} />
      {d.pakket?.monitoring && <Monitoring d={d} />}
      <Links d={d} bezig={bezig} doe={doe} />
      <Factuur d={d} bezig={bezig} doe={doe} />
      <OverdrachtBlok d={d} bezig={bezig} doe={doe} />
    </Venster>
  )
}

type Deel = { d: CareDetail; bezig: string | null; doe: (b: Record<string, unknown>, s: string, ok?: string) => Promise<Record<string, unknown> | null> }

function Pakket({ d, bezig, doe }: Deel) {
  return (
    <Blok titel="Pakket" sub={d.bevestigd ? undefined : 'voorstel, nog te bevestigen'}>
      <div className="grid grid-cols-3 gap-1.5" role="group" aria-label="Pakket">
        {d.pakketten.map((p) => (
          <button key={p.key} type="button" disabled={!!bezig} aria-pressed={d.care.pakket === p.key} onClick={() => p.key !== d.care.pakket && doe({ actie: 'care.pakket', pakket: p.key }, 'pk', `Pakket ${p.naam}.`)}
            className={`rounded-xl border px-2 py-2 text-left ${d.care.pakket === p.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 hover:border-gray-400'}`}>
            <div className="text-sm font-semibold">{p.naam}</div>
            <div className="text-[11px] opacity-80">{eur(p.prijs)}/m · {p.db_gb} GB db · {p.bestanden_gb} GB bestanden</div>
            <div className="text-[11px] opacity-80">{p.uren_per_maand ? `${p.uren_per_maand} u aanpassingen` : 'geen aanpassingen'}{p.monitoring ? ' · monitoring' : ''}</div>
          </button>
        ))}
      </div>
    </Blok>
  )
}

function Opslag({ d, bezig, doe }: Deel) {
  const [db, setDb] = useState(d.care.db_gb === null ? '' : String(d.care.db_gb).replace('.', ','))
  const [best, setBest] = useState(d.care.bestanden_gb === null ? '' : String(d.care.bestanden_gb).replace('.', ','))
  const s = d.opslag
  return (
    <Blok titel="Opslag" sub={d.care.gemeten_op ? `gemeten ${dagKort(d.care.gemeten_op)} (${d.care.meetbron === 'api' ? 'Supabase' : 'met de hand'})` : 'nog niet gemeten'} waarschuwing={!!s?.waarschuwing}>
      {s ? <div className="space-y-2"><Balk label="Databank" gebruikt={s.db.gebruikt} limiet={s.db.limiet} pct={s.db.pct} /><Balk label="Bestanden" gebruikt={s.bestanden.gebruikt} limiet={s.bestanden.limiet} pct={s.bestanden.pct} /></div>
        : <p className="text-xs text-gray-500">Kies eerst het pakket: daar komen de limieten uit.</p>}
      {s?.waarschuwing && <p className="text-xs text-amber-900">{s.voorstel ? `Boven 80%. Stel ${s.voorstel.naam} voor (${eur(s.voorstel.prijs)} per maand).` : 'Boven 80% van het hoogste pakket: bespreek een oplossing.'}</p>}
      <div className="flex flex-wrap gap-2 items-end">
        <label className="block"><span className={lbl}>Databank (GB)</span><input inputMode="decimal" className={`${inp} !w-28`} value={db} onChange={(e) => setDb(e.target.value)} /></label>
        <label className="block"><span className={lbl}>Bestanden (GB)</span><input inputMode="decimal" className={`${inp} !w-28`} value={best} onChange={(e) => setBest(e.target.value)} /></label>
        <button type="button" disabled={!!bezig} onClick={() => doe({ actie: 'care.gebruik', db_gb: db, bestanden_gb: best }, 'geb', 'Gebruik bewaard.')} className="btn-secondary !py-2 !text-sm"><Check className="h-4 w-4" />Bewaren</button>
        <button type="button" disabled={!!bezig || !d.care.supabase_ref || !d.beheerToken} title={!d.beheerToken ? 'Er is nog geen Supabase-toegangstoken ingesteld.' : !d.care.supabase_ref ? 'Vul eerst de Supabase-ref in.' : undefined}
          onClick={async () => { const j = await doe({ actie: 'care.meten' }, 'met', 'Gebruik opgehaald.'); if (j) { setDb(String(j.db_gb ?? '').replace('.', ',')); setBest(String(j.bestanden_gb ?? '').replace('.', ',')) } }} className="btn-secondary !py-2 !text-sm">
          {bezig === 'met' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Ophalen uit Supabase
        </button>
      </div>
    </Blok>
  )
}

function Uren({ d, bezig, doe }: Deel) {
  const [v, setV] = useState({ datum: vandaag(), uren: '', omschrijving: '' })
  const st = d.uren.stand
  return (
    <Blok titel="Aanpassingen deze maand" sub={st.beschikbaar ? `${st.gebruikt.toLocaleString('nl-BE')} van ${st.beschikbaar} u · nog ${st.resterend.toLocaleString('nl-BE')} u` : 'niet in dit pakket'} waarschuwing={st.over}>
      {st.over && <p className="text-xs text-amber-900">Meer uren dan in het pakket. Wat erboven gaat, is niet inbegrepen.</p>}
      {d.uren.rijen.length > 0 && (
        <ul className="text-sm divide-y divide-gray-100">
          {d.uren.rijen.map((r) => (
            <li key={r.id} className="py-1.5 flex items-center gap-2">
              <span className="text-xs text-gray-500 w-14 tabular-nums">{dagKort(r.datum)}</span>
              <span className="flex-1 truncate">{r.omschrijving || 'Aanpassing'}</span>
              <span className="tabular-nums text-xs">{r.uren.toLocaleString('nl-BE')} u</span>
              <button type="button" disabled={!!bezig} onClick={() => doe({ actie: 'care.uren_weg', uur: r.id }, `u${r.id}`)} className="text-[11px] text-gray-500 hover:text-gray-900">weg</button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex flex-wrap gap-1.5" onSubmit={async (e) => { e.preventDefault(); const j = await doe({ actie: 'care.uren', ...v }, 'uur', 'Uren genoteerd.'); if (j) setV({ ...v, uren: '', omschrijving: '' }) }}>
        <input type="date" className={`${inp} !w-36 !py-1.5`} value={v.datum} onChange={(e) => setV({ ...v, datum: e.target.value })} aria-label="Datum" />
        <input inputMode="decimal" className={`${inp} !w-20 !py-1.5`} value={v.uren} onChange={(e) => setV({ ...v, uren: e.target.value })} placeholder="uren" aria-label="Uren" />
        <input className={`${inp} !py-1.5 flex-1 min-w-[8rem]`} value={v.omschrijving} onChange={(e) => setV({ ...v, omschrijving: e.target.value })} placeholder="Wat werd aangepast?" />
        <button type="submit" disabled={!v.uren || !!bezig} className="btn-secondary !py-1.5 !text-sm"><Plus className="h-4 w-4" />Toevoegen</button>
      </form>
    </Blok>
  )
}

function Support({ d, bezig, doe }: Deel) {
  const [v, setV] = useState({ kanaal: 'telefoon', vraag: '' })
  const open = d.support.filter((s) => !s.opgelost_op)
  const opgelost = d.support.filter((s) => s.opgelost_op)
  const kleur = (st: string) => (st === 'te_laat' ? 'text-red-700' : st === 'bijna' ? 'text-amber-800' : 'text-gray-500')
  return (
    <Blok titel="Supportvragen" sub={d.reactie ? `reactie binnen ${d.reactie}` : undefined} waarschuwing={open.some((s) => s.status !== 'loopt')}>
      {open.length > 0 && (
        <ul className="space-y-1.5">
          {open.map((s) => {
            const Icoon = KANAAL_ICOON[s.kanaal as keyof typeof KANAAL_ICOON] ?? Phone
            return (
              <li key={s.id} className="rounded-lg border border-gray-100 px-2.5 py-2 flex items-start gap-2">
                <Icoon className="h-3.5 w-3.5 mt-0.5 text-gray-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm">{s.vraag}</div>
                  <div className={`text-[11px] ${kleur(s.status)}`}>Binnen {tijdstip(s.binnen_op)} · {s.status === 'te_laat' ? 'reactietijd voorbij' : 'antwoord tegen'} {tijdstip(s.deadline)}</div>
                </div>
                <button type="button" disabled={!!bezig} onClick={() => doe({ actie: 'care.support_opgelost', vraag_id: s.id }, `s${s.id}`, 'Opgelost.')} className="btn-secondary !py-1 !px-2 !text-xs shrink-0"><Check className="h-3.5 w-3.5" />Opgelost</button>
              </li>
            )
          })}
        </ul>
      )}
      <form className="flex flex-wrap gap-1.5" onSubmit={async (e) => { e.preventDefault(); const j = await doe({ actie: 'care.support', ...v }, 'sup', 'Vraag genoteerd.'); if (j) setV({ ...v, vraag: '' }) }}>
        <select className={`${inp} !w-32 !py-1.5`} value={v.kanaal} onChange={(e) => setV({ ...v, kanaal: e.target.value })} aria-label="Kanaal">{SUPPORT_KANALEN.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select>
        <input className={`${inp} !py-1.5 flex-1 min-w-[10rem]`} value={v.vraag} onChange={(e) => setV({ ...v, vraag: e.target.value })} placeholder="Wat vraagt de klant?" />
        <button type="submit" disabled={v.vraag.trim().length < 3 || !!bezig || !d.pakket} title={!d.pakket ? 'Kies eerst het pakket.' : undefined} className="btn-secondary !py-1.5 !text-sm"><Plus className="h-4 w-4" />Nieuwe vraag</button>
      </form>
      {opgelost.length > 0 && <p className="text-[11px] text-gray-500">{opgelost.length} opgelost (laatste {tijdstip(opgelost[0].opgelost_op!)})</p>}
    </Blok>
  )
}

function Monitoring({ d }: { d: CareDetail }) {
  return (
    <Blok titel="Monitoring" sub={d.care.monitor_url ? 'elke 10 minuten' : 'vul de monitor-link in'} waarschuwing={d.alarm}>
      {d.alarm && <p className="text-xs text-red-700 font-medium">Twee keer na elkaar een fout. Kijk het na.</p>}
      {d.checks.length ? (
        <div className="flex flex-wrap gap-1" aria-label="Laatste checks">
          {d.checks.map((c, i) => <span key={i} title={`${tijdstip(c.op)}${c.fout ? `: ${c.fout}` : c.ms ? ` · ${c.ms} ms` : ''}`} className={`h-3 w-3 rounded-sm ${c.ok ? 'bg-green-600' : 'bg-red-600'}`} />)}
        </div>
      ) : <p className="text-xs text-gray-500">Nog geen checks.</p>}
    </Blok>
  )
}

function Links({ d, bezig, doe }: Deel) {
  const [v, setV] = useState({ vercel_url: d.care.vercel_url ?? '', supabase_ref: d.care.supabase_ref ?? '', github_url: d.care.github_url ?? '', monitor_url: d.care.monitor_url ?? '' })
  const velden: [keyof typeof v, string, string][] = [['vercel_url', 'Vercel-project', 'https://vercel.com/…'], ['supabase_ref', 'Supabase-project (ref of link)', 'abcdefghijklmnopqrst'], ['github_url', 'GitHub-repo', 'https://github.com/…']]
  if (d.pakket?.monitoring) velden.push(['monitor_url', 'Monitor-link (publieke https)', 'https://app.klant.be/api/health'])
  return (
    <Blok titel="Project">
      <div className="grid sm:grid-cols-2 gap-2">
        {velden.map(([k, l, ph]) => <label key={k} className="block"><span className={lbl}>{l}</span><input className={inp} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} placeholder={ph} /></label>)}
      </div>
      <button type="button" disabled={!!bezig} onClick={() => doe({ actie: 'care.links', ...v }, 'lnk', 'Bewaard.')} className="btn-secondary !py-1.5 !text-sm"><Check className="h-4 w-4" />Bewaren</button>
    </Blok>
  )
}

function Factuur({ d, bezig, doe }: Deel) {
  return (
    <Blok titel="Care-factuur">
      {d.care.reeks_id
        ? <p className="text-sm text-gray-700 flex items-center gap-1.5"><Receipt className="h-4 w-4" />Staat als maandreeks in Te factureren{d.care.maandbedrag ? ` (${eur(d.care.maandbedrag)} per maand)` : ''}.</p>
        : <button type="button" disabled={!!bezig || !d.pakket || !d.care.client_id} title={!d.pakket ? 'Kies eerst het pakket.' : !d.care.client_id ? 'Koppel eerst de klant.' : undefined}
          onClick={() => { if (confirm(`Een maandreeks van ${d.pakket ? eur(d.pakket.prijs) : ''} in Te factureren zetten?`)) void doe({ actie: 'care.factuur' }, 'fac', 'De Care-factuur staat in Te factureren.') }} className="btn-primary !py-1.5 !text-sm"><Receipt className="h-4 w-4" />Care-factuur instellen</button>}
    </Blok>
  )
}

function OverdrachtBlok({ d, bezig, doe }: Deel) {
  const klaar = OVERDRACHT_STAPPEN.filter((s) => d.care.overdracht[s.key]).length
  return (
    <Blok titel="Overdracht zonder Care" sub={`${klaar}/${OVERDRACHT_STAPPEN.length} · gratis`}>
      {OVERDRACHT_STAPPEN.map((s) => {
        const g = d.care.overdracht[s.key]
        return (
          <label key={s.key} className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={!!g} disabled={!!bezig} onChange={(e) => doe({ actie: 'care.overdracht', stap: s.key, gedaan: e.target.checked }, `o${s.key}`)} />
            <span className={g ? 'text-gray-500' : ''}>{s.label}{g ? <span className="text-[11px]"> · {dagKort(g.op)}{g.door ? `, ${g.door}` : ''}</span> : null}</span>
          </label>
        )
      })}
      <p className="text-[11px] text-gray-500">Naar een ander platform verhuizen is geen overdracht: dat is een offerte-item vanaf {eur(d.migratie_vanaf)}.</p>
    </Blok>
  )
}

