'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, ShieldCheck, Circle, PlayCircle } from 'lucide-react'
import { PROJECT_FASES, KLANT_FASE_UITLEG, KLANT_STORY_STATUS } from '@/lib/ngs/levering'
import type { KlantProject, KlantCare } from '@/lib/ngs/levering-server'

const datum = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
const euro = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const BLAUW = '#1E40AF'

export function SolutionsKlant({ data, magGoedkeuren }: { data: { projecten: KlantProject[]; care: KlantCare[] }; magGoedkeuren: boolean }) {
  if (!data.projecten.length && !data.care.length) return <div className="card-base text-sm text-gray-500">Er loopt nog geen project bij NextGen Solutions.</div>
  return (
    <div className="space-y-5">
      {data.projecten.map((p) => <ProjectKaart key={p.id} p={p} magGoedkeuren={magGoedkeuren} />)}
      {data.care.length > 0 && (
        <section className="card-base space-y-3">
          <h2 className="font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5" style={{ color: BLAUW }} />Care: wat we voor je onderhouden</h2>
          <ul className="divide-y divide-gray-100">
            {data.care.map((c) => (
              <li key={c.id} className="py-2.5 flex flex-col sm:flex-row sm:items-start gap-x-4 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{c.naam}</p>
                  {c.omschrijving && <p className="text-xs text-gray-600 mt-0.5">{c.omschrijving}</p>}
                  {c.systemen.length > 0 && <p className="text-xs text-gray-500 mt-0.5">{c.systemen.join(' · ')}</p>}
                </div>
                <div className="text-xs text-gray-600 sm:text-right shrink-0">
                  <p className="font-medium">{c.status === 'actief' ? 'Actief' : 'Gepauzeerd'}{c.stand ? ` · Care ${c.stand.pakket}` : c.care_contract ? ' · Care-contract' : ''}</p>
                  {c.laatste_controle && <p>Laatst nagekeken op {datum(c.laatste_controle)}</p>}
                  {c.volgende && <p>Volgende controle {datum(c.volgende)}</p>}
                </div>
              </li>
            ))}
          </ul>
          {data.care.some((c) => c.stand) && (
            <ul className="grid sm:grid-cols-2 gap-2">
              {data.care.filter((c) => c.stand).map((c) => <CareStand key={c.id} naam={c.naam} s={c.stand!} />)}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}

function ProjectKaart({ p, magGoedkeuren }: { p: KlantProject; magGoedkeuren: boolean }) {
  // Care is geen stap van het project zelf; die staat er enkel als het project zover is.
  const stappen = PROJECT_FASES.filter((f) => f.key !== 'care' || p.fase === 'care')
  const huidig = stappen.findIndex((f) => f.key === p.fase)
  const open = (p.stories ?? []).filter((s) => s.magGoedkeuren).length
  return (
    <section className="card-base space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold text-lg">{p.titel}</h2>
          <p className="text-sm text-gray-600 mt-0.5">{KLANT_FASE_UITLEG[p.fase]}</p>
        </div>
        {p.prijs !== null && <span className="text-sm text-gray-700">Vaste prijs <b>{euro(p.prijs)}</b> excl. btw</span>}
      </div>
      {/* Waar we staan */}
      <ol className="flex flex-wrap gap-1.5" aria-label="Fases van het project">
        {stappen.map((f, i) => (
          <li key={f.key} className={`rounded-full border px-2.5 py-1 text-xs ${i === huidig ? 'text-white' : i < huidig ? 'border-gray-200 text-gray-500' : 'border-gray-200 text-gray-400'}`}
            style={i === huidig ? { background: BLAUW, borderColor: BLAUW } : undefined} aria-current={i === huidig ? 'step' : undefined}>
            {i < huidig && <CheckCircle2 className="inline h-3 w-3 mr-1 -mt-0.5" />}{f.label}
          </li>
        ))}
      </ol>
      {p.doel && <p className="text-sm"><span className="text-gray-500">Doel: </span>{p.doel}</p>}

      {p.workflows.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Per onderdeel</h3>
          <ul className="space-y-2">
            {p.workflows.map((w) => (
              <li key={w.id} className="rounded-xl border border-gray-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-medium text-sm min-w-0">{w.naam}</p>
                  <span className={`text-[11px] rounded-full border px-2 py-0.5 shrink-0 ${w.fase === 'klaar' ? 'border-green-200 text-green-800 bg-green-50' : 'border-gray-200 text-gray-600'}`}>{w.faseLabel}</span>
                </div>
                <p className={`text-sm mt-1 ${w.wachtOpJou ? 'text-amber-900' : 'text-gray-600'}`}>{w.uitleg}</p>
                {w.video && <a href={w.video} target="_blank" rel="noopener noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-sm font-medium underline" style={{ color: BLAUW }}><PlayCircle className="h-4 w-4" />Video: zo werkt het</a>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {p.stories === null ? (
        <p className="text-sm text-gray-500">We werken uit wat de oplossing precies moet kunnen. Zodra dat klaar is, zie je het hier en keur je het goed.</p>
      ) : !p.stories.length ? (
        <p className="text-sm text-gray-500">Nog geen user stories.</p>
      ) : (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Wat we bouwen{open > 0 && <span className="ml-2 text-xs font-normal rounded-full px-2 py-0.5 text-white" style={{ background: BLAUW }}>{open} wacht{open === 1 ? '' : 'en'} op jouw akkoord</span>}</h3>
          <ul className="space-y-2">{p.stories.map((s) => <StoryRij key={s.id} s={s} magGoedkeuren={magGoedkeuren} />)}</ul>
        </div>
      )}
    </section>
  )
}

function StoryRij({ s, magGoedkeuren }: { s: NonNullable<KlantProject['stories']>[number]; magGoedkeuren: boolean }) {
  const router = useRouter()
  const [bezig, setBezig] = useState(false)
  const keurGoed = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/portal/solutions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'goedkeuren', story_id: s.id }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Goedkeuren mislukt')
      toast.success('Goedgekeurd. Dank je.')
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Goedkeuren mislukt') } finally { setBezig(false) }
  }
  return (
    <li className="rounded-xl border border-gray-200 p-3 space-y-1.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-medium text-sm min-w-0">{s.nummer}. {s.titel}</p>
        <span className="text-[11px] rounded-full border border-gray-200 px-2 py-0.5 text-gray-600 shrink-0">{KLANT_STORY_STATUS[s.status] ?? s.status}</span>
      </div>
      {(s.als || s.wil || s.zodat) && <p className="text-sm text-gray-700">{[s.als && `Als ${s.als}`, s.wil && `wil ik ${s.wil}`, s.zodat && `zodat ${s.zodat}`].filter(Boolean).join(', ')}.</p>}
      {s.acceptatiecriteria.length > 0 && (
        <ul className="text-xs text-gray-600 space-y-0.5">{s.acceptatiecriteria.map((a, i) => <li key={i} className="flex gap-1.5"><Circle className="h-2 w-2 mt-1 shrink-0" />{a}</li>)}</ul>
      )}
      <div className="pt-1">
        {s.klant_akkoord_op ? (
          <p className="text-xs text-gray-600 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5 text-green-700" />Goedgekeurd op {datum(s.klant_akkoord_op)}{s.klant_akkoord_door ? ` door ${s.klant_akkoord_door}` : ''}</p>
        ) : s.magGoedkeuren && magGoedkeuren ? (
          <button type="button" onClick={keurGoed} disabled={bezig} className="btn-primary !text-xs !py-1.5" style={{ background: BLAUW }}>{bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Goedkeuren</button>
        ) : s.magGoedkeuren ? <p className="text-xs text-gray-500">Wacht op een akkoord van iemand die mag goedkeuren.</p> : null}
      </div>
    </li>
  )
}

function Balk({ label, gebruikt, limiet }: { label: string; gebruikt: number | null; limiet: number }) {
  const pct = gebruikt === null || !(limiet > 0) ? null : Math.min(100, Math.round((gebruikt / limiet) * 100))
  return (
    <div>
      <div className="flex justify-between text-xs"><span>{label}</span><span className="tabular-nums text-gray-600">{gebruikt === null ? 'nog niet gemeten' : `${gebruikt.toLocaleString('nl-BE')} van ${limiet} GB`}</span></div>
      <div className="h-1.5 rounded-full bg-gray-100 mt-1 overflow-hidden">{pct !== null && <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct >= 80 ? '#B45309' : BLAUW }} />}</div>
    </div>
  )
}

/** Wat het Care-pakket inhoudt en hoeveel er gebruikt is (enkel cijfers die de klant aangaan). */
function CareStand({ naam, s }: { naam: string; s: NonNullable<KlantCare['stand']> }) {
  return (
    <li className="rounded-xl border border-gray-200 p-3 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <p className="font-medium text-sm">{naam}</p>
        <p className="text-xs text-gray-600">Care {s.pakket} · reactie binnen {s.reactie}</p>
      </div>
      <Balk label="Databank" gebruikt={s.db.gebruikt} limiet={s.db.limiet} />
      <Balk label="Bestanden" gebruikt={s.bestanden.gebruikt} limiet={s.bestanden.limiet} />
      <p className="text-xs text-gray-600">{s.uren.beschikbaar > 0 ? `Kleine aanpassingen: nog ${s.uren.resterend.toLocaleString('nl-BE')} van ${s.uren.beschikbaar} uur deze maand.` : 'Kleine aanpassingen zitten niet in dit pakket.'}{s.gemeten_op ? ` Gemeten op ${datum(s.gemeten_op)}.` : ''}</p>
    </li>
  )
}
