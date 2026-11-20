'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowRight, Check, Globe, Loader2, Mail, Phone, RotateCcw, Sparkles, X } from 'lucide-react'
import { DIENSTEN, BEDRIJVEN, PROJECT_VERANTWOORDELIJKEN, projectNaam, type Bedrijf } from '@/lib/opdrachten-kanban'
import type { MailProject } from '@/lib/mail-opvolging/projecten-server'

const dagKort = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/opdrachten/mail-projecten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j
}

/**
 * Nieuwe projecten uit de mail. De AI las de inkomende mails en stelt enkel voor
 * wat duidelijk een nieuw project lijkt. Per voorstel: Ja (projectkaart in
 * Opvolging, met de gegevens uit de mail) of Nee. Niets gebeurt zonder klik.
 * Enkel zichtbaar als er iets te beslissen valt.
 */
export function MailProjecten() {
  const router = useRouter()
  const [lijst, setLijst] = useState<MailProject[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [beslist, setBeslist] = useState(false)

  const laad = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/opdrachten/mail-projecten', { cache: 'no-store' })
      const j = await r.json()
      setLijst(r.ok ? j.projecten ?? [] : [])
    } catch { setLijst([]) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const voorstellen = useMemo(() => (lijst ?? []).filter((p) => p.status === 'voorstel'), [lijst])
  const eerder = useMemo(() => (lijst ?? []).filter((p) => p.status === 'ja' || p.status === 'nee').slice(0, 15), [lijst])

  const nee = async (p: MailProject) => {
    setBezig(p.id)
    try {
      await post({ actie: 'nee', id: p.id })
      setLijst((l) => (l ?? []).map((x) => (x.id === p.id ? { ...x, status: 'nee' } : x)))
      toast('Geen nieuw project.', { action: { label: 'Ongedaan maken', onClick: () => terug(p) } })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  const terug = async (p: MailProject) => {
    try { await post({ actie: 'terug', id: p.id }); await laad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  if (lijst === null || !voorstellen.length) return null

  return (
    <section className="card-base !p-4 border-l-4 !border-l-geel" aria-labelledby="mail-projecten-kop">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <Sparkles className="h-4 w-4 text-gray-700" />
        <h2 id="mail-projecten-kop" className="text-sm font-semibold text-gray-900">Nieuw project?</h2>
        <span className="min-w-[1.75rem] text-center rounded-full px-2 py-0.5 text-xs font-bold bg-geel text-gray-900">{voorstellen.length}</span>
        <span className="text-[11px] text-gray-500">Uit de mail. Kies zelf of er een projectkaart komt.</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {voorstellen.map((p) => {
          const naam = p.klant ?? p.contact.bedrijf ?? p.contact.naam ?? p.van ?? 'Onbekend'
          return (
            <li key={p.id} className="py-3">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="min-w-0 w-full sm:flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-sm font-semibold text-gray-900">{projectNaam(naam, [], p.titel)}</p>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.client_id ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{p.client_id ? 'Bestaande klant' : 'Nieuwe prospect'}</span>
                    {p.formulier && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">Websiteformulier</span>}
                    {p.diensten.map((d) => { const i = DIENSTEN.find((x) => x.key === d); return i ? <span key={d} className="text-[10px] px-1.5 py-0.5 rounded-full border" style={{ background: i.achtergrond, borderColor: i.rand, color: i.tekst }}>{i.label}</span> : null })}
                  </div>
                  {p.samenvatting && <p className="text-sm text-gray-700 mt-1 leading-snug">{p.samenvatting}</p>}
                  {p.project && <p className="text-sm text-gray-900 mt-1 leading-snug"><span className="text-gray-500">Project: </span>{p.project}</p>}
                  <div className="text-xs text-gray-500 flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5">
                    <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{p.formulier ? 'Formulier' : p.van_naam ?? p.van} · {dagKort(p.ontvangen_op)}{p.onderwerp ? ` · “${p.onderwerp.slice(0, 70)}”` : ''}</span>
                    {p.contact.email && <a href={`mailto:${p.contact.email}`} className="hover:text-black underline decoration-gray-300">{p.contact.email}</a>}
                    {p.contact.telefoon && <a href={`tel:${p.contact.telefoon.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1 hover:text-black"><Phone className="h-3 w-3" />{p.contact.telefoon}</a>}
                    {p.contact.website && <span className="inline-flex items-center gap-1"><Globe className="h-3 w-3" />{p.contact.website}</span>}
                    <span className="text-gray-400">{BEDRIJVEN.find((b) => b.key === p.merk)?.label}</span>
                  </div>
                  {p.reden && <p className="text-[11px] text-gray-400 mt-1">Waarom: {p.reden}</p>}
                  {p.lopend && (
                    <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2 py-1 mt-2 inline-flex items-center gap-1 flex-wrap">
                      Deze klant heeft al een lopende kaart:
                      <Link href={`/admin/opdrachten?opdracht=${p.lopend.id}`} className="font-medium underline">{p.lopend.titel}</Link>
                      ({p.lopend.fase}). Hoort het daarbij, kies dan Nee.
                    </p>
                  )}
                </div>
                {open !== p.id && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" onClick={() => setOpen(p.id)} className="btn-primary text-xs h-8"><Check className="h-3.5 w-3.5" />Ja, kaart maken</button>
                    <button type="button" onClick={() => nee(p)} disabled={bezig === p.id} className="btn-secondary text-xs h-8">{bezig === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}Nee</button>
                  </div>
                )}
              </div>
              {open === p.id && (
                <KaartMaken p={p} naam={naam} onSluit={() => setOpen(null)} onKlaar={(id) => {
                  setOpen(null)
                  setLijst((l) => (l ?? []).map((x) => (x.id === p.id ? { ...x, status: 'ja', kaart: { id, titel: x.titel ?? '' } } : x)))
                  toast.success('De kaart staat in Opvolging.', { action: { label: 'Openen', onClick: () => router.push(`/admin/opdrachten?opdracht=${id}`) } })
                }} />
              )}
            </li>
          )
        })}
      </ul>
      {eerder.length > 0 && (
        <div className="mt-1">
          <button type="button" onClick={() => setBeslist((v) => !v)} className="text-xs text-gray-500 hover:text-black">{beslist ? 'Verberg' : 'Eerder beslist'} ({eerder.length})</button>
          {beslist && (
            <ul className="mt-1 space-y-1">
              {eerder.map((p) => (
                <li key={p.id} className="text-xs text-gray-600 flex items-center gap-2 flex-wrap">
                  <span className={`px-1.5 py-0.5 rounded-full ${p.status === 'ja' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{p.status === 'ja' ? 'Ja' : 'Nee'}</span>
                  <span className="text-gray-900">{projectNaam(p.klant ?? p.contact.bedrijf ?? p.contact.naam ?? p.van, [], p.titel)}</span>
                  <span className="text-gray-400">{dagKort(p.ontvangen_op)}{p.beslist_door ? ` · ${p.beslist_door}` : ''}</span>
                  {p.status === 'ja' && p.kaart && <Link href={`/admin/opdrachten?opdracht=${p.kaart.id}`} className="inline-flex items-center gap-0.5 hover:text-black underline decoration-gray-300">Kaart<ArrowRight className="h-3 w-3" /></Link>}
                  {p.status === 'nee' && <button type="button" onClick={() => terug(p)} className="inline-flex items-center gap-0.5 hover:text-black"><RotateCcw className="h-3 w-3" />Terugzetten</button>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

function KaartMaken({ p, naam, onSluit, onKlaar }: { p: MailProject; naam: string; onSluit: () => void; onKlaar: (opdrachtId: string) => void }) {
  const [klant, setKlant] = useState(p.client_id ? '' : naam)
  const [titel, setTitel] = useState(p.titel ?? '')
  const [diensten, setDiensten] = useState<string[]>(p.diensten)
  const [wie, setWie] = useState<string>(p.verantwoordelijke)
  const [merk, setMerk] = useState<Bedrijf>(p.merk as Bedrijf)
  const [bezig, setBezig] = useState(false)
  const pil = (aan: boolean) => `px-2.5 py-1 rounded-full text-xs border ${aan ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`
  const maak = async () => {
    if (!wie) { toast.error('Kies een verantwoordelijke.'); return }
    setBezig(true)
    try {
      const j = await post({ actie: 'ja', id: p.id, titel, ...(p.client_id ? {} : { klant }), diensten, merk, verantwoordelijke: wie })
      onKlaar(j.opdrachtId)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); setBezig(false) }
  }
  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-2.5">
      <div className="grid sm:grid-cols-2 gap-2">
        <label className="text-xs text-gray-500">Klant
          {p.client_id
            ? <span className="mt-1 block text-sm text-gray-900 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200">{p.klant}</span>
            : <input className="input-base mt-1 !py-1.5 text-sm" value={klant} onChange={(e) => setKlant(e.target.value)} maxLength={120} placeholder="Naam van het bedrijf" />}
        </label>
        <label className="text-xs text-gray-500">Waarover gaat het
          <input className="input-base mt-1 !py-1.5 text-sm" value={titel} onChange={(e) => setTitel(e.target.value)} maxLength={200} placeholder="bv. Nieuwe website" />
        </label>
      </div>
      <div>
        <p className="text-xs text-gray-500 mb-1">Diensten</p>
        <div className="flex gap-1.5 flex-wrap">
          {DIENSTEN.map((d) => { const aan = diensten.includes(d.key!); return <button key={d.key} type="button" onClick={() => setDiensten((l) => (aan ? l.filter((x) => x !== d.key) : [...l, d.key!]))} className={pil(aan)}>{d.label}</button> })}
        </div>
      </div>
      <div className="flex gap-4 flex-wrap">
        <div>
          <p className="text-xs text-gray-500 mb-1">Verantwoordelijke</p>
          <div className="flex gap-1.5">{PROJECT_VERANTWOORDELIJKEN.map((v) => <button key={v} type="button" onClick={() => setWie(v)} className={pil(wie === v)}>{v}</button>)}</div>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-1">Bedrijf</p>
          <div className="flex gap-1.5">{BEDRIJVEN.map((b) => <button key={b.key} type="button" onClick={() => setMerk(b.key)} className={pil(merk === b.key)}>{b.kort}</button>)}</div>
        </div>
      </div>
      {p.contact.email || p.contact.telefoon ? <p className="text-[11px] text-gray-500">Op de kaart: {[p.contact.naam, p.contact.email, p.contact.telefoon].filter(Boolean).join(' · ')}, met de samenvatting als eerste notitie.</p> : null}
      <div className="flex gap-2">
        <button type="button" onClick={maak} disabled={bezig || !titel.trim() || (!p.client_id && !klant.trim())} className="btn-primary text-xs h-8">{bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Kaart maken in Opvolging</button>
        <button type="button" onClick={onSluit} className="btn-secondary text-xs h-8">Annuleren</button>
      </div>
    </div>
  )
}
