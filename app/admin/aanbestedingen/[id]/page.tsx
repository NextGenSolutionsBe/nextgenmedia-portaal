'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, ExternalLink, EyeOff, Eye, CheckCircle2, Circle,
  FileText, AlertTriangle, Euro, Calendar, Building2,
} from 'lucide-react'
import { toast } from 'sonner'

/**
 * De opdrachten van één workspace, met het uitgewerkte dossier ernaast.
 *
 * De lijst staat op score, hoogste eerst. Wat nog geen score heeft zakt naar
 * onderen in plaats van er tussenin te verdwijnen.
 */

type Opdracht = {
  referentienummer: string
  titel: string | null
  organisatie: string | null
  uiterste_indieningsdatum: string | null
  uiterste_indieningsdatum_raw: string | null
  record_status: string
  ingediend: boolean
  genegeerd: boolean
  link: string | null
  score?: number | null
  volledig?: boolean
  kwalificatie_reden?: string | null
  prijs_bedrag?: number | null
  bestek_status?: string | null
  gezien_op?: string | null
}

type Analyse = {
  score: number | null
  volledig: boolean
  uitleg_kort: string | null
  samenvatting: string | null
  bestek_status: string | null
  bestek_samenvatting: string | null
  selectiecriteria: string[] | null
  gevraagde_documenten: string[] | null
  gunningscriteria: { criterium: string; gewicht: string }[] | null
  plan_van_aanpak: string | null
  gekozen_referenties: string[] | null
  prijs_bedrag: number | null
  prijs_type: string | null
  prijs_detail: { post: string; aantal: number | null; eenheid: string; tarief: number | null; bedrag: number | null }[] | null
  prijs_onderbouwing: string | null
  checklist: { wat: string; klaar: boolean }[] | null
  model: string | null
  kost_usd: number | null
  gegenereerd_op: string | null
}

type DocRij = {
  filename: string | null; doc_type: string | null; size_bytes: number | null
  page_count: number | null; char_count: number | null; leesbaar: boolean; status: string | null
}

type Weergave = 'open' | 'uitgewerkt' | 'genegeerd' | 'ingediend' | 'alles'

const euro = (n: number | null | undefined) =>
  n == null ? null : `€ ${n.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const datum = (o: Opdracht) => {
  if (o.uiterste_indieningsdatum_raw) return o.uiterste_indieningsdatum_raw
  if (!o.uiterste_indieningsdatum) return null
  return new Date(o.uiterste_indieningsdatum).toLocaleString('nl-BE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Hoeveel dagen nog? Bepaalt de kleur van het deadlinelabel. */
const dagenTot = (iso: string | null) =>
  iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null

const scoreKleur = (s: number | null | undefined) =>
  s == null ? 'bg-gray-100 text-gray-400'
    : s >= 80 ? 'bg-green-100 text-green-700'
      : s >= 60 ? 'bg-lime-100 text-lime-700'
        : s >= 40 ? 'bg-amber-100 text-amber-700'
          : 'bg-gray-100 text-gray-500'

export default function WorkspacePage() {
  const params = useParams<{ id: string }>()
  const filterId = params.id

  const [naam, setNaam] = useState('')
  const [opdrachten, setOpdrachten] = useState<Opdracht[]>([])
  const [laden, setLaden] = useState(true)
  const [weergave, setWeergave] = useState<Weergave>('open')
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ opdracht: Opdracht; analyse: Analyse | null; documenten: DocRij[] } | null>(null)
  const [detailLaadt, setDetailLaadt] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/aanbestedingen/opdrachten?filterId=${encodeURIComponent(filterId)}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setOpdrachten(j.opdrachten ?? [])
      setNaam(j.workspace?.naam ?? '')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Laden mislukt')
    } finally {
      setLaden(false)
    }
  }, [filterId])
  useEffect(() => { load() }, [load])

  const opendetail = async (ref: string) => {
    setOpen(ref); setDetail(null); setDetailLaadt(true)
    try {
      const r = await fetch(`/api/admin/aanbestedingen/opdrachten?filterId=${encodeURIComponent(filterId)}&ref=${encodeURIComponent(ref)}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setDetail(j)
      // De "nieuw"-markering is aan de serverkant weggehaald; hier bijhouden
      // zodat de lijst niet opnieuw geladen hoeft te worden.
      setOpdrachten((l) => l.map((o) => o.referentienummer === ref ? { ...o, gezien_op: new Date().toISOString() } : o))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dossier laden mislukt')
      setOpen(null)
    } finally {
      setDetailLaadt(false)
    }
  }

  const markeer = async (ref: string, velden: Record<string, unknown>, melding: string) => {
    try {
      const r = await fetch(`/api/admin/aanbestedingen/opdrachten?filterId=${encodeURIComponent(filterId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referentienummer: ref, ...velden }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setOpdrachten((l) => l.map((o) => o.referentienummer === ref ? { ...o, ...velden } : o))
      if (melding) toast.success(melding)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Mislukt')
    }
  }

  const vinkAf = async (index: number) => {
    if (!detail?.analyse?.checklist || !open) return
    const nieuw = detail.analyse.checklist.map((c, i) => i === index ? { ...c, klaar: !c.klaar } : c)
    setDetail({ ...detail, analyse: { ...detail.analyse, checklist: nieuw } })
    await markeer(open, { checklist: nieuw }, '')
  }

  const zichtbaar = useMemo(() => opdrachten.filter((o) => {
    if (weergave === 'alles') return true
    if (weergave === 'ingediend') return o.ingediend
    if (weergave === 'genegeerd') return o.genegeerd
    if (o.ingediend || o.genegeerd) return false
    if (weergave === 'uitgewerkt') return o.volledig === true
    return true
  }), [opdrachten, weergave])

  const tel = (w: Weergave) => opdrachten.filter((o) => {
    if (w === 'alles') return true
    if (w === 'ingediend') return o.ingediend
    if (w === 'genegeerd') return o.genegeerd
    if (o.ingediend || o.genegeerd) return false
    if (w === 'uitgewerkt') return o.volledig === true
    return true
  }).length

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <Link href="/admin/aanbestedingen" className="text-sm text-gray-500 hover:text-gray-900 flex items-center gap-1 w-fit">
          <ArrowLeft className="h-4 w-4" />Workspaces
        </Link>
        <h1 className="text-2xl font-bold mt-1">{naam || 'Aanbestedingen'}</h1>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {([
          ['open', 'Open'], ['uitgewerkt', 'Uitgewerkt'],
          ['genegeerd', 'Genegeerd'], ['ingediend', 'Ingediend'], ['alles', 'Alles'],
        ] as [Weergave, string][]).map(([k, label]) => (
          <button
            key={k} onClick={() => setWeergave(k)}
            className={`h-8 px-3 rounded-lg text-xs ${weergave === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            {label} <span className="opacity-60">{tel(k)}</span>
          </button>
        ))}
      </div>

      {laden ? (
        <div className="card-base text-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : zichtbaar.length === 0 ? (
        <div className="card-base text-center py-12 text-gray-400">
          <FileText className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Niets in deze weergave</p>
          <p className="text-xs mt-1">Haal eerst opdrachten op en laat ze beoordelen.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {zichtbaar.map((o) => {
            const d = dagenTot(o.uiterste_indieningsdatum)
            return (
              <div key={o.referentienummer} className="card-base">
                <button onClick={() => opendetail(o.referentienummer)} className="w-full text-left flex items-start gap-3">
                  <span className={`shrink-0 h-9 w-9 rounded-lg grid place-items-center text-sm font-semibold ${scoreKleur(o.score)}`}>
                    {o.score ?? '–'}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{o.titel ?? o.referentienummer}</span>
                      {o.volledig && !o.gezien_op && <span className="status-badge bg-yellow-100 text-yellow-800">nieuw</span>}
                      {o.volledig && <span className="status-badge bg-blue-50 text-blue-700">uitgewerkt</span>}
                      {o.ingediend && <span className="status-badge bg-green-100 text-green-700">ingediend</span>}
                      {o.genegeerd && <span className="status-badge bg-gray-100 text-gray-500">genegeerd</span>}
                      {o.record_status === 'verdwenen' && <span className="status-badge bg-red-50 text-red-600">niet meer gevonden</span>}
                    </span>
                    <span className="block text-xs text-gray-500 mt-0.5 truncate">
                      {[o.organisatie, o.referentienummer].filter(Boolean).join(' · ')}
                    </span>
                    {o.kwalificatie_reden && (
                      <span className="block text-xs text-gray-400 mt-1 line-clamp-2">{o.kwalificatie_reden}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    {datum(o) && (
                      <span className={`block ${d != null && d <= 7 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {datum(o)}
                      </span>
                    )}
                    {d != null && d >= 0 && <span className="block text-gray-400">nog {d} dag{d === 1 ? '' : 'en'}</span>}
                    {o.prijs_bedrag != null && <span className="block text-gray-600 mt-0.5">{euro(o.prijs_bedrag)}</span>}
                  </span>
                </button>
              </div>
            )
          })}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl max-h-[92vh] overflow-y-auto">
            {detailLaadt || !detail ? (
              <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
            ) : (
              <Dossier
                d={detail}
                sluit={() => { setOpen(null); setDetail(null) }}
                markeer={markeer}
                vinkAf={vinkAf}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Blok({ titel, children }: { titel: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{titel}</h3>
      {children}
    </div>
  )
}

function Dossier({ d, sluit, markeer, vinkAf }: {
  d: { opdracht: Opdracht; analyse: Analyse | null; documenten: DocRij[] }
  sluit: () => void
  markeer: (ref: string, velden: Record<string, unknown>, melding: string) => Promise<void>
  vinkAf: (i: number) => void
}) {
  const { opdracht: o, analyse: a, documenten } = d
  const lijst = (v: string[] | null | undefined) => (v ?? []).filter(Boolean)

  return (
    <>
      <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{o.titel ?? o.referentienummer}</div>
          <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
            {o.organisatie && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{o.organisatie}</span>}
            {datum(o) && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{datum(o)}</span>}
            <span>{o.referentienummer}</span>
          </div>
        </div>
        <button onClick={sluit} className="shrink-0 h-8 px-2 rounded-lg text-sm hover:bg-gray-100 text-gray-500">Sluiten</button>
      </div>

      <div className="p-5 space-y-5 text-sm">
        {!a ? (
          <div className="text-gray-500">
            Deze opdracht is nog niet beoordeeld. Gebruik <b>Beoordelen</b> op de workspace-kaart.
          </div>
        ) : !a.volledig ? (
          <>
            <div className="flex items-start gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>
                Enkel de voorselectie is gedaan — score <b>{a.score}</b>, op titel en CPV-code alleen.
                Het bestek is hier nog niet voor gelezen. Gebruik <b>Uitwerken</b> voor het volledige dossier.
              </span>
            </div>
            {a.uitleg_kort && <p className="text-gray-700 whitespace-pre-wrap">{a.uitleg_kort}</p>}
          </>
        ) : (
          <>
            {/* Waar dit dossier op gebouwd is. Eerst, niet als voetnoot: een
                analyse zonder bestek ziet er even net uit als een mét. */}
            <div className={`rounded-lg p-3 text-xs ${/geen bestek/i.test(a.bestek_status ?? '') ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-gray-50 text-gray-600'}`}>
              <b>Bron:</b> {a.bestek_status ?? 'onbekend'}
              {documenten.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {documenten.map((doc, i) => (
                    <li key={i} className={doc.leesbaar ? '' : 'text-amber-700'}>
                      {doc.leesbaar ? '·' : '×'} {doc.filename}
                      {doc.leesbaar
                        ? ` — ${doc.page_count ? `${doc.page_count} p, ` : ''}${(doc.char_count ?? 0).toLocaleString('nl-BE')} tekens`
                        : ` — ${doc.status}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {a.samenvatting && <Blok titel="Wat vraagt men"><p className="whitespace-pre-wrap text-gray-700">{a.samenvatting}</p></Blok>}
            {a.bestek_samenvatting && <Blok titel="Uit het bestek"><p className="whitespace-pre-wrap text-gray-700">{a.bestek_samenvatting}</p></Blok>}

            {lijst(a.selectiecriteria).length > 0 && (
              <Blok titel="Selectiecriteria">
                <ul className="list-disc ml-5 space-y-0.5 text-gray-700">
                  {lijst(a.selectiecriteria).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </Blok>
            )}

            {(a.gunningscriteria ?? []).length > 0 && (
              <Blok titel="Gunningscriteria">
                <ul className="space-y-0.5 text-gray-700">
                  {(a.gunningscriteria ?? []).map((g, i) => (
                    <li key={i} className="flex justify-between gap-3 border-b border-gray-50 py-0.5">
                      <span>{g.criterium}</span><span className="text-gray-500 shrink-0">{g.gewicht}</span>
                    </li>
                  ))}
                </ul>
              </Blok>
            )}

            {lijst(a.gevraagde_documenten).length > 0 && (
              <Blok titel="Mee in te dienen">
                <ul className="list-disc ml-5 space-y-0.5 text-gray-700">
                  {lijst(a.gevraagde_documenten).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </Blok>
            )}

            {a.plan_van_aanpak && <Blok titel="Plan van aanpak"><p className="whitespace-pre-wrap text-gray-700">{a.plan_van_aanpak}</p></Blok>}

            {lijst(a.gekozen_referenties).length > 0 && (
              <Blok titel="Onze sterkste referenties hier">
                <ul className="list-disc ml-5 space-y-0.5 text-gray-700">
                  {lijst(a.gekozen_referenties).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </Blok>
            )}

            <Blok titel="Prijs">
              {a.prijs_bedrag == null ? (
                // Geen prijs is een uitkomst, geen leeg veld. Zeg waarom.
                <div className="flex items-start gap-2 bg-gray-50 rounded-lg p-3 text-gray-600">
                  <Euro className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{a.prijs_onderbouwing || 'Geen prijs berekend.'}</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-lg font-semibold">
                    {euro(a.prijs_bedrag)} <span className="text-xs font-normal text-gray-500">{a.prijs_type}</span>
                  </div>
                  {(a.prijs_detail ?? []).length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <tbody>
                          {(a.prijs_detail ?? []).map((p, i) => (
                            <tr key={i} className="border-b border-gray-50">
                              <td className="py-1 pr-2">{p.post}</td>
                              <td className="py-1 pr-2 text-gray-500 whitespace-nowrap">
                                {p.aantal ?? ''} {p.eenheid}
                              </td>
                              <td className="py-1 pr-2 text-gray-500 whitespace-nowrap">{p.tarief != null ? euro(p.tarief) : ''}</td>
                              <td className="py-1 text-right whitespace-nowrap">{p.bedrag != null ? euro(p.bedrag) : ''}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {a.prijs_onderbouwing && <p className="text-xs text-gray-600 whitespace-pre-wrap">{a.prijs_onderbouwing}</p>}
                  <p className="text-xs text-amber-700 flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                    Reken dit na vóór je het indient. Dit is een voorstel, geen offerte.
                  </p>
                </div>
              )}
            </Blok>

            {(a.checklist ?? []).length > 0 && (
              <Blok titel="Vóór indienen">
                <ul className="space-y-1">
                  {(a.checklist ?? []).map((c, i) => (
                    <li key={i}>
                      <button onClick={() => vinkAf(i)} className="flex items-start gap-2 text-left w-full hover:bg-gray-50 rounded px-1 py-0.5">
                        {c.klaar
                          ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-green-600" />
                          : <Circle className="h-4 w-4 shrink-0 mt-0.5 text-gray-300" />}
                        <span className={c.klaar ? 'line-through text-gray-400' : 'text-gray-700'}>{c.wat}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Blok>
            )}

            <p className="text-[11px] text-gray-400 border-t border-gray-100 pt-3">
              {a.model} · {a.gegenereerd_op ? new Date(a.gegenereerd_op).toLocaleString('nl-BE') : ''}
              {a.kost_usd ? ` · $${Number(a.kost_usd).toFixed(3)}` : ''}
            </p>
          </>
        )}
      </div>

      <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex flex-wrap items-center gap-2">
        {o.link && (
          <a href={o.link} target="_blank" rel="noopener noreferrer"
            className="h-9 px-3 rounded-lg text-sm hover:bg-gray-100 text-gray-600 flex items-center gap-1.5">
            <ExternalLink className="h-4 w-4" />Op publicprocurement.be
          </a>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            onClick={() => markeer(o.referentienummer, { genegeerd: !o.genegeerd }, o.genegeerd ? 'Terug in de lijst' : 'Genegeerd')}
            className="h-9 px-3 rounded-lg text-sm hover:bg-gray-100 text-gray-600 flex items-center gap-1.5"
          >
            {o.genegeerd ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            {o.genegeerd ? 'Niet meer negeren' : 'Negeren'}
          </button>
          <button
            onClick={() => markeer(o.referentienummer, { ingediend: !o.ingediend }, o.ingediend ? 'Terug op niet-ingediend' : 'Gemarkeerd als ingediend')}
            className="btn-primary"
          >
            <CheckCircle2 className="h-4 w-4" />
            {o.ingediend ? 'Toch niet ingediend' : 'Ingediend'}
          </button>
        </div>
      </div>
    </>
  )
}
