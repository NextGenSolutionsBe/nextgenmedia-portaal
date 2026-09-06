/**
 * De rekenkern van de Harrie-koppeling. Pure module: geen databank, geen
 * server-imports — zo is elke regel hieronder los te testen, en dat is nodig,
 * want een fout hier betekent dat een klant een koude wervingsmail krijgt.
 *
 * WAT DEZE KOPPELING DOET. Harrie is ons acquisitiesysteem: het stuurt koude
 * mails en LinkedIn-berichten naar bedrijven die het zelf opzoekt. Onze
 * pipeline weet wie er NIET benaderd mag worden — klanten, mensen in gesprek,
 * wie al nee zei, wie op bel-me-niet staat. Die kennis geven we hier door.
 *
 * WAT WIJ WEL EN NIET BESLISSEN. Harrie krijgt de VOLLEDIGE pipeline te zien,
 * elke fase, ook Closed Won. Hij beslist zelf wat hij ermee doet — een bedrijf
 * dat bij ons klant is, hoeft hij niet eens op te laden. Wij sturen dus geen
 * blokkeerlijst mee en houden hier geen opvolgadministratie bij: hoeveel mails
 * er al uit zijn en wie wanneer gebeld moet worden, weet Harrie zelf.
 *
 * `doNotContact` blijft bestaan voor de twee gevallen die geen oordeel vragen:
 * iemand die op bel-me-niet staat, en onze eigen klanten en partners.
 */

/** Wat er per partij naar Harrie gaat. Vorm ligt vast in het contract. */
export type HarrieContact = {
  id: string
  company: string
  kbo: string | null
  emails: string[]
  domains: string[]
  phones: string[]
  website: string | null
  /** Vrije tekst, enkel ter informatie. Harrie toont dit, beslist er niets mee. */
  stage: string
  /**
   * De STABIELE sleutel van diezelfde fase ('to_contact', 'won', …).
   *
   * Staat niet in het oorspronkelijke contract en is dus optioneel, maar wie de
   * pipeline wil SPIEGELEN heeft hem nodig: labels mogen we morgen hernoemen,
   * sleutels niet. Harrie leest hiermee onze fase en toont die in zijn eigen
   * scherm zonder op tekst te moeten matchen.
   */
  stageKey?: string
  doNotContact: boolean
  /** Waarom er niet benaderd mag worden — enkel gevuld als we het weten. */
  doNotContactReason?: string | null
  owner: string | null
  /** Naam van de contactpersoon, zodat Harrie niet "Beste heer/mevrouw" schrijft. */
  contactName?: string | null
  city?: string | null
  sector?: string | null
  /** Staat er bij ons een terugbelmoment gepland? */
  callbackAt?: string | null
  labels?: string[]
  updatedAt: string
  /** Weg uit de pipeline: Harrie mag deze partij weer vrijgeven. */
  deleted?: boolean
}

/**
 * Maildomeinen die niets zeggen over WELK bedrijf iemand is.
 *
 * Zou "gmail.com" als bedrijfsdomein doorgaan, dan blokkeerde één klant met een
 * Gmail-adres in één klap elke prospect met een Gmail-adres. Dat is precies de
 * fout die een koppeling onbruikbaar maakt, dus die domeinen gaan er hier uit.
 */
export const GRATIS_MAILDOMEINEN = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.be', 'hotmail.nl',
  'outlook.com', 'outlook.be', 'outlook.nl', 'live.com', 'live.be', 'live.nl',
  'msn.com', 'yahoo.com', 'yahoo.co.uk', 'icloud.com', 'me.com', 'mac.com',
  'telenet.be', 'skynet.be', 'proximus.be', 'scarlet.be', 'voo.be', 'edpnet.be',
  'ziggo.nl', 'kpnmail.nl', 'planet.nl', 'home.nl', 'xs4all.nl', 'chello.be',
  'aol.com', 'gmx.com', 'gmx.net', 'protonmail.com', 'proton.me', 'pandora.be',
])

/** Het domein uit een e-mailadres, of null als het er geen is. */
export function domeinVanEmail(email: string | null | undefined): string | null {
  const s = (email ?? '').trim().toLowerCase()
  const m = s.match(/^[^\s@]+@([^\s@]+\.[^\s@]+)$/)
  if (!m) return null
  const domein = m[1].replace(/\.$/, '')
  return GRATIS_MAILDOMEINEN.has(domein) ? null : domein
}

/** Het domein uit een website-URL, zonder www. */
export function domeinVanWebsite(website: string | null | undefined): string | null {
  const raw = (website ?? '').trim()
  if (!raw) return null
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!host.includes('.')) return null
    return GRATIS_MAILDOMEINEN.has(host) ? null : host
  } catch {
    return null
  }
}

/**
 * Ondernemingsnummer tot enkel cijfers, met de landcode eraf.
 *
 * "BE 0437.476.235", "0437476235" en "437476235" zijn hetzelfde bedrijf. Zonder
 * deze normalisatie matcht Harrie's notatie nooit op de onze, en glipt er dus
 * iemand door.
 */
export function normaliseerKbo(kbo: string | null | undefined): string | null {
  let d = (kbo ?? '').replace(/\D+/g, '')
  if (!d) return null
  if (d.length === 12 && d.startsWith('00')) d = d.slice(2)   // 00BE-notatie
  if (d.length === 9) d = `0${d}`                             // voorloopnul terug
  return d.length === 10 ? d : null
}

/** E-mailadres netjes: kleine letters, geen spaties, of null. */
export function schoonEmail(email: string | null | undefined): string | null {
  const s = (email ?? '').trim().toLowerCase()
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null
}

/** Unieke, niet-lege waarden — de lijstvelden in het contract. */
export function uniek(waarden: (string | null | undefined)[]): string[] {
  const uit: string[] = []
  for (const w of waarden) {
    const s = (w ?? '').trim()
    if (s && !uit.includes(s)) uit.push(s)
  }
  return uit
}

// ── Wat Harrie meldt, en wat wij daarmee doen ────────────────────────────────

/**
 * De gebeurtenissen die Harrie kan melden — het contract, plus `imported`.
 *
 * Die ene toevoeging is er omdat Harrie zelf prospects opzoekt (KBO, LinkedIn)
 * en die in onze pipeline moet kunnen zetten, zodat hij bij een volgende
 * ophaling ziet dat ze er al staan en niets dubbel oplaadt.
 *
 * Wat hier BEWUST niet staat: opvolgmails tellen, "moet gebeld worden"
 * bijhouden, gebelde gesprekken loggen. Dat is Harrie's eigen administratie.
 * Wij bewaren alleen waar een lead in ONZE pipeline staat.
 */
export const HARRIE_TYPES = [
  'imported',
  'sent', 'linkedin_request', 'linkedin_message', 'replied',
  'booked', 'booking_moved', 'booking_cancelled',
  'declined', 'unsubscribed', 'bounced', 'lost', 'manual_reply',
] as const
export type HarrieType = (typeof HARRIE_TYPES)[number]

export const isHarrieType = (v: unknown): v is HarrieType =>
  typeof v === 'string' && (HARRIE_TYPES as readonly string[]).includes(v)

export type Gevolg = {
  /** Onze fase waar de lead naartoe gaat; null = fase ongemoeid laten. */
  fase: string | null
  /** Fase alleen zetten bij een NIEUWE lead — nooit een bestaande terugzetten. */
  enkelBijNieuw?: boolean
  /**
   * Deze fase mag alleen VOORUIT.
   *
   * Staat een lead al op "Afspraak ingepland" en meldt Harrie nog een
   * verstuurde mail uit een lopende reeks, dan is dat een regel op de tijdlijn
   * en geen stap terug. Geldt voor contactmeldingen; een annulering of een
   * afwijzing mag wél terug, want dat is nieuwe informatie.
   */
  alleenVooruit?: boolean
  /** Zet de warme markering: de prospect reageerde zelf. */
  markeerWarm?: boolean
  /** Nooit meer benaderen (bel-me-niet). */
  nietMeerBenaderen?: boolean
  /** Reden bij een verloren lead — onze pipeline eist die. */
  reden?: string
  /** Label dat op de lead gezet wordt. */
  label?: string
  /** Hoe de regel op de tijdlijn komt te staan. */
  omschrijving: string
}

/**
 * Van Harrie-gebeurtenis naar onze pipeline.
 *
 * Elke gebeurtenis doet één ding: de fase zetten. Geen terugbelafspraken, geen
 * opvolgtellers — dat blijft in Harrie.
 *
 * Eén keuze verdient uitleg: "booked" zet de fase op 'appointment'. Elders in deze app kan die fase
 *    alleen ontstaan uit een boeking in ons eigen scherm; hier maken we een
 *    uitzondering, want Harrie's afspraak IS een echte afspraak — hij staat
 *    alleen in zijn agenda in plaats van in de onze. Zonder die uitzondering
 *    zou Marco iemand nabellen die al een afspraak heeft staan, en dat is
 *    precies wat deze koppeling moet voorkomen.
 */
export function gevolgVan(
  type: HarrieType,
  detail?: string | null,
  /** Het kanaal uit het harrie-blokje; bepaalt of het mail of LinkedIn wordt. */
  kanaal?: string | null,
): Gevolg {
  const tekst = (detail ?? '').trim()
  const viaLinkedIn = /linkedin/i.test(kanaal ?? '')
  /** Waar valt een lead op terug als een afspraak afgezegd wordt? */
  const terugNaarKanaal = viaLinkedIn ? 'contacted_linkedin' : 'contacted_mail'

  switch (type) {
    case 'sent':
      return {
        fase: 'contacted_mail', alleenVooruit: true,
        omschrijving: `Harrie: koude mail verstuurd${tekst ? ` · ${tekst}` : ''}`,
      }
    case 'linkedin_request':
      return {
        fase: 'contacted_linkedin', alleenVooruit: true,
        omschrijving: `Harrie: LinkedIn-verzoek verstuurd${tekst ? ` · ${tekst}` : ''}`,
      }
    case 'linkedin_message':
      return {
        fase: 'contacted_linkedin', alleenVooruit: true,
        omschrijving: `Harrie: LinkedIn-bericht verstuurd${tekst ? ` · ${tekst}` : ''}`,
      }

    /**
     * DE BELANGRIJKSTE. Iemand die op een koude mail of een LinkedIn-bericht
     * antwoordt, is de warmste lead die er is. De fase BLIJFT staan — het
     * kanaal waarlangs het gesprek loopt verandert immers niet — maar de lead
     * krijgt een warme markering, en die is in de lijst niet te missen.
     */
    case 'replied':
      return {
        fase: null, markeerWarm: true,
        omschrijving: `Harrie: prospect reageerde${tekst ? ` · ${tekst}` : ''}`,
      }

    case 'booked':
      return { fase: 'appointment', omschrijving: `Harrie: afspraak geboekt${tekst ? ` · ${tekst}` : ''}` }
    case 'booking_moved':
      return { fase: 'appointment', omschrijving: `Harrie: afspraak verzet${tekst ? ` · ${tekst}` : ''}` }
    case 'booking_cancelled':
      return {
        fase: terugNaarKanaal,
        omschrijving: `Harrie: afspraak geannuleerd${tekst ? ` · ${tekst}` : ''}`,
      }

    case 'declined':
      return {
        fase: 'not_interested', reden: tekst || 'Afgewezen na koude benadering (Harrie)',
        omschrijving: `Harrie: prospect zei nee${tekst ? ` · ${tekst}` : ''}`,
      }
    case 'lost':
      return {
        fase: 'not_interested', reden: tekst || 'Afgesloten in Harrie',
        omschrijving: `Harrie: afgesloten${tekst ? ` · ${tekst}` : ''}`,
      }

    case 'unsubscribed':
      return {
        fase: null, nietMeerBenaderen: true,
        omschrijving: 'Harrie: uitgeschreven — niet meer mailen',
      }
    case 'bounced':
      return {
        fase: null, label: 'e-mail ongeldig',
        omschrijving: `Harrie: e-mailadres bestaat niet${tekst ? ` · ${tekst}` : ''}`,
      }
    case 'manual_reply':
      return { fase: null, omschrijving: `Harrie: handmatig antwoord${tekst ? ` · ${tekst}` : ''}` }

    /**
     * Opgeladen, nog niet benaderd. Deze landt op "Nog te contacteren" — zodat
     * hij in ONZE belijst verschijnt en Marco hem gewoon kan bellen, ook al
     * heeft Harrie er nog niets mee gedaan. Bestaat de lead al, dan laten we
     * de fase met rust: een prospect die al verder staat, mag niet door een
     * import terugvallen.
     */
    case 'imported':
      return {
        fase: 'to_contact', enkelBijNieuw: true,
        omschrijving: `Harrie: prospect opgeladen${tekst ? ` · ${tekst}` : ''}`,
      }
  }
}

/** Wat Harrie per gebeurtenis meestuurt over de stand van zijn eigen reeks. */
export type HarrieBlok = {
  kanaal?: string | null
  stap?: number | null
  berichtenVerstuurd?: number | null
  laatsteContact?: string | null
  dagenSindsContact?: number | null
  reageerde?: boolean | null
  laatsteReactie?: string | null
  afspraak?: string | null
  nogBezig?: boolean | null
  uitgeschreven?: boolean | null
  belAdvies?: string | null
}

/**
 * Het blokje opschonen voor we het bewaren.
 *
 * Alles is optioneel — Harrie vult wat hij weet — maar wat er binnenkomt moet
 * wél van het juiste type zijn: dit gaat rechtstreeks naar een scherm waar een
 * setter een belbeslissing op neemt.
 */
export function schoonHarrieBlok(ruw: unknown): HarrieBlok | null {
  if (!ruw || typeof ruw !== 'object') return null
  const h = ruw as Record<string, unknown>
  const tekst = (v: unknown, max: number): string | null => {
    const t = String(v ?? '').trim()
    return t ? t.slice(0, max) : null
  }
  const getal = (v: unknown): number | null => {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

  const uit: HarrieBlok = {
    kanaal: tekst(h.kanaal, 40),
    stap: getal(h.stap),
    berichtenVerstuurd: getal(h.berichtenVerstuurd),
    laatsteContact: tekst(h.laatsteContact, 40),
    dagenSindsContact: getal(h.dagenSindsContact),
    reageerde: bool(h.reageerde),
    laatsteReactie: tekst(h.laatsteReactie, 1000),
    afspraak: tekst(h.afspraak, 200),
    nogBezig: bool(h.nogBezig),
    uitgeschreven: bool(h.uitgeschreven),
    belAdvies: tekst(h.belAdvies, 500),
  }
  return Object.values(uit).some((v) => v !== null) ? uit : null
}

/** Het label waaraan we leads herkennen die uit Harrie zelf komen. */
export const HARRIE_LABEL = 'Harrie'
