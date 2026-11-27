'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Inbox, FileText, CalendarClock, KanbanSquare, MessageSquare, Wrench, PackageCheck, Send, ArrowRight, PenLine, Receipt, Mail, ListPlus, ListChecks, X, RefreshCw,
} from 'lucide-react'
import type { OpvolgGroep, OpvolgItem } from '@/lib/notifications'
import { dagLangNaam, standaardTaakDag, type LabelToon, type OpvolgLabel } from '@/lib/opvolging-label'
import { NieuweTaak } from '@/components/admin/clickup-taken'

// "Op te volgen" — bovenaan het Command Center: per soort wat er nu ligt, met
// namen en per regel wanneer het moet gebeuren. Elke regel kan een taak krijgen
// (ClickUp en Taken in de app); dan telt de datum van die taak.
const ICOON: Record<OpvolgGroep['key'], React.ElementType> = {
  aanvragen: Inbox, contracten: FileText, tegentekenen: PenLine, meetings: CalendarClock, projecten: KanbanSquare, content: MessageSquare, onderhoud: Wrench, opleveringen: PackageCheck, offertes: Send, facturen: Receipt, mails: Mail, verlengen: RefreshCw,
}

const TOON: Record<LabelToon, string> = {
  te_laat: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
  vandaag: 'bg-geel text-gray-900',
  binnenkort: 'bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200',
  later: 'bg-gray-100 text-gray-600',
  info: 'bg-gray-100 text-gray-500',
}
const RANG: Record<LabelToon, number> = { te_laat: 0, vandaag: 1, binnenkort: 2, later: 3, info: 4 }
const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

export function Label({ l }: { l: OpvolgLabel }) {
  return (
    <span title={l.datum ? dagLangNaam(l.datum) : undefined}
      className={`inline-flex items-center shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 whitespace-nowrap ${TOON[l.toon]}`}>
      {l.tekst}
    </span>
  )
}

export function OpvolgingKaarten({ groepen: alle }: { groepen: OpvolgGroep[] }) {
  const [taakVoor, setTaakVoor] = useState<OpvolgItem | null>(null)
  const router = useRouter()
  const beste = (g: OpvolgGroep) => Math.min(5, ...g.items.map((i) => (i.label ? RANG[i.label.toon] : 5)))
  // Enkel blokken waar iets in staat; wat te laat is eerst, dan vandaag, dan de grootste.
  const groepen = alle.filter((g) => g.totaal > 0).sort((a, b) => beste(a) - beste(b) || b.totaal - a.totaal)
  const tel = useMemo(() => {
    const items = groepen.flatMap((g) => g.items)
    return { teLaat: items.filter((i) => i.label?.toon === 'te_laat').length, vandaag: items.filter((i) => i.label?.toon === 'vandaag').length }
  }, [groepen])

  return (
    <section aria-labelledby="op-te-volgen" className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 id="op-te-volgen" className="font-semibold text-gray-900">Op te volgen</h2>
        {tel.teLaat > 0 && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TOON.te_laat}`}>{tel.teLaat} te laat</span>}
        {tel.vandaag > 0 && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TOON.vandaag}`}>{tel.vandaag} vandaag</span>}
      </div>
      {groepen.length === 0 && <div className="card-base !p-4 text-sm text-gray-500">Alles is bij. Niets om op te volgen.</div>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groepen.map((g) => {
          const Icoon = ICOON[g.key]
          return (
            <div key={g.key} className="card-base !p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Icoon className="h-4 w-4 text-gray-500 shrink-0" />
                <h3 className="text-sm font-semibold text-gray-900 flex-1">{g.titel}</h3>
                <span className={`min-w-[1.75rem] text-center rounded-full px-2 py-0.5 text-xs font-bold ${g.totaal > 0 ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'}`}>{g.totaal}</span>
              </div>
              {g.items.length === 0 ? (
                <p className="text-sm text-gray-400 py-1">{g.leeg}</p>
              ) : (
                <ul className="-mx-2 flex-1">
                  {g.items.map((i) => (
                    <li key={i.id} className="flex items-start gap-1 rounded-lg hover:bg-gray-50">
                      <Link href={i.href} className="min-w-0 flex-1 px-2 py-1.5">
                        <span className="block text-sm text-gray-900 truncate">{i.titel}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 min-w-0">
                          {i.label && <Label l={i.label} />}
                          {i.sub && <span className="text-xs text-gray-500 truncate">{i.sub}</span>}
                        </span>
                        {i.taak && (
                          <span className="mt-1 flex items-center gap-1 text-[11px] text-gray-600 min-w-0">
                            <ListChecks className="h-3 w-3 shrink-0 text-gray-400" aria-hidden />
                            <span className="truncate">Taak: {i.taak.omschrijving}{i.taak.wie ? ` · ${i.taak.wie}` : ''}</span>
                          </span>
                        )}
                      </Link>
                      {i.nieuweTaak && (
                        <button type="button" onClick={() => setTaakVoor(i)} title="Taak maken (ClickUp en Taken)" aria-label={`Taak maken voor ${i.titel}`}
                          className="mt-1 mr-1 h-7 w-7 shrink-0 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-900 hover:bg-white">
                          <ListPlus className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <Link href={g.alles} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black w-fit">
                {g.totaal > g.items.length ? `Alle ${g.totaal} bekijken` : 'Openen'}<ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )
        })}
      </div>
      {taakVoor && <TaakVenster item={taakVoor} onSluit={() => setTaakVoor(null)} onKlaar={() => { setTaakVoor(null); router.refresh() }} />}
    </section>
  )
}

function TaakVenster({ item, onSluit, onKlaar }: { item: OpvolgItem; onSluit: () => void; onKlaar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onSluit])
  const t = item.nieuweTaak!
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onSluit}>
      <div role="dialog" aria-modal="true" aria-label={`Taak voor ${item.titel}`} onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900">Taak maken</p>
            <p className="text-xs text-gray-500 truncate">{item.titel}</p>
            {item.label && <div className="mt-1"><Label l={item.label} /></div>}
          </div>
          <button type="button" onClick={onSluit} aria-label="Sluiten" className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <NieuweTaak basis={t.basis} waarbij={t.ref ? 'opvolging' : 'opdracht'} standaardMerk={null} klant={t.klant}
          context={[t.klant, item.titel].filter(Boolean).join(' · ') || null}
          voorstellen={t.voorstellen} standaardDeadline={standaardTaakDag(item.label, vandaag())} metVandaag
          extra={t.ref ? { opvolg_ref: t.ref, ...(t.client_id ? { client_id: t.client_id } : {}) } : undefined}
          kader={false} onSluit={onSluit} onKlaar={onKlaar} />
      </div>
    </div>
  )
}
