import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ImapFlow } from 'imapflow'
import { simpleParser } from 'mailparser'
import { mailboxen, veiligeFout, mapPaden, type Mailbox } from '@/lib/mail-opvolging/mailboxen'
import { normEmail, nieuwDeel } from '@/lib/mail-opvolging/regels'
import { leesKoppen, massamail } from '@/lib/mail-opvolging/projecten'
import { leesIcs, vergaderLink, kuisBeschrijving, type IcsEvent } from '@/lib/agenda/ics'
import { zoneNaarIso } from '@/lib/meetings/model'

type Admin = SupabaseClient

/**
 * Uitnodigingen in de mail (Teams, Google Meet, Zoom, Outlook) als voorstel in
 * de agenda. Enkel lezen: niets wordt ingepland of beantwoord zonder klik.
 *
 * Met een agendabestand (bijna altijd) lezen we dat. Zonder, maar met een
 * vergaderlink en een onderwerp dat op een meeting lijkt, vraagt de AI wanneer
 * het is; vindt die geen duidelijke datum en uur, dan geen voorstel.
 * Een wijziging of annulering van een meeting die al voorgesteld of ingepland
 * is, wordt herkend aan de UID en komt als nieuw voorstel ("gewijzigd",
 * "geannuleerd") met de vorige erbij.
 */

const EERSTE_KEER_DAGEN = 14
const MAX_UIDS = 400
const MAX_AI = 8
const KOPPEN = ['list-unsubscribe', 'list-id', 'precedence', 'auto-submitted', 'x-autoreply', 'x-autorespond', 'x-auto-response-suppress']
const LIJKT_MEETING = /uitnodiging|invitation|invite|meeting|vergadering|afspraak|teams|zoom|webinar|google meet|call|gesprek|overleg|bijgewerkt|updated|geannuleerd|cancel|verplaatst|accepted|aanvaard/i
const ANTWOORD = /^(accepted|declined|tentative|geaccepteerd|aanvaard|geweigerd|voorlopig|accepté|refusé)\s*:/i

type Scan = { mailbox: string; gelezen: number; voorstellen: number; fout: string | null }

type Deel = { type?: string; childNodes?: Deel[]; part?: string; disposition?: string; parameters?: Record<string, string>; dispositionParameters?: Record<string, string> }

/** Zit er een agendabestand in? (text/calendar of een .ics-bijlage) */
function heeftAgendabestand(s: Deel | undefined): boolean {
  if (!s) return false
  const t = (s.type ?? '').toLowerCase()
  const naam = (s.parameters?.name ?? s.dispositionParameters?.filename ?? '').toLowerCase()
  if (t === 'text/calendar' || t === 'application/ics' || naam.endsWith('.ics')) return true
  return (s.childNodes ?? []).some(heeftAgendabestand)
}

/** De AI leest een mail zonder agendabestand: wanneer is de meeting? Geen duidelijke datum en uur = null. */
async function aiMoment(p: { onderwerp: string | null; tekst: string; ontvangen: string }): Promise<{ titel: string; start_op: string; eind_op: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  const dag = p.ontvangen.slice(0, 10)
  const prompt = `Hieronder staat een mail (ontvangen op ${dag}, Belgische tijd) met een link naar een online meeting.
Onderwerp: ${(p.onderwerp ?? '').slice(0, 200)}
---
${p.tekst.slice(0, 2500)}
---
Geef UITSLUITEND geldige JSON: {"titel": "korte titel van de meeting, max 80 tekens", "datum": "JJJJ-MM-DD of null", "van": "HH:MM of null", "tot": "HH:MM of null", "zeker": 0.0-1.0}
Enkel als de mail duidelijk zegt wanneer de meeting is (reken "morgen", "donderdag" om vanaf ${dag}). Uren in Belgische tijd. Geen einduur genoemd = null. Twijfel = datum null.`
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6', max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) throw new Error(`AI ${res.status}`)
    const json = await res.json().catch(() => null)
    const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
    const a = text.indexOf('{'), z = text.lastIndexOf('}')
    if (a < 0 || z < 0) return null
    const r = JSON.parse(text.slice(a, z + 1)) as { titel?: unknown; datum?: unknown; van?: unknown; tot?: unknown; zeker?: unknown }
    const datum = typeof r.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.datum) ? r.datum : null
    const van = typeof r.van === 'string' && /^\d{2}:\d{2}$/.test(r.van) ? r.van : null
    if (!datum || !van || Number(r.zeker ?? 0) < 0.7) return null
    const tot = typeof r.tot === 'string' && /^\d{2}:\d{2}$/.test(r.tot) && r.tot > van ? r.tot : null
    const start = zoneNaarIso(datum, van)
    return { titel: String(r.titel ?? p.onderwerp ?? 'Meeting').replace(/\s+/g, ' ').trim().slice(0, 200) || 'Meeting', start_op: start, eind_op: tot ? zoneNaarIso(datum, tot) : new Date(Date.parse(start) + 3600_000).toISOString() }
  } catch (e) { throw e instanceof Error ? e : new Error('AI niet bereikbaar') }
}

type Context = { eigenLinks: Set<string>; eigenUids: Set<string> }

/** Wat al in de app staat (eigen meetings met hun Meet-link of Google-id) komt nooit als voorstel. */
async function laadContext(admin: Admin): Promise<Context> {
  const vanaf = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const [{ data: km }, { data: items }] = await Promise.all([
    admin.from('klant_meetings').select('meet_url, google_event_id').gte('starts_at', vanaf).limit(2000),
    admin.from('ag_items').select('meet_url').not('meet_url', 'is', null).gte('eind_op', vanaf).is('verwijderd_op', null).limit(2000),
  ])
  const eigenLinks = new Set<string>(), eigenUids = new Set<string>()
  for (const r of (km ?? []) as { meet_url: string | null; google_event_id: string | null }[]) {
    if (r.meet_url) eigenLinks.add(r.meet_url.split('?')[0].toLowerCase())
    if (r.google_event_id) eigenUids.add(`${r.google_event_id}@google.com`.toLowerCase())
  }
  for (const r of (items ?? []) as { meet_url: string }[]) eigenLinks.add(r.meet_url.split('?')[0].toLowerCase())
  return { eigenLinks, eigenUids }
}

async function bewaar(admin: Admin, mb: string, mail: { message_id: string; van: string; vanNaam: string | null; onderwerp: string | null; ontvangen: string }, ev: Omit<IcsEvent, 'methode'> & { bron: 'ics' | 'ai' }, ctx: Context): Promise<boolean> {
  if (!ev.start_op) return false
  // Voorbij (meer dan een dag) of al in de app: niet voorstellen.
  if (Date.parse(ev.eind_op ?? ev.start_op) < Date.now() - 86_400_000 && !ev.geannuleerd) return false
  if (ev.uid && ctx.eigenUids.has(ev.uid.toLowerCase())) return false
  if (!ev.geannuleerd && ev.meet_url && ctx.eigenLinks.has(ev.meet_url.split('?')[0].toLowerCase())) return false

  // Dezelfde meeting al eerder gezien (zelfde UID)?
  let vervangt: string | null = null
  if (ev.uid) {
    const { data: vorige } = await admin.from('ag_mail_voorstellen').select('id, status, item_id, start_op, eind_op, geannuleerd').eq('ics_uid', ev.uid).order('ontvangen_op', { ascending: false }).limit(1)
    const v = (vorige ?? [])[0] as { id: string; status: string; item_id: string | null; start_op: string | null; eind_op: string | null; geannuleerd: boolean } | undefined
    if (v) {
      const ms = (x: string | null) => (x ? Date.parse(x) : null)
      const zelfde = ms(v.start_op) === ms(ev.start_op) && ms(v.eind_op) === ms(ev.eind_op) && v.geannuleerd === ev.geannuleerd
      if (zelfde) return false
      if (v.status === 'voorstel') {
        // Nog niet beslist: het voorstel gewoon bijwerken naar de laatste versie.
        await admin.from('ag_mail_voorstellen').update({
          message_id: mail.message_id, onderwerp: mail.onderwerp, ontvangen_op: mail.ontvangen, titel: ev.titel, start_op: ev.start_op, eind_op: ev.eind_op,
          locatie: ev.locatie, meet_url: ev.meet_url, platform: ev.platform, deelnemers: ev.deelnemers, beschrijving: ev.beschrijving, geannuleerd: ev.geannuleerd,
        }).eq('id', v.id)
        return true
      }
      if (v.status === 'ingepland' && v.item_id) vervangt = v.item_id
      else if (ev.geannuleerd) return false // nooit ingepland en nu geannuleerd: niets te doen
    } else if (ev.geannuleerd) return false
  }
  const { error } = await admin.from('ag_mail_voorstellen').insert({
    mailbox: mb, message_id: mail.message_id, van: mail.van, van_naam: mail.vanNaam, onderwerp: mail.onderwerp, ontvangen_op: mail.ontvangen,
    titel: ev.titel, start_op: ev.start_op, eind_op: ev.eind_op, locatie: ev.locatie, meet_url: ev.meet_url, platform: ev.platform,
    deelnemers: ev.deelnemers, organisator: ev.organisator, beschrijving: ev.beschrijving, bron: ev.bron, status: 'voorstel',
    ics_uid: ev.uid, geannuleerd: ev.geannuleerd, vervangt_item_id: vervangt,
  })
  return !error
}

async function scanMailbox(admin: Admin, mb: Mailbox, ctx: Context, tot: number, ai: { over: number }): Promise<Scan> {
  const uit: Scan = { mailbox: mb.gebruiker, gelezen: 0, voorstellen: 0, fout: null }
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
      const { data: st } = await admin.from('ag_mail_scan').select('uidvalidity, laatste_uid').eq('mailbox', mb.gebruiker).maybeSingle()
      const vorige = st && Number(st.uidvalidity) === uidValidity && st.laatste_uid ? Number(st.laatste_uid) : null
      laatste = vorige
      const gevonden = vorige
        ? await client.search({ uid: `${vorige + 1}:*` }, { uid: true })
        : await client.search({ since: new Date(Date.now() - EERSTE_KEER_DAGEN * 86_400_000) }, { uid: true })
      const uids = (Array.isArray(gevonden) ? gevonden : []).filter((u) => !vorige || u > vorige).sort((a, b) => a - b).slice(0, MAX_UIDS)
      if (!uids.length) return uit

      // Eerst goedkoop: envelop, structuur en een paar koppen.
      const kandidaten: { uid: number; ics: boolean; message_id: string; van: string; vanNaam: string | null; onderwerp: string | null; ontvangen: string }[] = []
      for await (const m of client.fetch(uids, { uid: true, envelope: true, bodyStructure: true, headers: KOPPEN }, { uid: true })) {
        uit.gelezen++
        const env = m.envelope
        const van = normEmail(env?.from?.[0]?.address)
        if (!env || !van) continue
        const onderwerp = env.subject ? String(env.subject).slice(0, 300) : null
        if (onderwerp && ANTWOORD.test(onderwerp)) continue // "Accepted: …" is een antwoord, geen uitnodiging
        const ics = heeftAgendabestand(m.bodyStructure as Deel | undefined)
        if (!ics) {
          if (!onderwerp || !LIJKT_MEETING.test(onderwerp)) continue
          if (massamail({ van, onderwerp, koppen: leesKoppen(m.headers ? m.headers.toString('utf8') : ''), aantalOntvangers: [...(env.to ?? []), ...(env.cc ?? [])].length })) continue
        }
        const datum = env.date ? new Date(env.date) : new Date()
        kandidaten.push({
          uid: m.uid, ics, van, vanNaam: env.from?.[0]?.name ? String(env.from[0].name).slice(0, 120) : null, onderwerp,
          message_id: (env.messageId ?? `${mb.gebruiker}:inbox:${uidValidity}:${m.uid}`).slice(0, 500),
          ontvangen: (isNaN(datum.getTime()) ? new Date() : datum).toISOString(),
        })
      }
      const { data: al } = kandidaten.length ? await admin.from('ag_mail_voorstellen').select('message_id').in('message_id', kandidaten.map((k) => k.message_id)) : { data: [] }
      const bekend = new Set(((al ?? []) as { message_id: string }[]).map((x) => x.message_id))

      let klaar = true
      let tot_uid = vorige
      const perUid = new Map(kandidaten.map((k) => [k.uid, k]))
      for (const uid of uids) {
        if (Date.now() > tot) { klaar = false; break }
        const k = perUid.get(uid)
        if (k && !bekend.has(k.message_id)) {
          const msg = await client.fetchOne(String(uid), { source: true }, { uid: true }).catch(() => null)
          if (msg && msg.source && msg.source.length <= 8_000_000) {
            const p = await simpleParser(msg.source, { skipImageLinks: true, skipTextToHtml: true }).catch(() => null)
            if (p) {
              const tekst = p.text ?? (typeof p.html === 'string' ? p.html.replace(/<[^>]+>/g, ' ') : '')
              let events: IcsEvent[] = []
              if (k.ics) {
                const delen = [
                  ...(p.attachments ?? []).filter((a) => /calendar|ics/i.test(a.contentType ?? '') || /\.ics$/i.test(a.filename ?? '')).map((a) => a.content.toString('utf8')),
                ]
                // Een agendabestand als deel van de mail zelf (niet als bijlage) staat in de bron.
                if (!delen.length) { const bron = msg.source.toString('utf8'); const i = bron.indexOf('BEGIN:VCALENDAR'); if (i >= 0) delen.push(bron.slice(i, bron.indexOf('END:VCALENDAR', i) + 13)) }
                for (const d of delen) events.push(...leesIcs(d))
                events = events.slice(0, 3)
              }
              if (events.length) {
                for (const ev of events) {
                  // Een agendabestand zonder link in de beschrijving: de link uit de mail zelf.
                  const link = ev.meet_url ? null : vergaderLink(tekst)
                  if (await bewaar(admin, mb.gebruiker, k, { ...ev, meet_url: ev.meet_url ?? link?.url ?? null, platform: ev.platform ?? link?.platform ?? null, beschrijving: ev.beschrijving ?? (kuisBeschrijving(nieuwDeel(tekst, 3000)) || null), bron: 'ics' }, ctx)) uit.voorstellen++
                }
              } else if (!k.ics) {
                const link = vergaderLink(tekst, typeof p.html === 'string' ? p.html : null)
                if (link && !ctx.eigenLinks.has(link.url.split('?')[0].toLowerCase())) {
                  if (ai.over <= 0) { klaar = false; break }
                  ai.over--
                  let moment: Awaited<ReturnType<typeof aiMoment>> = null
                  try { moment = await aiMoment({ onderwerp: k.onderwerp, tekst: nieuwDeel(tekst, 3000), ontvangen: k.ontvangen }) } catch (e) {
                    uit.fout = e instanceof Error ? e.message.slice(0, 200) : 'AI niet bereikbaar'
                    klaar = false; break // deze mail de volgende ronde opnieuw
                  }
                  if (moment) {
                    const deelnemers = [...(p.to ? (Array.isArray(p.to) ? p.to : [p.to]) : []), ...(p.cc ? (Array.isArray(p.cc) ? p.cc : [p.cc]) : [])]
                      .flatMap((a) => a.value).map((v) => ({ naam: v.name || null, email: (v.address ?? '').toLowerCase() })).filter((v) => /@/.test(v.email)).slice(0, 50)
                    if (await bewaar(admin, mb.gebruiker, k, {
                      uid: null, titel: moment.titel, start_op: moment.start_op, eind_op: moment.eind_op, heel_dag: false, locatie: null,
                      beschrijving: kuisBeschrijving(nieuwDeel(tekst, 3000)).slice(0, 4000) || null, meet_url: link.url, platform: link.platform,
                      organisator: { naam: k.vanNaam, email: k.van }, deelnemers, geannuleerd: false, bron: 'ai',
                    }, ctx)) uit.voorstellen++
                  }
                }
              }
            }
          }
        }
        tot_uid = uid
      }
      laatste = klaar ? uids[uids.length - 1] : tot_uid
    } finally { lock.release() }
  } catch (e) {
    uit.fout = veiligeFout(e, mb)
  } finally {
    await client.logout().catch(() => client.close())
    await admin.from('ag_mail_scan').upsert({ mailbox: mb.gebruiker, uidvalidity: uidValidity || null, laatste_uid: laatste, laatst_gelezen_op: new Date().toISOString(), fout: uit.fout }, { onConflict: 'mailbox' }).then(() => null, () => null)
  }
  return uit
}

/** Alle mailboxen na elkaar binnen het budget. */
export async function leesUitnodigingen(admin: Admin, opts: { budgetMs?: number } = {}): Promise<Scan[]> {
  const tot = Date.now() + (opts.budgetMs ?? 60_000)
  const ctx = await laadContext(admin)
  const ai = { over: MAX_AI }
  const uit: Scan[] = []
  for (const mb of mailboxen()) {
    if (Date.now() > tot - 10_000) break
    uit.push(await scanMailbox(admin, mb, ctx, tot, ai))
  }
  return uit
}
