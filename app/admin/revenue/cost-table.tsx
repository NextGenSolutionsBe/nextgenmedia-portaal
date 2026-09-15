'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2, Repeat2, ArrowDownRight, CircleStop, RotateCcw, Pencil, X } from 'lucide-react'
import { CostDialog } from './cost-form'
import { formatEuro, formatDate } from '@/lib/utils'

export type Cost = {
  id: string
  name: string | null
  category: string | null
  type: 'one_time' | 'recurring'
  cost_date: string | null
  start_date: string | null
  end_date: string | null
  billing_frequency: string | null
  amount_excl: number
  vat_pct: number
  notes?: string | null
}

const FREQ_LABEL: Record<string, string> = { monthly: 'maandelijks', quarterly: 'per kwartaal', annual: 'jaarlijks' }

/** Loopt dit abonnement vandaag nog? Vergelijkt op maand, net als de rekenkern:
 *  een einddatum halverwege de maand betekent dat die maand nog meetelt. */
function loopt(c: Cost, nu = new Date()): boolean {
  if (c.type !== 'recurring') return false
  const maand = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const nuKey = maand(nu)
  if (c.start_date && nuKey < maand(new Date(c.start_date))) return false
  if (!c.end_date) return true
  return nuKey <= maand(new Date(c.end_date))
}

/**
 * Laatste dag van de gekozen maand. Stopzetten doe je per maand, niet per dag —
 * de rekenkern telt toch in hele maanden.
 *
 * LET OP: niet via toISOString(). `new Date(2026, 8, 0)` is 31 augustus om
 * middernacht LOKALE tijd, en in Brussel is dat 30 augustus 22:00 UTC — dan
 * krijg je er een dag te vroeg uit. Zelf samenstellen dus.
 */
function eindeVanMaand(jaarMaand: string): string {
  const [j, m] = jaarMaand.split('-').map(Number)
  const dag = new Date(j, m, 0).getDate()   // dag-nummer is wél lokaal correct
  return `${j}-${String(m).padStart(2, '0')}-${String(dag).padStart(2, '0')}`
}

/**
 * De kostenlijst.
 *
 * `setterCostFY` is geen ingevoerde kostenpost maar een berekend bedrag (uren en
 * commissie van de appointment setters). Het staat hier bewust wél in de lijst —
 * anders tel je de tabel op en kom je niet aan het totaal dat er bovenaan staat.
 * Zonder knoppen, want er valt niets te wijzigen of te verwijderen.
 */
export function CostTable({ costs, setterCostFY = 0, year }: {
  costs: Cost[]; setterCostFY?: number; year?: number
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [stoppen, setStoppen] = useState<Cost | null>(null)
  const [bewerken, setBewerken] = useState<Cost | null>(null)
  const [laatsteMaand, setLaatsteMaand] = useState('')
  const [fout, setFout] = useState<string | null>(null)

  const openStop = (c: Cost) => {
    const nu = new Date()
    // Standaard deze maand: een abonnement dat je vandaag opzegt heb je voor
    // deze maand meestal al betaald.
    setLaatsteMaand(`${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}`)
    setFout(null)
    setStoppen(c)
  }

  const bewaarStop = async (end_date: string | null) => {
    if (!stoppen) return
    setBusy(stoppen.id); setFout(null)
    try {
      const res = await fetch('/api/admin/costs', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: stoppen.id, end_date }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setStoppen(null)
      router.refresh()
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Mislukt')
    } finally { setBusy(null) }
  }

  const hervat = async (c: Cost) => {
    setBusy(c.id)
    try {
      const res = await fetch('/api/admin/costs', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, end_date: null }),
      })
      if (res.ok) router.refresh()
    } finally { setBusy(null) }
  }

  const remove = async (id: string) => {
    if (!confirm('Deze kost verwijderen?')) return
    setBusy(id)
    try {
      const res = await fetch('/api/admin/costs', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
      if (res.ok) router.refresh()
    } finally { setBusy(null) }
  }

  if (costs.length === 0 && setterCostFY <= 0) {
    return (
      <div className="card-base">
        <h2 className="font-semibold mb-2">Alle kosten</h2>
        <p className="text-sm text-gray-400 text-center py-8">Nog geen kosten geregistreerd</p>
      </div>
    )
  }

  const setterRow = setterCostFY > 0 ? (
    <tr className="border-b border-gray-50 bg-gray-50/60">
      <td className="py-2.5">
        <div className="font-medium">Appointment setters</div>
        <div className="text-[11px] text-gray-500">Automatisch — gelogde uren en toegekende commissies</div>
      </td>
      <td className="py-2.5 text-gray-600">Appointment setters</td>
      <td className="py-2.5 text-gray-600">Doorlopend{year ? ` · ${year}` : ''}</td>
      <td className="py-2.5 text-right tabular">{formatEuro(setterCostFY)}</td>
      <td className="py-2.5 text-right text-gray-400">—</td>
      <td className="py-2.5 text-right tabular">{formatEuro(setterCostFY)}</td>
      <td className="py-2.5 text-right">
        <span className="text-[11px] text-gray-400">berekend</span>
      </td>
    </tr>
  ) : null

  return (
    <div className="card-base">
      <h2 className="font-semibold mb-4">Alle kosten</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 text-xs text-gray-500 font-medium">Naam</th>
              <th className="text-left py-2 text-xs text-gray-500 font-medium">Categorie</th>
              <th className="text-left py-2 text-xs text-gray-500 font-medium">Type / Periode</th>
              <th className="text-right py-2 text-xs text-gray-500 font-medium">Excl. btw</th>
              <th className="text-right py-2 text-xs text-gray-500 font-medium">BTW</th>
              <th className="text-right py-2 text-xs text-gray-500 font-medium">Incl. btw</th>
              <th className="py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {setterRow}
            {costs.map((c) => {
              const incl = Number(c.amount_excl) * (1 + Number(c.vat_pct) / 100)
              const actief = loopt(c)
              const period = c.type === 'recurring'
                ? `${formatDate(c.start_date)}${c.end_date ? ' → ' + formatDate(c.end_date) : ''} · ${FREQ_LABEL[c.billing_frequency ?? 'monthly']}`
                : formatDate(c.cost_date)
              return (
                <tr key={c.id} className="hover:bg-gray-50/50">
                  <td className="py-2.5 font-medium">{c.name ?? '—'}</td>
                  <td className="py-2.5 text-gray-500">{c.category ?? '—'}</td>
                  <td className="py-2.5 text-gray-500 text-xs">
                    <span className="inline-flex items-center gap-1 flex-wrap">
                      {c.type === 'recurring' ? <Repeat2 className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                      {period}
                      {/* Loopt hij nog of niet? Dat is het enige wat je hier
                          echt wil weten, dus dat krijgt een eigen label. */}
                      {c.type === 'recurring' && (
                        <span className={`status-badge ${actief ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {actief ? 'loopt' : 'gestopt'}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2.5 text-right">{formatEuro(Number(c.amount_excl))}</td>
                  <td className="py-2.5 text-right text-gray-400">{Number(c.vat_pct)}%</td>
                  <td className="py-2.5 text-right text-gray-600">{formatEuro(incl)}</td>
                  <td className="py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {c.type === 'recurring' && (actief ? (
                        <button onClick={() => openStop(c)} disabled={busy === c.id}
                          className="text-xs px-2 py-1 rounded-lg text-gray-500 hover:bg-gray-100 inline-flex items-center gap-1"
                          title="Stopzetten — de maanden die al geteld hebben blijven staan">
                          <CircleStop className="h-3.5 w-3.5" />Stopzetten
                        </button>
                      ) : (
                        <button onClick={() => hervat(c)} disabled={busy === c.id}
                          className="text-xs px-2 py-1 rounded-lg text-gray-500 hover:bg-gray-100 inline-flex items-center gap-1"
                          title="Toch weer laten doorlopen">
                          <RotateCcw className="h-3.5 w-3.5" />Hervatten
                        </button>
                      ))}
                      <button onClick={() => setBewerken(c)} className="text-gray-400 hover:text-gray-700 p-1" title="Wijzigen">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => remove(c.id)} disabled={busy === c.id} className="text-red-400 hover:text-red-600 p-1" title="Verwijderen">
                        {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {bewerken && <CostDialog cost={bewerken} onClose={() => setBewerken(null)} />}

      {stoppen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold">Abonnement stopzetten</h3>
              <button onClick={() => setStoppen(null)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4 text-sm">
              <p className="text-gray-600">
                <b>{stoppen.name}</b> telt mee tot en met de maand die je hier kiest, en daarna niet meer.
                Alles wat al geteld heeft blijft staan — je boekjaar verandert dus niet met terugwerkende kracht.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Laatste maand</label>
                <input type="month" value={laatsteMaand} onChange={(e) => setLaatsteMaand(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
                <p className="text-[11px] text-gray-400 mt-1">
                  Standaard deze maand: een abonnement dat je vandaag opzegt heb je meestal al betaald.
                </p>
              </div>
              {fout && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{fout}</div>}
              <div className="flex gap-2">
                <button onClick={() => bewaarStop(laatsteMaand ? eindeVanMaand(laatsteMaand) : null)}
                  disabled={!laatsteMaand || busy === stoppen.id} className="btn-primary flex-1 justify-center disabled:opacity-50">
                  {busy === stoppen.id && <Loader2 className="h-4 w-4 animate-spin" />}Stopzetten
                </button>
                <button onClick={() => setStoppen(null)} className="btn-secondary">Annuleer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
