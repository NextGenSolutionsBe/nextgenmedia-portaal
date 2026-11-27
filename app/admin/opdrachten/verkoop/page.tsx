export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { laadVerkoopcijfers } from '@/lib/sales/verkoopcijfers-server'
import type { Stap } from '@/lib/sales/verkoopcijfers'

const vandaagBE = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

function periodeVan(soort: string | undefined, vandaag: string): { van: string; tot: string; label: string; soort: string } {
  const j = Number(vandaag.slice(0, 4)), m = Number(vandaag.slice(5, 7))
  const p = (n: number) => String(n).padStart(2, '0')
  const einde = (jj: number, mm: number) => new Date(Date.UTC(jj, mm, 0)).toISOString().slice(0, 10)
  if (soort === 'maand') return { van: `${j}-${p(m)}-01`, tot: einde(j, m), label: 'deze maand', soort }
  if (soort === 'kwartaal') { const q = Math.floor((m - 1) / 3) * 3 + 1; return { van: `${j}-${p(q)}-01`, tot: einde(j, q + 2), label: 'dit kwartaal', soort } }
  if (soort === 'vorig') return { van: `${j - 1}-01-01`, tot: `${j - 1}-12-31`, label: `${j - 1}`, soort }
  return { van: `${j}-01-01`, tot: `${j}-12-31`, label: `${j}`, soort: 'jaar' }
}

/** Verkoopcijfers (verbeterplan fase 6): trechter per bedrijf, bronnen, verlies, ABM-activiteit en salesuren. */
export default async function VerkoopPagina({ searchParams }: { searchParams: { periode?: string } }) {
  if (!(await magIk('opdrachten', 'bekijken'))) redirect('/admin')
  const p = periodeVan(searchParams.periode, vandaagBE())
  const c = await laadVerkoopcijfers(createAdminSupabaseClient(), p.van, p.tot)
  const chip = (k: string, l: string) => <Link key={k} href={`/admin/opdrachten/verkoop?periode=${k}`} className={`text-xs px-3 py-1.5 rounded-full ${p.soort === k ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-600'}`}>{l}</Link>
  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center gap-2"><Link href="/admin/opdrachten" className="btn-secondary px-2" title="Terug naar Projecten"><ChevronLeft className="h-4 w-4" /></Link>
        <div><h1 className="text-xl sm:text-2xl font-semibold">Verkoopcijfers</h1><p className="text-sm text-gray-500">Op aanmaakdatum, {p.label}.</p></div></div>
      <div className="inline-flex rounded-full p-1 bg-gray-100">{chip('maand', 'Maand')}{chip('kwartaal', 'Kwartaal')}{chip('jaar', 'Dit jaar')}{chip('vorig', 'Vorig jaar')}</div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Trechter titel="NextGenMedia (Projecten)" stappen={c.media.stappen} sub={`${c.media.open} lopen nog · ${c.media.verloren} verloren`} />
        <Trechter titel="NextGenSolutions (pipeline)" stappen={c.solutions.stappen} sub={`${c.solutions.open} lopen nog · ${c.solutions.verloren} verloren${c.solutionsKaarten ? ` · ${c.solutionsKaarten} Solutions-kaarten op Projecten niet meegeteld` : ''}`} />
      </div>
      <p className="text-[11px] text-gray-500 -mt-2">Een verloren kaart telt tot de offerte of het contract als die er waren; verder kennen we de weg niet.</p>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card-base space-y-2">
          <h2 className="font-semibold text-sm">Per bron</h2>
          {!c.bronnen.length ? <p className="text-sm text-gray-500">Niets in deze periode.</p> : (
            <table className="w-full text-sm"><thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 font-medium">Bron</th><th className="font-medium">Totaal</th><th className="font-medium">Gewonnen</th><th className="font-medium">Verloren</th></tr></thead>
              <tbody className="divide-y divide-gray-50">{c.bronnen.map((b) => <tr key={b.bron}><td className="py-1">{b.bron}</td><td>{b.totaal}</td><td>{b.gewonnen}</td><td>{b.verloren}</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="card-base space-y-3">
          <h2 className="font-semibold text-sm">Waarom verloren</h2>
          {([['NextGenMedia', c.verlies.media], ['NextGenSolutions', c.verlies.solutions]] as const).map(([l, lijst]) => (
            <div key={l}><div className="text-[11px] text-gray-500 mb-1">{l}</div>
              {!lijst.length ? <p className="text-xs text-gray-400">Niets verloren.</p> : <ul className="text-sm space-y-0.5">{lijst.map((r) => <li key={r.reden} className="flex justify-between"><span>{r.reden}</span><span className="text-gray-500">{r.aantal}</span></li>)}</ul>}
            </div>
          ))}
        </section>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <section className="card-base space-y-2">
          <h2 className="font-semibold text-sm">Salesactiviteit (Account-based marketing)</h2>
          {!c.activiteit.length ? <p className="text-sm text-gray-500">Nog geen gesprekken genoteerd bij Account-based marketing in deze periode.</p> : (
            <table className="w-full text-sm"><thead><tr className="text-left text-[11px] text-gray-500"><th className="py-1 font-medium">Wie</th><th className="font-medium">Gesprekken</th><th className="font-medium">Gesproken</th><th className="font-medium">Interesse</th><th className="font-medium">Niet bereikt</th><th className="font-medium">Media</th><th className="font-medium">Solutions</th></tr></thead>
              <tbody className="divide-y divide-gray-50">{c.activiteit.map((a) => <tr key={a.wie}><td className="py-1">{a.wie}</td><td>{a.gesprekken}</td><td>{a.gesproken}</td><td>{a.interesse}</td><td>{a.nietOpgenomen}</td><td>{a.media ?? 0}</td><td>{a.solutions ?? 0}</td></tr>)}</tbody></table>
          )}
        </section>
        <section className="card-base space-y-2">
          <h2 className="font-semibold text-sm">Salesuren: gepland tegenover gedaan</h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl border border-gray-100 py-2"><div className="text-[11px] text-gray-500">Gepland</div><div className="text-lg font-semibold">{String(c.uren.gepland).replace('.', ',')} u</div><div className="text-[10px] text-gray-400">vaste blokken Sales</div></div>
            <div className="rounded-xl border border-gray-100 py-2"><div className="text-[11px] text-gray-500">Gedaan</div><div className="text-lg font-semibold">{String(c.uren.gedaan).replace('.', ',')} u</div><div className="text-[10px] text-gray-400">{c.uren.afspraken} gehouden verkoopafspraken</div></div>
            <div className="rounded-xl border border-gray-100 py-2"><div className="text-[11px] text-gray-500">Verhouding</div><div className="text-lg font-semibold">{c.uren.pct === null ? '—' : `${c.uren.pct}%`}</div><div className="text-[10px] text-gray-400">gedaan / gepland</div></div>
          </div>
          {c.uren.perPersoon.length > 0 ? <ul className="text-xs text-gray-600">{c.uren.perPersoon.map((x) => <li key={x.naam} className="flex justify-between"><span>{x.naam}</span><span>{String(x.uren).replace('.', ',')} u gepland</span></li>)}</ul>
            : <p className="text-xs text-gray-500">Nog geen vaste blokken Sales in de agenda (Agenda → Vast blok → Sales).</p>}
        </section>
      </div>
    </div>
  )
}

function Trechter({ titel, stappen, sub }: { titel: string; stappen: Stap[]; sub: string }) {
  const max = Math.max(stappen[0]?.aantal ?? 0, 1)
  return (
    <section className="card-base space-y-2">
      <div><h2 className="font-semibold text-sm">{titel}</h2><p className="text-[11px] text-gray-500">{sub}</p></div>
      <ul className="space-y-1.5">
        {stappen.map((s) => (
          <li key={s.label}>
            <div className="flex justify-between text-xs"><span>{s.label}</span><span className="tabular-nums text-gray-600">{s.aantal}{s.conversie !== null ? <span className="text-gray-400"> · {s.conversie}%</span> : null}</span></div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-gray-900 rounded-full" style={{ width: `${Math.round((s.aantal / max) * 100)}%` }} /></div>
          </li>
        ))}
      </ul>
    </section>
  )
}
