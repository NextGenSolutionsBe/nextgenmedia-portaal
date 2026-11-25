import { naamSleutel } from '@/lib/agenda/model'

/**
 * Een label voor een taak, uit de titel en waar ze staat. Gewone regels, geen
 * AI: meteen klaar, ook voor duizenden taken, en altijd hetzelfde antwoord.
 * Het blijft een voorstel: bij een nieuwe taak kan je het weghalen of een ander
 * kiezen. Bestaande labels worden nooit weggehaald, er komt er enkel een bij.
 */

export type Categorie = { naam: string; kleur: string }

/** De categorieën, in deze volgorde nagekeken. Bestaat er al een label met die naam (hoofdletters maken niet uit), dan wordt dat gebruikt. */
export const CATEGORIEEN: Categorie[] = [
  { naam: 'Persoonlijk', kleur: '#e7e5e4' },
  { naam: 'Algemene vergadering', kleur: '#64748b' },
  { naam: 'netwerkevent', kleur: '#f9a8d4' },
  { naam: 'juridisch', kleur: '#bbbbbb' },
  { naam: 'boekhouding', kleur: '#b6b6ff' },
  { naam: 'Personeel', kleur: '#f5d0fe' },
  { naam: 'Teamvergadering', kleur: '#8b5cf6' },
  { naam: 'Klantmeeting', kleur: '#10b981' },
  { naam: 'Lead', kleur: '#3b82f6' },
  { naam: 'contentshoot', kleur: '#f59e0b' },
  { naam: 'Advertenties', kleur: '#86efac' },
  { naam: 'Website', kleur: '#7dd3fc' },
  { naam: 'App & AI', kleur: '#c4b5fd' },
  { naam: 'Content', kleur: '#fdba74' },
  { naam: 'Opvolging', kleur: '#fde68a' },
  { naam: 'Kantoor', kleur: '#d9f99d' },
  { naam: 'Klantwerk', kleur: '#e5e7eb' },
  { naam: 'Intern', kleur: '#f3f4f6' },
]

export type LabelContext = {
  /** Namen van klanten in de app (company_name). */
  klanten: string[]
  /** Voornamen van het team (Bram, Marco, Chiara, Alida …). */
  team: string[]
}
export type LabelInvoer = {
  titel: string
  soort?: 'taak' | 'meeting'
  lijstNaam?: string | null
  mapNaam?: string | null
  /** De map of lijst hoort bij een klant. */
  bijKlant?: boolean
  /** Staat in iemands privélijst (bv. "Bram Privé"). */
  priveLijst?: boolean
}

const w = (...woorden: string[]) => new RegExp(`(^|[^a-z0-9à-ÿ])(${woorden.join('|')})`, 'i')
const R = {
  persoonlijk: w('tandarts', 'dokter', 'huisarts', 'kapper', 'verjaardag', 'mama', 'papa', 'sport\\b', 'fitness', 'gym\\b', 'lopen\\b', 'padel', 'grasmaaien', 'examen', 'scriptie', 'studeren', 'les\\b', 'vakantie', 'privé', 'prive\\b', 'gsm opruimen', 'boodschappen'),
  av: w('algemene vergadering', 'aandeelhoudersvergadering', 'aandeelhouders', 'vennotenoverleg', 'vennoten', 'zaakvoerdersoverleg', 'zaakvoerders(?:meeting| meeting|overleg)'),
  event: w('event', 'netwerk', 'voka', 'unizo', 'bni\\b', 'beurs', 'webinar', 'seminar', 'receptie', 'openhuizendag', 'opendeur', 'congres', 'gala', 'ondernemersevent', 'afterwork', 'netwerkontbijt', 'ontbijtsessie', 'lezing', 'conferentie', 'meetup'),
  juridisch: w('contract', 'nda\\b', 'overeenkomst', 'tegenteken', 'handtekening', 'ondertekenen', 'tekenen\\b', 'juridisch', 'advocaat', 'notaris', 'statuten', 'gdpr', 'privacyverklaring', 'algemene voorwaarden', 'vestiging', 'recht\\b', 'verdrag', 'aansprakelijk', 'verzekering', 'kbo\\b', 'ondernemingsloket'),
  boekhouding: w('factu', 'btw', 'boekhoud', 'creditnota', 'betaling', 'betalen', 'onkost', 'financi', 'aangifte', 'belasting', 'bankrekening', 'zakelijke rekening', 'bank\\b', 'kbc\\b', 'cashback', 'billing', 'budgetten', 'peppol', 'aflettering', 'loonbrief', 'kasticket', 'bonnetje', 'liquiditeit', 'cashflow', 'begroting', 'coda\\b'),
  personeel: w('stagi', 'stage\\b', 'stagetaken', 'sollicit', 'vacature', 'dimona', 'loon\\b', 'lonen', 'evaluatie', 'jobstudent', 'personeel', 'aanwerv', 'onboarding (?:medewerker|stagiair)', 'training document', 'functioneringsgesprek', 'contract medewerker', 'freelancer'),
  teamvergadering: w('teamvergadering', 'teammeeting', 'team meeting', 'weekmeeting', 'week meeting', 'weekly', 'standup', 'stand-up', 'bespreking team', 'teambespreking', 'intern overleg', 'interne meeting', 'bespreking nextgen', 'bespreking ngm', 'overleg ngm', 'meeting ngm', 'ngm meeting', 'kwartaalbespreking intern', 'brainstorm'),
  meeting: w('meeting', 'afspraak', 'call\\b', 'bespreking', 'overleg', 'kennismaking', 'intake', 'lunch', 'koffie', 'teams\\b', 'google meet', 'meet\\b', 'gesprek', 'samenzitten', 'langsgaan', 'bezoek'),
  lead: w('offerte', 'projectvoorstel', 'voorstel', 'pitch', 'cold call', 'cold callen', 'cold outreach', 'prospect', 'lead\\b', 'leads\\b', 'salesdocument', 'sales', 'demo\\b', 'prijs opmaken', 'prijzenlijst', 'prijsvoorstel', 'nieuwe klant'),
  shoot: w('shoot', 'contentshoot', 'fotoshoot', 'videoshoot', 'opnames', 'filmen', 'draaidag'),
  ads: w('ads\\b', 'adverten', 'campagne', 'meta ads', 'google ads', 'advertentiebudget', 'adsweet', 'boost', 'sponsored'),
  website: w('website', 'webflow', 'framer', 'wix\\b', 'seo\\b', 'domein', 'hosting', 'indexeren', 'landingspagina', 'webshop', 'wordpress', 'shopify'),
  app: w('app\\b', 'nextgenapp', 'automatis', 'ai\\b', 'prompt', 'claude', 'chatgpt', 'clickup', 'odoo', 'workflow', 'n8n', 'make\\.com', 'zapier', 'dashboard', 'api\\b', 'agent\\b'),
  content: w('contentkalender', 'content', 'post\\b', 'posts\\b', 'reel', 'story', 'stories', "story's", 'video', 'edit', 'montage', 'script', 'feed\\b', 'linkedin', 'instagram', 'tiktok', 'carrousel', 'carousel', 'aftermovie', 'testimonial', 'foto', 'grafisch', 'design', 'logo', 'huisstijl', 'branding', 'copy\\b', 'copy\'s', 'blog', 'nieuwsbrief', 'inplannen dec', 'thumbnail'),
  opvolging: w('bellen', 'terugbellen', 'mailen', 'mail\\b', 'mails\\b', 'sturen', 'opvolgen', 'opvolging', 'contacteren', 'antwoorden', 'beantwoorden', 'reminden', 'herinneren', 'navragen', 'vragen\\b', 'terugsturen', 'whatsapp', 'bericht'),
  kantoor: w('kantoor', 'corda', 'verhuis', 'inrichting', 'printer', 'materiaal', 'bestellen', 'harddrive', 'harde schijf', 'sd kaart', 'camera', 'microfoon', 'polo', 'merch', 'sleutel', 'parking', 'tankkaart', 'laptop'),
}

/** Komt een klantnaam (zonder rechtsvorm) in de titel voor? Korte namen (< 4 tekens) tellen niet: te veel valse treffers. */
export function klantInTitel(titel: string, klanten: string[]): boolean {
  const t = naamSleutel(titel)
  if (!t) return false
  for (const k of klanten) {
    const s = naamSleutel(k)
    if (s.length >= 4 && t.includes(s)) return true
  }
  return false
}
/**
 * Met wie is de afspraak? De woorden met een hoofdletter na "Meeting", "Afspraak" …
 * Allemaal teamleden (of geen namen, bv. "Meeting finaliseren app") = intern.
 */
function enkelTeam(titel: string, team: string[]): boolean {
  const rest = titel.replace(/^\s*(meeting|afspraak|call|bespreking|overleg|lunch(en)?( met)?)\s*[:\-–—]?\s*/i, '').replace(/next\s*gen\s*(media|solutions|agency)?|\bng[ms]\b/gi, ' ')
  const namen = (rest.match(/\b[A-ZÀ-Ý][a-zà-ÿ]{2,}/g) ?? []).filter((n) => !/^(Meeting|Afspraak|Bespreking|Overleg|Team|Intern|Interne|Week|Maand|Planning|Kantoor|Nextgen|Ngm|Ngs|App|Online|Teams|Google|Meet|Met|Over|Voor|Van|Bij|Op|En|De|Het|Een)$/i.test(n))
  const tl = new Set(team.map((x) => x.toLowerCase()))
  return namen.every((n) => tl.has(n.toLowerCase()))
}

/** De naam van het voorgestelde label (een van CATEGORIEEN). */
export function stelLabelVoor(i: LabelInvoer, c: LabelContext): string {
  const t = `${i.titel} `.toLowerCase()
  const lijst = `${i.mapNaam ?? ''} ${i.lijstNaam ?? ''}`.toLowerCase()
  // Een post, reel of story voor de socials is content, wat er ook in de titel staat.
  if (/^\s*(post|posts|story|stories|reel|reels|carrousel|carousel|video)\b/i.test(i.titel) || /\((meta|linkedin|tiktok|instagram|facebook|yt|youtube)\b/i.test(i.titel)) return 'Content'
  if (R.persoonlijk.test(t)) return 'Persoonlijk'
  if (R.av.test(t)) return 'Algemene vergadering'
  if (R.event.test(t)) return 'netwerkevent'
  if (R.juridisch.test(t)) return 'juridisch'
  if (R.personeel.test(t)) return 'Personeel'
  if (R.boekhouding.test(t) || /factu/.test(lijst)) return 'boekhouding'
  // Een afspraak: met het team, met een klant die we kennen, of anders iemand die (nog) geen klant is.
  if (R.teamvergadering.test(t)) return 'Teamvergadering'
  // Enkel de titel: in ClickUp is elke taak met een begin- en einduur een "meeting".
  if (R.meeting.test(t) || /meeting|afspraak/.test(t)) {
    if (klantInTitel(i.titel, c.klanten)) return 'Klantmeeting'
    if (enkelTeam(i.titel, c.team)) return i.bijKlant ? 'Klantmeeting' : 'Teamvergadering'
    if (i.bijKlant) return 'Klantmeeting'
    return 'Lead'
  }
  if (R.lead.test(t)) return 'Lead'
  if (R.shoot.test(t)) return 'contentshoot'
  if (R.ads.test(t) || /campaign/.test(lijst)) return 'Advertenties'
  if (R.website.test(t)) return 'Website'
  if (R.app.test(t) || /app-problemen|problemen/.test(lijst)) return 'App & AI'
  if (R.content.test(t) || /contentkalender/.test(lijst)) return 'Content'
  if (R.opvolging.test(t)) return 'Opvolging'
  if (R.kantoor.test(t)) return 'Kantoor'
  return i.priveLijst ? 'Persoonlijk' : i.bijKlant ? 'Klantwerk' : 'Intern'
}

/** Is dit label een van onze categorieën? (hoofdletters maken niet uit) */
export const isCategorie = (naam: string) => CATEGORIEEN.some((c) => c.naam.toLowerCase() === naam.trim().toLowerCase())

/** Onze eigen bedrijven tellen niet als klant (NextGenMedia, NextGenSolutions, Founders of Flanders …). */
export const isEigenBedrijf = (naam: string | null | undefined) => !!naam && /next\s*gen|founders of flanders|ngm\b|ngs\b/i.test(naam)
/** Klantnamen zonder onze eigen bedrijven. */
export const klantNamenVoorLabels = (namen: (string | null | undefined)[]) => namen.filter((n): n is string => !!n && !isEigenBedrijf(n))

/**
 * De invoer voor stelLabelVoor uit de boom: lijst, map (en of die bij een
 * klant hoort, eigen bedrijven niet) en of het iemands privélijst is.
 */
export function labelInvoerVoor(
  i: { titel: string; soort?: 'taak' | 'meeting'; lijst_id: string | null },
  b: { lijsten: { id: string; naam: string; map_id: string | null; client_id: string | null; space_id?: string | null }[]; mappen: { id: string; naam: string; client_id: string | null }[]; spaces?: { id: string; naam: string }[] },
): LabelInvoer {
  const l = i.lijst_id ? b.lijsten.find((x) => x.id === i.lijst_id) : undefined
  const m = l?.map_id ? b.mappen.find((x) => x.id === l.map_id) : undefined
  const sp = l?.space_id ? b.spaces?.find((x) => x.id === l.space_id) : undefined
  // Freelancers, stagiairs en de zaakvoerders zijn geen klanten.
  const eigen = isEigenBedrijf(m?.naam) || isEigenBedrijf(l?.naam) || /freelance|stagi|zaakvoerders|administratie/i.test(sp?.naam ?? '')
  return {
    titel: i.titel, soort: i.soort, lijstNaam: l?.naam ?? null, mapNaam: m?.naam ?? null,
    bijKlant: !eigen && !!(l?.client_id || m?.client_id || (m && !/priv[eé]|zaakvoerders|freelance|stagi/i.test(m.naam))),
    priveLijst: !!(m && /priv[eé]/i.test(m.naam)) || !!(l && /^priv[eé]$|^sport$/i.test(l.naam)),
  }
}
