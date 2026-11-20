import 'server-only'
import { randomUUID } from 'node:crypto'
import { MERK_STIJL, mailMerkVan, type MailMerk } from '@/lib/merk-mail'
import { OFFERTE_BUCKET, type Offerte } from '@/lib/offertes'
import { OfferteFout, maakOfferte, leesOfferte, verwijderOfferte } from '@/lib/offertes-server'
import {
  leesInhoud, controleerOpmaak, berekenPrijs, volgendOffertenummer, isVerantwoordelijke, FICHE_NAAR_DIENST,
  type OfferteInhoud, type Verantwoordelijke,
} from '@/lib/offerte-fiche'
import {
  OFFERTE_INSTELLINGEN_SLEUTEL, leesOfferteInstellingen, controleerOfferteInstellingen, offerteBedrijf, contactUitPersoneel,
  type OfferteInstellingen, type OfferteContact,
} from '@/lib/offerte-afzender'
import { maakOffertePdf } from '@/lib/offerte-pdf'

/**
 * Offertes opmaken in de app (serverkant). Een opgemaakte offerte is een
 * gewone offerte (zelfde tabel, link, mail, geopend, akkoord en kaart op
 * Projecten); enkel de pdf maakt de server zelf uit de invulfiches.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: { from: (b: string) => any } }

const nu = () => new Date().toISOString()
const vandaagBrussel = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Instellingen (contacten per verantwoordelijke, betalingstermijn) ────────

export async function offerteInstellingen(admin: Admin): Promise<OfferteInstellingen> {
  const { data } = await admin.from('app_settings').select('value').eq('key', OFFERTE_INSTELLINGEN_SLEUTEL).maybeSingle()
  return leesOfferteInstellingen((data as { value?: unknown } | null)?.value)
}

export async function bewaarOfferteInstellingen(admin: Admin, b: unknown, door: string | null): Promise<OfferteInstellingen> {
  const v = controleerOfferteInstellingen(b)
  if (!v.ok) throw new OfferteFout(v.fout)
  const { error } = await admin.from('app_settings').upsert({ key: OFFERTE_INSTELLINGEN_SLEUTEL, value: v.waarde, updated_at: nu(), updated_by_email: door }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
  return v.waarde
}

// ── Contactpersoon uit Personeel ────────────────────────────────────────────

const PERSONEEL_BUCKET = 'personeel'

async function personeelVan(admin: Admin, wie: Verantwoordelijke) {
  const { data } = await admin.from('personeel').select('voornaam, achternaam, functie, telefoon, email, profielfoto_pad, actief').ilike('voornaam', wie).order('actief', { ascending: false }).limit(1)
  return ((data ?? [])[0] ?? null) as { voornaam: string | null; achternaam: string | null; functie: string | null; telefoon: string | null; email: string | null; profielfoto_pad: string | null } | null
}

/** Marco en Bram zoals ze op de offerte komen (zonder foto), voor het formulier. */
export async function offerteContacten(admin: Admin): Promise<Record<Verantwoordelijke, OfferteContact>> {
  const [marco, bram] = await Promise.all([personeelVan(admin, 'marco'), personeelVan(admin, 'bram')])
  return { marco: contactUitPersoneel('marco', marco), bram: contactUitPersoneel('bram', bram) }
}

/** De contactpersoon met profielfoto (jpg of png) voor de pdf. Geen foto = initialen. */
async function contactMetFoto(admin: Admin, wie: Verantwoordelijke): Promise<{ contact: OfferteContact; foto: Uint8Array | null }> {
  const p = await personeelVan(admin, wie)
  let foto: Uint8Array | null = null
  if (p?.profielfoto_pad && /\.(jpe?g|png)$/i.test(p.profielfoto_pad)) {
    try {
      const { data } = await admin.storage.from(PERSONEEL_BUCKET).download(p.profielfoto_pad)
      if (data) foto = new Uint8Array(await (data as Blob).arrayBuffer())
    } catch { foto = null }
  }
  return { contact: contactUitPersoneel(wie, p), foto }
}

// ── Nummer ──────────────────────────────────────────────────────────────────

export async function volgendNummer(admin: Admin): Promise<string> {
  const jaar = Number(vandaagBrussel().slice(0, 4))
  const { data } = await admin.from('offertes').select('offertenummer').ilike('offertenummer', `OF-${jaar}-%`).limit(2000)
  return volgendOffertenummer(((data ?? []) as { offertenummer: string | null }[]).map((r) => r.offertenummer), jaar)
}

async function nummerVrij(admin: Admin, nummer: string, behalve: string | null): Promise<boolean> {
  const { data } = await admin.from('offertes').select('id').ilike('offertenummer', nummer.replace(/[%_]/g, '')).limit(5)
  return !((data ?? []) as { id: string }[]).some((r) => r.id !== behalve)
}

// ── Klant ───────────────────────────────────────────────────────────────────

type KlantPdf = { naam: string; contact: string | null; email: string | null; telefoon: string | null; adres: string | null; btw: string | null }

async function klantVoorPdf(admin: Admin, clientId: string | null, vrij: string | null): Promise<KlantPdf | null> {
  if (!clientId) return vrij ? { naam: vrij, contact: null, email: null, telefoon: null, adres: null, btw: null } : null
  const { data } = await admin.from('clients').select('company_name, contact_name, email, telefoon, adres_straat, adres_postcode, adres_gemeente, btw_nummer').eq('id', clientId).maybeSingle()
  if (!data) return null
  const k = data as Record<string, string | null>
  const adres = [k.adres_straat, [k.adres_postcode, k.adres_gemeente].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null
  return { naam: k.company_name ?? vrij ?? 'Klant', contact: k.contact_name, email: k.email, telefoon: k.telefoon, adres, btw: k.btw_nummer }
}

// ── Pdf ─────────────────────────────────────────────────────────────────────

export type PdfVraag = {
  inhoud: OfferteInhoud; merk: MailMerk; verantwoordelijke: Verantwoordelijke; nummer: string
  klant: KlantPdf; handtekening?: { png: Uint8Array; naam: string; op: string } | null; akkoord?: { naam: string; op: string } | null; voorbeeld?: boolean
}

export async function bouwOffertePdf(admin: Admin, v: PdfVraag): Promise<Uint8Array> {
  const [c, oi] = await Promise.all([contactMetFoto(admin, v.verantwoordelijke), offerteInstellingen(admin)])
  return maakOffertePdf({
    merk: v.merk, bedrijf: offerteBedrijf(MERK_STIJL[v.merk]), contact: c.contact, foto: c.foto,
    betalingstermijn: oi.betalingstermijn, klant: v.klant, inhoud: v.inhoud, nummer: v.nummer,
    handtekening: v.handtekening ?? null, akkoord: v.akkoord ?? null, voorbeeld: v.voorbeeld,
  })
}

/** Voorbeeld uit het formulier, zonder iets te bewaren. */
export async function voorbeeldPdf(admin: Admin, b: Record<string, unknown>): Promise<Uint8Array> {
  const inhoud = leesInhoud(b.inhoud)
  const clientId = typeof b.client_id === 'string' && UUID.test(b.client_id) ? b.client_id : null
  const klant = (await klantVoorPdf(admin, clientId, String(b.klant_naam ?? '').trim() || null)) ?? { naam: 'Klant', contact: null, email: null, telefoon: null, adres: null, btw: null }
  const verantwoordelijke = isVerantwoordelijke(b.verantwoordelijke) ? b.verantwoordelijke : 'bram'
  const nummer = String(inhoud.algemeen.offertenummer ?? '') || await volgendNummer(admin)
  return bouwOffertePdf(admin, { inhoud, merk: mailMerkVan(b.merk), verantwoordelijke, nummer, klant, voorbeeld: true })
}

async function bewaarPdf(admin: Admin, bytes: Uint8Array, nummer: string, klant: string): Promise<{ pad: string; naam: string }> {
  const naam = `Offerte ${nummer} ${klant}`.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._ -]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100)
  const pad = `offertes/${randomUUID()}/${naam.replace(/\s+/g, '-') || 'offerte'}.pdf`
  const { error } = await admin.storage.from(OFFERTE_BUCKET).upload(pad, bytes, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(`Pdf bewaren mislukt: ${error.message}`)
  return { pad, naam: `${naam}.pdf` }
}

// ── Bewaren ─────────────────────────────────────────────────────────────────

type Invoer = { inhoud: OfferteInhoud; merk: MailMerk; verantwoordelijke: Verantwoordelijke; clientId: string | null; klantNaam: string | null; opdrachtId: string | null; nummer: string }

async function leesInvoer(admin: Admin, b: Record<string, unknown>, behalve: string | null): Promise<Invoer> {
  const inhoud = leesInhoud(b.inhoud)
  const clientId = typeof b.client_id === 'string' && UUID.test(b.client_id) ? b.client_id : null
  const klantNaam = String(b.klant_naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 160) || null
  const fouten = controleerOpmaak(inhoud, { klant: !!(clientId || klantNaam), verantwoordelijke: b.verantwoordelijke, vandaag: vandaagBrussel() })
  if (fouten.length) throw new OfferteFout(fouten[0].fout)
  if (!inhoud.algemeen.datum) inhoud.algemeen.datum = vandaagBrussel()
  let nummer = String(inhoud.algemeen.offertenummer ?? '').toUpperCase()
  if (!nummer) nummer = await volgendNummer(admin)
  if (!(await nummerVrij(admin, nummer, behalve))) throw new OfferteFout(`Offertenummer ${nummer} bestaat al. Het volgende vrije is ${await volgendNummer(admin)}.`, 409)
  inhoud.algemeen.offertenummer = nummer
  return {
    inhoud, merk: mailMerkVan(b.merk), verantwoordelijke: b.verantwoordelijke as Verantwoordelijke, clientId, klantNaam,
    opdrachtId: typeof b.opdracht_id === 'string' && UUID.test(b.opdracht_id) ? b.opdracht_id : null, nummer,
  }
}

const velden = (v: Invoer) => ({
  bron: 'opgemaakt', inhoud: v.inhoud, offertenummer: v.nummer, verantwoordelijke: v.verantwoordelijke,
  ontvanger_naam: String(v.inhoud.algemeen.contactpersoon ?? '') || undefined,
  ontvanger_email: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v.inhoud.algemeen.email ?? '')) ? String(v.inhoud.algemeen.email) : undefined,
})

/**
 * De kaart op Projecten: diensten en verantwoordelijke uit de offerte. Een kaart
 * die deze offerte zelf aanmaakte, volgt altijd de gekozen diensten; een
 * bestaande kaart enkel als er nog geen diensten op staan.
 */
async function vulKaartAan(admin: Admin, opdrachtId: string | null, v: Invoer, offerteId?: string): Promise<void> {
  if (!opdrachtId) return
  const { data } = await admin.from('opdrachten').select('id, diensten, verantwoordelijke, aangemaakt_door_offerte').eq('id', opdrachtId).maybeSingle()
  const k = data as { diensten: string[] | null; verantwoordelijke: string | null; aangemaakt_door_offerte?: string | null } | null
  if (!k) return
  const patch: Record<string, unknown> = {}
  const eigen = !!offerteId && k.aangemaakt_door_offerte === offerteId
  if (eigen || !(k.diensten ?? []).length) patch.diensten = [...new Set(v.inhoud.diensten.map((d) => FICHE_NAAR_DIENST[d]))]
  if (!k.verantwoordelijke) patch.verantwoordelijke = v.verantwoordelijke === 'marco' ? 'Marco' : 'Bram'
  if (Object.keys(patch).length) await admin.from('opdrachten').update({ ...patch, updated_at: nu() }).eq('id', opdrachtId)
}

/** Nieuwe opgemaakte offerte (concept). Daarna versturen via de MailComposer, zoals elke offerte. */
export async function maakOpgemaakteOfferte(admin: Admin, b: Record<string, unknown>, door: { userId: string | null; email: string | null }): Promise<Offerte> {
  const v = await leesInvoer(admin, b, null)
  const klant = await klantVoorPdf(admin, v.clientId, v.klantNaam)
  if (!klant) throw new OfferteFout('Die klant bestaat niet.')
  const prijs = berekenPrijs(v.inhoud.prijs, v.inhoud.extra)
  const bytes = await bouwOffertePdf(admin, { inhoud: v.inhoud, merk: v.merk, verantwoordelijke: v.verantwoordelijke, nummer: v.nummer, klant })
  const pdf = await bewaarPdf(admin, bytes, v.nummer, klant.naam)
  const o = await maakOfferte(admin, {
    titel: String(v.inhoud.algemeen.projectnaam), bedrag_excl: prijs.excl || null, geldig_tot: v.inhoud.algemeen.geldig_tot, merk: v.merk,
    eigen_pad: pdf.pad, eigen_naam: pdf.naam, client_id: v.clientId, klant_naam: v.clientId ? null : v.klantNaam, opdracht_id: v.opdrachtId,
  }, door)
  const extra = velden(v)
  let { data, error } = await admin.from('offertes').update({ ...extra, updated_at: nu() }).eq('id', o.id).select('*').single()
  if (error && /duplicate|unique/i.test(error.message)) {
    // Iemand nam hetzelfde nummer net in gebruik: deze offerte weer weg, opnieuw proberen geeft een nieuw nummer.
    await verwijderOfferte(admin, o.id, null).catch(() => null)
    throw new OfferteFout(`Offertenummer ${v.nummer} werd net gebruikt. Bewaar opnieuw: je krijgt het volgende nummer.`, 409)
  }
  if (error && /column|schema cache/i.test(error.message)) ({ data, error } = await admin.from('offertes').update({ updated_at: nu() }).eq('id', o.id).select('*').single())
  if (error) throw new Error(error.message)
  await vulKaartAan(admin, (data as Offerte).opdracht_id, v, o.id).catch(() => null)
  return data as Offerte
}

/** Een concept aanpassen: nieuwe pdf, zelfde link. Verstuurd = vast; maak dan een kopie. */
export async function wijzigOpgemaakteOfferte(admin: Admin, id: string, b: Record<string, unknown>): Promise<Offerte> {
  const o = await leesOfferte(admin, id)
  if (!o) throw new OfferteFout('Offerte niet gevonden.', 404)
  if (o.bron !== 'opgemaakt') throw new OfferteFout('Deze offerte is een pdf; die pas je niet aan in de app.', 409)
  if (o.status !== 'concept') throw new OfferteFout('Een verstuurde offerte verandert niet meer. Maak een kopie en pas die aan.', 409)
  const v = await leesInvoer(admin, { ...b, client_id: b.client_id ?? o.client_id, klant_naam: b.klant_naam ?? o.klant_naam, opdracht_id: o.opdracht_id }, id)
  const klant = await klantVoorPdf(admin, v.clientId, v.klantNaam)
  if (!klant) throw new OfferteFout('Die klant bestaat niet.')
  const prijs = berekenPrijs(v.inhoud.prijs, v.inhoud.extra)
  const bytes = await bouwOffertePdf(admin, { inhoud: v.inhoud, merk: v.merk, verantwoordelijke: v.verantwoordelijke, nummer: v.nummer, klant })
  const pdf = await bewaarPdf(admin, bytes, v.nummer, klant.naam)
  const { data, error } = await admin.from('offertes').update({
    ...velden(v), titel: String(v.inhoud.algemeen.projectnaam).slice(0, 160), bedrag_excl: prijs.excl || null, geldig_tot: v.inhoud.algemeen.geldig_tot,
    merk: v.merk, client_id: v.clientId, klant_naam: klant.naam, pdf_pad: pdf.pad, pdf_naam: pdf.naam, updated_at: nu(),
  }).eq('id', id).eq('status', 'concept').select('*')
  if (error) throw new Error(error.message)
  const na = ((data ?? [])[0] ?? null) as Offerte | null
  if (!na) { await admin.storage.from(OFFERTE_BUCKET).remove([pdf.pad]).catch(() => {}); throw new OfferteFout('Deze offerte werd intussen verstuurd. Maak een kopie om ze aan te passen.', 409) }
  if (o.pdf_pad !== pdf.pad) await admin.storage.from(OFFERTE_BUCKET).remove([o.pdf_pad]).catch(() => {})
  if (na.opdracht_id) {
    await admin.from('opdrachten').update({ bedrag_excl: prijs.excl || null, updated_at: nu() }).eq('id', na.opdracht_id).eq('aangemaakt_door_offerte', id).then(() => null, () => null)
    await vulKaartAan(admin, na.opdracht_id, v, id).catch(() => null)
  }
  return na
}

/** Kopie van een opgemaakte offerte: nieuw nummer, datum vandaag, geldig 30 dagen, als concept. */
export function kopieInhoud(inhoud: unknown, vandaag: string, geldigTot: string): OfferteInhoud {
  const i = leesInhoud(inhoud)
  return { ...i, algemeen: { ...i.algemeen, offertenummer: '', datum: vandaag, geldig_tot: geldigTot } }
}
