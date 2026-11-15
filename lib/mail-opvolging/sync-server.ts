import 'server-only'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { lijstAgendaEvents } from '@/lib/sales/google-calendar'
import { laadAdresboek, projectVanKlant, type ActiefProject } from './adresboek-server'
import { mailboxen, veiligeFout, type Mailbox } from './mailboxen'
import { schatAntwoordIn } from './ai'
import { isEigen, koppel, nieuwDeel, normEmail, type Adresboek } from './regels'

/**
 * Mailboxen lezen (IMAP, enkel lezen: niets verplaatsen, markeren of wissen).
 *
 *  · Inbox en Verzonden, vanaf de laatst gelezen mail (eerste keer: 60 dagen terug).
 *  · Enkel mails met iemand uit het adresboek (klanten, contactpersonen, leads)
 *    worden bewaard: afzender, ontvangers, onderwerp, datum en de koppeling. Al
 *    de rest lezen we niet verder en bewaren we niet.
 *  · Van een recent antwoord van een klant met een lopend project lezen we ook
 *    de tekst: een fragment van het nieuwe deel en een AI-inschatting (akkoord,
 *    vraag, weigering, uitstel). Geciteerde tekst en bijlagen gaan nooit mee.
 *  · Daarnaast de meetings uit de gekoppelde Google-agenda's met een klant als genodigde.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type MapResultaat = { mailbox: string; map: string; gelezen: number; bewaard: number; fout: string | null }
export type SyncResultaat = { gekoppeld: boolean; mappen: MapResultaat[]; meetings: number; agendaFout: string | null }

const DAGEN_TERUG = 60
const MAX_PER_MAP = 400
const AI_MAX = 20
const AI_DAGEN = 10

type Rij = {
  message_id: string; mailbox: string; map: string; uid: number; richting: 'in' | 'uit'; van: string | null; aan: string[]
  onderwerp: string | null; verzonden_op: string; in_reply_to: string | null; tegenpartij: string
  client_id: string | null; opdracht_id: string | null; fragment?: string | null; ai_soort?: string | null; ai_samenvatting?: string | null; ai_op?: string | null
}

function mapPaden(lijst: { path: string; specialUse?: string }[]): { inbox: string; verzonden: string | null } {
  const inbox = lijst.find((m) => m.specialUse === '\\Inbox')?.path ?? lijst.find((m) => m.path.toUpperCase() === 'INBOX')?.path ?? 'INBOX'
  const verzonden = lijst.find((m) => m.specialUse === '\\Sent')?.path
    ?? lijst.find((m) => /^(inbox[./])?(sent|sent items|sent messages|verzonden|verzonden items|verzonden berichten)$/i.test(m.path))?.path ?? null
  return { inbox, verzonden }
}

async function leesMailbox(admin: Admin, mb: Mailbox, boek: Adresboek, projecten: ActiefProject[], aiBudget: { over: number }): Promise<MapResultaat[]> {
  const eigen = new Set(mailboxen().map((m) => m.gebruiker))
  const perKlant = projectVanKlant(projecten)
  const actief = new Map(projecten.map((p) => [p.id, p]))
  const client = new ImapFlow({ host: mb.host, port: mb.poort, secure: mb.poort === 993, auth: { user: mb.gebruiker, pass: mb.wachtwoord }, logger: false, socketTimeout: 90_000 })
  const uit: MapResultaat[] = []
  try {
    await client.connect()
    const { inbox, verzonden } = mapPaden(await client.list())
    for (const [map, pad] of [['inbox', inbox], ['verzonden', verzonden]] as const) {
      if (!pad) { uit.push({ mailbox: mb.gebruiker, map, gelezen: 0, bewaard: 0, fout: 'Geen map Verzonden gevonden.' }); continue }
      const r: MapResultaat = { mailbox: mb.gebruiker, map, gelezen: 0, bewaard: 0, fout: null }
      const lock = await client.getMailboxLock(pad, { readOnly: true })
      try {
        const box = client.mailbox
        const uidValidity = box && typeof box === 'object' ? Number(box.uidValidity ?? 0) : 0
        const { data: st } = await admin.from('mail_sync_status').select('uidvalidity, laatste_uid').eq('mailbox', mb.gebruiker).eq('map', map).maybeSingle()
        const vorige = st && Number(st.uidvalidity) === uidValidity && st.laatste_uid ? Number(st.laatste_uid) : null
        const gevonden = vorige
          ? await client.search({ uid: `${vorige + 1}:*` }, { uid: true })
          : await client.search({ since: new Date(Date.now() - DAGEN_TERUG * 86_400_000) }, { uid: true })
        const uids = (Array.isArray(gevonden) ? gevonden : []).filter((u) => !vorige || u > vorige).sort((a, b) => a - b).slice(0, MAX_PER_MAP)
        const rijen: Rij[] = []
        if (uids.length) {
          for await (const m of client.fetch(uids, { uid: true, envelope: true, size: true }, { uid: true })) {
            r.gelezen++
            const env = m.envelope
            if (!env) continue
            const van = normEmail(env.from?.[0]?.address)
            const naar = [...(env.to ?? []), ...(env.cc ?? [])].map((a) => normEmail(a.address)).filter((e): e is string => !!e)
            const richting: 'in' | 'uit' = isEigen(van, eigen) ? 'uit' : 'in'
            const anderen = richting === 'uit' ? naar.filter((e) => !isEigen(e, eigen)) : [van]
            const k = koppel(anderen, boek)
            if (!k) continue
            const project = k.opdracht_id && actief.has(k.opdracht_id) ? actief.get(k.opdracht_id)! : k.client_id ? perKlant.get(k.client_id) ?? null : null
            const datum = env.date ? new Date(env.date) : new Date()
            rijen.push({
              message_id: (env.messageId ?? `${mb.gebruiker}:${map}:${uidValidity}:${m.uid}`).slice(0, 500), mailbox: mb.gebruiker, map, uid: m.uid, richting,
              van, aan: naar.slice(0, 30), onderwerp: env.subject ? String(env.subject).slice(0, 300) : null,
              verzonden_op: (isNaN(datum.getTime()) ? new Date() : datum).toISOString(), in_reply_to: env.inReplyTo ? String(env.inReplyTo).slice(0, 500) : null,
              tegenpartij: k.tegenpartij, client_id: k.client_id, opdracht_id: project?.id ?? k.opdracht_id ?? null,
              ...(m.size && m.size > 3_000_000 ? { fragment: null } : {}),
            })
          }
        }
        // Recente antwoorden van klanten met een lopend project: het nieuwe deel lezen en inschatten.
        for (const rij of rijen) {
          if (aiBudget.over <= 0) break
          if (rij.richting !== 'in' || !rij.opdracht_id || !actief.has(rij.opdracht_id)) continue
          if (Date.now() - new Date(rij.verzonden_op).getTime() > AI_DAGEN * 86_400_000 || rij.fragment === null) continue
          try {
            const msg = await client.fetchOne(String(rij.uid), { source: true }, { uid: true })
            if (!msg || !msg.source) continue
            const p = await simpleParser(msg.source, { skipImageLinks: true, skipTextToHtml: true })
            const tekst = nieuwDeel(p.text ?? '')
            rij.fragment = tekst.replace(/\s+/g, ' ').slice(0, 300) || null
            const project = actief.get(rij.opdracht_id)!
            const a = await schatAntwoordIn({ onderwerp: rij.onderwerp, tekst, fase: project.kolom })
            aiBudget.over--
            if (a) { rij.ai_soort = a.soort; rij.ai_samenvatting = a.samenvatting; rij.ai_op = new Date().toISOString() }
          } catch { /* inschatting is een extra */ }
        }
        if (rijen.length) {
          const { error } = await admin.from('mail_berichten').upsert(rijen.map((x) => ({ ...x, fragment: x.fragment ?? null })), { onConflict: 'message_id', ignoreDuplicates: true })
          if (error) throw new Error(error.message)
        }
        r.bewaard = rijen.length
        const laatste = uids.length ? uids[uids.length - 1] : vorige
        await admin.from('mail_sync_status').upsert({ mailbox: mb.gebruiker, map, pad, uidvalidity: uidValidity, laatste_uid: laatste, laatst_gelezen_op: new Date().toISOString(), aantal_bewaard: r.bewaard, fout: null }, { onConflict: 'mailbox,map' })
      } catch (e) {
        r.fout = veiligeFout(e, mb)
        await admin.from('mail_sync_status').upsert({ mailbox: mb.gebruiker, map, pad, fout: r.fout, laatst_gelezen_op: new Date().toISOString() }, { onConflict: 'mailbox,map' })
      } finally { lock.release() }
      uit.push(r)
    }
  } catch (e) {
    const fout = veiligeFout(e, mb)
    for (const map of ['inbox', 'verzonden']) {
      if (!uit.some((x) => x.map === map)) {
        uit.push({ mailbox: mb.gebruiker, map, gelezen: 0, bewaard: 0, fout })
        await admin.from('mail_sync_status').upsert({ mailbox: mb.gebruiker, map, fout, laatst_gelezen_op: new Date().toISOString() }, { onConflict: 'mailbox,map' })
      }
    }
  } finally {
    await client.logout().catch(() => client.close())
  }
  return uit
}

/** Gehouden meetings uit de gekoppelde Google-agenda's met een klant als genodigde (laatste 60 dagen). */
async function leesAgendaMeetings(admin: Admin, boek: Adresboek, projecten: ActiefProject[]): Promise<{ aantal: number; fout: string | null }> {
  const { data: koppelingen } = await admin.from('sales_calendar_connections').select('id, name, active').eq('active', true)
  const perKlant = projectVanKlant(projecten)
  const actief = new Set(projecten.map((p) => p.id))
  const nu = Date.now()
  let aantal = 0
  const fouten: string[] = []
  for (const k of (koppelingen ?? []) as { id: string; name: string }[]) {
    try {
      const events = await lijstAgendaEvents(k.id, nu - DAGEN_TERUG * 86_400_000, nu)
      const rijen = events
        .filter((e) => !e.geannuleerd && !e.heleDag && (e.genodigden?.length ?? 0) > 0)
        .map((e) => {
          const m = koppel((e.genodigden ?? []).filter((g) => !isEigen(g)), boek)
          if (!m) return null
          const project = m.opdracht_id && actief.has(m.opdracht_id) ? m.opdracht_id : m.client_id ? perKlant.get(m.client_id)?.id ?? null : null
          return { bron: 'google', event_id: `${e.agenda}:${e.id}`.slice(0, 500), agenda: k.name, titel: e.titel.slice(0, 300), start: e.start, eind: e.eind, genodigde: m.tegenpartij, client_id: m.client_id, opdracht_id: project ?? m.opdracht_id }
        })
        .filter((x): x is NonNullable<typeof x> => !!x)
      if (rijen.length) {
        const { error } = await admin.from('opvolg_meetings').upsert(rijen, { onConflict: 'bron,event_id' })
        if (error) throw new Error(error.message)
      }
      aantal += rijen.length
    } catch (e) { fouten.push(`${k.name}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200)) }
  }
  return { aantal, fout: fouten.length ? fouten.join(' · ') : null }
}

/** Alles lezen: mailboxen en agenda's. Veilig om vaak te draaien (enkel nieuwe mails, nooit dubbels). */
export async function leesMailEnAgenda(admin: Admin): Promise<SyncResultaat> {
  const boek = await laadAdresboek(admin)
  const lijst = mailboxen()
  const mappen: MapResultaat[] = []
  const aiBudget = { over: AI_MAX }
  for (const mb of lijst) mappen.push(...(await leesMailbox(admin, mb, boek, boek.projecten, aiBudget)))
  const agenda = await leesAgendaMeetings(admin, boek, boek.projecten).catch((e) => ({ aantal: 0, fout: e instanceof Error ? e.message : String(e) }))
  return { gekoppeld: lijst.length > 0, mappen, meetings: agenda.aantal, agendaFout: agenda.fout }
}
