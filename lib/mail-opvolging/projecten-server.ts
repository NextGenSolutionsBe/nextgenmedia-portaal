import 'server-only'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { kolomInfo, kolomVan, dienstInfo, isBedrijf, normaliseerDiensten, projectVerantwoordelijke } from '@/lib/opdrachten-kanban'
import { vandaagISO } from '@/lib/opdrachten'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { mailboxen, mapPaden, veiligeFout } from './mailboxen'
import { beoordeelProject } from './ai'
import { isEigen, koppel, nieuwDeel, normEmail, type Adresboek } from './regels'
import {
  EERSTE_KEER_DAGEN, MAX_LEEFTIJD_DAGEN, bedrijfVoor, contactRegels, isVoorstel, kaartNotitie, kaartVoorProspect, leesKoppen, lijktFormulier,
  massamail, naamSleutel, onderwerpSleutel, voorstelVerantwoordelijke, type Contact, type MailProjectStatus, type ProjectOordeel,
} from './projecten'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

/**
 * Nieuwe projecten uit de mail. Een aparte leesronde over de Inbox (enkel lezen,
 * met een eigen bladwijzer in mail_project_scan), naast de gewone mail-opvolging:
 *  · afzenders van ons eigen domein, nieuwsbrieven, meldingen en automatische
 *    mails slaan we over (`massamail`), een websiteformulier niet;
 *  · van wat overblijft gaat het nieuwe deel van de tekst naar de AI met de vraag
 *    "is dit een nieuw project?", met wat we van de afzender weten;
 *  · enkel een duidelijk ja wordt een voorstel (mail_projecten). Van al de rest
 *    bewaren we niets.
 * Een voorstel per mail en hoogstens één open voorstel per afzender. Staat de
 * prospect al op het bord (bv. een websiteaanvraag), dan geen voorstel.
 */

const MAX_PER_RONDE = 45
const MAX_UIDS = 400
const TEGELIJK = 4
const KOPPEN = ['list-unsubscribe', 'list-id', 'precedence', 'auto-submitted', 'x-autoreply', 'x-autorespond', 'x-auto-response-suppress']

export type ProjectScan = { mailbox: string; gelezen: number; beoordeeld: number; voorstellen: number; fout: string | null; klaar: boolean }

type Kaart = { id: string; client_id: string | null; klant_vrij: string | null; omschrijving: string | null; titel: string; status: string; diensten: string[] | null; updated_at: string }
type Kandidaat = {
  uid: number; message_id: string; van: string; vanNaam: string | null; onderwerp: string | null; ontvangen: string
  formulier: boolean; client_id: string | null; opdracht_id: string | null
}

const merkNaam = (mailbox: string) => (mailbox.endsWith('@nextgensolutions.be') ? 'NextGenSolutions' : 'NextGenMedia') as 'NextGenMedia' | 'NextGenSolutions'
const lopendeKolom = (status: string) => !['afgerond', 'stopgezet'].includes(kolomVan(status))

async function laadKaarten(admin: Admin): Promise<Kaart[]> {
  const { data } = await admin.from('opdrachten').select('id, client_id, klant_vrij, omschrijving, titel, status, diensten, updated_at').order('updated_at', { ascending: false }).limit(3000)
  return ((data ?? []) as Kaart[]).filter((k) => lopendeKolom(k.status))
}

const kaartContext = (k: Kaart) => ({ titel: k.titel, fase: kolomInfo(kolomVan(k.status)).label, diensten: (k.diensten ?? []).map((d) => dienstInfo(d).label) })

/** De bestaande klant bij een bedrijfsnaam (zonder rechtsvorm), enkel als er precies één is. */
function klantOpNaam(naam: string | null, namen: Map<string, string>): string | null {
  const s = naamSleutel(naam)
  if (s.length < 3) return null
  const hits = [...namen].filter(([, n]) => naamSleutel(n) === s)
  return hits.length === 1 ? hits[0][0] : null
}

/** Eén mailbox: nieuwe mails in de Inbox sinds de bladwijzer, beoordelen zolang er budget en tijd is. */
async function scanMailbox(admin: Admin, mb: ReturnType<typeof mailboxen>[number], boek: Adresboek & { namen: Map<string, string> }, kaarten: Kaart[], budget: { over: number; tot: number }): Promise<ProjectScan> {
  const eigen = new Set(mailboxen().map((m) => m.gebruiker))
  const uit: ProjectScan = { mailbox: mb.gebruiker, gelezen: 0, beoordeeld: 0, voorstellen: 0, fout: null, klaar: true }
  const client = new ImapFlow({ host: mb.host, port: mb.poort, secure: mb.poort === 993, auth: { user: mb.gebruiker, pass: mb.wachtwoord }, logger: false, socketTimeout: 90_000 })
  let uidValidity = 0
  let laatste: number | null = null
  try {
    await client.connect()
    const { inbox } = mapPaden(await client.list())
    const lock = await client.getMailboxLock(inbox, { readOnly: true })
    try {
      const box = client.mailbox
      uidValidity = box && typeof box === 'object' ? Number(box.uidValidity ?? 0) : 0
      const { data: st } = await admin.from('mail_project_scan').select('uidvalidity, laatste_uid').eq('mailbox', mb.gebruiker).maybeSingle()
      const vorige = st && Number(st.uidvalidity) === uidValidity && st.laatste_uid ? Number(st.laatste_uid) : null
      laatste = vorige
      const gevonden = vorige
        ? await client.search({ uid: `${vorige + 1}:*` }, { uid: true })
        : await client.search({ since: new Date(Date.now() - EERSTE_KEER_DAGEN * 86_400_000) }, { uid: true })
      const uids = (Array.isArray(gevonden) ? gevonden : []).filter((u) => !vorige || u > vorige).sort((a, b) => a - b).slice(0, MAX_UIDS)
      if (!uids.length) return uit

      // Goedkoop: enkel de envelop en een paar koppen. Daarmee vallen de meeste mails al af.
      const perUid = new Map<number, Kandidaat | null>()
      for await (const m of client.fetch(uids, { uid: true, envelope: true, headers: KOPPEN }, { uid: true })) {
        uit.gelezen++
        const env = m.envelope
        const van = normEmail(env?.from?.[0]?.address)
        const datum = env?.date ? new Date(env.date) : new Date()
        const ontvangen = (isNaN(datum.getTime()) ? new Date() : datum).toISOString()
        const onderwerp = env?.subject ? String(env.subject).slice(0, 300) : null
        const ontvangers = [...(env?.to ?? []), ...(env?.cc ?? [])].length
        const koppen = leesKoppen(m.headers ? m.headers.toString('utf8') : '')
        const formulier = lijktFormulier(onderwerp)
        const overslaan = !env || !van
          || (isEigen(van, eigen) && !formulier)
          || Date.now() - new Date(ontvangen).getTime() > MAX_LEEFTIJD_DAGEN * 86_400_000
          || !!massamail({ van, onderwerp, koppen, aantalOntvangers: ontvangers })
        if (overslaan) { perUid.set(m.uid, null); continue }
        const k = isEigen(van, eigen) ? null : koppel([van], boek)
        perUid.set(m.uid, {
          uid: m.uid, message_id: (env.messageId ?? `${mb.gebruiker}:inbox:${uidValidity}:${m.uid}`).slice(0, 500), van: van!, vanNaam: env.from?.[0]?.name ? String(env.from[0].name).slice(0, 120) : null,
          onderwerp, ontvangen, formulier, client_id: k?.client_id ?? null, opdracht_id: k?.opdracht_id ?? null,
        })
      }

      // Al beoordeeld, al een open voorstel van die afzender, of hetzelfde gesprek al beslist? Dan niet opnieuw.
      const kandidaten = [...perUid.values()].filter((x): x is Kandidaat => !!x)
      const bekend = new Set<string>(), openVan = new Set<string>(), gesprek = new Set<string>()
      if (kandidaten.length) {
        const { data: al } = await admin.from('mail_projecten').select('message_id').in('message_id', kandidaten.map((x) => x.message_id))
        for (const x of (al ?? []) as { message_id: string }[]) bekend.add(x.message_id)
        const vanaf = new Date(Date.now() - 60 * 86_400_000).toISOString()
        const { data: rec } = await admin.from('mail_projecten').select('van, onderwerp_sleutel, status').in('van', [...new Set(kandidaten.map((x) => x.van))]).gte('ontvangen_op', vanaf)
        for (const x of (rec ?? []) as { van: string; onderwerp_sleutel: string | null; status: string }[]) {
          if (x.status === 'voorstel') openVan.add(x.van)
          gesprek.add(`${x.van}|${x.onderwerp_sleutel ?? ''}`)
        }
      }

      const openKaarten = kaarten
      const perKlant = new Map<string, Kaart[]>()
      for (const k of openKaarten) if (k.client_id) perKlant.set(k.client_id, [...(perKlant.get(k.client_id) ?? []), k])

      let rij: Kandidaat[] = []
      let rijTot = laatste
      const verwerk = async (): Promise<boolean> => {
        if (!rij.length) return true
        // Tekst ophalen (één verbinding, na elkaar), dan de AI tegelijk.
        const teksten: (string | null)[] = []
        for (const c of rij) {
          try {
            const msg = await client.fetchOne(String(c.uid), { source: true }, { uid: true })
            if (!msg || !msg.source || msg.source.length > 3_000_000) { teksten.push(null); continue }
            const p = await simpleParser(msg.source, { skipImageLinks: true, skipTextToHtml: true })
            teksten.push(nieuwDeel(p.text ?? (typeof p.html === 'string' ? p.html.replace(/<[^>]+>/g, ' ') : ''), 3000) || null)
          } catch { teksten.push(null) }
        }
        const oordelen = await Promise.allSettled(rij.map(async (c, i) => {
          const t = teksten[i]
          if (!t) return null
          const prospectKaart = !c.client_id && !c.formulier ? kaartVoorProspect({ email: c.van, bedrijf: null }, openKaarten) : null
          const lopend = c.client_id ? (perKlant.get(c.client_id) ?? []) : c.opdracht_id ? openKaarten.filter((k) => k.id === c.opdracht_id) : prospectKaart ? [prospectKaart] : []
          budget.over--
          uit.beoordeeld++
          return beoordeelProject({
            onderwerp: c.onderwerp, tekst: t, datum: c.ontvangen, van: c.formulier ? null : c.van, vanNaam: c.formulier ? null : c.vanNaam,
            klant: c.client_id ? boek.namen.get(c.client_id) ?? null : null, lopend: lopend.map(kaartContext), merk: merkNaam(mb.gebruiker), formulier: c.formulier,
          })
        }))
        for (let i = 0; i < rij.length; i++) {
          const r = oordelen[i]
          if (r.status === 'rejected') {
            // De AI was niet bereikbaar: deze mail en wat volgt de volgende ronde opnieuw.
            uit.fout = r.reason instanceof Error ? r.reason.message.slice(0, 200) : 'AI niet bereikbaar'
            laatste = Math.max(laatste ?? 0, rij[i].uid - 1) || laatste
            rij = []
            return false
          }
          const o = r.value
          if (isVoorstel(o)) { if (await bewaarVoorstel(admin, mb.gebruiker, rij[i], o!, boek, openKaarten, perKlant)) uit.voorstellen++ }
        }
        rij = []
        laatste = rijTot
        return true
      }

      for (const uid of uids) {
        const c = perUid.get(uid) ?? null
        const sleutel = c ? `${c.van}|${onderwerpSleutel(c.onderwerp)}` : ''
        // Een formulier komt altijd van hetzelfde adres met hetzelfde onderwerp: daar enkel per mail ontdubbelen.
        const nodig = !!c && !bekend.has(c.message_id) && (c.formulier || (!openVan.has(c.van) && !gesprek.has(sleutel)))
        if (nodig) {
          if (budget.over - rij.length <= 0 || Date.now() > budget.tot) { uit.klaar = false; break }
          rij.push(c!)
          if (!c!.formulier) { openVan.add(c!.van); gesprek.add(sleutel) }
        }
        rijTot = uid
        if (rij.length >= TEGELIJK && !(await verwerk())) { uit.klaar = false; break }
      }
      if (uit.klaar && !(await verwerk())) uit.klaar = false
      else if (!uit.klaar) await verwerk()
      if (uit.klaar) laatste = uids[uids.length - 1]
    } finally { lock.release() }
  } catch (e) {
    uit.fout = veiligeFout(e, mb)
    uit.klaar = false
  } finally {
    await client.logout().catch(() => client.close())
    await admin.from('mail_project_scan').upsert({ mailbox: mb.gebruiker, uidvalidity: uidValidity || null, laatste_uid: laatste, laatst_gelezen_op: new Date().toISOString(), beoordeeld: uit.beoordeeld, fout: uit.fout }, { onConflict: 'mailbox' }).then(() => null, () => null)
  }
  return uit
}

/** Een ja van de AI bewaren als voorstel (of als "al op het bord" als de prospect er al staat). */
async function bewaarVoorstel(admin: Admin, mailbox: string, c: Kandidaat, o: ProjectOordeel, boek: Adresboek & { namen: Map<string, string> }, kaarten: Kaart[], perKlant: Map<string, Kaart[]>): Promise<boolean> {
  let clientId = c.client_id
  if (!clientId && o.contact.email) clientId = koppel([o.contact.email], boek)?.client_id ?? null
  if (!clientId) clientId = klantOpNaam(o.contact.bedrijf, boek.namen)
  const email = o.contact.email ?? (c.formulier ? null : c.van)
  let status: MailProjectStatus = 'voorstel'
  let lopende: string | null = null
  if (clientId) {
    // Bestaande klant: een lopende kaart in een vroege fase tonen we als hint, de mens beslist.
    lopende = (perKlant.get(clientId) ?? []).find((k) => ['potentieel', 'offerte', 'geaccepteerd'].includes(kolomVan(k.status)))?.id ?? null
  } else {
    const al = kaartVoorProspect({ email, bedrijf: o.contact.bedrijf, van: c.formulier ? null : c.van }, kaarten)
    if (al) { status = 'al_op_bord'; lopende = al.id }
  }
  const contact: Contact = { ...o.contact, email, naam: o.contact.naam ?? (c.formulier ? null : c.vanNaam) }
  const { error } = await admin.from('mail_projecten').insert({
    message_id: c.message_id, mailbox, van: c.van, van_naam: c.vanNaam, onderwerp: c.onderwerp, onderwerp_sleutel: onderwerpSleutel(c.onderwerp), ontvangen_op: c.ontvangen,
    formulier: c.formulier, client_id: clientId, lopende_opdracht_id: lopende, status, zekerheid: o.zekerheid, reden: o.reden, titel: o.titel, samenvatting: o.samenvatting,
    project: o.project, diensten: o.diensten, ads: o.ads, contact, email,
  })
  if (error && !/23505|duplicate/i.test(`${(error as { code?: string }).code ?? ''} ${error.message}`)) console.warn('[mail-projecten]', error.message)
  return !error && status === 'voorstel'
}

/** Alle mailboxen: nieuwe projecten zoeken. `tot` = tijdstip waarop we stoppen (de rest volgt bij de volgende ronde). */
export async function zoekNieuweProjecten(admin: Admin, boek: Adresboek & { namen: Map<string, string> }, opts: { tot: number; max?: number }): Promise<ProjectScan[]> {
  const lijst = mailboxen()
  if (!lijst.length || !process.env.ANTHROPIC_API_KEY) return []
  const kaarten = await laadKaarten(admin)
  const budget = { over: opts.max ?? MAX_PER_RONDE, tot: opts.tot }
  const uit: ProjectScan[] = []
  for (const mb of lijst) {
    if (Date.now() > opts.tot) break
    uit.push(await scanMailbox(admin, mb, boek, kaarten, budget))
  }
  return uit
}

// ── Lijst en beslissingen ───────────────────────────────────────────────────

export type MailProject = {
  id: string; status: MailProjectStatus; mailbox: string; merk: string
  van: string | null; van_naam: string | null; onderwerp: string | null; ontvangen_op: string; formulier: boolean
  client_id: string | null; klant: string | null; titel: string | null; samenvatting: string | null; project: string | null; reden: string | null; zekerheid: number | null
  diensten: string[]; contact: Contact; verantwoordelijke: string
  lopend: { id: string; titel: string; fase: string } | null
  kaart: { id: string; titel: string } | null
  beslist_door: string | null; beslist_op: string | null
}

const UUID = /^[0-9a-f-]{36}$/i

/** Open voorstellen en de beslissingen van de laatste 30 dagen. */
export async function mailProjectenLijst(admin: Admin): Promise<MailProject[]> {
  const sinds = new Date(Date.now() - 45 * 86_400_000).toISOString()
  const { data, error } = await admin.from('mail_projecten').select('*').gte('ontvangen_op', sinds).neq('status', 'al_op_bord').order('ontvangen_op', { ascending: false }).limit(200)
  if (error) return []
  const rijen = (data ?? []) as Record<string, unknown>[]
  const ids = (k: string) => [...new Set(rijen.map((r) => r[k]).filter((x): x is string => typeof x === 'string' && UUID.test(x)))]
  const kaartIds = [...new Set([...ids('opdracht_id'), ...ids('lopende_opdracht_id')])]
  const [kl, op] = await Promise.all([
    ids('client_id').length ? admin.from('clients').select('id, company_name').in('id', ids('client_id')) : { data: [] },
    kaartIds.length ? admin.from('opdrachten').select('id, titel, status').in('id', kaartIds) : { data: [] },
  ])
  const naam = new Map(((kl.data ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
  const kaart = new Map(((op.data ?? []) as { id: string; titel: string; status: string }[]).map((k) => [k.id, k]))
  return rijen.map((r) => {
    const diensten = Array.isArray(r.diensten) ? (r.diensten as string[]) : []
    const contact = { bedrijf: null, naam: null, email: null, telefoon: null, website: null, btw: null, ...((r.contact ?? {}) as Partial<Contact>) } as Contact
    const lop = r.lopende_opdracht_id ? kaart.get(r.lopende_opdracht_id as string) : null
    const gemaakt = r.opdracht_id ? kaart.get(r.opdracht_id as string) : null
    return {
      id: r.id as string, status: r.status as MailProjectStatus, mailbox: r.mailbox as string, merk: bedrijfVoor(r.mailbox as string, diensten),
      van: (r.van as string | null) ?? null, van_naam: (r.van_naam as string | null) ?? null, onderwerp: (r.onderwerp as string | null) ?? null,
      ontvangen_op: r.ontvangen_op as string, formulier: !!r.formulier,
      client_id: (r.client_id as string | null) ?? null, klant: r.client_id ? naam.get(r.client_id as string) ?? null : null,
      titel: (r.titel as string | null) ?? null, samenvatting: (r.samenvatting as string | null) ?? null, project: (r.project as string | null) ?? null,
      reden: (r.reden as string | null) ?? null, zekerheid: r.zekerheid == null ? null : Number(r.zekerheid),
      diensten, contact, verantwoordelijke: voorstelVerantwoordelijke(diensten, (r.ads as ProjectOordeel['ads']) ?? null),
      lopend: lop && lopendeKolom(lop.status) ? { id: lop.id, titel: lop.titel, fase: kolomInfo(kolomVan(lop.status)).label } : null,
      kaart: gemaakt ? { id: gemaakt.id, titel: gemaakt.titel } : null,
      beslist_door: (r.beslist_door as string | null) ?? null, beslist_op: (r.beslist_op as string | null) ?? null,
    }
  })
}

export class MailProjectFout extends Error {
  constructor(public publiek: string, public status = 400) { super(publiek) }
}

/**
 * Ja: een projectkaart in Opvolging met de gegevens uit de mail. De klant (of de
 * naam van de prospect), titel, diensten, bedrijf en verantwoordelijke komen uit
 * het venster; de verantwoordelijke is verplicht. Twee keer klikken = één kaart.
 */
export async function maakKaartUitMail(
  admin: Admin, id: string,
  b: { titel?: unknown; klant?: unknown; client_id?: unknown; diensten?: unknown; merk?: unknown; verantwoordelijke?: unknown },
  door: { email: string | null; naam: string | null },
): Promise<{ opdrachtId: string }> {
  const { data } = await admin.from('mail_projecten').select('*').eq('id', id).maybeSingle()
  const r = data as (Record<string, unknown> & { status: MailProjectStatus; opdracht_id: string | null }) | null
  if (!r) throw new MailProjectFout('Voorstel niet gevonden.', 404)
  if (r.status === 'ja' && r.opdracht_id) return { opdrachtId: r.opdracht_id }
  if (r.status !== 'voorstel') throw new MailProjectFout('Hierover werd al beslist.', 409)

  const verantwoordelijke = projectVerantwoordelijke(b.verantwoordelijke)
  if (!verantwoordelijke) throw new MailProjectFout('Kies een verantwoordelijke: Marco, Bram, Chiara of gezamenlijke lead.')
  const titel = String(b.titel ?? r.titel ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (!titel) throw new MailProjectFout('Geef het project een titel.')
  let clientId: string | null = typeof b.client_id === 'string' && UUID.test(b.client_id) ? b.client_id : b.client_id === null ? null : (r.client_id as string | null)
  if (clientId) {
    const { data: k } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle()
    if (!k) clientId = null
  }
  const contact = { bedrijf: null, naam: null, email: null, telefoon: null, website: null, btw: null, ...((r.contact ?? {}) as Partial<Contact>) } as Contact
  const klantVrij = clientId ? null : (String(b.klant ?? '').replace(/\s+/g, ' ').trim() || contact.bedrijf || contact.naam || (r.van as string | null) || '').slice(0, 120)
  if (!clientId && !klantVrij) throw new MailProjectFout('Geef de naam van de klant of het bedrijf.')
  const diensten = normaliseerDiensten(b.diensten !== undefined ? b.diensten : r.diensten)
  const merk = isBedrijf(b.merk) ? b.merk : bedrijfVoor(r.mailbox as string, diensten)

  // Eerst het voorstel vastnemen: wie tweemaal klikt, maakt geen tweede kaart.
  const nu = new Date().toISOString()
  const { data: genomen } = await admin.from('mail_projecten').update({ status: 'ja', beslist_door: door.naam ?? door.email, beslist_op: nu, updated_at: nu }).eq('id', id).eq('status', 'voorstel').select('id')
  if (!(genomen as unknown[] | null)?.length) {
    const { data: nog } = await admin.from('mail_projecten').select('status, opdracht_id').eq('id', id).maybeSingle()
    const n = nog as { status: string; opdracht_id: string | null } | null
    if (n?.status === 'ja' && n.opdracht_id) return { opdrachtId: n.opdracht_id }
    throw new MailProjectFout('Hierover werd net al beslist.', 409)
  }

  const rij: Record<string, unknown> = {
    client_id: clientId, klant_vrij: klantVrij, titel, omschrijving: contactRegels(contact) || null,
    status: 'open', status_bron: 'handmatig', status_gewijzigd_op: nu, verantwoordelijke, aangemaakt_door_email: door.email,
    bron: 'inbound', diensten, merk, datum: vandaagISO(),
  }
  let { data: nieuw, error } = await admin.from('opdrachten').insert(rij).select('id').single()
  if (error && /merk|datum|bron|diensten|schema cache|column/i.test(error.message)) {
    delete rij.merk; delete rij.datum
    ;({ data: nieuw, error } = await admin.from('opdrachten').insert(rij).select('id').single())
  }
  if (error || !nieuw) {
    await admin.from('mail_projecten').update({ status: 'voorstel', beslist_door: null, beslist_op: null, updated_at: new Date().toISOString() }).eq('id', id)
    throw new MailProjectFout(`De kaart kon niet gemaakt worden: ${error?.message ?? 'onbekende fout'}`, 500)
  }
  const opdrachtId = String((nieuw as { id: string }).id)
  await admin.from('mail_projecten').update({ opdracht_id: opdrachtId, updated_at: new Date().toISOString() }).eq('id', id)
  await voegNotitieToe(admin, opdrachtId, kaartNotitie({
    van: (r.van as string | null) ?? null, vanNaam: (r.van_naam as string | null) ?? null, onderwerp: (r.onderwerp as string | null) ?? null,
    ontvangen: r.ontvangen_op as string, samenvatting: (r.samenvatting as string | null) ?? null, project: (r.project as string | null) ?? null,
  }), 'systeem', null).catch(() => null)
  return { opdrachtId }
}

/** Nee (geen nieuw project), of een nee terugzetten naar de voorstellen. */
export async function zetMailProject(admin: Admin, id: string, naar: 'nee' | 'voorstel', door: string | null): Promise<void> {
  const van = naar === 'nee' ? 'voorstel' : 'nee'
  const nu = new Date().toISOString()
  const { data } = await admin.from('mail_projecten').update({ status: naar, beslist_door: naar === 'nee' ? door : null, beslist_op: naar === 'nee' ? nu : null, updated_at: nu }).eq('id', id).eq('status', van).select('id')
  if (!(data as unknown[] | null)?.length) throw new MailProjectFout(naar === 'nee' ? 'Hierover werd al beslist.' : 'Dit voorstel staat niet op nee.', 409)
}
