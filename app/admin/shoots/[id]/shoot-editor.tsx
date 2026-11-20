'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AlertTriangle, ArrowLeft, Backpack, Building2, Clock, Eye, FileText, Info, ListChecks, Loader2, MapPin, Navigation, Paperclip, Plus,
  Save, Send, Sparkles, Trash2, UserPlus, Users, X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { KlantKiezer, type KlantOptie } from '@/components/admin/klant-kiezer'
import { MailComposer } from '@/components/admin/mail-composer'
import { DicteerKnop } from '@/components/admin/dicteer-knop'
import { Bevestig, INP } from '@/app/admin/instellingen/ui'
import { KANTOOR } from '@/lib/meetings/model'
import { leesDocx } from '@/lib/docx-lezen'
import {
  LEEG_PLAN, SHOOT_STATUSSEN, STATUS_INFO, kaartLink, nieuwId, nogAanTeVullen, normaliseerPlan, shootNaam, voegVoorstelSamen, volgendTijdstip,
  type Betrokkene, type ProgrammaPunt, type ShootLocatie, type ShootPlan, type ShootStatus,
} from '@/lib/shoots/model'

type Bestand = { pad: string; naam: string; type: string }
type Verzonden = { email: string | null; naam: string | null; op: string; geopend_op: string | null }
type TeamLid = { naam: string; rol: string; email: string; telefoon: string }

const LBL = 'block text-xs font-medium text-gray-600 mb-1'
const LEESBAAR = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const TYPE_VAN_EXT: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', docx: DOCX, txt: 'text/plain' }
const typeVan = (f: File) => (f.type && f.type !== 'application/octet-stream' ? f.type : TYPE_VAN_EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] ?? '')
const leegPunt = (van: string): ProgrammaPunt => ({ id: nieuwId(), van, tot: '', locatie: '', wat: '', wie: '' })
const leegeLocatie = (): ShootLocatie => ({ id: nieuwId(), naam: '', adres: '', contact: '', telefoon: '', notitie: '' })
const leegPersoon = (): Betrokkene => ({ id: nieuwId(), naam: '', rol: '', email: '', telefoon: '' })
/** Vergelijkbare stand van het formulier, om te weten of er iets niet bewaard is. */
const momentopname = (k: string, p: ShootPlan, b: Bestand | null) => JSON.stringify({ k, p: normaliseerPlan(p), b: b?.pad ?? null })
const plakTekst = (oud: string, nieuw: string) => (oud.trim() ? `${oud.trimEnd()}\n\n${nieuw.trim()}` : nieuw.trim())

/** Eén shoot: de briefing, het plan per uur en locatie, wie erbij is en versturen. */
export function ShootEditor({ id, startDatum, startKlant, magAanpassen, magVerwijderen }: {
  id: string; startDatum?: string | null; startKlant?: string | null; magAanpassen: boolean; magVerwijderen: boolean
}) {
  const router = useRouter()
  const nieuw = id === 'nieuw'
  const [laden, setLaden] = useState(!nieuw)
  const [fout, setFout] = useState<string | null>(null)
  const [klantId, setKlantId] = useState(startKlant ?? '')
  const [plan, setPlan] = useState<ShootPlan>({ ...LEEG_PLAN, datum: startDatum ?? '' })
  const [bestand, setBestand] = useState<Bestand | null>(null)
  const [versie, setVersie] = useState<number | null>(null)
  const [snapshot, setSnapshot] = useState('')
  const [meta, setMeta] = useState<{ bijgewerkt_door: string | null; updated_at: string | null }>({ bijgewerkt_door: null, updated_at: null })
  const [verzonden, setVerzonden] = useState<Verzonden[]>([])
  const [onduidelijk, setOnduidelijk] = useState<string[]>([])
  const [klanten, setKlanten] = useState<KlantOptie[] | null>(null)
  const [team, setTeam] = useState<TeamLid[]>([])
  const [bezig, setBezig] = useState<null | 'bewaren' | 'ai' | 'upload' | 'weg'>(null)
  const [vraagWeg, setVraagWeg] = useState(false)
  const bestandInvoer = useRef<HTMLInputElement>(null)

  const vuil = nieuw || momentopname(klantId, plan, bestand) !== snapshot

  const laad = useCallback(async () => {
    if (nieuw) return
    try {
      const r = await fetch(`/api/admin/shoots/${id}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      const s = j.shoot
      const p = normaliseerPlan(s)
      const b = s.briefing_pad ? { pad: s.briefing_pad, naam: s.briefing_naam ?? 'briefing', type: s.briefing_type ?? '' } : null
      setKlantId(s.client_id); setPlan(p); setBestand(b); setVersie(s.versie)
      setMeta({ bijgewerkt_door: s.bijgewerkt_door, updated_at: s.updated_at })
      setVerzonden(j.verzonden ?? [])
      setSnapshot(momentopname(s.client_id, p, b))
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [id, nieuw])

  useEffect(() => { void laad() }, [laad])
  useEffect(() => {
    fetch('/api/admin/clients-list', { cache: 'no-store' }).then((r) => r.json()).then((j) => setKlanten(j.clients ?? [])).catch(() => setKlanten([]))
    fetch('/api/admin/shoots?team=1', { cache: 'no-store' }).then((r) => r.json()).then((j) => setTeam(j.team ?? [])).catch(() => setTeam([]))
  }, [])

  // ── Bewerken ──────────────────────────────────────────────────────────────
  const zet = (deel: Partial<ShootPlan>) => setPlan((p) => ({ ...p, ...deel }))
  const zetPunt = (pid: string, deel: Partial<ProgrammaPunt>) => setPlan((p) => ({ ...p, programma: p.programma.map((x) => (x.id === pid ? { ...x, ...deel } : x)) }))
  const zetLocatie = (lid: string, deel: Partial<ShootLocatie>) => setPlan((p) => {
    const oud = p.locaties.find((l) => l.id === lid)
    // Een andere naam: ook in het programma meenemen.
    const programma = deel.naam !== undefined && oud?.naam
      ? p.programma.map((x) => (x.locatie && x.locatie === oud.naam ? { ...x, locatie: deel.naam as string } : x)) : p.programma
    return { ...p, programma, locaties: p.locaties.map((l) => (l.id === lid ? { ...l, ...deel } : l)) }
  })
  const zetPersoon = (bid: string, deel: Partial<Betrokkene>) => setPlan((p) => ({ ...p, betrokkenen: p.betrokkenen.map((b) => (b.id === bid ? { ...b, ...deel } : b)) }))
  const voegPersoonToe = (b: Omit<Betrokkene, 'id'>) => setPlan((p) => ({ ...p, betrokkenen: [...p.betrokkenen, { ...b, id: nieuwId() }] }))

  const klant = klanten?.find((k) => k.id === klantId) ?? null
  const emails = new Set(plan.betrokkenen.map((b) => b.email.trim().toLowerCase()).filter(Boolean))
  const namen = new Set(plan.betrokkenen.map((b) => b.naam.trim().toLowerCase()).filter(Boolean))
  const teamTeKiezen = team.filter((t) => !(t.email && emails.has(t.email)) && !namen.has(t.naam.trim().toLowerCase()))
  const klantContact = klant?.email && !emails.has(klant.email.toLowerCase()) ? klant : null
  const nog = useMemo(() => nogAanTeVullen(normaliseerPlan(plan)), [plan])
  const locatieNamen = plan.locaties.map((l) => l.naam).filter(Boolean)

  // ── Briefingdocument ──────────────────────────────────────────────────────
  const kiesBestand = async (f: File) => {
    const type = typeVan(f)
    if (!TYPE_VAN_EXT[f.name.split('.').pop()?.toLowerCase() ?? ''] && !Object.values(TYPE_VAN_EXT).includes(type)) { toast.error('Enkel een pdf, foto (jpg, png, webp), Word-document (.docx) of tekstbestand.'); return }
    if (f.size > 25 * 1024 * 1024) { toast.error('Het bestand mag maximaal 25 MB zijn.'); return }
    setBezig('upload')
    try {
      // Word en tekst: de tekst meteen bij de briefing, zodat je ze kan lezen en aanpassen.
      if (type === DOCX || type === 'text/plain') {
        const tekst = type === DOCX ? await leesDocx(f) : await f.text()
        if (tekst.trim()) { zet({ briefing: plakTekst(plan.briefing, tekst) }); toast.success('De tekst uit het document staat bij de briefing.') }
      }
      const r = await fetch('/api/admin/shoots/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam: f.name, grootte: f.size, type }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Opladen mislukt')
      const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: type, upsert: false })
      if (error) throw new Error(error.message)
      setBestand({ pad: j.pad, naam: f.name, type })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally { setBezig(null); if (bestandInvoer.current) bestandInvoer.current.value = '' }
  }

  // ── Plan maken uit de briefing (AI-voorstel, niets bewaard) ───────────────
  const leesbaarBestand = bestand && LEESBAAR.includes(bestand.type) ? bestand : null
  const maakPlan = async () => {
    if (!plan.briefing.trim() && !leesbaarBestand) { toast.error('Vul eerst de briefing in of voeg een document toe.'); return }
    setBezig('ai')
    try {
      const r = await fetch('/api/admin/shoots/voorstel', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tekst: plan.briefing, briefing_pad: leesbaarBestand?.pad ?? null, client_id: klantId || null, plan }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Het plan maken lukte niet')
      const oud = plan
      setPlan(voegVoorstelSamen(oud, j.plan as ShootPlan))
      setOnduidelijk(j.onduidelijk ?? [])
      toast.success('Het plan is ingevuld. Kijk alles na en bewaar.', { duration: 8000, action: { label: 'Ongedaan maken', onClick: () => { setPlan(oud); setOnduidelijk([]) } } })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Het plan maken lukte niet') } finally { setBezig(null) }
  }

  // ── Bewaren ───────────────────────────────────────────────────────────────
  const bewaar = useCallback(async () => {
    if (!klantId) { toast.error('Kies voor welke klant de shoot is.'); return }
    if (!plan.datum) { toast.error('Kies de datum van de shoot.'); return }
    setBezig('bewaren')
    try {
      const body = { client_id: klantId, plan, versie: versie ?? undefined, briefing_pad: bestand?.pad ?? null, briefing_naam: bestand?.naam ?? null, briefing_type: bestand?.type ?? null }
      const r = await fetch(nieuw ? '/api/admin/shoots' : `/api/admin/shoots/${id}`, { method: nieuw ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await r.json()
      if (!r.ok) {
        if (r.status === 409) { toast.error(j.error, { duration: 10000, action: { label: 'Herladen', onClick: () => void laad() } }); return }
        throw new Error(j.error || 'Bewaren mislukt')
      }
      toast.success(nieuw ? 'Shoot aangemaakt.' : 'Bewaard.')
      if (nieuw) router.replace(`/admin/shoots/${j.id}`)
      else await laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(null) }
  }, [bestand, id, klantId, laad, nieuw, plan, router, versie])

  useEffect(() => {
    const toets = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (magAanpassen && !bezig) void bewaar() } }
    const weg = (e: BeforeUnloadEvent) => { if (vuil && !nieuw) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('keydown', toets); window.addEventListener('beforeunload', weg)
    return () => { window.removeEventListener('keydown', toets); window.removeEventListener('beforeunload', weg) }
  }, [bewaar, bezig, magAanpassen, nieuw, vuil])

  const verwijder = async () => {
    setBezig('weg')
    try {
      const r = await fetch(`/api/admin/shoots/${id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Verwijderen mislukt')
      toast.success('Shoot verwijderd.')
      router.push('/admin/shoots')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt'); setBezig(null) }
  }

  if (laden) return <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
  if (fout) return <div className="card-base text-sm text-red-700">{fout} <Link href="/admin/shoots" className="underline ml-1">Terug naar de planner</Link></div>

  return (
    <div className="space-y-4 pb-24 max-w-4xl">
      {/* Kop */}
      <div className="flex items-start gap-3 flex-wrap">
        <Link href="/admin/shoots" className="h-9 w-9 rounded-full hover:bg-gray-100 flex items-center justify-center shrink-0" aria-label="Terug naar de planner"><ArrowLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-gray-500">Shoot planner</div>
          <h1 className="text-xl font-semibold truncate">{nieuw && !plan.titel ? 'Nieuwe shoot' : shootNaam({ titel: plan.titel, klant: klant?.company_name })}</h1>
          {!nieuw && meta.updated_at && <p className="text-[11px] text-gray-500">Laatst bewaard {new Date(meta.updated_at).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{meta.bijgewerkt_door ? ` door ${meta.bijgewerkt_door.split('@')[0]}` : ''}</p>}
        </div>
        {!nieuw && (
          <div className="flex items-center gap-2 flex-wrap">
            <a href={`/api/admin/shoots/${id}/pdf`} target="_blank" rel="noopener noreferrer" className="btn-secondary text-sm"><FileText className="h-4 w-4" />Shootplan (pdf)</a>
            {vuil
              ? <button type="button" onClick={() => toast.info('Bewaar eerst je wijzigingen, dan stuur je de laatste versie.')} className="btn-secondary text-sm"><Send className="h-4 w-4" />Versturen</button>
              : <MailComposer context={{ type: 'shoot', shootId: id }} label="Versturen" className="btn-secondary text-sm" onSent={() => void laad()} />}
            {magVerwijderen && <button type="button" onClick={() => setVraagWeg(true)} className="h-9 w-9 rounded-full text-gray-500 hover:bg-red-50 hover:text-red-600 flex items-center justify-center" aria-label="Shoot verwijderen"><Trash2 className="h-4 w-4" /></button>}
          </div>
        )}
      </div>

      {/* Briefing */}
      <section className="card-base space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h2 className="font-semibold">Briefing</h2>
            <p className="text-xs text-gray-500">Typ, spreek in of plak wat er gaat gebeuren, of voeg het document toe. Daarna zet de app het plan klaar; jij kijkt het na.</p>
          </div>
          <DicteerKnop zet={(f) => setPlan((p) => ({ ...p, briefing: f(p.briefing) }))} context={[klant?.company_name, 'shootbriefing'].filter(Boolean).join(' · ')} />
        </div>
        <textarea rows={7} className={INP} value={plan.briefing} onChange={(e) => zet({ briefing: e.target.value })}
          placeholder={'bv. Zaterdag 28 november shoot voor Bakkerij Peeters. 9u opbouw in de winkel op de Markt in Hasselt, 10u interview met Jan (zaakvoerder), 12u30 productshots in het atelier in Genk. Bram regie, Chiara foto. Model brengt eigen kleding mee.'} />
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={bestandInvoer} type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void kiesBestand(f) }} />
          {bestand ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white pl-3 pr-1 py-1 text-xs max-w-full">
              <Paperclip className="h-3.5 w-3.5 text-gray-400 shrink-0" /><span className="truncate max-w-[16rem]">{bestand.naam}</span>
              <a href={`/api/admin/shoots/upload?pad=${encodeURIComponent(bestand.pad)}`} target="_blank" rel="noopener noreferrer" className="h-6 w-6 rounded-full hover:bg-gray-100 flex items-center justify-center" aria-label="Document bekijken"><Eye className="h-3.5 w-3.5" /></a>
              <button type="button" onClick={() => setBestand(null)} className="h-6 w-6 rounded-full hover:bg-gray-100 flex items-center justify-center" aria-label="Document weghalen"><X className="h-3.5 w-3.5" /></button>
            </span>
          ) : (
            <button type="button" onClick={() => bestandInvoer.current?.click()} disabled={bezig === 'upload'} className="btn-secondary text-sm">
              {bezig === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}Document toevoegen
            </button>
          )}
          <div className="flex-1" />
          {magAanpassen && (
            <button type="button" onClick={maakPlan} disabled={!!bezig || (!plan.briefing.trim() && !leesbaarBestand)} className="btn-primary text-sm">
              {bezig === 'ai' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{bezig === 'ai' ? 'Plan maken…' : 'Plan maken uit de briefing'}
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-500">Pdf, foto, Word (.docx) of tekst, tot 25 MB. De tekst uit een Word-document komt hierboven bij de briefing. De briefing ziet de klant ook bij Social media in de klantapp.</p>
      </section>

      {/* Wat nog ontbreekt */}
      {(nog.length > 0 || onduidelijk.length > 0) && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950 space-y-1.5">
          <div className="font-medium flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" />Nog aan te vullen</div>
          <ul className="list-disc pl-5 space-y-0.5 text-[13px]">
            {nog.map((x) => <li key={x}>{x}</li>)}
            {onduidelijk.map((x) => <li key={`ai-${x}`}>{x} <span className="text-amber-700">(uit de briefing)</span></li>)}
          </ul>
        </section>
      )}

      {/* Algemeen */}
      <section className="card-base space-y-3">
        <h2 className="font-semibold">Algemeen</h2>
        <div className="grid sm:grid-cols-[1fr_11rem_10rem] gap-3">
          <div>
            <label className={LBL}>Klant</label>
            <KlantKiezer id="shoot-klant" klanten={klanten} waarde={klantId} onKies={(k) => setKlantId(k?.id ?? '')} onNieuw={(k) => setKlanten((l) => [...(l ?? []), k])} bron="shoot" />
          </div>
          <div>
            <label className={LBL} htmlFor="shoot-datum">Datum</label>
            <input id="shoot-datum" type="date" className={INP} value={plan.datum} onChange={(e) => zet({ datum: e.target.value })} />
          </div>
          <div>
            <label className={LBL} htmlFor="shoot-status">Status</label>
            <select id="shoot-status" className={INP} value={plan.status} onChange={(e) => zet({ status: e.target.value as ShootStatus })}>
              {SHOOT_STATUSSEN.map((s) => <option key={s} value={s}>{STATUS_INFO[s].label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className={LBL} htmlFor="shoot-titel">Titel <span className="text-gray-400">(optioneel)</span></label>
          <input id="shoot-titel" className={INP} value={plan.titel} onChange={(e) => zet({ titel: e.target.value })} placeholder={`bv. Bedrijfsvideo ${klant?.company_name ?? 'klant'}`} />
        </div>
        <div>
          <label className={LBL} htmlFor="shoot-doel">Waarover gaat de shoot</label>
          <textarea id="shoot-doel" rows={2} className={INP} value={plan.doel} onChange={(e) => zet({ doel: e.target.value })} placeholder="Wat maken we en wat moet er klaar zijn?" />
        </div>
      </section>

      {/* Programma */}
      <section className="card-base space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold flex-1 flex items-center gap-2"><Clock className="h-4 w-4 text-gray-400" />Programma</h2>
          <button type="button" onClick={() => setPlan((p) => ({ ...p, programma: [...p.programma, leegPunt(volgendTijdstip(p.programma))] }))} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Tijdstip toevoegen</button>
        </div>
        {plan.programma.length === 0 && <p className="text-sm text-gray-500">Nog niets ingepland. Voeg een tijdstip toe of laat de app het plan maken uit de briefing. Een hele dag op meerdere plaatsen = een tijdstip per locatie (bv. 11:00 winkel, 12:30 atelier).</p>}
        <datalist id="shoot-locaties">{locatieNamen.map((n) => <option key={n} value={n} />)}</datalist>
        <ol className="space-y-2">
          {plan.programma.map((p) => (
            <li key={p.id} className="rounded-xl border border-gray-200 p-2.5 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <input type="time" aria-label="Van" className={`${INP} !w-[7.5rem]`} value={p.van} onChange={(e) => zetPunt(p.id, { van: e.target.value })} />
                <span className="text-xs text-gray-500">tot</span>
                <input type="time" aria-label="Tot" className={`${INP} !w-[7.5rem]`} value={p.tot} onChange={(e) => zetPunt(p.id, { tot: e.target.value })} />
                <div className="relative flex-1 min-w-[10rem]">
                  <MapPin className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input list="shoot-locaties" aria-label="Locatie" className={`${INP} !pl-7`} value={p.locatie} onChange={(e) => zetPunt(p.id, { locatie: e.target.value })} placeholder="Locatie" />
                </div>
                <button type="button" onClick={() => setPlan((x) => ({ ...x, programma: x.programma.filter((y) => y.id !== p.id) }))} className="h-8 w-8 rounded-full text-gray-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center" aria-label="Tijdstip weghalen"><Trash2 className="h-4 w-4" /></button>
              </div>
              <textarea rows={2} aria-label="Wat" className={INP} value={p.wat} onChange={(e) => zetPunt(p.id, { wat: e.target.value })} placeholder="Wat gebeurt er? bv. Interview met de zaakvoerder" />
              <input aria-label="Wie" className={INP} value={p.wie} onChange={(e) => zetPunt(p.id, { wie: e.target.value })} placeholder="Wie moet erbij zijn? bv. Bram, Chiara, de zaakvoerder" />
              {p.locatie.trim() && !plan.locaties.some((l) => l.naam.trim().toLowerCase() === p.locatie.trim().toLowerCase()) && (
                <p className="text-[11px] text-amber-800">
                  &quot;{p.locatie.trim()}&quot; staat nog niet bij de locaties.{' '}
                  <button type="button" onClick={() => setPlan((x) => ({ ...x, locaties: [...x.locaties, { ...leegeLocatie(), naam: p.locatie.trim() }] }))} className="underline font-medium">Toevoegen als locatie</button>
                </p>
              )}
            </li>
          ))}
        </ol>
        {plan.programma.length > 1 && <p className="text-[11px] text-gray-500">Bij het bewaren zet de app alles op volgorde van uur.</p>}
      </section>

      {/* Locaties */}
      <section className="card-base space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-semibold flex-1 flex items-center gap-2"><MapPin className="h-4 w-4 text-gray-400" />Locaties</h2>
          {!plan.locaties.some((l) => l.adres === KANTOOR.adres) && (
            <button type="button" onClick={() => setPlan((p) => ({ ...p, locaties: [...p.locaties, { ...leegeLocatie(), naam: KANTOOR.naam, adres: KANTOOR.adres }] }))} className="btn-secondary text-xs"><Building2 className="h-3.5 w-3.5" />Corda Campus</button>
          )}
          <button type="button" onClick={() => setPlan((p) => ({ ...p, locaties: [...p.locaties, leegeLocatie()] }))} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Locatie toevoegen</button>
        </div>
        {plan.locaties.length === 0 && <p className="text-sm text-gray-500">Nog geen locatie.</p>}
        {plan.locaties.map((l) => (
          <div key={l.id} className="rounded-xl border border-gray-200 p-3 space-y-2">
            <div className="grid sm:grid-cols-2 gap-2">
              <div><label className={LBL}>Naam</label><input className={INP} value={l.naam} onChange={(e) => zetLocatie(l.id, { naam: e.target.value })} placeholder="bv. Winkel Hasselt" /></div>
              <div><label className={LBL}>Adres</label><input className={INP} value={l.adres} onChange={(e) => zetLocatie(l.id, { adres: e.target.value })} placeholder="Straat nr, postcode gemeente" /></div>
              <div><label className={LBL}>Contact ter plaatse</label><input className={INP} value={l.contact} onChange={(e) => zetLocatie(l.id, { contact: e.target.value })} /></div>
              <div><label className={LBL}>Telefoon</label><input className={INP} type="tel" value={l.telefoon} onChange={(e) => zetLocatie(l.id, { telefoon: e.target.value })} /></div>
            </div>
            <div><label className={LBL}>Praktisch voor deze plek</label><textarea rows={2} className={INP} value={l.notitie} onChange={(e) => zetLocatie(l.id, { notitie: e.target.value })} placeholder="Parkeren, toegang, sleutel, stroom …" /></div>
            <div className="flex items-center gap-2">
              {l.adres && <a href={kaartLink(l.adres)} target="_blank" rel="noopener noreferrer" className="text-xs underline inline-flex items-center gap-1"><Navigation className="h-3 w-3" />Bekijk in Maps</a>}
              <div className="flex-1" />
              <button type="button" onClick={() => setPlan((p) => ({ ...p, locaties: p.locaties.filter((x) => x.id !== l.id) }))} className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1"><Trash2 className="h-3.5 w-3.5" />Weghalen</button>
            </div>
          </div>
        ))}
      </section>

      {/* Wie is erbij */}
      <section className="card-base space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-semibold flex-1 flex items-center gap-2"><Users className="h-4 w-4 text-gray-400" />Wie is erbij</h2>
          <button type="button" onClick={() => setPlan((p) => ({ ...p, betrokkenen: [...p.betrokkenen, leegPersoon()] }))} className="btn-secondary text-xs"><UserPlus className="h-3.5 w-3.5" />Persoon toevoegen</button>
        </div>
        {(teamTeKiezen.length > 0 || klantContact) && (
          <div className="flex flex-wrap gap-1.5">
            {teamTeKiezen.map((t) => (
              <button key={t.email || t.naam} type="button" onClick={() => voegPersoonToe({ naam: t.naam, rol: t.rol, email: t.email, telefoon: t.telefoon })} className="text-xs rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50 inline-flex items-center gap-1"><Plus className="h-3 w-3" />{t.naam}</button>
            ))}
            {klantContact && (
              <button type="button" onClick={() => voegPersoonToe({ naam: klantContact.contact_name || klantContact.company_name, rol: `Klant (${klantContact.company_name})`, email: klantContact.email ?? '', telefoon: '' })} className="text-xs rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50 inline-flex items-center gap-1"><Plus className="h-3 w-3" />Contact van {klantContact.company_name}</button>
            )}
          </div>
        )}
        {plan.betrokkenen.length === 0 && <p className="text-sm text-gray-500">Nog niemand. Iedereen met een e-mailadres kan je het plan sturen.</p>}
        <ul className="space-y-2">
          {plan.betrokkenen.map((b) => (
            <li key={b.id} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_1.3fr_1fr_2rem] gap-2 items-center rounded-xl border border-gray-100 sm:border-0 p-2 sm:p-0">
              <input aria-label="Naam" className={INP} value={b.naam} onChange={(e) => zetPersoon(b.id, { naam: e.target.value })} placeholder="Naam" />
              <input aria-label="Rol" className={INP} value={b.rol} onChange={(e) => zetPersoon(b.id, { rol: e.target.value })} placeholder="Rol (fotograaf, model …)" />
              <input aria-label="E-mail" type="email" className={INP} value={b.email} onChange={(e) => zetPersoon(b.id, { email: e.target.value })} placeholder="E-mail" />
              <input aria-label="Telefoon" type="tel" className={INP} value={b.telefoon} onChange={(e) => zetPersoon(b.id, { telefoon: e.target.value })} placeholder="Telefoon" />
              <button type="button" onClick={() => setPlan((p) => ({ ...p, betrokkenen: p.betrokkenen.filter((x) => x.id !== b.id) }))} className="h-8 w-8 rounded-full text-gray-400 hover:bg-red-50 hover:text-red-600 flex items-center justify-center justify-self-end" aria-label="Persoon weghalen"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      </section>

      {/* Shotlist, paklijst, praktisch */}
      <section className="card-base grid md:grid-cols-2 gap-3">
        <div>
          <label className={`${LBL} flex items-center gap-1.5`}><ListChecks className="h-3.5 w-3.5" />Shotlist <span className="text-gray-400 font-normal">(één per regel)</span></label>
          <textarea rows={6} className={INP} value={plan.shotlist.join('\n')} onChange={(e) => zet({ shotlist: e.target.value.split('\n') })} placeholder={'Sfeerbeeld van de winkel\nZaakvoerder aan het werk\nProduct close-ups'} />
        </div>
        <div>
          <label className={`${LBL} flex items-center gap-1.5`}><Backpack className="h-3.5 w-3.5" />Mee te nemen <span className="text-gray-400 font-normal">(één per regel)</span></label>
          <textarea rows={6} className={INP} value={plan.paklijst.join('\n')} onChange={(e) => zet({ paklijst: e.target.value.split('\n') })} placeholder={'Camera + 2 lenzen\nLampen en statieven\nMicrofoons'} />
        </div>
        <div className="md:col-span-2">
          <label className={`${LBL} flex items-center gap-1.5`}><Info className="h-3.5 w-3.5" />Praktisch</label>
          <textarea rows={3} className={INP} value={plan.praktisch} onChange={(e) => zet({ praktisch: e.target.value })} placeholder="Dresscode, catering, wat als het regent …" />
        </div>
      </section>

      {/* Verstuurd naar */}
      {verzonden.length > 0 && (
        <section className="card-base">
          <h2 className="font-semibold mb-2 flex items-center gap-2"><Send className="h-4 w-4 text-gray-400" />Verstuurd naar</h2>
          <ul className="divide-y divide-gray-100 text-sm">
            {verzonden.map((v) => (
              <li key={`${v.email}-${v.op}`} className="py-1.5 flex items-center gap-2 flex-wrap">
                <span className="flex-1 min-w-0 truncate">{v.naam ? <><span className="font-medium">{v.naam}</span> <span className="text-gray-500">· {v.email}</span></> : v.email}</span>
                <span className="text-xs text-gray-500">{new Date(v.op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}</span>
                {v.geopend_op ? <span className="text-[11px] rounded-full bg-green-50 text-green-800 border border-green-200 px-2">Geopend</span> : <span className="text-[11px] rounded-full bg-gray-100 text-gray-600 border border-gray-200 px-2">Nog niet geopend</span>}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-500 mt-2">Wie de link heeft, ziet altijd de laatste versie. Pas je iets belangrijks aan (uur, plaats), stuur dan gerust opnieuw.</p>
        </section>
      )}

      {/* Bewaren */}
      {magAanpassen && (
        <div className="sticky bottom-3 z-20">
          <div className="glas rounded-full px-3 py-2 flex items-center gap-3 w-fit ml-auto shadow-lg">
            <span className="text-xs text-gray-600 pl-1">{nieuw ? 'Nog niet aangemaakt' : vuil ? 'Niet bewaarde wijzigingen' : 'Alles bewaard'}</span>
            <button type="button" onClick={() => void bewaar()} disabled={!!bezig || (!vuil && !nieuw)} className="btn-primary text-sm">
              {bezig === 'bewaren' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{nieuw ? 'Shoot aanmaken' : 'Bewaren'}
            </button>
          </div>
        </div>
      )}

      {vraagWeg && (
        <Bevestig titel="Shoot verwijderen" gevaarlijk bezig={bezig === 'weg'} bevestigLabel="Verwijderen"
          tekst={<>De shoot verdwijnt uit de planner, de klantfiche en de klantapp. Links die al verstuurd werden, werken niet meer.</>}
          onBevestig={() => void verwijder()} onAnnuleer={() => setVraagWeg(false)} />
      )}
    </div>
  )
}
