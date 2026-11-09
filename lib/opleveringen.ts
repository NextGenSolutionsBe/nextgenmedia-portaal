// Opleveringen — pure module (client- en serverveilig).
//
// Alles wat we aan een klant opleveren, zonder WeTransfer: video's
// (aftermovies, promotievideo's, testimonials), grafisch ontwerp (logo, svg,
// pdf, drukwerk), foto's en documenten. De klant bekijkt, downloadt in volle
// kwaliteit, geeft feedback (bij video met tijdcodes, anders per bestand) en
// krijgt twee revisierondes:
// Eerste versie → Revisieronde 1 → Revisieronde 2 → Finale versie.
//
// De bestanden staan maar 3 dagen in de app (wij hebben altijd een backup op
// onze harde schijven); daarna haalt de scheduler ze weg. De gegevens
// (versies, feedback) blijven. Socialemediacontent loopt via Metricool, niet hier.

export const BEWAARTERMIJN_DAGEN = 3
export const MAX_REVISIES_STANDAARD = 2
/** Grootte per bestand (ook 4K). De globale limiet van de opslag moet minstens zo hoog staan. */
export const MAX_BESTAND = 50 * 1024 * 1024 * 1024

const DAG = 86_400_000

export type Versie = {
  id: string
  nummer: number
  is_finaal: boolean
  bericht: string | null
  gepubliceerd_op: string | null
  verloopt_op: string | null
  verwijderd_op: string | null
}
/** Een opmerking: bij video met tijdcode, bij andere bestanden over één bestand (de naam). */
export type FeedbackPunt = { tijd: number | null; tekst: string; bestand?: string | null }

/** Wat leveren we op? Bepaalt de teksten, het voorbeeld en of feedback met tijdcodes gaat. */
export type OpleveringSoort = 'video' | 'ontwerp' | 'foto' | 'document'
export const OPLEVERING_SOORTEN: { key: OpleveringSoort; label: string; uitleg: string; voorbeeld: string; feedbackVoorbeeld: string }[] = [
  { key: 'video', label: 'Video', uitleg: "Aftermovies, promotievideo's, testimonials. Ook 4K.", voorbeeld: 'Aftermovie zomerfeest', feedbackVoorbeeld: 'bv. muziek iets zachter, logo op het einde groter' },
  { key: 'ontwerp', label: 'Grafisch ontwerp', uitleg: 'Logo, huisstijl, flyers, drukwerk. Svg, pdf, png, ai, eps …', voorbeeld: 'Logo en huisstijl', feedbackVoorbeeld: 'bv. het blauw iets donkerder, de slogan kleiner' },
  { key: 'foto', label: "Foto's", uitleg: "Fotoshoot, productfoto's, portretten. Jpg, png, raw …", voorbeeld: 'Fotoshoot kantoor', feedbackVoorbeeld: 'bv. foto 12 iets lichter, foto 4 mag weg' },
  { key: 'document', label: 'Documenten', uitleg: 'Teksten, presentaties, brandbooks. Pdf, docx, pptx, zip …', voorbeeld: 'Brandbook', feedbackVoorbeeld: 'bv. op pagina 3 de tweede alinea korter' },
]
export const soortVan = (v: unknown): OpleveringSoort => (OPLEVERING_SOORTEN.some((s) => s.key === v) ? v as OpleveringSoort : 'video')
export const soortInfo = (v: unknown) => OPLEVERING_SOORTEN.find((s) => s.key === soortVan(v))!
export type FeedbackSoort = 'revisie' | 'goedkeuring' | 'opmerking'
export type Feedback = {
  id: string
  versie_id: string
  soort: FeedbackSoort
  ronde: number | null
  tekst: string | null
  punten: FeedbackPunt[]
  door_naam: string | null
  created_at: string
}

/** Hoe de versie heet voor klant en team. */
export function versieLabel(v: Pick<Versie, 'nummer' | 'is_finaal'>): string {
  if (v.is_finaal) return 'Finale versie'
  if (v.nummer <= 1) return 'Eerste versie'
  return `Revisieronde ${v.nummer - 1}`
}

/** Revisierondes: hoeveel gebruikt, hoeveel over, welke ronde is de volgende. */
export function revisieStand(feedback: Pick<Feedback, 'soort'>[], max: number = MAX_REVISIES_STANDAARD): { gebruikt: number; over: number; volgende: number | null; max: number } {
  const gebruikt = feedback.filter((f) => f.soort === 'revisie').length
  const over = Math.max(0, max - gebruikt)
  return { gebruikt, over, volgende: over > 0 ? gebruikt + 1 : null, max }
}

export type Beschikbaarheid = { status: 'concept' | 'beschikbaar' | 'verlopen'; tot: string | null; resterendMs: number; tekst: string }

/** Kan de klant de bestanden van deze versie nog bekijken en downloaden? */
export function beschikbaarheid(v: Pick<Versie, 'gepubliceerd_op' | 'verloopt_op' | 'verwijderd_op'>, nu: Date = new Date()): Beschikbaarheid {
  if (!v.gepubliceerd_op) return { status: 'concept', tot: null, resterendMs: 0, tekst: 'Nog niet gedeeld' }
  const tot = v.verloopt_op ? new Date(v.verloopt_op).getTime() : new Date(v.gepubliceerd_op).getTime() + BEWAARTERMIJN_DAGEN * DAG
  const rest = tot - nu.getTime()
  if (v.verwijderd_op || rest <= 0) return { status: 'verlopen', tot: new Date(tot).toISOString(), resterendMs: 0, tekst: 'Niet meer beschikbaar' }
  return { status: 'beschikbaar', tot: new Date(tot).toISOString(), resterendMs: rest, tekst: `Nog ${resterend(rest)} beschikbaar` }
}

/** "2 dagen en 4 uur", "5 uur", "20 minuten". */
export function resterend(ms: number): string {
  const min = Math.max(1, Math.floor(ms / 60_000))
  const d = Math.floor(min / 1440), u = Math.floor((min % 1440) / 60)
  if (d >= 1) return u ? `${d} ${d === 1 ? 'dag' : 'dagen'} en ${u} uur` : `${d} ${d === 1 ? 'dag' : 'dagen'}`
  if (u >= 1) return `${u} uur`
  return `${min} ${min === 1 ? 'minuut' : 'minuten'}`
}

/** Vervaldatum bij publiceren of verlengen: 3 dagen vanaf nu. */
export const nieuweVervaldatum = (nu: Date = new Date()): string => new Date(nu.getTime() + BEWAARTERMIJN_DAGEN * DAG).toISOString()

export type OpleveringStatus = 'concept' | 'wacht_op_klant' | 'revisie_gevraagd' | 'goedgekeurd' | 'finaal'

export const STATUS_INFO: Record<OpleveringStatus, { klant: string; team: string; kleur: string }> = {
  concept: { klant: 'In voorbereiding', team: 'Concept: nog niet gedeeld', kleur: 'bg-gray-100 text-gray-700 border-gray-200' },
  wacht_op_klant: { klant: 'Nieuwe versie om te bekijken', team: 'Wacht op de klant', kleur: 'bg-blue-50 text-blue-800 border-blue-200' },
  revisie_gevraagd: { klant: 'Wij verwerken je feedback', team: 'Revisie gevraagd', kleur: 'bg-amber-50 text-amber-900 border-amber-200' },
  goedgekeurd: { klant: 'Goedgekeurd', team: 'Goedgekeurd', kleur: 'bg-green-50 text-green-800 border-green-200' },
  finaal: { klant: 'Finale versie klaar', team: 'Finale versie gedeeld', kleur: 'bg-[#166534] text-white border-[#166534]' },
}

/**
 * Waar staat de oplevering? Kijkt naar de laatst gedeelde versie en wat de
 * klant daarop antwoordde. Een nieuwe concept-versie (nog niet gedeeld) na
 * een revisievraag laat de status op "revisie gevraagd" staan.
 */
export function opleveringStatus(versies: Versie[], feedback: Pick<Feedback, 'versie_id' | 'soort'>[]): OpleveringStatus {
  const gedeeld = versies.filter((v) => v.gepubliceerd_op).sort((a, b) => b.nummer - a.nummer)
  const laatste = gedeeld[0]
  if (!laatste) return 'concept'
  if (laatste.is_finaal) return 'finaal'
  const opLaatste = feedback.filter((f) => f.versie_id === laatste.id)
  if (opLaatste.some((f) => f.soort === 'goedkeuring')) return 'goedgekeurd'
  if (opLaatste.some((f) => f.soort === 'revisie')) return 'revisie_gevraagd'
  return 'wacht_op_klant'
}

/** De versie waarop de klant nu kan reageren: de laatst gedeelde, als daar nog geen revisie of goedkeuring op kwam. */
export function actieveVersie(versies: Versie[], feedback: Pick<Feedback, 'versie_id' | 'soort'>[]): Versie | null {
  const laatste = versies.filter((v) => v.gepubliceerd_op).sort((a, b) => b.nummer - a.nummer)[0]
  if (!laatste) return null
  return feedback.some((f) => f.versie_id === laatste.id && (f.soort === 'revisie' || f.soort === 'goedkeuring')) ? null : laatste
}

/** Feedback van de klant nakijken. Een revisie of opmerking heeft tekst of minstens één punt nodig. */
export function valideerFeedback(b: Record<string, unknown>): { ok: true; waarde: { soort: FeedbackSoort; tekst: string | null; punten: FeedbackPunt[] } } | { ok: false; fout: string } {
  const soort = b.soort === 'revisie' || b.soort === 'goedkeuring' || b.soort === 'opmerking' ? b.soort : null
  if (!soort) return { ok: false, fout: 'Kies revisie, goedkeuren of opmerking.' }
  const tekst = String(b.tekst ?? '').trim().slice(0, 4000) || null
  const punten: FeedbackPunt[] = (Array.isArray(b.punten) ? b.punten : []).slice(0, 60).map((p) => {
    const r = (p ?? {}) as Record<string, unknown>
    const t = Number(r.tijd)
    const bestand = String(r.bestand ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const punt: FeedbackPunt = { tijd: r.tijd === null || r.tijd === undefined || r.tijd === '' || !Number.isFinite(t) || t < 0 ? null : Math.round(t * 10) / 10, tekst: String(r.tekst ?? '').trim().slice(0, 1000) }
    return bestand ? { ...punt, bestand } : punt
  }).filter((p) => p.tekst)
  if (soort !== 'goedkeuring' && !tekst && !punten.length) return { ok: false, fout: 'Schrijf wat er anders moet.' }
  return { ok: true, waarde: { soort, tekst, punten } }
}

/** 75.4 → "1:15"; 3725 → "1:02:05". */
export function tijdLabel(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return ''
  const s = Math.max(0, Math.floor(sec))
  const u = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  return u ? `${u}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

/** 1536 → "1,5 kB"; 4.2 GB, … */
export function grootteLabel(bytes: number | null | undefined): string {
  const b = Number(bytes) || 0
  if (b < 1024) return `${b} B`
  const eenheden = ['kB', 'MB', 'GB', 'TB']
  let x = b / 1024, i = 0
  while (x >= 1024 && i < eenheden.length - 1) { x /= 1024; i++ }
  return `${x.toLocaleString('nl-BE', { maximumFractionDigits: x < 10 ? 1 : 0 })} ${eenheden[i]}`
}

export type BestandSoort = 'video' | 'foto' | 'pdf' | 'ander'
// Foto's die elke browser zelf toont. Heic, tiff, raw en psd: enkel downloaden.
const TOONBAAR = /^image\/(jpeg|jpg|pjpeg|png|gif|webp|avif|bmp|svg\+xml)$/i
const extensie = (naam: string | null | undefined) => (String(naam ?? '').match(/\.([a-z0-9]{1,6})$/i)?.[1] ?? '').toLowerCase()
/** Hoe tonen we een bestand: video afspelen, foto tonen, pdf openen of enkel downloaden. */
export function bestandSoort(mime: string | null | undefined, naam?: string | null): BestandSoort {
  const m = String(mime ?? '')
  const ext = extensie(naam)
  const onbekend = !m || m === 'application/octet-stream'
  if (/^video\//.test(m) || (onbekend && ['mp4', 'mov', 'm4v', 'webm'].includes(ext))) return 'video'
  if (TOONBAAR.test(m) || (onbekend && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext))) return 'foto'
  if (m === 'application/pdf' || (onbekend && ext === 'pdf')) return 'pdf'
  return 'ander'
}

/** "SVG", "PDF", "PNG": het formaat als klein label bij een bestand. */
export function formaatLabel(naam: string | null | undefined, mime?: string | null): string {
  const ext = extensie(naam)
  if (ext) return ext === 'jpeg' ? 'JPG' : ext.toUpperCase()
  const m = String(mime ?? '').split('/')[1] ?? ''
  return m.replace(/^x-|\+xml$/g, '').slice(0, 5).toUpperCase()
}

/** Een veilige bestandsnaam voor in de opslag (de echte naam bewaren we apart, voor de download). */
export function veiligeNaam(naam: string): string {
  const s = naam.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  return (s || 'bestand').slice(-120)
}

/** Pad in de bucket: <oplevering>/<versie>/<uuid>-<naam>. */
export const bestandPad = (opleveringId: string, versieId: string, id: string, naam: string) => `${opleveringId}/${versieId}/${id}-${veiligeNaam(naam)}`
export const posterPad = (opleveringId: string, versieId: string, id: string) => `${opleveringId}/${versieId}/${id}-poster.jpg`

export type VolgendeStap = { tekst: string; dringend: boolean; klaar: boolean }

/**
 * Wat moet het team nu doen met deze oplevering? Eén korte zin voor de kaart
 * en het detail, zodat niemand moet uitzoeken waar het staat.
 */
export function volgendeStap(o: {
  status: OpleveringStatus
  versies: (Pick<Versie, 'nummer' | 'is_finaal' | 'gepubliceerd_op' | 'verloopt_op' | 'verwijderd_op'> & { bestanden_aantal: number })[]
  revisies: { over: number }
}, nu: Date = new Date()): VolgendeStap {
  const versies = [...o.versies].sort((a, b) => b.nummer - a.nummer)
  const laatste = versies[0]
  if (!laatste) return { tekst: 'Maak een eerste versie en laad de bestanden op', dringend: false, klaar: false }
  if (!laatste.gepubliceerd_op) {
    return laatste.bestanden_aantal > 0
      ? { tekst: `Deel ${versieLabel(laatste).toLowerCase()} met de klant`, dringend: o.status === 'revisie_gevraagd', klaar: false }
      : { tekst: `Laad de bestanden van ${versieLabel(laatste).toLowerCase()} op`, dringend: o.status === 'revisie_gevraagd', klaar: false }
  }
  const b = beschikbaarheid(laatste, nu)
  switch (o.status) {
    case 'revisie_gevraagd':
      return { tekst: `Verwerk de feedback en laad ${versieLabel({ nummer: laatste.nummer + 1, is_finaal: false }).toLowerCase()} op`, dringend: true, klaar: false }
    case 'goedgekeurd':
      return { tekst: 'Goedgekeurd: laad de finale versie op', dringend: false, klaar: false }
    case 'finaal':
      return b.status === 'beschikbaar'
        ? { tekst: `Klaar. De klant kan nog downloaden (${resterend(b.resterendMs)})`, dringend: false, klaar: true }
        : { tekst: 'Klaar. Archiveer de oplevering als alles binnen is', dringend: false, klaar: true }
    case 'wacht_op_klant':
      if (b.status === 'verlopen') return { tekst: 'Verlopen zonder reactie: verleng de link of contacteer de klant', dringend: true, klaar: false }
      return { tekst: `Wacht op de klant · nog ${resterend(b.resterendMs)}${o.revisies.over ? '' : ' · geen revisierondes meer'}`, dringend: b.resterendMs < DAG, klaar: false }
    default:
      return { tekst: 'Deel de eerste versie met de klant', dringend: false, klaar: false }
  }
}
