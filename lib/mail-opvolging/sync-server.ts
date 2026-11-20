import 'server-only'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { lijstAgendaEvents } from '@/lib/sales/google-calendar'
import { laadAdresboek, projectVanKlant, type ActiefProject } from './adresboek-server'
import { mailboxen, mapPaden, veiligeFout, type Mailbox } from './mailboxen'
import { leesMailInhoud, type MailTaakVoorstel } from './ai'
import { isEigen, koppel, nieuwDeel, normEmail, type Adresboek } from './regels'
import { recenteTaken } from '@/lib/clickup'
import { lijktOp, isAfInClickup } from './taken'
import { zoekNieuweProjecten, type ProjectScan } from './projecten-server'

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
export type SyncResultaat = { gekoppeld: boolean; mappen: MapResultaat[]; meetings: number; agendaFout: string | null; projecten: ProjectScan[] }

const DAGEN_TERUG = 60
const MAX_PER_MAP = 400
const AI_MAX = 40
const AI_DAGEN = 7

type Rij = {
  message_id: string; mailbox: string; map: string; uid: number; richting: 'in' | 'uit'; van: string | null; aan: string[]
  onderwerp: string | null; verzonden_op: string; in_reply_to: string | null; tegenpartij: string
  client_id: string | null; opdracht_id: string | null; fragment?: string | null; ai_soort?: string | null; ai_samenvatting?: string | null; ai_op?: string | null
  taken?: MailTaakVoorstel[]
}


async function leesMailbox(admin: Admin, mb: Mailbox, boek: Adresboek & { namen: Map<string, string> }, projecten: ActiefProject[], aiBudget: { over: number }): Promise<MapResultaat[]> {
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
        // Al gelezen (bv. dezelfde mail in een andere mailbox)? Dan niet opnieuw laten lezen.
        const bekend = new Set<string>()
        if (rijen.length) {
          const { data: al } = await admin.from('mail_berichten').select('message_id').in('message_id', rijen.map((x) => x.message_id))
          for (const x of (al ?? []) as { message_id: string }[]) bekend.add(x.message_id)
        }
        // Recente mails met klanten: het nieuwe deel lezen. Antwoorden op een
        // lopend project krijgen een inschatting; uit elke mail komen de taken voor ons.
        for (const rij of rijen) {
          if (aiBudget.over <= 0) break
          if (bekend.has(rij.message_id) || rij.fragment === null) continue
          if (Date.now() - new Date(rij.verzonden_op).getTime() > AI_DAGEN * 86_400_000) continue
          try {
            const msg = await client.fetchOne(String(rij.uid), { source: true }, { uid: true })
            if (!msg || !msg.source) continue
            const p = await simpleParser(msg.source, { skipImageLinks: true, skipTextToHtml: true })
            const tekst = nieuwDeel(p.text ?? '')
            rij.fragment = tekst.replace(/\s+/g, ' ').slice(0, 300) || null
            const project = rij.opdracht_id ? actief.get(rij.opdracht_id) ?? null : null
            const klant = rij.client_id ? boek.namen.get(rij.client_id) ?? null : project?.klant ?? null
            const a = await leesMailInhoud({ richting: rij.richting, onderwerp: rij.onderwerp, tekst, datum: rij.verzonden_op, klant, fase: project?.kolom ?? null })
            aiBudget.over--
            if (a) {
              if (rij.richting === 'in' && project) { rij.ai_soort = a.soort; rij.ai_samenvatting = a.samenvatting }
              rij.ai_op = new Date().toISOString()
              rij.taken = a.taken
            }
          } catch { /* lezen is een extra */ }
        }
        if (rijen.length) {
          const { error } = await admin.from('mail_berichten').upsert(rijen.map(({ taken: _t, ...x }) => ({ ...x, fragment: x.fragment ?? null })), { onConflict: 'message_id', ignoreDuplicates: true })
          if (error) throw new Error(error.message)
          const metTaken = rijen.filter((x) => x.taken?.length)
          if (metTaken.length) {
            const { data: ids } = await admin.from('mail_berichten').select('id, message_id').in('message_id', metTaken.map((x) => x.message_id))
            const idVan = new Map(((ids ?? []) as { id: string; message_id: string }[]).map((x) => [x.message_id, x.id]))
            const taken = metTaken.flatMap((x) => (x.taken ?? []).map((t) => ({
              mail_id: idVan.get(x.message_id) ?? null, message_id: x.message_id, client_id: x.client_id, opdracht_id: x.opdracht_id,
              wat: t.wat, deadline: t.deadline, citaat: t.citaat, wie: t.wie, status: 'voorstel',
            })))
            // De unieke sleutel is (message_id, lower(wat)): een dubbel geeft 23505 en slaan we over.
            for (const t of taken) {
              const { error: e2 } = await admin.from('mail_taken').insert(t)
              if (e2 && !/23505|duplicate/i.test(`${(e2 as { code?: string }).code ?? ''} ${e2.message}`)) console.warn('[mail-taken]', e2.message)
            }
          }
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

/**
 * Taken uit de mail naast ClickUp leggen: staat het er al (open), of is het daar
 * al afgesloten? Dan valt het voorstel vanzelf weg uit "Te beslissen". En van
 * wat al in ClickUp stond, de status bijwerken.
 */
export async function controleerMailTaken(admin: Admin): Promise<{ gedaan: number; inClickup: number; fout: string | null }> {
  const { data } = await admin.from('mail_taken').select('id, wat, status, client_id, created_at, clickup_task_id').in('status', ['voorstel', 'in_clickup']).limit(500)
  const lijst = (data ?? []) as { id: string; wat: string; status: string; client_id: string | null; created_at: string; clickup_task_id: string | null }[]
  if (!lijst.length) return { gedaan: 0, inClickup: 0, fout: null }
  const kIds = [...new Set(lijst.map((t) => t.client_id).filter(Boolean))] as string[]
  const { data: kl } = kIds.length ? await admin.from('clients').select('id, company_name').in('id', kIds) : { data: [] }
  const naam = new Map(((kl ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
  const oudste = Math.min(...lijst.map((t) => new Date(t.created_at).getTime())) - 14 * 86_400_000
  let taken: Awaited<ReturnType<typeof recenteTaken>>
  try { taken = await recenteTaken(Math.max(oudste, Date.now() - 90 * 86_400_000)) } catch (e) { return { gedaan: 0, inClickup: 0, fout: e instanceof Error ? e.message : String(e) } }
  const perId = new Map(taken.map((t) => [t.id, t]))
  let gedaan = 0, inClickup = 0
  const nu = new Date().toISOString()
  for (const t of lijst) {
    const bestaand = t.clickup_task_id ? perId.get(t.clickup_task_id) : null
    if (t.status === 'in_clickup') {
      if (bestaand) await admin.from('mail_taken').update({ clickup_status_type: bestaand.type, updated_at: nu }).eq('id', t.id)
      continue
    }
    const hit = taken.find((x) => lijktOp({ wat: t.wat, klant: t.client_id ? naam.get(t.client_id) ?? null : null }, x))
    if (!hit) continue
    if (isAfInClickup(hit.type)) {
      gedaan++
      await admin.from('mail_taken').update({ status: 'al_gedaan', clickup_task_id: hit.id, clickup_url: hit.url, clickup_naam: hit.naam.slice(0, 200), clickup_status_type: hit.type, reden: 'Al afgesloten in ClickUp', updated_at: nu }).eq('id', t.id).eq('status', 'voorstel')
    } else {
      inClickup++
      await admin.from('mail_taken').update({ status: 'in_clickup', clickup_task_id: hit.id, clickup_url: hit.url, clickup_naam: hit.naam.slice(0, 200), clickup_status_type: hit.type, reden: 'Staat al in ClickUp', updated_at: nu }).eq('id', t.id).eq('status', 'voorstel')
    }
  }
  return { gedaan, inClickup, fout: null }
}

/** Alles lezen: mailboxen en agenda's. Veilig om vaak te draaien (enkel nieuwe mails, nooit dubbels). */
export async function leesMailEnAgenda(admin: Admin): Promise<SyncResultaat> {
  const start = Date.now()
  const boek = await laadAdresboek(admin)
  const lijst = mailboxen()
  const mappen: MapResultaat[] = []
  const aiBudget = { over: AI_MAX }
  for (const mb of lijst) mappen.push(...(await leesMailbox(admin, mb, boek, boek.projecten, aiBudget)))
  const agenda = await leesAgendaMeetings(admin, boek, boek.projecten).catch((e) => ({ aantal: 0, fout: e instanceof Error ? e.message : String(e) }))
  await controleerMailTaken(admin).catch(() => null)
  // Nieuwe projecten: wat niet past binnen de tijd van deze ronde, volgt de volgende keer.
  const projecten = await zoekNieuweProjecten(admin, boek, { tot: start + 230_000 }).catch((e) => [{ mailbox: '-', gelezen: 0, beoordeeld: 0, voorstellen: 0, fout: e instanceof Error ? e.message.slice(0, 200) : 'mislukt', klaar: false }])
  return { gekoppeld: lijst.length > 0, mappen, meetings: agenda.aantal, agendaFout: agenda.fout, projecten }
}
