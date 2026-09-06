'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, KeyRound, Copy, Check, Trash2, Plug, ShieldAlert, History, Save,
} from 'lucide-react'

/**
 * De koppeling met Harrie, ons acquisitiesysteem.
 *
 * Harrie stuurt koude mails en LinkedIn-berichten. Hij haalt hier de volledige
 * pipeline op en meldt terug wat hij deed. Dit scherm doet drie dingen: een
 * sleutel maken, kiezen waar nieuwe prospects landen, en tonen wat er binnenkwam.
 */

type Token = {
  id: string; naam: string; prefix: string; created_at: string
  laatst_gebruikt: string | null; aantal_verzoeken: number; ingetrokken_op: string | null
}
type Pipeline = { id: string; name: string; key: string }
type Gebeurtenis = {
  id: string; type: string; gebeurd_op: string | null; detail: string | null
  resultaat: string | null; created_at: string; lead_id: string | null
  prospect: { company?: string; name?: string; email?: string } | null
}

const tijd = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export function KoppelingClient({ basisUrl }: { basisUrl: string }) {
  const [laden, setLaden] = useState(true)
  const [tokens, setTokens] = useState<Token[]>([])
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [events, setEvents] = useState<Gebeurtenis[]>([])
  const [omvang, setOmvang] = useState({ leads: 0, klanten: 0, kantoorbedrijven: 0 })
  const [pipelineId, setPipelineId] = useState('')
  const [naam, setNaam] = useState('Harrie')
  const [bezig, setBezig] = useState(false)
  // Het verse token, één keer zichtbaar. Daarna staat enkel de hash bij ons.
  const [nieuwToken, setNieuwToken] = useState<string | null>(null)
  const [gekopieerd, setGekopieerd] = useState<string | null>(null)

  const laad = useCallback(async () => {
    setLaden(true)
    try {
      const r = await fetch('/api/admin/sales/harrie', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setTokens(j.tokens ?? [])
      setPipelines(j.pipelines ?? [])
      setEvents(j.events ?? [])
      setOmvang(j.omvang ?? { leads: 0, klanten: 0, kantoorbedrijven: 0 })
      setPipelineId(j.instellingen?.pipeline_id ?? '')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
    finally { setLaden(false) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const maakToken = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/sales/harrie', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actie: 'token', naam }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setNieuwToken(j.token)
      setGekopieerd(null)
      toast.success('Sleutel aangemaakt. Kopieer hem nu — je ziet hem maar één keer.')
      laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Aanmaken mislukt') }
    finally { setBezig(false) }
  }

  const trekIn = async (t: Token) => {
    if (!confirm(`Sleutel "${t.naam}" intrekken?\n\nHarrie kan daarna niets meer ophalen of melden tot je een nieuwe sleutel instelt.`)) return
    try {
      const r = await fetch(`/api/admin/sales/harrie?token=${t.id}`, { method: 'DELETE' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Ingetrokken.')
      laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Intrekken mislukt') }
  }

  const bewaarInstellingen = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/sales/harrie', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actie: 'instellingen', pipeline_id: pipelineId || null }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success('Bewaard. Harrie ziet dit bij zijn volgende ophaling.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') }
    finally { setBezig(false) }
  }

  const kopieer = async (tekst: string, wat: string) => {
    try { await navigator.clipboard.writeText(tekst); setGekopieerd(wat) }
    catch { toast.error('Kopiëren lukte niet — selecteer het handmatig.') }
  }

  if (laden) {
    return <div className="card-base py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
  }

  const actieveTokens = tokens.filter((t) => !t.ingetrokken_op)

  return (
    <div className="space-y-4">
      {/* ── Adres + sleutel ── */}
      <div className="card-base space-y-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Plug className="h-4 w-4 text-gray-400" />Verbinding</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Vul dit in bij Harrie onder <b>Instellingen → Pipeline</b>.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Adres van deze app</label>
          <div className="flex gap-2">
            <code className="flex-1 font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 select-all break-all">
              {basisUrl}/api
            </code>
            <button onClick={() => kopieer(`${basisUrl}/api`, 'url')} className="btn-secondary text-xs shrink-0">
              {gekopieerd === 'url' ? <><Check className="h-3.5 w-3.5" />Gekopieerd</> : <><Copy className="h-3.5 w-3.5" />Kopieer</>}
            </button>
          </div>
          <p className="text-[11px] text-gray-500 mt-1">
            Harrie plakt daar zelf <code className="font-mono">/harrie/ping</code>, <code className="font-mono">/harrie/contacts</code> en <code className="font-mono">/harrie/events</code> achter.
          </p>
        </div>

        <div className="border-t border-gray-100 pt-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">Nieuwe sleutel</label>
          <div className="flex gap-2">
            <input className="input-base text-sm" value={naam} maxLength={120}
              onChange={(e) => setNaam(e.target.value)} placeholder="Waarvoor is deze sleutel?" />
            <button onClick={maakToken} disabled={bezig} className="btn-primary text-sm shrink-0">
              {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}Maak sleutel
            </button>
          </div>
        </div>

        {/* Eén keer zichtbaar. Wij bewaren enkel de hash, dus dit is je enige kans. */}
        {nieuwToken && (
          <div className="rounded-xl border border-[#fff848] bg-[#fff848]/15 p-3 space-y-1.5">
            <div className="text-[11px] uppercase tracking-wide text-gray-600">Plak dit in Harrie</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs bg-white border border-gray-200 rounded-lg px-2 py-1.5 select-all break-all">
                {nieuwToken}
              </code>
              <button onClick={() => kopieer(nieuwToken, 'token')} className="btn-secondary text-xs shrink-0">
                {gekopieerd === 'token' ? <><Check className="h-3.5 w-3.5" />Gekopieerd</> : <><Copy className="h-3.5 w-3.5" />Kopieer</>}
              </button>
            </div>
            <p className="text-[11px] text-gray-600">
              Je ziet dit maar één keer: wij bewaren enkel een versleutelde afdruk, nooit de sleutel zelf.
              Kwijt? Maak een nieuwe en trek de oude in.
            </p>
            <button onClick={() => setNieuwToken(null)} className="text-[11px] underline text-gray-500">Klaar, verberg dit</button>
          </div>
        )}

        {tokens.length > 0 && (
          <div className="border-t border-gray-100 pt-3 space-y-1">
            {tokens.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs">
                <KeyRound className={`h-3.5 w-3.5 ${t.ingetrokken_op ? 'text-gray-300' : 'text-green-600'}`} />
                <span className={t.ingetrokken_op ? 'text-gray-400 line-through' : 'font-medium'}>{t.naam}</span>
                <code className="font-mono text-gray-400">{t.prefix}…</code>
                <span className="text-gray-400">
                  {t.ingetrokken_op
                    ? `ingetrokken ${tijd(t.ingetrokken_op)}`
                    : t.laatst_gebruikt
                      ? `laatst gebruikt ${tijd(t.laatst_gebruikt)} · ${t.aantal_verzoeken} verzoeken`
                      : 'nog nooit gebruikt'}
                </span>
                {!t.ingetrokken_op && (
                  <button onClick={() => trekIn(t)}
                    className="ml-auto h-6 w-6 flex items-center justify-center rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                    title="Intrekken">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {actieveTokens.length === 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
            Er staat geen actieve sleutel. Harrie krijgt op elk verzoek een 401 tot je er een maakt.
          </p>
        )}
      </div>

      {/* ── Wat Harrie ziet ── */}
      <div className="card-base space-y-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-gray-400" />Wat Harrie ziet
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            De volledige pipeline, elke fase. Harrie leest de status en beslist zelf:
            een bedrijf dat bij ons op Closed Won staat, laadt hij niet als prospect op.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="text-lg font-bold tabular-nums">{omvang.leads}</div>
            <div className="text-[11px] text-gray-500">leads uit de pipeline</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="text-lg font-bold tabular-nums">{omvang.klanten}</div>
            <div className="text-[11px] text-gray-500">klanten</div>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2">
            <div className="text-lg font-bold tabular-nums">{omvang.kantoorbedrijven}</div>
            <div className="text-[11px] text-gray-500">eigen bedrijven en partners</div>
          </div>
        </div>

        <p className="text-[11px] text-gray-500">
          Enkel bij <b>bel-me-niet</b> en bij onze klanten en partners zetten we
          <code className="font-mono mx-1">doNotContact</code>op waar — dat zijn de
          twee gevallen waar niets aan te beslissen valt. Al de rest komt gewoon
          mee met zijn fase.
        </p>

        <div className="border-t border-gray-100 pt-3">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Nieuwe prospects van Harrie komen terecht in
          </label>
          <select className="input-base text-sm" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
            <option value="">NextGenMedia (standaard)</option>
            {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <button onClick={bewaarInstellingen} disabled={bezig} className="btn-primary text-sm w-full">
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren
        </button>
      </div>

      {/* ── Wat Harrie meldde ── */}
      <div className="card-base">
        <h2 className="font-semibold flex items-center gap-2 mb-2">
          <History className="h-4 w-4 text-gray-400" />Wat Harrie meldde
        </h2>
        {events.length === 0 ? (
          <p className="text-sm text-gray-500">
            Nog niets binnengekomen. Zodra Harrie een mail stuurt of een antwoord krijgt, verschijnt het hier.
          </p>
        ) : (
          <div className="divide-y divide-gray-50 max-h-[24rem] overflow-y-auto -mx-2">
            {events.map((e) => (
              <div key={e.id} className="px-2 py-2">
                <div className="flex items-center gap-2 text-sm flex-wrap">
                  <span className="status-badge bg-gray-100 text-gray-700">{e.type}</span>
                  <span className="font-medium">{e.prospect?.company ?? e.prospect?.name ?? '—'}</span>
                  <span className="text-gray-400 text-xs ml-auto">{tijd(e.gebeurd_op ?? e.created_at)}</span>
                </div>
                {e.detail && <p className="text-xs text-gray-600 mt-0.5 whitespace-pre-wrap">{e.detail}</p>}
                {e.resultaat && <p className="text-[11px] text-gray-400 mt-0.5">{e.resultaat}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
