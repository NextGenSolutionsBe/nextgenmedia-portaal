'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Loader2, Trash2, Pencil, X, ExternalLink, CalendarClock, AlertTriangle, Globe,
} from 'lucide-react'
import { toast } from 'sonner'
import { formatEuro } from '@/lib/utils'

/**
 * Framer-sites onder Financiën.
 *
 * De verlengdatum die je invult is een ANKER, geen "de volgende keer". Het
 * scherm rekent er de eerstvolgende verlenging uit, zodat er nooit een datum uit
 * het verleden blijft staan omdat niemand hem bijwerkte.
 */

type Site = {
  id: string
  naam: string
  client_id: string | null
  client_naam: string | null
  site_url: string | null
  plan: string | null
  bedrag_excl: number
  vat_pct: number
  facturatie: 'monthly' | 'annual'
  renew_op: string | null
  opgezegd_op: string | null
  notitie: string | null
  volgende_verlenging: string | null
  dagen_tot: number | null
  per_maand: number
}

type Klant = { id: string; name: string | null }

type Formulier = {
  id?: string
  naam: string; client_id: string; site_url: string; plan: string
  bedrag_excl: string; vat_pct: string
  facturatie: 'monthly' | 'annual'; renew_op: string; notitie: string
}

const LEEG: Formulier = {
  naam: '', client_id: '', site_url: '', plan: '',
  bedrag_excl: '', vat_pct: '21', facturatie: 'annual', renew_op: '', notitie: '',
}

const datum = (s: string | null) =>
  s ? new Date(s + 'T12:00:00').toLocaleDateString('nl-BE', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function FramerPage() {
  const [sites, setSites] = useState<Site[]>([])
  const [klanten, setKlanten] = useState<Klant[]>([])
  const [hint, setHint] = useState<string | null>(null)
  const [laden, setLaden] = useState(true)
  const [form, setForm] = useState<Formulier | null>(null)
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/framer-sites', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setSites(j.sites ?? [])
      setKlanten(j.clients ?? [])
      setHint(j.hint ?? null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Laden mislukt')
    } finally { setLaden(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const lopend = useMemo(() => sites.filter((s) => !s.opgezegd_op), [sites])
  const gestopt = useMemo(() => sites.filter((s) => s.opgezegd_op), [sites])
  const perMaandTotaal = useMemo(() => lopend.reduce((t, s) => t + Number(s.per_maand || 0), 0), [lopend])
  const binnenkort = useMemo(
    () => lopend.filter((s) => s.dagen_tot != null && s.dagen_tot <= 30).sort((a, b) => (a.dagen_tot ?? 0) - (b.dagen_tot ?? 0)),
    [lopend],
  )

  const bewerk = (s: Site) => setForm({
    id: s.id, naam: s.naam, client_id: s.client_id ?? '', site_url: s.site_url ?? '',
    plan: s.plan ?? '', bedrag_excl: String(s.bedrag_excl ?? ''), vat_pct: String(s.vat_pct ?? '21'),
    facturatie: s.facturatie, renew_op: s.renew_op ?? '', notitie: s.notitie ?? '',
  })

  const bewaar = async () => {
    if (!form) return
    setBezig(true); setFout(null)
    try {
      const r = await fetch('/api/admin/framer-sites', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          bedrag_excl: Number(String(form.bedrag_excl).replace(',', '.')) || 0,
          vat_pct: Number(String(form.vat_pct).replace(',', '.')) || 0,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      toast.success(form.id ? 'Bijgewerkt' : 'Toegevoegd')
      setForm(null); load()
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally { setBezig(false) }
  }

  const zetStop = async (s: Site, stoppen: boolean) => {
    try {
      const r = await fetch('/api/admin/framer-sites', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, opgezegd_op: stoppen ? new Date().toISOString().slice(0, 10) : null }),
      })
      if (!r.ok) throw new Error((await r.json()).error)
      toast.success(stoppen ? 'Opgezegd' : 'Weer lopend')
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  const verwijder = async (s: Site) => {
    if (!confirm(`${s.naam} verwijderen? Wil je de historiek bewaren, gebruik dan Opzeggen.`)) return
    try {
      const r = await fetch(`/api/admin/framer-sites?id=${encodeURIComponent(s.id)}`, { method: 'DELETE' })
      if (!r.ok) throw new Error((await r.json()).error)
      toast.success('Verwijderd'); load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  const Rij = ({ s }: { s: Site }) => {
    const dringend = s.dagen_tot != null && s.dagen_tot <= 14
    return (
      <tr className="hover:bg-gray-50/50">
        <td className="py-2.5">
          <div className="font-medium flex items-center gap-1.5">
            {s.naam}
            {s.site_url && (
              <a href={s.site_url.startsWith('http') ? s.site_url : `https://${s.site_url}`}
                target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-700">
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="text-[11px] text-gray-500">
            {s.client_naam
              ? s.client_naam
              : <span className="text-gray-400">niet gekoppeld aan een klant</span>}
            {s.plan && <> · {s.plan}</>}
          </div>
        </td>
        <td className="py-2.5 text-xs text-gray-600">
          {s.facturatie === 'annual' ? 'jaarlijks' : 'maandelijks'}
        </td>
        <td className="py-2.5 text-right whitespace-nowrap">{formatEuro(Number(s.bedrag_excl))}</td>
        <td className="py-2.5 text-right whitespace-nowrap text-gray-600">{formatEuro(Number(s.per_maand))}</td>
        <td className="py-2.5 text-xs whitespace-nowrap">
          {s.opgezegd_op ? (
            <span className="text-gray-400">opgezegd {datum(s.opgezegd_op)}</span>
          ) : s.volgende_verlenging ? (
            <span className={dringend ? 'text-red-600 font-medium' : 'text-gray-600'}>
              {datum(s.volgende_verlenging)}
              {s.dagen_tot != null && (
                <span className="block text-[11px] opacity-70">
                  {s.dagen_tot === 0 ? 'vandaag' : `over ${s.dagen_tot} dag${s.dagen_tot === 1 ? '' : 'en'}`}
                </span>
              )}
            </span>
          ) : <span className="text-amber-700">geen datum ingevuld</span>}
        </td>
        <td className="py-2.5">
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => bewerk(s)} title="Wijzigen"
              className="text-gray-400 hover:text-gray-700 p-1"><Pencil className="h-3.5 w-3.5" /></button>
            <button onClick={() => zetStop(s, !s.opgezegd_op)}
              title={s.opgezegd_op ? 'Weer lopend maken' : 'Opzeggen — blijft in de historiek staan'}
              className="text-xs px-2 py-1 rounded-lg text-gray-500 hover:bg-gray-100 whitespace-nowrap">
              {s.opgezegd_op ? 'Hervatten' : 'Opzeggen'}
            </button>
            <button onClick={() => verwijder(s)} title="Verwijderen"
              className="text-red-400 hover:text-red-600 p-1"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </td>
      </tr>
    )
  }

  const Tabel = ({ rijen }: { rijen: Site[] }) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[680px]">
        <thead>
          <tr className="border-b border-gray-100">
            <th className="text-left py-2 text-xs text-gray-500 font-medium">Site</th>
            <th className="text-left py-2 text-xs text-gray-500 font-medium">Facturatie</th>
            <th className="text-right py-2 text-xs text-gray-500 font-medium">Bedrag excl.</th>
            <th className="text-right py-2 text-xs text-gray-500 font-medium">Per maand</th>
            <th className="text-left py-2 text-xs text-gray-500 font-medium">Verlengt</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rijen.map((s) => <Rij key={s.id} s={s} />)}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Globe className="h-4 w-4" />Framer-sites</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Welke klantwebsites op Framer draaien, wat ze kosten en wanneer ze verlengen.
          </p>
        </div>
        <button onClick={() => { setForm({ ...LEEG }); setFout(null) }} className="btn-secondary shrink-0">
          <Plus className="h-4 w-4" />Site toevoegen
        </button>
      </div>

      {hint && <div className="card-base bg-amber-50 border-amber-200 text-sm text-amber-800">{hint}</div>}

      {binnenkort.length > 0 && (
        <div className="card-base bg-amber-50 border-amber-200 text-sm text-amber-800 flex items-start gap-2">
          <CalendarClock className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <b>Verlengt binnen de maand:</b>{' '}
            {binnenkort.map((s) => `${s.naam} (${s.dagen_tot === 0 ? 'vandaag' : `${s.dagen_tot} d`})`).join(' · ')}
          </div>
        </div>
      )}

      {laden ? (
        <div className="card-base text-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : sites.length === 0 ? (
        <div className="card-base text-center py-12 text-gray-400">
          <Globe className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nog geen Framer-sites</p>
          <p className="text-xs mt-1">Een site hoeft niet aan een klant uit de app te hangen.</p>
        </div>
      ) : (
        <>
          <div className="card-base">
            <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
              <h3 className="font-semibold">Lopend <span className="text-gray-400 font-normal">({lopend.length})</span></h3>
              <div className="text-sm text-gray-600">
                {formatEuro(perMaandTotaal)} <span className="text-gray-400">per maand</span>
                <span className="text-gray-400"> · {formatEuro(perMaandTotaal * 12)} per jaar</span>
              </div>
            </div>
            {lopend.length === 0
              ? <p className="text-sm text-gray-400 text-center py-6">Geen lopende sites</p>
              : <Tabel rijen={lopend} />}
          </div>

          {gestopt.length > 0 && (
            <div className="card-base">
              <h3 className="font-semibold mb-3 text-gray-600">
                Opgezegd <span className="text-gray-400 font-normal">({gestopt.length})</span>
              </h3>
              <div className="opacity-70"><Tabel rijen={gestopt} /></div>
            </div>
          )}

          {/* Deze cijfers staan bewust los van de kostentotalen bij Financiën.
              Ze automatisch meetellen zou je winstcijfer wijzigen zonder dat je
              daarom gevraagd hebt. */}
          <p className="text-[11px] text-gray-500">
            Deze bedragen tellen <b>niet</b> automatisch mee in je kosten. Wil je dat wel, zeg het dan —
            dan koppelen we het aan de kostenmodule in plaats van het stilletjes op te tellen.
          </p>
        </>
      )}

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
              <h3 className="font-semibold">{form.id ? 'Site wijzigen' : 'Site toevoegen'}</h3>
              <button onClick={() => setForm(null)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className={lbl}>Naam *</label>
                <input className={inp} value={form.naam} placeholder="Bakkerij Peeters"
                  onChange={(e) => setForm({ ...form, naam: e.target.value })} />
              </div>

              <div>
                <label className={lbl}>Klant in de app</label>
                <select className={inp} value={form.client_id}
                  onChange={(e) => setForm({ ...form, client_id: e.target.value })}>
                  <option value="">Geen — deze site hoort bij niemand in de app</option>
                  {klanten.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Optioneel. De naam hierboven blijft leidend.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Website</label>
                  <input className={inp} value={form.site_url} placeholder="bakkerijpeeters.be"
                    onChange={(e) => setForm({ ...form, site_url: e.target.value })} />
                </div>
                <div>
                  <label className={lbl}>Plan</label>
                  <input className={inp} value={form.plan} placeholder="Basic, Pro…"
                    onChange={(e) => setForm({ ...form, plan: e.target.value })} />
                </div>
              </div>

              <div>
                <label className={lbl}>Facturatie</label>
                <div className="grid grid-cols-2 gap-1.5">
                  {([['annual', 'Jaarlijks'], ['monthly', 'Maandelijks']] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setForm({ ...form, facturatie: v })}
                      className={`py-2 rounded-lg border text-xs font-medium ${
                        form.facturatie === v ? 'border-[#fff848] bg-[#fff848]/10 text-black' : 'border-gray-200 text-gray-500'
                      }`}>{l}</button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>Bedrag excl. btw (€)</label>
                  <input className={inp} inputMode="decimal" value={form.bedrag_excl} placeholder="180"
                    onChange={(e) => setForm({ ...form, bedrag_excl: e.target.value })} />
                </div>
                <div>
                  <label className={lbl}>BTW %</label>
                  <input className={inp} inputMode="decimal" value={form.vat_pct}
                    onChange={(e) => setForm({ ...form, vat_pct: e.target.value })} />
                </div>
              </div>

              <div>
                <label className={lbl}>Verlengdatum</label>
                <input type="date" className={inp} value={form.renew_op}
                  onChange={(e) => setForm({ ...form, renew_op: e.target.value })} />
                <p className="text-[11px] text-gray-400 mt-1">
                  De dag waarop het verlengt. Mag in het verleden liggen — het scherm rekent zelf de
                  eerstvolgende keer uit, dus je hoeft dit nooit bij te werken.
                </p>
              </div>

              <div>
                <label className={lbl}>Notitie</label>
                <input className={inp} value={form.notitie}
                  onChange={(e) => setForm({ ...form, notitie: e.target.value })} />
              </div>

              {fout && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />{fout}
              </div>}

              <div className="flex gap-2 pt-1">
                <button onClick={bewaar} disabled={bezig || !form.naam.trim()} className="btn-primary flex-1 justify-center disabled:opacity-50">
                  {bezig && <Loader2 className="h-4 w-4 animate-spin" />}{form.id ? 'Opslaan' : 'Toevoegen'}
                </button>
                <button onClick={() => setForm(null)} className="btn-secondary">Annuleer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
