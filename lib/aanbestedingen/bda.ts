import 'server-only'
import { fetchMetLimiet } from '@/lib/fetch-met-limiet'

/**
 * Koppeling met publicprocurement.be (BDA).
 *
 * Deze API is INTERN en niet gedocumenteerd. Onderstaande details zijn met
 * reverse-engineering achterhaald en in productie bewezen. Wijk er niet van af
 * zonder opnieuw te meten.
 *
 * De drie dingen die het vaakst misgaan:
 *  1. `BelGov-Trace-Id` ontbreekt → alles geeft 400. Nagemeten: zonder die
 *     header antwoordt de zoek-endpoint met HTTP 400, mét header met 200.
 *  2. Paginering in de querystring → werkt niet, het moet in de body.
 *  3. `withActiveSubmissionDeadline: false` → je krijgt het volledige archief.
 *     Nagemeten op één CPV-code: 13 open opdrachten tegenover 1668 met archief.
 */

const BASE = 'https://www.publicprocurement.be'

/** Sleutels die de zoek-endpoint aanvaardt. De interne `get*`-hulpvelden uit
 *  het filterobject meesturen levert een 400 op, dus we filteren streng. */
const TOEGESTAAN = new Set([
  'terms', 'publicationLanguages', 'cpvCodes', 'nutsCodes', 'natures',
  'organisationIds', 'authorityIds', 'includeOrganisationChildren',
  'specialPurchasingTechniques', 'reservedTenders',
])

export type BdaDocument = { version_id: string; filename: string; file_hash: string }

export class BdaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'BdaError'
  }
}

export function bdaConfigured(): boolean {
  return !!process.env.BDA_AUTH_CLIENT_SECRET
}

export class BdaClient {
  private token: string | null = null
  private verlooptOp = 0

  constructor(private readonly secret = process.env.BDA_AUTH_CLIENT_SECRET ?? '') {}

  /** Geldig token; wordt een minuut vóór het verloopt al ververst. */
  private async geldigToken(): Promise<string> {
    if (this.token && Date.now() < this.verlooptOp - 60_000) return this.token
    if (!this.secret) throw new BdaError('BDA_AUTH_CLIENT_SECRET ontbreekt in de omgeving.')

    const res = await fetchMetLimiet(`${BASE}/auth/realms/supplier/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'frontend-public',
        client_secret: this.secret,
      }),
      cache: 'no-store',
    })
    if (!res.ok) throw new BdaError(`Aanmelden bij publicprocurement.be mislukt (${res.status})`, res.status)
    const p = await res.json() as { access_token?: string; expires_in?: number }
    if (!p.access_token) throw new BdaError('Geen toegangstoken ontvangen.')
    this.token = p.access_token
    this.verlooptOp = Date.now() + (p.expires_in ?? 3600) * 1000
    return this.token
  }

  private async headers(): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.geldigToken()}`,
      'Account-Type': 'public',
      // VERPLICHT en uniek per verzoek. Zonder deze header: HTTP 400.
      'BelGov-Trace-Id': crypto.randomUUID(),
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
    }
  }

  /** Het filterobject achter een deel-link (shortLink). */
  async filterVanShortLink(shortLink: string): Promise<Record<string, unknown>> {
    const url = `${BASE}/api/sea/search/publications/filtersByShortLink/${encodeURIComponent(shortLink)}`
    const res = await fetchMetLimiet(url, { headers: await this.headers(), cache: 'no-store' })
    if (res.status === 404) throw new BdaError('Deze filterlink bestaat niet (meer) bij publicprocurement.be.', 404)
    if (!res.ok) throw new BdaError(`Filter ophalen mislukt (${res.status})`, res.status)
    return await res.json() as Record<string, unknown>
  }

  /**
   * Alle publicaties van een filter, volledig gepagineerd.
   *
   * `page` is 1-gebaseerd en hoort in de BODY. We blijven doorgaan tot we
   * `totalCount` bereikt hebben, met een seconde pauze tussen de pagina's —
   * dit is andermans server.
   */
  async alleOpdrachten(
    shortLink: string,
    opties: {
      includeClosed?: boolean
      onPage?: (opgehaald: number, totaal: number) => void | Promise<void>
      /** Tussen twee pagina's gevraagd. Geeft dit true, dan stoppen we en
       *  leveren we wat we tot dan toe hebben — geen halve pagina. */
      stoppen?: () => Promise<boolean>
    } = {},
  ): Promise<{ records: Record<string, unknown>[]; totaal: number; gestopt: boolean }> {
    const filter = await this.filterVanShortLink(shortLink)
    const basis: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(filter)) if (TOEGESTAAN.has(k)) basis[k] = v
    basis.withActiveSubmissionDeadline = !opties.includeClosed
    basis.pageSize = 100

    const records: Record<string, unknown>[] = []
    let totaal = -1
    let page = 1
    let gestopt = false

    // Harde bovengrens: bij een onverwacht antwoord nooit eindeloos doorgaan.
    for (let ronde = 0; ronde < 200; ronde++) {
      const res = await fetchMetLimiet(`${BASE}/api/sea/search/publications`, {
        method: 'POST',
        headers: await this.headers(),
        body: JSON.stringify({ ...basis, page }),
        cache: 'no-store',
      })
      if (!res.ok) throw new BdaError(`Zoeken mislukt (${res.status})`, res.status)
      const data = await res.json() as { publications?: Record<string, unknown>[]; totalCount?: number }
      if (totaal < 0) totaal = Number(data.totalCount ?? 0)

      const pubs = data.publications ?? []
      records.push(...pubs)
      await opties.onPage?.(records.length, totaal)

      if (pubs.length === 0 || records.length >= totaal) break
      if (await opties.stoppen?.()) { gestopt = true; break }
      page++
      await new Promise((r) => setTimeout(r, 1000))
    }
    return { records, totaal: totaal < 0 ? records.length : totaal, gestopt }
  }

  /** De bestekdocumenten van één opdracht (workspace). */
  async documenten(workspaceId: string): Promise<BdaDocument[]> {
    const res = await fetchMetLimiet(`${BASE}/api/dos/publication-workspaces/${encodeURIComponent(workspaceId)}/documents`, {
      headers: await this.headers(), cache: 'no-store',
    })
    if (!res.ok) throw new BdaError(`Documentenlijst mislukt (${res.status})`, res.status)
    const lijst = await res.json() as Record<string, unknown>[]

    const uit: BdaDocument[] = []
    for (const doc of lijst ?? []) {
      const versies = (doc.versions ?? []) as Record<string, unknown>[]
      const v = versies[0]
      if (!v?.id) continue
      const binnen = (v.document ?? {}) as Record<string, unknown>
      const naam = String(binnen.originalFileName ?? '')
      // Alleen formaten waar tekst uit te halen valt.
      if (naam && !/\.(pdf|docx|xlsx|doc|zip|rtf)$/i.test(naam)) continue
      uit.push({
        version_id: String(v.id),
        filename: naam,
        file_hash: String(binnen.fileHash ?? ''),
      })
    }
    return uit
  }

  /**
   * Eén document ophalen. Twee stappen: eerst de tijdelijke download-URL, dan
   * die URL ZONDER onze auth-headers ophalen — met headers weigert de opslag.
   */
  async download(versionId: string, maxBytes = 40 * 1024 * 1024): Promise<Uint8Array | null> {
    const res = await fetchMetLimiet(
      `${BASE}/api/dos/publication-workspace-document-versions/${encodeURIComponent(versionId)}/download-url`,
      { headers: await this.headers(), cache: 'no-store' },
    )
    // Niet elk document is publiek op te halen: in de praktijk geeft de BDA
    // hier soms 403 of 404 (bv. een ESPD-formulier). Dat is een normale
    // toestand, geen storing — dan slaan we dat ene document over in plaats
    // van de hele run te laten klappen.
    if (res.status === 403 || res.status === 404) return null
    if (!res.ok) throw new BdaError(`Download-URL mislukt (${res.status})`, res.status)
    const url = (await res.json() as { value?: string }).value
    if (!url) return null

    const bestand = await fetchMetLimiet(url, { cache: 'no-store' })   // GEEN auth-headers
    if (bestand.status === 403 || bestand.status === 404) return null
    if (!bestand.ok) throw new BdaError(`Bestand ophalen mislukt (${bestand.status})`, bestand.status)
    const buf = new Uint8Array(await bestand.arrayBuffer())
    // Te groot? Dan overslaan in plaats van het geheugen vol te trekken.
    return buf.byteLength <= maxBytes ? buf : null
  }
}
