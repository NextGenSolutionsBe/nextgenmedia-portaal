// Contractarchief en ondertekeningscertificaat — pure logica, testbaar.
//
// Bij elke definitieve ondertekening bewaren we een onveranderlijke kopie van
// het getekende contract mét een certificaat (wie, wanneer, van waar, welke
// vingerafdruk) in een aparte, afgeschermde opslag. Dit bestand bepaalt hoe
// dat dossier eruitziet; lib/contract-archief.ts doet het echte werk.

export type DossierGebeurtenis = {
  event_type: string
  created_at: string
  actor: string | null
  ip_address: string | null
  user_agent: string | null
}

export type Dossier = {
  contractId: string
  referentie: string
  /** Uniek certificaatnummer (NGM-CERT-JJJJ-00001), gereserveerd vóór het certificaat gemaakt wordt. */
  certificaatNr: string | null
  titel: string
  contractType: string | null
  /** De klant zoals gekend in de app (clients.company_name). */
  klantNaam: string | null
  /** Contactpersoon bij de klant (clients.contact_name), indien gekend. */
  contactNaam: string | null
  /** Ons bedrijf dat het contract afsloot (Instellingen → Bedrijfsgegevens). */
  bedrijfsnaam: string | null
  signerName: string | null
  signerEmail: string | null
  signedAt: string | null
  sentAt: string | null
  ipAdres: string | null
  userAgent: string | null
  startDatum: string | null
  eindDatum: string | null
  verwachtAantal: number | null
  verwachtBedragExcl: number | null
  frequentie: string | null
  gebeurtenissen: DossierGebeurtenis[]
  sha256Contract: string
  bron: string
  versie: number
  gearchiveerdOp: string
  app: string
}

export const TIJDZONE = 'Europe/Brussels'
export const TIJDZONE_LABEL = 'Europe/Brussels (CET/CEST)'

/** Menselijke referentie van een contract, dezelfde als op de ontvangstpagina. */
export const referentie = (contractId: string): string => `NGM-${contractId.slice(0, 8).toUpperCase()}`

/** Contractnummer zoals op het certificaat: referentie + volledig id. */
export const contractnummer = (contractId: string): string => `${referentie(contractId)} (${contractId})`

export const GEBEURTENIS_LABEL: Record<string, string> = {
  uploaded: 'Document geüpload',
  ai_analyzed: 'Document geanalyseerd',
  fields_edited: 'Invulvelden aangepast',
  template_created: 'Template aangemaakt',
  created_from_template: 'Aangemaakt uit template',
  token_regenerated: 'Nieuwe tekenlink aangemaakt',
  sent: 'Tekenlink verstuurd',
  opened: 'Geopend door de ondertekenaar',
  filled: 'Velden ingevuld door de ondertekenaar',
  signed: 'Ondertekend',
  pdf_generated: 'Getekende PDF aangemaakt',
  downloaded: 'Gedownload',
  downloaded_original: 'Origineel gedownload',
  downloaded_signed: 'Getekende versie gedownload',
  expired: 'Tekenlink verlopen',
  facturatie_opdrachten_aangemaakt: 'Facturatieopdrachten aangemaakt',
  facturatie_sync_ok: 'Facturatieopdracht in ClickUp gezet',
  facturatie_sync_mislukt: 'ClickUp-synchronisatie mislukt',
  facturatie_controle_vereist: 'Facturatie: controle vereist',
  facturatie_bevestigd: 'Factuurplanning bevestigd',
  facturatie_gestopt: 'Facturatie vroegtijdig gestopt',
  gearchiveerd: 'Gearchiveerd in het contractarchief',
  melding_verstuurd: 'Melding naar Legal verstuurd',
  melding_mislukt: 'Melding naar Legal mislukt',
}

export const gebeurtenisLabel = (t: string): string => GEBEURTENIS_LABEL[t] ?? t

/** Tijdstip in Brusselse tijd, seconde-precies: "14/09/2026 om 14:31:08". */
export function tijdstipBrussel(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const delen = new Intl.DateTimeFormat('nl-BE', {
    timeZone: TIJDZONE, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const v = (t: string) => delen.find((x) => x.type === t)?.value ?? ''
  return `${v('day')}/${v('month')}/${v('year')} om ${v('hour')}:${v('minute')}:${v('second')}`
}

/** Enkel de datum in Brusselse tijd, als "JJJJ-MM-DD" (voor bestandsnamen). */
export function datumBrusselIso(iso: string | null | undefined, terugval: Date = new Date()): string {
  const d = iso ? new Date(iso) : terugval
  const bron = Number.isNaN(d.getTime()) ? terugval : d
  const delen = new Intl.DateTimeFormat('nl-BE', { timeZone: TIJDZONE, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(bron)
  const v = (t: string) => delen.find((x) => x.type === t)?.value ?? ''
  return `${v('year')}-${v('month')}-${v('day')}`
}

/** Bestandsveilige naam: "contract-website-aanpassingen". */
export function veiligeNaam(s: string | null | undefined, terugval = 'contract'): string {
  const t = String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return (t || terugval).slice(0, 60)
}

/**
 * Eén deel van een bestandsnaam, veilig ASCII: accenten weg, alles wat geen
 * letter of cijfer is wordt een underscore. "Bakkerij Éclair & Zo" → "Bakkerij_Eclair_Zo".
 */
export function bestandsnaamDeel(s: string | null | undefined, terugval: string, max = 50): string {
  const t = String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return (t || terugval).slice(0, max).replace(/_+$/g, '')
}

export type DocumentSoort = 'getekend_contract' | 'certificaat' | 'origineel' | 'beide_zip' | 'beide_pdf'

const SOORT_PREFIX: Record<DocumentSoort, string> = {
  getekend_contract: 'Getekend_contract',
  certificaat: 'Ondertekeningscertificaat',
  origineel: 'Contract_origineel',
  beide_zip: 'Getekende_documenten',
  beide_pdf: 'Getekende_documenten',
}

/**
 * Bestandsnaam voor een download: "Getekend_contract_[klant]_[contract]_[JJJJ-MM-DD].pdf".
 * `datum` is de ondertekeningsdatum (ISO); zonder datum de dag van vandaag.
 */
export function documentBestandsnaam(soort: DocumentSoort, klantNaam: string | null | undefined, titel: string | null | undefined, datum: string | null | undefined, nu: Date = new Date()): string {
  const ext = soort === 'beide_zip' ? 'zip' : 'pdf'
  return `${SOORT_PREFIX[soort]}_${bestandsnaamDeel(klantNaam, 'Klant')}_${bestandsnaamDeel(titel, 'Contract')}_${datumBrusselIso(datum, nu)}.${ext}`
}

/**
 * Content-Disposition met een ASCII-naam én een RFC 5987 `filename*`, zodat
 * elke browser dezelfde naam gebruikt.
 */
export function contentDisposition(bestandsnaam: string, wijze: 'attachment' | 'inline' = 'attachment'): string {
  const ascii = bestandsnaam.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  return `${wijze}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(bestandsnaam)}`
}

/** Paden in de archiefbucket: per contract een map, per versie een submap. */
export function archiefPaden(contractId: string, versie: number): { contract: string; certificaat: string; dossier: string } {
  const basis = `${contractId}/v${versie}`
  return { contract: `${basis}/contract-getekend.pdf`, certificaat: `${basis}/certificaat.pdf`, dossier: `${basis}/dossier.json` }
}

/** Bestandsnaam voor de download van het certificaat (oude, korte vorm — voor het archief-ZIP). */
export function certificaatBestandsnaam(titel: string | null | undefined, contractId: string): string {
  return `certificaat-${veiligeNaam(titel)}-${referentie(contractId).toLowerCase()}.pdf`
}

/** SHA-256 in groepjes van 8 tekens, zodat je hem met het oog kunt vergelijken. */
export function vingerafdrukLeesbaar(hex: string): string {
  return (hex.match(/.{1,8}/g) ?? [hex]).join(' ')
}

/** Hoe er getekend werd, in mensentaal. */
export function wijzeVanOndertekenen(bron: string): string {
  return bron === 'upload_getekend' ? 'Opgeladen getekend document' : 'Digitale ondertekening via de tekenlink in de app'
}

export const STATUS_ONDERTEKEND = 'Succesvol ondertekend'
export const INTEGRITEITSZIN = 'De getekende versie van dit contract is sinds de ondertekening niet gewijzigd. De SHA-256-vingerafdruk hierboven is berekend op het definitieve getekende bestand; wie het bestand opnieuw hasht en dezelfde waarde bekomt, heeft het ongewijzigde origineel.'

export type CertificaatBlok = { kop: string; regels: [string, string][] }

/**
 * De inhoud van het certificaat, als blokken met label/waarde-regels. Los van
 * de PDF-opmaak zodat de inhoud te testen is en niet per ongeluk een veld
 * verliest bij een lay-outwijziging. IP-adres en toestel verschijnen enkel
 * wanneer ze effectief geregistreerd zijn.
 */
export function certificaatBlokken(d: Dossier): CertificaatBlok[] {
  const fmtBedrag = (n: number | null) => (n === null || n === undefined ? null : `€ ${n.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} excl. btw`)
  const facturatie: [string, string][] = []
  if (d.verwachtAantal || d.verwachtBedragExcl) {
    facturatie.push(['Verwachte facturatie', [d.verwachtAantal ? `${d.verwachtAantal}×` : null, fmtBedrag(d.verwachtBedragExcl), d.frequentie].filter(Boolean).join(' · ')])
  }
  const audit: [string, string][] = []
  if (d.ipAdres) audit.push(['IP-adres', d.ipAdres])
  if (d.userAgent) audit.push(['Toestel / browser', d.userAgent.slice(0, 160)])
  if (d.sentAt) audit.push(['Tekenlink verstuurd op', tijdstipBrussel(d.sentAt)])

  const blokken: CertificaatBlok[] = [
    { kop: 'Certificaat', regels: [
      ['Certificaatnummer', d.certificaatNr ?? '—'],
      ['Status', STATUS_ONDERTEKEND],
      ['Certificaat gegenereerd op', tijdstipBrussel(d.gearchiveerdOp)],
    ] },
    { kop: 'Contract', regels: [
      ['Titel', d.titel],
      ['Contractnummer', contractnummer(d.contractId)],
      ['Type', d.contractType ?? '—'],
      ['Klant', d.klantNaam ?? '—'],
      ...(d.contactNaam ? [['Contactpersoon', d.contactNaam] as [string, string]] : []),
      ['Bedrijf', d.bedrijfsnaam ?? '—'],
      ['Looptijd', [d.startDatum, d.eindDatum].filter(Boolean).join(' → ') || '—'],
      ...facturatie,
    ] },
    { kop: 'Ondertekening', regels: [
      ['Ondertekend door', d.signerName ?? '—'],
      ['E-mailadres', d.signerEmail ?? '—'],
      ['Datum en tijdstip', tijdstipBrussel(d.signedAt)],
      ['Tijdzone', TIJDZONE_LABEL],
      ['Wijze', wijzeVanOndertekenen(d.bron)],
      ...audit,
    ] },
    { kop: 'Integriteit', regels: [
      ['SHA-256 van het getekende PDF', vingerafdrukLeesbaar(d.sha256Contract)],
      ['Archiefversie', `v${d.versie}`],
      ['Systeem', d.app],
    ] },
    { kop: 'Tijdlijn', regels: d.gebeurtenissen
      .filter((g) => !g.event_type.startsWith('downloaded'))
      .map((g) => [tijdstipBrussel(g.created_at), `${gebeurtenisLabel(g.event_type)}${g.actor ? ` — ${g.actor}` : ''}${g.ip_address ? ` (${g.ip_address})` : ''}`] as [string, string]) },
  ]
  return blokken
}

// ── Melding naar Legal ──────────────────────────────────────────────────────

export const LEGAL_STANDAARD = 'legal@nextgenmedia.be'
const NOOIT_NAAR = new Set(['info@nextgenmedia.be'])

/**
 * Naar wie de ondertekeningsmelding gaat: CONTRACT_LEGAL_EMAIL (komma-
 * gescheiden) als die gezet is, anders legal@nextgenmedia.be. Nooit het
 * algemene info-adres — dat is geen juridisch postvak.
 */
export function legalOntvangers(env: { CONTRACT_LEGAL_EMAIL?: string | null | undefined }): string[] {
  const uit: string[] = []
  for (const e of String(env.CONTRACT_LEGAL_EMAIL ?? '').split(',')) {
    const t = e.trim().toLowerCase()
    if (t && t.includes('@') && !NOOIT_NAAR.has(t) && !uit.includes(t)) uit.push(t)
  }
  return uit.length ? uit : [LEGAL_STANDAARD]
}

/** Onderwerp en tekst van de melding naar Legal. */
export function meldingTekst(d: Dossier, extra: { adminUrl: string; ontvangstUrl?: string | null }): { onderwerp: string; tekst: string } {
  const onderwerp = `Contract getekend – ${d.klantNaam ?? 'Zonder klant'} – ${d.titel}`
  const regels = [
    `${d.signerName ?? 'Iemand'}${d.signerEmail ? ` (${d.signerEmail})` : ''} heeft "${d.titel}" ondertekend op ${tijdstipBrussel(d.signedAt)} (${TIJDZONE_LABEL}).`,
    '',
    `Klantnaam:          ${d.klantNaam ?? '—'}`,
    ...(d.contactNaam ? [`Contactpersoon:     ${d.contactNaam}`] : []),
    `Bedrijfsnaam:       ${d.bedrijfsnaam ?? '—'}`,
    `Contractnaam:       ${d.titel}`,
    `Contractnummer:     ${contractnummer(d.contractId)}`,
    `Ondertekenaar:      ${d.signerName ?? '—'}${d.signerEmail ? ` <${d.signerEmail}>` : ''}`,
    `Ondertekend op:     ${tijdstipBrussel(d.signedAt)}`,
    `Wijze:              ${wijzeVanOndertekenen(d.bron)}`,
    `Certificaatnummer:  ${d.certificaatNr ?? '—'}`,
    `SHA-256:            ${vingerafdrukLeesbaar(d.sha256Contract)}`,
    '',
    'Het getekende contract en het ondertekeningscertificaat zitten in bijlage en staan in het beschermde contractarchief.',
    `Contract in de app: ${extra.adminUrl}`,
    ...(extra.ontvangstUrl ? [`Ontvangstpagina: ${extra.ontvangstUrl}`] : []),
  ]
  return { onderwerp, tekst: regels.join('\n') }
}

// ── Idempotentie van de melding ─────────────────────────────────────────────

export type MeldingGebeurtenis = { event_type: string; created_at: string; meta?: Record<string, unknown> | null }

/**
 * Is er voor deze archiefversie al een melding verstuurd? Oudere meldingen
 * (van vóór het versienummer in de meta) horen bij versie 1.
 */
export function meldingAlVerstuurd(events: MeldingGebeurtenis[], archief: { versie: number; archiefId?: string | null }): boolean {
  return events.some((e) => {
    if (e.event_type !== 'melding_verstuurd') return false
    const m = e.meta ?? {}
    if (archief.archiefId && m.archief_id === archief.archiefId) return true
    if (typeof m.versie === 'number') return m.versie === archief.versie
    if (typeof m.versie === 'string' && m.versie.trim() !== '') return Number(m.versie) === archief.versie
    return archief.versie === 1
  })
}

/** De uitkomst van de laatste meldingspoging: verstuurd, mislukt, of nog geen. */
export function laatsteMeldingStatus(events: MeldingGebeurtenis[]): 'verstuurd' | 'mislukt' | null {
  const meldingen = events
    .filter((e) => e.event_type === 'melding_verstuurd' || e.event_type === 'melding_mislukt')
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
  if (!meldingen.length) return null
  return meldingen[0].event_type === 'melding_verstuurd' ? 'verstuurd' : 'mislukt'
}

/**
 * Moet de knop "Melding naar Legal opnieuw versturen" getoond worden? Enkel
 * wanneer de laatste poging mislukte, of wanneer een getekend en gearchiveerd
 * contract nog helemaal geen melding kreeg.
 */
export function meldingOpnieuwNodig(events: MeldingGebeurtenis[], gearchiveerd: boolean): boolean {
  const status = laatsteMeldingStatus(events)
  if (status === 'mislukt') return true
  return status === null && gearchiveerd
}
