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
  titel: string
  contractType: string | null
  klantNaam: string | null
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

/** Menselijke referentie van een contract, dezelfde als op de ontvangstpagina. */
export const referentie = (contractId: string): string => `NGM-${contractId.slice(0, 8).toUpperCase()}`

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
  gearchiveerd: 'Gearchiveerd in het contractarchief',
  melding_verstuurd: 'Interne melding verstuurd',
}

export const gebeurtenisLabel = (t: string): string => GEBEURTENIS_LABEL[t] ?? t

/** Tijdstip in Brusselse tijd, seconde-precies: "14/09/2026 om 14:31:08". */
export function tijdstipBrussel(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const delen = new Intl.DateTimeFormat('nl-BE', {
    timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d)
  const v = (t: string) => delen.find((x) => x.type === t)?.value ?? ''
  return `${v('day')}/${v('month')}/${v('year')} om ${v('hour')}:${v('minute')}:${v('second')}`
}

/** Bestandsveilige naam: "contract-website-aanpassingen". */
export function veiligeNaam(s: string | null | undefined, terugval = 'contract'): string {
  const t = String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return (t || terugval).slice(0, 60)
}

/** Paden in de archiefbucket: per contract een map, per versie een submap. */
export function archiefPaden(contractId: string, versie: number): { contract: string; certificaat: string; dossier: string } {
  const basis = `${contractId}/v${versie}`
  return { contract: `${basis}/contract-getekend.pdf`, certificaat: `${basis}/certificaat.pdf`, dossier: `${basis}/dossier.json` }
}

/** Bestandsnaam voor de download van het certificaat. */
export function certificaatBestandsnaam(titel: string | null | undefined, contractId: string): string {
  return `certificaat-${veiligeNaam(titel)}-${referentie(contractId).toLowerCase()}.pdf`
}

/** SHA-256 in groepjes van 8 tekens, zodat je hem met het oog kunt vergelijken. */
export function vingerafdrukLeesbaar(hex: string): string {
  return (hex.match(/.{1,8}/g) ?? [hex]).join(' ')
}

export type CertificaatBlok = { kop: string; regels: [string, string][] }

/**
 * De inhoud van het certificaat, als blokken met label/waarde-regels. Los van
 * de PDF-opmaak zodat de inhoud te testen is en niet per ongeluk een veld
 * verliest bij een lay-outwijziging.
 */
export function certificaatBlokken(d: Dossier): CertificaatBlok[] {
  const fmtBedrag = (n: number | null) => (n === null || n === undefined ? null : `€ ${n.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} excl. btw`)
  const facturatie: [string, string][] = []
  if (d.verwachtAantal || d.verwachtBedragExcl) {
    facturatie.push(['Verwachte facturatie', [d.verwachtAantal ? `${d.verwachtAantal}×` : null, fmtBedrag(d.verwachtBedragExcl), d.frequentie].filter(Boolean).join(' · ')])
  }
  const blokken: CertificaatBlok[] = [
    { kop: 'Contract', regels: [
      ['Titel', d.titel],
      ['Referentie', d.referentie],
      ['Type', d.contractType ?? '—'],
      ['Klant', d.klantNaam ?? '—'],
      ['Looptijd', [d.startDatum, d.eindDatum].filter(Boolean).join(' → ') || '—'],
      ...facturatie,
    ] },
    { kop: 'Ondertekening', regels: [
      ['Ondertekend door', d.signerName ?? '—'],
      ['E-mailadres', d.signerEmail ?? '—'],
      ['Tijdstip', tijdstipBrussel(d.signedAt)],
      ['IP-adres', d.ipAdres ?? '—'],
      ['Toestel / browser', d.userAgent ? d.userAgent.slice(0, 160) : '—'],
      ['Tekenlink verstuurd op', tijdstipBrussel(d.sentAt)],
      ['Wijze', d.bron === 'upload_getekend' ? 'Reeds getekend document opgeladen' : 'Digitale ondertekening via de tekenlink'],
    ] },
    { kop: 'Integriteit', regels: [
      ['SHA-256 van het getekende PDF', vingerafdrukLeesbaar(d.sha256Contract)],
      ['Archiefversie', `v${d.versie}`],
      ['Gearchiveerd op', tijdstipBrussel(d.gearchiveerdOp)],
      ['Systeem', d.app],
    ] },
    { kop: 'Tijdlijn', regels: d.gebeurtenissen
      .filter((g) => !g.event_type.startsWith('downloaded'))
      .map((g) => [tijdstipBrussel(g.created_at), `${gebeurtenisLabel(g.event_type)}${g.actor ? ` — ${g.actor}` : ''}${g.ip_address ? ` (${g.ip_address})` : ''}`] as [string, string]) },
  ]
  return blokken
}

/** Onderwerp en tekst van de interne melding. */
export function meldingTekst(d: Dossier, extra: { adminUrl: string; ontvangstUrl: string | null; facturatie: string | null }): { onderwerp: string; tekst: string } {
  const onderwerp = `Contract ondertekend: ${d.titel}${d.klantNaam ? ` — ${d.klantNaam}` : ''}`
  const regels = [
    `${d.signerName ?? 'Iemand'}${d.signerEmail ? ` (${d.signerEmail})` : ''} heeft "${d.titel}" ondertekend op ${tijdstipBrussel(d.signedAt)}.`,
    '',
    `Klant:       ${d.klantNaam ?? '—'}`,
    `Referentie:  ${d.referentie}`,
    `IP-adres:    ${d.ipAdres ?? '—'}`,
    `SHA-256:     ${vingerafdrukLeesbaar(d.sha256Contract)}`,
    '',
    extra.facturatie ? `Facturatie:  ${extra.facturatie}` : 'Facturatie:  geen facturatieafspraken op dit contract — maak de factuur handmatig aan.',
    '',
    'Het getekende contract en het ondertekeningscertificaat zitten in bijlage en staan in het contractarchief.',
    `Contract in de app: ${extra.adminUrl}`,
    ...(extra.ontvangstUrl ? [`Ontvangstpagina: ${extra.ontvangstUrl}`] : []),
  ]
  return { onderwerp, tekst: regels.join('\n') }
}
