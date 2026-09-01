'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Loader2, X, Phone, Mail, Globe, SkipForward, CheckCircle2, Clock, Search,
  Building2, MapPin, Users, BadgeInfo, PhoneOff, AlertTriangle, ChevronDown, FileText,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { merkStijl } from '@/lib/sales/merk'
import { FOCUS_ACTIONS, stageLabel } from '@/lib/sales/stages'
import {
  bouwWachtrij, aftelLabel, terugbelMoment, leesTijdstip, isKlaarFase, TERUGBEL_KEUZES,
  MAX_GEEN_GEHOOR, GEEN_GEHOOR_UREN,
} from '@/lib/sales/focus-queue'
import { GEEN_INTERESSE_REDENEN, bouwReden } from '@/lib/sales/redenen'
import { kiesScript, sectieKleur, type ScriptAnalyse } from '@/lib/sales/script-analyse'

/**
 * Focus Mode — het belscherm, volledig scherm, gemodelleerd naar hoe een echt
 * beldialoogscherm (Steam Connect) werkt:
 *
 *   LINKS   alles over wie je aan de lijn hebt: nummers, links, bedrijf.
 *   MIDDEN  het belscript van de setter, door AI ingedeeld in gespreksdelen.
 *   RECHTS  bezwaren met reacties (openklapbaar) en de notitie.
 *   ONDER   de uitkomsten, met sneltoetsen 1–6.
 *
 * TERUGBELAFSPRAKEN. "Bel over een uur terug" haalt de lead uit de rij; ná dat
 * uur springt hij ALS EERSTE terug binnen (ook live, terwijl je zit te bellen —
 * de wachtrij herrekent elke halve minuut). De zijlijst toont wie er wanneer
 * terugkomt ("over 47 min").
 */

type Bedrijf = {
  name: string; website: string | null; sector: string | null; city: string | null
  phone: string | null; region?: string | null
  email?: string | null; werkklasse?: string | null; activiteit?: string | null
  ondernemingsnummer?: string | null; prioriteit?: string | null
  linkedin?: string | null; employees?: number | null
}
type Contact = {
  name: string | null; email: string | null; phone: string | null
  mobile: string | null; role: string | null; linkedin?: string | null
}
type Lead = {
  id: string; stage_key: string; do_not_call: boolean
  callback_at?: string | null; callback_note?: string | null
  /** Aantal keer vergeefs gebeld; bij MAX_GEEN_GEHOOR gaat de lead uit de rij. */
  geen_gehoor_count?: number | null
  sales_companies: Bedrijf | null
  sales_contacts: Contact | null
}

type ScriptRij = {
  id: string; naam: string; eigenaar_auth_id: string | null
  pipeline_id: string | null; actief: boolean; analyse: ScriptAnalyse | null
}

export function FocusMode({ leads, bezet = {}, pipelineId, merk, stageFilter, onClose, onChanged }: {
  leads: Lead[]
  /** Leads die een collega NU aan het bellen is (lead-id → naam). */
  bezet?: Record<string, string>
  pipelineId?: string | null
  /** Het merk waarin je aan het bellen bent — als badge in de kop, zodat
   *  iedereen op elk moment ziet: geel = NextGenMedia, blauw = NextGenSolutions. */
  merk?: { key: string; name: string } | null
  /** Het actieve fasefilter van het bord. Filtert iemand bewust op een
   *  afgeronde fase ("geen interesse" nog eens nabellen), dan slaan we die
   *  fase hier niet over — anders levert die keuze een lege belronde op. */
  stageFilter?: string
  onClose: () => void
  onChanged: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [gedaan, setGedaan] = useState<Set<string>>(() => new Set())
  // Lokale wijzigingen (terugbelmoment) zonder de hele lijst te herladen.
  const [lokaal, setLokaal] = useState<Map<string, Partial<Lead>>>(() => new Map())
  // Elke 30 s hertellen: aftellingen lopen en vervallen afspraken springen terug.
  const [nu, setNu] = useState(() => Date.now())
  const [redenOpen, setRedenOpen] = useState(false)
  const [script, setScript] = useState<{ naam: string; analyse: ScriptAnalyse } | null | 'laden'>('laden')
  // Alle scripts die deze setter mag gebruiken. Marco heeft er drie — één per
  // situatie (mooie website zonder socials, mét socials, geen website) — en
  // welke past weet je pas als je het bedrijf bekijkt. Vandaar een keuze
  // tijdens het bellen in plaats van één vast script.
  const [scriptKeuzes, setScriptKeuzes] = useState<{ naam: string; analyse: ScriptAnalyse }[]>([])
  const [openBezwaar, setOpenBezwaar] = useState<number | null>(null)
  // Vrij ingetypt terugbeltijdstip, bv. '14u30'.
  const [eigenTijd, setEigenTijd] = useState('')
  const doorlopen = useRef(0)
  // Ankers voor de springlinks naar de scriptsecties.
  const sectieRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    const t = setInterval(() => setNu(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  // Het script van deze setter ophalen; kiesScript kiest het meest specifieke.
  useEffect(() => {
    let weg = false
    ;(async () => {
      try {
        const r = await fetch('/api/admin/sales/scripts')
        const j = await r.json()
        if (weg || !r.ok) { if (!weg) setScript(null); return }
        const scripts = (j.scripts ?? []) as ScriptRij[]
        const mij = String(j.mijnAuthId ?? '')
        // Alles wat voor mij bruikbaar is: eigen scripts en algemene, van dit
        // merk of van alle merken. Zelfde regels als kiesScript, maar dan de
        // hele lijst in plaats van enkel de beste.
        const bruikbaar = scripts.filter((x) =>
          x.actief && x.analyse
          && (x.eigenaar_auth_id === mij || x.eigenaar_auth_id === null)
          && (x.pipeline_id === null || x.pipeline_id === (pipelineId ?? null)))
          .map((x) => ({ naam: x.naam, analyse: x.analyse as ScriptAnalyse }))
        setScriptKeuzes(bruikbaar)

        const i = kiesScript(scripts, mij, pipelineId ?? null)
        const s = i >= 0 ? scripts[i] : null
        // Het beste script staat klaar; bruikbaar[0] als terugval zodat er
        // altijd íets getoond wordt wanneer er scripts zijn.
        setScript(s?.analyse ? { naam: s.naam, analyse: s.analyse } : (bruikbaar[0] ?? null))
      } catch { if (!weg) setScript(null) }
    })()
    return () => { weg = true }
  }, [pipelineId])

  /**
   * Leads die een collega vasthoudt vallen uit de wachtrij. Twee bronnen:
   * `bezet` (stand bij het openen) en `zelfBezet` (wat we tijdens het bellen
   * tegenkomen). Ze verdwijnen dus zonder dat je het merkt — precies de
   * bedoeling: je krijgt gewoon de volgende die wél vrij is.
   */
  const [zelfBezet, setZelfBezet] = useState<Map<string, string>>(() => new Map())
  const isBezet = useCallback(
    (id: string) => !!bezet[id] || zelfBezet.has(id),
    [bezet, zelfBezet],
  )

  const metLokaal = useMemo(
    () => leads
      .filter((l) => !gedaan.has(l.id) && !isBezet(l.id))
      .map((l) => ({ ...l, ...(lokaal.get(l.id) ?? {}) })),
    [leads, gedaan, lokaal, isBezet],
  )
  const wachtrij = useMemo(
    () => bouwWachtrij(
      metLokaal.map((l) => ({ ...l, callback_at: l.callback_at ?? null })),
      nu,
      { klaarOverslaan: !(stageFilter && isKlaarFase(stageFilter)) },
    ),
    [metLokaal, nu, stageFilter],
  )

  // De huidige lead staat VAST tot er een uitkomst gekozen is. Zonder dit zou
  // een terugbelafspraak die tijdens je gesprek vervalt de lead onder je neus
  // wegwisselen — hij hoort als VOLGENDE binnen te komen, niet middenin.
  const [vastId, setVastId] = useState<string | null>(null)
  const lead = (vastId && wachtrij.nu.find((l) => l.id === vastId)) || wachtrij.nu[0]
  useEffect(() => {
    if (lead && lead.id !== vastId) setVastId(lead.id)
    if (!lead && vastId) setVastId(null)
  }, [lead, vastId])

  /**
   * Deze lead voor mij vastzetten zolang ik ermee bezig ben.
   *
   * Lukt het niet, dan is een collega hem net voor: we markeren hem als bezet
   * en de wachtrij schuift vanzelf door naar de volgende. De hartslag
   * vernieuwt het slot elke minuut; klapt de browser dicht, dan verloopt het
   * na drie minuten vanzelf en kan de ander verder.
   */
  const huidigeId = lead?.id ?? null
  useEffect(() => {
    if (!huidigeId) return
    let weg = false

    const claim = async () => {
      try {
        const r = await fetch('/api/admin/sales/leads/claim', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadId: huidigeId }),
        })
        if (weg) return
        if (r.status === 409) {
          const j = await r.json().catch(() => ({}))
          setZelfBezet((m) => new Map(m).set(huidigeId, j.bezetDoor ?? 'een collega'))
          toast.info(`${j.bezetDoor ?? 'Een collega'} is deze prospect net aan het bellen — je krijgt de volgende.`)
        }
      } catch { /* netwerk hapert: doorbellen is belangrijker dan het slot */ }
    }
    claim()
    const klok = setInterval(claim, 60_000)

    return () => {
      weg = true
      clearInterval(klok)
      // Slot loslaten zodra je verdergaat. `keepalive` zorgt dat dit ook nog
      // vertrekt als het tabblad meteen daarna sluit; lukt het toch niet, dan
      // regelt de vervaltijd van drie minuten het.
      fetch(`/api/admin/sales/leads/claim?leadId=${huidigeId}`, { method: 'DELETE', keepalive: true })
        .catch(() => { /* vervaltijd vangt dit op */ })
    }
  }, [huidigeId])
  const bedrijf = lead?.sales_companies
  const contact = lead?.sales_contacts

  // Meelezen terwijl je typt: "14u30" → "over 2 u 15". Zo zie je meteen of de
  // app hetzelfde begrijpt als wat je bedoelt, vóór je op Zet klikt.
  const eigenTijdVoorbeeld = useMemo(() => {
    if (!eigenTijd.trim()) return null
    const m = leesTijdstip(eigenTijd, nu)
    if (m === null) return 'niet begrepen'
    const wanneer = new Date(m).toLocaleString('nl-BE', {
      weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels',
    })
    return `${wanneer} · ${aftelLabel(new Date(m).toISOString(), nu)}`
  }, [eigenTijd, nu])

  const volgende = useCallback((id: string) => {
    setNote('')
    setOpenBezwaar(null)
    doorlopen.current += 1
    setGedaan((s) => new Set(s).add(id))
  }, [])

  /** PATCH op de huidige lead; bij succes door naar de volgende. */
  const stuur = useCallback(async (body: Record<string, unknown>, blijf = false) => {
    if (!lead || busy) return false
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/sales/leads/${lead.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      onChanged()
      if (!blijf) volgende(lead.id)
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
      return false
    } finally { setBusy(false) }
  }, [lead, busy, onChanged, volgende])

  const actie = useCallback(async (key: string) => {
    if (!lead || busy) return
    const a = FOCUS_ACTIONS.find((x) => x.key === key)
    if (!a) return
    if (a.opensBooking) {
      // Het boekscherm is een andere pagina; dit scherm verdwijnt. Wat er in
      // het notitieveld staat zou anders stil verloren gaan — eerst loggen.
      if (note.trim()) {
        await stuur({ noteKind: 'call', note: note.trim() }, true)
      }
      router.push(`/admin/sales/appointments?lead=${lead.id}`)
      return
    }
    // "Geen interesse" vraagt altijd een reden: daar draait de statistiek op.
    if (a.stage === 'not_interested') { setRedenOpen(true); return }

    const body: Record<string, unknown> = { noteKind: 'call', note: note.trim() || a.label }

    /**
     * "Geen antwoord" laat de server tellen en het terugbelmoment zetten
     * (25 uur later, zodat je niet elke dag op hetzelfde uur belt). Na zes
     * vergeefse pogingen gaat de lead naar "Max. belpogingen" en uit de rij.
     * Fase en terugbelmoment komen dan van de server, dus die zetten we hier
     * bewust niet — anders schrijven we zijn beslissing weer over.
     */
    if (a.key === '1') {
      body.geen_gehoor = true
      const gelukt = await stuur(body)
      if (gelukt) {
        const pogingen = (lead.geen_gehoor_count ?? 0) + 1
        toast.info(pogingen >= MAX_GEEN_GEHOOR
          ? `${pogingen}× geen gehoor — deze staat nu op "Max. belpogingen".`
          : `Geen gehoor (${pogingen}/${MAX_GEEN_GEHOOR}) — komt over ${GEEN_GEHOOR_UREN} uur terug.`)
      }
      return
    }

    if (a.stage && a.stage !== lead.stage_key) body.stage = a.stage
    // Een afgehandelde terugbelafspraak moet gewist worden — anders blijft
    // deze lead voor altijd als "te laat" vooraan in elke volgende belronde.
    if (lead.callback_at) body.callback_at = null
    await stuur(body)
  }, [lead, busy, note, router, stuur])

  /** Terugbelafspraak: moment zetten, loggen, en de lead lokaal verplaatsen
   *  zodat hij meteen in de wachtlijst verschijnt (en straks terug opspringt). */
  const zetTerugbel = useCallback(async (omMs: number, label: string) => {
    if (!lead) return
    const om = new Date(omMs).toISOString()
    const notitie = note.trim()
    const okGelukt = await stuur({
      callback_at: om,
      callback_note: notitie || null,
      noteKind: 'call',
      note: `Terugbelafspraak (${label})${notitie ? ` — ${notitie}` : ''}`,
    }, true)
    if (okGelukt) {
      setLokaal((m) => new Map(m).set(lead.id, { callback_at: om, callback_note: notitie || null }))
      setNote('')
      setOpenBezwaar(null)
      doorlopen.current += 1
      setEigenTijd('')
      toast.success(`Komt terug ${aftelLabel(om, Date.now())}`)
    }
  }, [lead, note, stuur])

  /** Snelknop: "over zoveel minuten" (of morgen 9u bij -1). */
  const terugbellen = useCallback(
    (minuten: number, label: string) => zetTerugbel(terugbelMoment(minuten, Date.now()), label),
    [zetTerugbel],
  )

  /** Vrij ingetypt tijdstip, bv. "14u30" of "+45". */
  const opEigenTijd = useCallback(() => {
    const moment = leesTijdstip(eigenTijd, Date.now())
    if (moment === null) {
      toast.error('Dat tijdstip begrijp ik niet. Probeer "14u30", "9:00" of "+45".')
      return
    }
    return zetTerugbel(moment, aftelLabel(new Date(moment).toISOString(), Date.now()))
  }, [eigenTijd, zetTerugbel])

  const geenInteresse = useCallback(async (reden: string, toelichting: string) => {
    const lostReason = bouwReden(reden, toelichting)
    if (!lostReason) return
    const okGelukt = await stuur({
      stage: 'not_interested',
      lost_reason: lostReason,
      // Ook hier de terugbelafspraak opruimen: wie afhaakt, wordt niet meer gebeld.
      ...(lead?.callback_at ? { callback_at: null } : {}),
      noteKind: 'call',
      note: `Geen interesse — ${lostReason}${note.trim() ? ` · ${note.trim()}` : ''}`,
    })
    if (okGelukt) setRedenOpen(false)
  }, [stuur, note, lead])

  // Sneltoetsen — niet terwijl je typt of terwijl de redenkiezer open staat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (redenOpen) { if (e.key === 'Escape') setRedenOpen(false); return }
      if (e.key === 'Escape') { onClose(); return }
      if (FOCUS_ACTIONS.some((a) => a.key === e.key)) { e.preventDefault(); void actie(e.key) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [actie, onClose, redenOpen])

  // ── Klaar ──────────────────────────────────────────────────────────────────
  if (!lead) {
    const wachtend = wachtrij.later.length
    return (
      <div className="fixed inset-0 z-50 bg-white flex items-center justify-center p-6">
        <div className="text-center space-y-3 max-w-md">
          <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
          <h2 className="text-xl font-bold">Lijst afgewerkt</h2>
          <p className="text-sm text-gray-600">
            Je hebt {doorlopen.current} lead(s) doorlopen.
            {wachtend > 0 && (
              <> Er {wachtend === 1 ? 'wacht nog 1 terugbelafspraak' : `wachten nog ${wachtend} terugbelafspraken`} —
              de eerstvolgende {aftelLabel(wachtrij.later[0].callback_at!, nu)}. Laat dit scherm open, dan springt hij er vanzelf in.</>
            )}
          </p>
          <button onClick={onClose} className="btn-primary">Terug naar de pipeline</button>
        </div>
      </div>
    )
  }

  const telefoons = [
    { label: 'Rechtstreeks', nummer: contact?.mobile || contact?.phone || null },
    { label: 'Algemeen', nummer: bedrijf?.phone || null },
  ].filter((t) => t.nummer)
  const zoek = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`
  const isTeLaat = !!lead.callback_at && new Date(lead.callback_at).getTime() <= nu

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 flex flex-col">
      {/* Gekleurde bovenrand: het merk waarin je werkt, altijd in beeld. */}
      {merk && <div className={`h-1 shrink-0 ${merkStijl(merk.key).balk}`} />}
      {/* ── Kop ── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-3 min-w-0">
          {merk && (
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full border shrink-0 ${merkStijl(merk.key).badge}`}>
              {merk.name}
            </span>
          )}
          <span className="text-sm text-gray-500 shrink-0">
            Nog <b className="text-gray-900">{wachtrij.nu.length}</b> te bellen
          </span>
          {isTeLaat && (
            <span className="text-xs font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full shrink-0 flex items-center gap-1">
              <Clock className="h-3 w-3" />Terugbelafspraak — nu bellen
            </span>
          )}
          {wachtrij.later.length > 0 && (
            <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full shrink-0">
              {wachtrij.later.length} wachtend · eerstvolgende {aftelLabel(wachtrij.later[0].callback_at!, nu)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => volgende(lead.id)} className="btn-secondary text-sm">
            <SkipForward className="h-4 w-4" />Overslaan
          </button>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Drie kolommen ── */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[300px_1fr_320px]">

        {/* LINKS — wie heb je aan de lijn */}
        <div className="overflow-y-auto border-r border-gray-200 bg-white p-4 space-y-4">
          <div>
            <div className="flex items-start justify-between gap-2">
              <h1 className="text-xl font-bold leading-tight">{bedrijf?.name ?? 'Onbekend bedrijf'}</h1>
              {bedrijf?.prioriteit && (
                <span className="text-[10px] font-bold bg-[#fff848] text-black px-1.5 py-0.5 rounded shrink-0">
                  {bedrijf.prioriteit}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-700 mt-1 font-medium">
              {[contact?.name, contact?.role].filter(Boolean).join(' · ') || 'Geen contactpersoon'}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">{stageLabel(lead.stage_key)}</p>
          </div>

          {/* Nummers: groot en klikbaar, met label — je moet ZIEN of je de
              zaakvoerder rechtstreeks belt of de receptie. */}
          <div className="space-y-1.5">
            {telefoons.length === 0 && (
              <p className="text-sm text-gray-400 flex items-center gap-2"><Phone className="h-4 w-4" />Geen telefoonnummer</p>
            )}
            {telefoons.map((t) => (
              <a key={t.label} href={`tel:${t.nummer}`} className="block group">
                <span className="text-[10px] uppercase tracking-wide text-gray-400">{t.label}</span>
                <span className="flex items-center gap-2 text-lg font-semibold group-hover:underline">
                  <Phone className="h-4 w-4 text-gray-400" />{t.nummer}
                </span>
              </a>
            ))}
          </div>

          <div className="space-y-1 text-sm">
            {contact?.email && (
              <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 text-gray-600 hover:text-black truncate">
                <Mail className="h-3.5 w-3.5 text-gray-400 shrink-0" />{contact.email}
              </a>
            )}
            {bedrijf?.email && bedrijf.email !== contact?.email && (
              <a href={`mailto:${bedrijf.email}`} className="flex items-center gap-1.5 text-gray-500 hover:text-black truncate">
                <Mail className="h-3.5 w-3.5 text-gray-300 shrink-0" />{bedrijf.email} <span className="text-gray-300">(algemeen)</span>
              </a>
            )}
          </div>

          {/* Opzoeklinks, zoals de knopjes in Steam. */}
          <div className="flex flex-wrap gap-1.5">
            {bedrijf?.website && (
              <a href={bedrijf.website.startsWith('http') ? bedrijf.website : `https://${bedrijf.website}`}
                target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-1">
                <Globe className="h-3 w-3 text-gray-400" />Website
              </a>
            )}
            {/* Waarde uit een geïmporteerde lijst nooit rauw als href: alleen
                http(s) mag door, al de rest valt terug op de zoeklink. */}
            <a href={(contact?.linkedin ?? '').startsWith('http') ? contact!.linkedin! : zoek(`linkedin ${contact?.name ?? ''} ${bedrijf?.name ?? ''}`)}
              target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-1">
              <Search className="h-3 w-3 text-gray-400" />LinkedIn
            </a>
            {bedrijf?.ondernemingsnummer && (
              <a href={`https://kbopub.economie.fgov.be/kbopub/toonondernemingps.html?ondernemingsnummer=${bedrijf.ondernemingsnummer.replace(/\D/g, '')}`}
                target="_blank" rel="noreferrer" className="text-xs px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-1">
                <Building2 className="h-3 w-3 text-gray-400" />KBO
              </a>
            )}
          </div>

          <dl className="space-y-1.5 text-sm border-t border-gray-100 pt-3">
            {bedrijf?.sector && (
              <div className="flex items-start gap-1.5">
                <BadgeInfo className="h-3.5 w-3.5 text-gray-300 mt-0.5 shrink-0" />
                <span>{bedrijf.sector}</span>
              </div>
            )}
            {(bedrijf?.werkklasse || bedrijf?.employees) && (
              <div className="flex items-start gap-1.5">
                <Users className="h-3.5 w-3.5 text-gray-300 mt-0.5 shrink-0" />
                <span>{bedrijf.werkklasse ?? bedrijf.employees} werknemers</span>
              </div>
            )}
            {(bedrijf?.city || bedrijf?.region) && (
              <div className="flex items-start gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-gray-300 mt-0.5 shrink-0" />
                <span>{[bedrijf.city, bedrijf.region].filter(Boolean).join(', ')}</span>
              </div>
            )}
            {bedrijf?.activiteit && (
              <div className="text-xs text-gray-400 leading-snug pt-1">{bedrijf.activiteit}</div>
            )}
          </dl>

          {lead.callback_note && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-2.5 py-2">
              <b>Bij de terugbelafspraak:</b> {lead.callback_note}
            </div>
          )}

          {/* Wie komt er straks terug */}
          {wachtrij.later.length > 0 && (
            <div className="border-t border-gray-100 pt-3">
              <h3 className="text-[10px] uppercase tracking-wide text-gray-400 mb-1.5 flex items-center gap-1">
                <Clock className="h-3 w-3" />Komt terug in de rij
              </h3>
              <ul className="space-y-1">
                {wachtrij.later.slice(0, 6).map((l) => (
                  <li key={l.id} className="text-xs flex items-center justify-between gap-2">
                    <span className="truncate">{l.sales_companies?.name}</span>
                    <span className="text-gray-400 shrink-0 tabular-nums">{aftelLabel(l.callback_at!, nu)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* MIDDEN — het script */}
        <div className="overflow-y-auto p-5">
          {script === 'laden' ? (
            <div className="text-center text-gray-400 pt-16"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : script ? (
            <div className="max-w-2xl mx-auto space-y-4">
              {/* Meerdere scripts? Dan kies je hier welk gesprek je voert. Dat
                  hangt af van wat je op de website ziet, en dat weet je pas
                  wanneer de lead voor je staat — vandaar hier en niet vooraf. */}
              {scriptKeuzes.length > 1 && (
                <div className="sticky top-0 bg-gray-50 pt-1 pb-2 z-20">
                  <div className="flex flex-wrap gap-1">
                    {scriptKeuzes.map((k) => (
                      <button
                        key={k.naam}
                        onClick={() => setScript(k)}
                        title={k.naam}
                        className={cn(
                          'text-[11px] font-medium px-2 py-1 rounded-lg border transition-colors',
                          k.naam === script.naam
                            ? 'bg-[#fff848] border-yellow-400 text-gray-900'
                            : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300',
                        )}
                      >
                        {k.naam}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-2 sticky top-0 bg-gray-50 py-1 z-10">
                <p className="text-[10px] uppercase tracking-wide text-gray-400 flex items-center gap-1">
                  <FileText className="h-3 w-3" />{script.naam}
                </p>
                {/* Springlinks: bij een lang script wil je tijdens een gesprek
                    niet scrollen — één klik en je staat bij het juiste stuk. */}
                <div className="flex flex-wrap gap-1 justify-end">
                  {script.analyse.secties.map((s, i) => (
                    <button
                      key={`nav-${i}`}
                      onClick={() => sectieRefs.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className={cn(
                        'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border border-gray-200 hover:bg-white',
                        sectieKleur(s.kop),
                      )}
                    >
                      {s.kop.split(/[\s/]/)[0].slice(0, 10)}
                    </button>
                  ))}
                </div>
              </div>
              {script.analyse.secties.map((s, i) => (
                <section
                  key={`${i}-${s.kop}`}
                  ref={(el) => { sectieRefs.current[i] = el }}
                  className="scroll-mt-10"
                >
                  <h2 className={cn('text-sm font-bold uppercase tracking-wide mb-1.5', sectieKleur(s.kop))}>
                    {s.kop}
                  </h2>
                  <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{s.tekst}</div>
                </section>
              ))}
            </div>
          ) : (
            <div className="max-w-md mx-auto text-center pt-16 space-y-2">
              <FileText className="h-8 w-8 text-gray-300 mx-auto" />
              <p className="text-sm font-medium">Nog geen belscript</p>
              <p className="text-xs text-gray-500">
                Upload je script bij <a href="/admin/sales/scripts" className="underline">Belscripts</a> — dan staat het
                hier in het midden, met de bezwaren rechts.
              </p>
            </div>
          )}
        </div>

        {/* RECHTS — bezwaren, weetjes, notitie, terugbellen */}
        <div className="overflow-y-auto border-l border-gray-200 bg-white p-4 space-y-4">
          {script && script !== 'laden' && script.analyse.bezwaren.length > 0 && (
            <div>
              <h3 className="text-[10px] uppercase tracking-wide text-red-600 font-bold mb-1.5">Bezwaren</h3>
              <div className="space-y-1">
                {script.analyse.bezwaren.map((b, i) => (
                  <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      onClick={() => setOpenBezwaar(openBezwaar === i ? null : i)}
                      className="w-full text-left text-[13px] font-semibold px-2.5 py-1.5 hover:bg-gray-50 flex items-center justify-between gap-2"
                    >
                      <span>“{b.bezwaar}”</span>
                      <ChevronDown className={cn('h-3.5 w-3.5 text-gray-400 shrink-0 transition-transform', openBezwaar === i && 'rotate-180')} />
                    </button>
                    {openBezwaar === i && (
                      <div className="px-2.5 pb-2 text-[13px] leading-relaxed text-gray-700 whitespace-pre-wrap border-t border-gray-100 pt-1.5">
                        {b.reactie}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {script && script !== 'laden' && script.analyse.weetjes.length > 0 && (
            <div>
              <h3 className="text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-1.5">Snel opzoeken</h3>
              <ul className="space-y-1 text-xs text-gray-600 list-disc pl-4">
                {script.analyse.weetjes.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          <div>
            <label className="block text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-1">
              Notitie bij deze belpoging
            </label>
            <textarea rows={3} className="input-base text-sm" value={note} onChange={(e) => setNote(e.target.value)}
              placeholder="Wat is er gezegd?" />
          </div>

          <div>
            <h3 className="text-[10px] uppercase tracking-wide text-gray-400 font-bold mb-1.5 flex items-center gap-1">
              <Clock className="h-3 w-3" />Terugbellen
            </h3>
            <div className="grid grid-cols-3 gap-1.5">
              {TERUGBEL_KEUZES.map((k) => (
                <button key={k.label} onClick={() => terugbellen(k.minuten, k.label)} disabled={busy}
                  className="text-xs font-semibold px-2 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
                  {k.label}
                </button>
              ))}
            </div>

            {/* Vrij tijdstip — dít is wat een gesprek echt oplevert: "bel me
                om twee uur terug". Vaste knoppen dekken dat nooit. */}
            <div className="flex gap-1.5 mt-1.5">
              <input
                value={eigenTijd}
                onChange={(e) => setEigenTijd(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') opEigenTijd() }}
                placeholder="of: 14u30, 9:00, +45"
                className="input-base text-xs flex-1 min-w-0"
              />
              <button
                onClick={opEigenTijd}
                disabled={busy || !eigenTijd.trim()}
                className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40 shrink-0"
              >
                Zet
              </button>
            </div>
            {eigenTijdVoorbeeld && (
              <p className="text-[10px] text-gray-500 mt-1">→ {eigenTijdVoorbeeld}</p>
            )}
            <p className="text-[10px] text-gray-400 mt-1">
              De lead springt na dat moment als eerste terug in de rij. Je notitie gaat mee.
              Een uur dat al voorbij is, wordt morgen.
            </p>
          </div>

          <div className="border-t border-gray-100 pt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => stuur({ do_not_call: true, do_not_call_reason: note.trim() || 'Gevraagd tijdens gesprek', noteKind: 'call', note: 'Bel-me-niet gevraagd' })}
              disabled={busy}
              className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1 disabled:opacity-40"
            >
              <PhoneOff className="h-3 w-3" />Bel-me-niet
            </button>
            <button
              onClick={() => stuur({ archived: true, noteKind: 'note', note: 'Gearchiveerd: foutief telefoonnummer' })}
              disabled={busy}
              className="text-xs px-2 py-1 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 inline-flex items-center gap-1 disabled:opacity-40"
            >
              <AlertTriangle className="h-3 w-3" />Foutief nummer
            </button>
          </div>
        </div>
      </div>

      {/* ── Uitkomsten ── */}
      <div className="border-t border-gray-200 bg-white px-4 py-3">
        <div className="max-w-4xl mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1.5">
          {FOCUS_ACTIONS.map((a) => (
            <button key={a.key} onClick={() => actie(a.key)} disabled={busy}
              className={cn(
                'text-[13px] px-2.5 py-2 rounded-lg border text-left transition-colors disabled:opacity-40',
                a.opensBooking
                  ? 'border-[#fff848] bg-[#fff848]/30 hover:bg-[#fff848]/60 font-semibold'
                  : 'border-gray-200 hover:bg-gray-50',
              )}>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-gray-900 text-white text-[11px] font-bold mr-1.5">{a.key}</span>
              {a.label}
            </button>
          ))}
        </div>
        {busy && <div className="text-center mt-1.5"><Loader2 className="h-4 w-4 animate-spin mx-auto text-gray-400" /></div>}
      </div>

      {redenOpen && (
        <RedenKiezer
          busy={busy}
          onKies={geenInteresse}
          onSluit={() => setRedenOpen(false)}
        />
      )}
    </div>
  )
}

/** Waarom geen interesse? Vaste keuzes — daar draait de sectorstatistiek op. */
function RedenKiezer({ busy, onKies, onSluit }: {
  busy: boolean
  onKies: (reden: string, toelichting: string) => void
  onSluit: () => void
}) {
  const [reden, setReden] = useState<string>('')
  const [toelichting, setToelichting] = useState('')

  return (
    <div className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={onSluit}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold">Waarom geen interesse?</h3>
        <p className="text-xs text-gray-500">
          Hierop draait de statistiek — zo zien we per sector waarom het niet lukt.
        </p>
        <div className="space-y-1">
          {GEEN_INTERESSE_REDENEN.map((r) => (
            <label key={r} className={cn(
              'flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-lg border cursor-pointer',
              reden === r ? 'border-black bg-gray-50 font-medium' : 'border-gray-200 hover:bg-gray-50',
            )}>
              <input type="radio" name="reden" checked={reden === r} onChange={() => setReden(r)} className="accent-black" />
              {r}
            </label>
          ))}
        </div>
        {reden === 'Anders' && (
          <input
            autoFocus
            value={toelichting}
            onChange={(e) => setToelichting(e.target.value)}
            placeholder="Korte toelichting"
            className="input-base text-sm"
          />
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => reden && onKies(reden, toelichting)}
            disabled={!reden || busy}
            className="btn-primary flex-1 disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Vastleggen'}
          </button>
          <button onClick={onSluit} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}
