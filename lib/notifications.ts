import 'server-only'
import { dagenTot, maandenTekst, vandaagBrussel } from '@/lib/content/deadline-model'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { followUp } from '@/lib/contract-status'
import { FEATURES } from '@/lib/features'
import { syncGezondheid, SYNC_VEROUDERD_MIN } from '@/lib/sales/clickup-agenda-sync'
import { onderhoudOpvolgen, resterendTekst, type MaintenanceClient } from '@/lib/maintenance'
import { opleveringStatus, volgendeStap, revisieStand, type Versie as OpVersie } from '@/lib/opleveringen'
import { offerteWeergave, moetOpvolgen, isVerlopen, type Offerte } from '@/lib/offertes'
import { samenvatting, grootte, OPSLAG_LIMIET_GB, type RuwVerbruik } from '@/lib/opslag'
import { STATUS as AANVRAAG_STATUS, nieuweAanvraagTitel, type AanvraagSoort } from '@/lib/aanvragen/model'

// Eén bron voor meldingen + "Vandaag": alles live afgeleid uit bestaande data
// (geen nieuwe tabel). Gelezen/niet-gelezen wordt client-side in localStorage
// bijgehouden zodat er geen migratie of dataschrijven nodig is.

export type NotifPriority = 'high' | 'med' | 'low'
export type Notif = {
  id: string            // stabiel, bv. "invoice:<uuid>" → voor read-state
  kind: string          // invoice | contract | blog | website | client
  priority: NotifPriority
  title: string
  date: string | null
  href: string
}

const todayISO = () => new Date().toISOString().slice(0, 10)
const thisMonth = () => new Date().toISOString().slice(0, 7)

export async function buildNotifications(): Promise<Notif[]> {
  let admin: ReturnType<typeof createAdminSupabaseClient>
  try { admin = createAdminSupabaseClient() } catch { return [] }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safe = async <T,>(p: PromiseLike<{ data: T[] | null }>): Promise<T[]> => { try { return (await p).data ?? [] } catch { return [] } }

  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const [invoices, contracts, blogs, webRequests, clients, clientMap] = await Promise.all([
    safe(admin.from('invoices').select('id, description, status, invoice_month, client_id').eq('status', 'te_factureren').limit(50)),
    safe(admin.from('contracts').select('id, title, status, sent_at, created_at, expires_at, client_id').limit(300)),
    safe(admin.from('blogs').select('id, titel, status').eq('status', 'goedgekeurd').limit(50)),
    safe(admin.from('webdesign_change_requests').select('id, title, status, created_at').eq('status', 'new').limit(50)),
    safe(admin.from('clients').select('id, company_name, created_at').gte('created_at', since).limit(50)),
    safe(admin.from('clients').select('id, company_name').limit(2000)),
  ]) as [
    { id: string; description?: string | null; status: string; invoice_month?: string | null; client_id?: string | null }[],
    { id: string; title: string; status: string; sent_at?: string | null; created_at?: string | null; expires_at?: string | null; client_id?: string | null }[],
    { id: string; titel: string; status: string }[],
    { id: string; title: string; status: string; created_at?: string | null }[],
    { id: string; company_name: string; created_at?: string | null }[],
    { id: string; company_name: string }[],
  ]

  const names = new Map(clientMap.map((c) => [c.id, c.company_name]))
  const out: Notif[] = []

  // Nieuwe formulierinzendingen: één signaal per formulier (status 'nieuw').
  // De id bevat de laatste inzending, zodat een nieuwe inzending opnieuw ongelezen is.
  try {
    const nieuweInzendingen = await safe(admin.from('formulier_inzendingen')
      .select('formulier_id, created_at').eq('status', 'nieuw').order('created_at', { ascending: false }).limit(500)) as { formulier_id: string; created_at: string }[]
    if (nieuweInzendingen.length) {
      const perFormulier = new Map<string, { n: number; laatste: string }>()
      for (const r of nieuweInzendingen) {
        const x = perFormulier.get(r.formulier_id)
        if (x) x.n++; else perFormulier.set(r.formulier_id, { n: 1, laatste: r.created_at })
      }
      const titels = await safe(admin.from('formulieren').select('id, titel').in('id', [...perFormulier.keys()])) as { id: string; titel: string }[]
      const titel = new Map(titels.map((f) => [f.id, f.titel]))
      for (const [id, { n, laatste }] of perFormulier) {
        out.push({
          id: `formulier:${id}:${laatste}`, kind: 'formulier', priority: 'med',
          title: `${n} nieuwe formulierinzending${n === 1 ? '' : 'en'} — ${titel.get(id) ?? 'Formulier'}`,
          date: laatste.slice(0, 10), href: `/admin/formulieren/${id}?tab=inzendingen`,
        })
      }
    }
  } catch { /* tabel nog niet gemigreerd → geen signaal */ }

  // Klant paste zelf content aan in de contentplanner (laatste 7 dagen): één signaal
  // per klant; de id bevat de laatste wijziging zodat een nieuwe wijziging opnieuw ongelezen is.
  try {
    const gewijzigd = await safe(admin.from('social_content_items').select('client_id, klant_gewijzigd_op')
      .gte('klant_gewijzigd_op', since).order('klant_gewijzigd_op', { ascending: false }).limit(500)) as { client_id: string; klant_gewijzigd_op: string }[]
    const perKlant = new Map<string, { n: number; laatste: string }>()
    for (const r of gewijzigd) { const x = perKlant.get(r.client_id); if (x) x.n++; else perKlant.set(r.client_id, { n: 1, laatste: r.klant_gewijzigd_op }) }
    for (const [cid, { n, laatste }] of perKlant) {
      out.push({
        id: `content-klant:${cid}:${laatste}`, kind: 'content', priority: 'med',
        title: `${names.get(cid) ?? 'Klant'} plande of paste ${n} contentitem${n === 1 ? '' : 's'} zelf aan`,
        date: laatste.slice(0, 10), href: `/admin/services/social-media?client=${cid}`,
      })
    }
  } catch { /* kolom nog niet gemigreerd → geen signaal */ }

  // Opmerkingen van klanten in de contentkalender (laatste 7 dagen): één signaal per klant,
  // opnieuw ongelezen bij een nieuwe opmerking.
  try {
    const opmerkingen = await safe(admin.from('social_content_activiteit').select('client_id, op')
      .eq('rol', 'klant').eq('actie', 'opmerking').gte('op', since).order('op', { ascending: false }).limit(500)) as { client_id: string | null; op: string }[]
    const perKlant = new Map<string, { n: number; laatste: string }>()
    for (const r of opmerkingen) { if (!r.client_id) continue; const x = perKlant.get(r.client_id); if (x) x.n++; else perKlant.set(r.client_id, { n: 1, laatste: r.op }) }
    for (const [cid, { n, laatste }] of perKlant) {
      out.push({
        id: `content-opmerking:${cid}:${laatste}`, kind: 'content', priority: 'med',
        title: `${names.get(cid) ?? 'Klant'} plaatste ${n} opmerking${n === 1 ? '' : 'en'} in de contentkalender`,
        date: laatste.slice(0, 10), href: `/admin/services/social-media?client=${cid}`,
      })
    }
  } catch { /* tabel nog niet gemigreerd → geen signaal */ }

  // Goedkeuringsdeadlines van de contentkalender die binnen 3 dagen vallen
  // (of vandaag). De id bevat de datum: een verschoven deadline is opnieuw ongelezen.
  // Verstreken maar nog open = wij moeten manueel "Alles goedkeuren" (nooit automatisch).
  try {
    const vandaag = vandaagBrussel()
    const binnen3 = new Date(Date.parse(`${vandaag}T12:00:00Z`) + 3 * 86400000).toISOString().slice(0, 10)
    const dl = await safe(admin.from('content_goedkeuring_deadlines').select('id, client_id, maanden, deadline')
      .eq('status', 'open').lte('deadline', binnen3).order('deadline').limit(50)) as { id: string; client_id: string; maanden: string[]; deadline: string }[]
    for (const d of dl) {
      const n = dagenTot(d.deadline, vandaag)
      if (n < 0) {
        out.push({
          id: `goedkeuring:${d.id}:verstreken`, kind: 'content', priority: 'high',
          title: `Goedkeuringsdeadline verstreken — ${names.get(d.client_id) ?? 'klant'} (${maandenTekst(d.maanden)}): keur goed met “Alles goedkeuren”`,
          date: d.deadline, href: `/admin/services/social-media?client=${d.client_id}`,
        })
        continue
      }
      out.push({
        id: `goedkeuring:${d.id}:${d.deadline}`, kind: 'content', priority: n <= 1 ? 'high' : 'med',
        title: `Goedkeuringsdeadline ${n === 0 ? 'vandaag' : n === 1 ? 'morgen' : `over ${n} dagen`} — ${names.get(d.client_id) ?? 'klant'} (${maandenTekst(d.maanden)})`,
        date: d.deadline, href: `/admin/services/social-media?client=${d.client_id}`,
      })
    }
  } catch { /* tabel nog niet gemigreerd → geen signaal */ }


  // ClickUp→Google-agendasync: ligt die stil, dan zien de setters niet wat er
  // in ClickUp gepland staat en kán er dubbel geboekt worden. Dat verdient de
  // hoogste prioriteit in de bel — naast de mail die de sync zelf al stuurt.
  try {
    const sync = await syncGezondheid()
    if (sync.actief && sync.verouderd) {
      out.push({
        id: `clickupsync:verouderd:${sync.laatsteOkOp ?? 'nooit'}`,
        kind: 'sales', priority: 'high',
        title: sync.laatsteOkOp
          ? `ClickUp-agendasync draait niet meer (laatste keer gelukt: ${Math.round(sync.minutenSindsOk ?? 0)} min geleden — hoort elke 10 min)`
          : `ClickUp-agendasync is nog nooit gelukt (hoort elke ${SYNC_VEROUDERD_MIN / 3} min te draaien)`,
        date: sync.laatsteOkOp?.slice(0, 10) ?? null,
        href: '/admin/meetings?tab=agenda',
      })
    } else if (sync.actief && sync.laatsteFout) {
      out.push({
        id: 'clickupsync:fout',
        kind: 'sales', priority: 'high',
        title: `ClickUp-agendasync geeft een fout: ${sync.laatsteFout.slice(0, 120)}`,
        date: todayISO(), href: '/admin/meetings?tab=agenda',
      })
    }
  } catch { /* meldingen mogen nooit stuklopen op de waakhond */ }

  // Aanvragen uit het klantportaal: nieuw binnengekomen, of de klant besliste over een offerte.
  try {
    const nieuw = await safe(admin.from('klant_aanvragen').select('id, client_id, soort, type_label, created_at').eq('status', 'ontvangen').order('created_at', { ascending: false }).limit(30)) as { id: string; client_id: string; soort: string; type_label: string; created_at: string }[]
    for (const a of nieuw) out.push({ id: `aanvraag:${a.id}:nieuw`, kind: 'aanvraag', priority: 'high', title: `${nieuweAanvraagTitel(a.soort as AanvraagSoort)} — ${names.get(a.client_id) ?? 'Klant'}: ${a.type_label}`, date: a.created_at, href: `/admin/aanvragen?aanvraag=${a.id}` })
    const beslist = await safe(admin.from('klant_aanvragen').select('id, client_id, type_label, offerte_status, offerte_beslist_op, status').in('offerte_status', ['aanvaard', 'geweigerd']).in('status', ['aanvaard', 'in_behandeling']).gte('offerte_beslist_op', since).limit(30)) as { id: string; client_id: string; type_label: string; offerte_status: string; offerte_beslist_op: string }[]
    for (const a of beslist) out.push({ id: `aanvraag:${a.id}:offerte:${a.offerte_status}`, kind: 'aanvraag', priority: a.offerte_status === 'aanvaard' ? 'high' : 'med', title: `Offerte ${a.offerte_status === 'aanvaard' ? 'aanvaard' : 'geweigerd'} door de klant — ${names.get(a.client_id) ?? 'Klant'}: ${a.type_label}`, date: a.offerte_beslist_op, href: `/admin/aanvragen?aanvraag=${a.id}` })
  } catch { /* meldingen mogen nooit stuklopen */ }

  // Video-opleveringen: de klant vroeg een revisie, keurde goed of stuurde een opmerking.
  try {
    const fb = await safe(admin.from('oplevering_feedback').select('id, oplevering_id, soort, ronde, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(30)) as { id: string; oplevering_id: string; soort: string; ronde: number | null; created_at: string }[]
    if (fb.length) {
      const ops = await safe(admin.from('opleveringen').select('id, titel, client_id').in('id', [...new Set(fb.map((f) => f.oplevering_id))])) as { id: string; titel: string; client_id: string }[]
      const op = new Map(ops.map((o) => [o.id, o]))
      for (const f of fb) {
        const o = op.get(f.oplevering_id); if (!o) continue
        const wat = f.soort === 'goedkeuring' ? 'Goedgekeurd' : f.soort === 'revisie' ? `Revisieronde ${f.ronde} gevraagd` : 'Opmerking'
        out.push({ id: `oplevering:${f.id}`, kind: 'oplevering', priority: f.soort === 'opmerking' ? 'med' : 'high', title: `${wat} — ${names.get(o.client_id) ?? 'Klant'}: ${o.titel}`, date: f.created_at, href: `/admin/opleveringen?oplevering=${o.id}` })
      }
    }
  } catch { /* meldingen mogen nooit stuklopen */ }

  // Offertes: de klant accepteerde (via de knop op /offerte/<token>).
  try {
    const ok = await safe(admin.from('offertes').select('id, client_id, klant_naam, titel, geaccepteerd_op').eq('status', 'geaccepteerd').gte('geaccepteerd_op', since).order('geaccepteerd_op', { ascending: false }).limit(30)) as { id: string; client_id: string | null; klant_naam: string | null; titel: string; geaccepteerd_op: string }[]
    for (const o of ok) out.push({ id: `offerte:${o.id}:geaccepteerd`, kind: 'offerte', priority: 'high', title: `Offerte geaccepteerd — ${(o.client_id ? names.get(o.client_id) : null) ?? o.klant_naam ?? 'Klant'}: ${o.titel}. Maak het contract op.`, date: o.geaccepteerd_op, href: `/admin/offertes?offerte=${o.id}` })
  } catch { /* meldingen mogen nooit stuklopen */ }

  // Workshops & events: nieuwe inschrijvingen, afgelopen events met nog te
  // factureren inschrijvingen, en een Google-agenda die niet lukte.
  try {
    const nieuw = await safe(admin.from('klant_event_inschrijvingen').select('id, event_id, client_id, naam, created_at, klant_events ( titel )').eq('status', 'ingeschreven').gte('created_at', since).order('created_at', { ascending: false }).limit(30)) as { id: string; event_id: string; client_id: string; naam: string; created_at: string; klant_events?: { titel?: string } | null }[]
    for (const i of nieuw) out.push({ id: `event-inschrijving:${i.id}`, kind: 'event', priority: 'med', title: `Nieuwe inschrijving — ${names.get(i.client_id) ?? 'Klant'}: ${i.naam} voor "${i.klant_events?.titel ?? 'event'}"`, date: i.created_at, href: `/admin/events?event=${i.event_id}` })
    const teFact = await safe(admin.from('klant_event_inschrijvingen').select('event_id, prijs_cents, klant_events ( titel, einde_op )').eq('factuur_status', 'te_factureren').limit(2000)) as { event_id: string; prijs_cents: number; klant_events?: { titel?: string; einde_op?: string } | null }[]
    const perEvent = new Map<string, { titel: string; einde: string; aantal: number; cents: number }>()
    for (const r of teFact) {
      if (!r.klant_events?.einde_op || Date.parse(r.klant_events.einde_op) > Date.now()) continue
      const t = perEvent.get(r.event_id) ?? { titel: r.klant_events.titel ?? 'Event', einde: r.klant_events.einde_op, aantal: 0, cents: 0 }
      perEvent.set(r.event_id, { ...t, aantal: t.aantal + 1, cents: t.cents + (r.prijs_cents ?? 0) })
    }
    for (const [id, t] of perEvent) out.push({ id: `event-factureren:${id}:${t.aantal}`, kind: 'event', priority: 'high', title: `Te factureren: "${t.titel}" — ${t.aantal} ${t.aantal === 1 ? 'inschrijving' : 'inschrijvingen'}, ${(t.cents / 100).toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })} excl. btw`, date: t.einde, href: `/admin/events?event=${id}` })
    const fout = await safe(admin.from('klant_events').select('id, titel, google_fout, updated_at').eq('status', 'gepubliceerd').eq('google_status', 'fout').gt('einde_op', new Date().toISOString()).limit(20)) as { id: string; titel: string; google_fout: string | null; updated_at: string }[]
    for (const e of fout) out.push({ id: `event-google:${e.id}:${e.updated_at}`, kind: 'event', priority: 'high', title: `Google-agenda lukte niet voor "${e.titel}": ${(e.google_fout ?? '').slice(0, 100)}`, date: e.updated_at, href: `/admin/events?event=${e.id}` })
  } catch { /* meldingen mogen nooit stuklopen */ }

  // Klantmeetings: een stap die misliep, of een herinnering die niet vertrok
  // (mislukt, of de scheduler loopt achter). Enkel voor meetings die nog komen.
  try {
    const nuIso = new Date().toISOString()
    const meetings = await safe(admin.from('klant_meetings')
      .select('*')
      .eq('status', 'ingepland').gte('starts_at', nuIso).limit(200)) as { id: string; titel: string; klant_naam: string; starts_at: string; google_status: string; meet_url: string | null; clickup_status: string; bron?: string; bevestiging_status?: string | null; created_at?: string }[]
    if (meetings.length) {
      const herinneringen = await safe(admin.from('klant_meeting_herinneringen')
        .select('meeting_id, status, gepland_voor').in('meeting_id', meetings.map((m) => m.id)).in('status', ['mislukt', 'gepland'])) as { meeting_id: string; status: string; gepland_voor: string }[]
      const achterstand = new Date(Date.now() - 20 * 60000).toISOString()
      for (const m of meetings) {
        const href = `/admin/meetings?meeting=${m.id}`
        const naam = `${m.klant_naam} · ${m.titel}`
        const stappen = [
          m.google_status === 'fout' ? 'agenda' : null,
          m.google_status === 'ok' && !m.meet_url ? 'Meet-link' : null,
          m.clickup_status === 'fout' ? 'ClickUp' : null,
        ].filter(Boolean)
        if (stappen.length) out.push({ id: `meeting:${m.id}:${stappen.join('-')}`, kind: 'meeting', priority: 'high', title: `Klantmeeting niet volledig ingepland (${stappen.join(', ')}) — ${naam}`, date: m.starts_at.slice(0, 10), href })
        if (m.bron === 'klantboeking') {
          if (m.bevestiging_status === 'mislukt') out.push({ id: `klantboeking:${m.id}:bevestiging`, kind: 'meeting', priority: 'high', title: `Bevestigingsmail van een klantboeking mislukt — ${naam}`, date: m.starts_at.slice(0, 10), href })
          else if (m.created_at && Date.now() - new Date(m.created_at).getTime() < 7 * 86400000) out.push({ id: `klantboeking:${m.id}`, kind: 'meeting', priority: 'med', title: `Nieuwe klantboeking — ${naam}`, date: m.created_at.slice(0, 10), href })
        }
        const h = herinneringen.find((x) => x.meeting_id === m.id)
        if (h?.status === 'mislukt') out.push({ id: `meeting-herinnering:${m.id}:mislukt`, kind: 'meeting', priority: 'high', title: `Herinneringsmail mislukt — ${naam}`, date: m.starts_at.slice(0, 10), href })
        else if (h?.status === 'gepland' && h.gepland_voor < achterstand) out.push({ id: `meeting-herinnering:${m.id}:achter`, kind: 'meeting', priority: 'high', title: `Herinneringsmail had al moeten vertrekken (scheduler loopt achter) — ${naam}`, date: m.starts_at.slice(0, 10), href })
      }
    }
  } catch { /* meldingen mogen nooit stuklopen */ }

  for (const i of invoices) {
    const due = (i.invoice_month ?? '') <= thisMonth()
    out.push({
      id: `invoice:${i.id}`, kind: 'invoice', priority: due ? 'high' : 'med',
      title: `Factuur te versturen — ${i.client_id ? names.get(i.client_id) ?? '' : ''} ${i.description ?? ''}`.trim(),
      date: i.invoice_month ?? null, href: '/admin/invoices',
    })
  }
  for (const c of contracts) {
    const fu = followUp(c)
    if (!fu.needs) continue
    out.push({
      id: `contract:${c.id}`, kind: 'contract', priority: fu.level === 'urgent' ? 'high' : 'med',
      title: `Contract opvolgen — ${c.title} (${fu.reason})`, date: c.sent_at ?? c.created_at ?? null,
      href: `/admin/contracts/${c.id}`,
    })
  }
  // Blog-signalen enkel als de module aan staat (lib/features.ts).
  if (FEATURES.blogs) {
    for (const b of blogs) {
      out.push({ id: `blog:${b.id}`, kind: 'blog', priority: 'low', title: `Blog klaar voor publicatie — ${b.titel}`, date: null, href: '/admin/blog-calendar' })
    }
  }
  for (const w of webRequests) {
    out.push({ id: `website:${w.id}`, kind: 'website', priority: 'med', title: `Nieuwe websitefeedback — ${w.title}`, date: w.created_at ?? null, href: '/admin/services/website' })
  }
  for (const c of clients) {
    out.push({ id: `client:${c.id}`, kind: 'client', priority: 'low', title: `Nieuwe klant toegevoegd — ${c.company_name}`, date: c.created_at ?? null, href: `/admin/clients/${c.id}` })
  }

  // Personeel: uren en beschikbaarheden die op een beslissing wachten, vergeten
  // uit te klokken, en documenten die vervallen. Eén signaal per soort.
  try {
    const [uren, beschikbaar, actief, docs] = await Promise.all([
      safe(admin.from('personeel_sessies').select('id, created_at').in('status', ['ingediend']).limit(500)),
      safe(admin.from('personeel_beschikbaarheid').select('id, created_at').eq('status', 'ingediend').limit(500)),
      safe(admin.from('personeel_sessies').select('id, personeel_id, start_at').eq('status', 'actief').limit(100)),
      safe(admin.from('personeel_documenten').select('id, naam, vervalt_op, personeel_id').not('vervalt_op', 'is', null).lte('vervalt_op', new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).limit(100)),
    ]) as [{ id: string; created_at: string }[], { id: string; created_at: string }[], { id: string; personeel_id: string; start_at: string }[], { id: string; naam: string; vervalt_op: string; personeel_id: string }[]]
    if (uren.length) out.push({ id: `personeel:uren:${uren.length}:${uren[0].created_at}`, kind: 'personeel', priority: 'med', title: `${uren.length} urenregistratie${uren.length === 1 ? '' : 's'} klaar voor controle`, date: uren[0].created_at, href: '/admin/personeel?tab=uren' })
    if (beschikbaar.length) out.push({ id: `personeel:beschikbaar:${beschikbaar.length}:${beschikbaar[0].created_at}`, kind: 'personeel', priority: 'med', title: `${beschikbaar.length} beschikbaarhe${beschikbaar.length === 1 ? 'id' : 'den'} te behandelen`, date: beschikbaar[0].created_at, href: '/admin/personeel?tab=planning' })
    const vergeten = actief.filter((x) => Date.now() - new Date(x.start_at).getTime() > 10 * 3600000)
    for (const v of vergeten) out.push({ id: `personeel:vergeten:${v.id}`, kind: 'personeel', priority: 'high', title: 'Een medewerker is vergeten uit te klokken', date: v.start_at, href: `/admin/personeel/${v.personeel_id}?tab=uren` })
    for (const d of docs) out.push({ id: `personeel:doc:${d.id}:${d.vervalt_op}`, kind: 'personeel', priority: d.vervalt_op < todayISO() ? 'high' : 'low', title: `Personeelsdocument ${d.vervalt_op < todayISO() ? 'vervallen' : 'vervalt binnenkort'} — ${d.naam}`, date: d.vervalt_op, href: `/admin/personeel/${d.personeel_id}?tab=documenten` })
  } catch { /* tabellen bestaan pas na de migratie */ }

  // Websiteonderhoud: binnen 30 dagen af, verlopen of zonder startdatum. De id
  // bevat de einddatum, zodat een verlengd pakket later opnieuw meldt.
  try {
    const { data } = await admin.from('clients')
      .select('id, company_name, maintenance_included, maintenance_start_date, maintenance_months').eq('maintenance_included', true).limit(1000)
    for (const { klant, status } of onderhoudOpvolgen((data ?? []) as MaintenanceClient[])) {
      out.push({
        id: `onderhoud:${klant.id}:${status.endDate ?? 'geen-start'}:${status.expired ? 'verlopen' : 'af'}`, kind: 'website',
        priority: status.expired || (status.daysLeft !== null && status.daysLeft <= 7) ? 'high' : 'med',
        title: status.endDate
          ? `Websiteonderhoud ${status.expired ? 'verlopen' : 'loopt af'} — ${klant.company_name} (${resterendTekst(status)})`
          : `Websiteonderhoud zonder startdatum — ${klant.company_name}`,
        date: status.endDate, href: `/admin/clients/${klant.id}#website`,
      })
    }
  } catch { /* stil */ }

  // Opslag in Supabase: een signaal vanaf 70% van de 100 GB (zie lib/opslag.ts).
  try {
    const { data } = await admin.rpc('opslag_verbruik')
    const o = samenvatting(data as RuwVerbruik)
    if (o.niveau !== 'ok') {
      const pct = Math.floor(o.procent / 5) * 5
      out.push({ id: `opslag:${pct}`, kind: 'opslag', priority: o.niveau === 'kritiek' ? 'high' : 'med', title: `Opslag in Supabase op ${Math.round(o.procent)}% (${grootte(o.totaalBytes)} van ${OPSLAG_LIMIET_GB} GB)`, date: todayISO(), href: '/admin/instellingen?tab=opslag' })
    }
  } catch { /* functie nog niet gemigreerd → geen signaal */ }

  const rank: Record<NotifPriority, number> = { high: 0, med: 1, low: 2 }
  return out.sort((a, b) => rank[a.priority] - rank[b.priority] || (b.date ?? '').localeCompare(a.date ?? ''))
}

// ── Opvolging bovenaan het Command Center ────────────────────────────────────
// Wat er concreet op te volgen valt, per soort, met namen: aanvragen,
// contracten, komende meetings, leads en feedback op de contentkalender.
// Zelfde bron en regels als de rest van de app (followUp, de focuswachtrij van
// de pipeline). `modules` = rechten van de medewerker (null = admin, alles).

export type OpvolgItem = { id: string; titel: string; sub: string | null; href: string; dringend?: boolean }
export type OpvolgGroep = { key: 'aanvragen' | 'contracten' | 'meetings' | 'projecten' | 'content' | 'onderhoud' | 'opleveringen' | 'offertes'; titel: string; totaal: number; items: OpvolgItem[]; alles: string; leeg: string }

const OPVOLG_MAX = 5
const dagKort = (d: string) => new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })
const momentKort = (iso: string) => new Date(iso).toLocaleString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })

export async function buildOpvolging(modules: string[] | null): Promise<OpvolgGroep[]> {
  let admin: ReturnType<typeof createAdminSupabaseClient>
  try { admin = createAdminSupabaseClient() } catch { return [] }
  const mag = (m: string) => modules === null || modules.includes(m)
  const klantNamen = async (ids: string[]): Promise<Map<string, string>> => {
    const uniek = [...new Set(ids.filter(Boolean))]
    if (!uniek.length) return new Map()
    const { data } = await admin.from('clients').select('id, company_name').in('id', uniek)
    return new Map(((data ?? []) as { id: string; company_name: string }[]).map((c) => [c.id, c.company_name]))
  }

  const groepen = await Promise.all([
    mag('aanvragen') ? opvolgAanvragen() : null,
    mag('contracts') ? opvolgContracten() : null,
    mag('meetings') ? opvolgMeetings() : null,
    mag('opdrachten') ? opvolgProjecten() : null,
    mag('content') ? opvolgContent() : null,
    mag('content') ? opvolgOnderhoud() : null,
    mag('opleveringen') ? opvolgOpleveringen() : null,
    mag('offertes') ? opvolgOffertes() : null,
  ])
  return groepen.filter((g): g is OpvolgGroep => !!g)

  async function opvolgAanvragen(): Promise<OpvolgGroep | null> {
    try {
      const { data, count } = await admin.from('klant_aanvragen')
        .select('id, client_id, soort, type_label, status, periode_van, created_at', { count: 'exact' })
        .in('status', ['ontvangen', 'in_behandeling', 'offerte', 'aanvaard']).order('created_at', { ascending: false }).limit(50)
      const rijen = (data ?? []) as { id: string; client_id: string; soort: string; type_label: string; status: keyof typeof AANVRAAG_STATUS; periode_van: string | null; created_at: string }[]
      // Nieuw binnengekomen eerst, dan wie de offerte aanvaardde (in te plannen).
      const rang: Record<string, number> = { ontvangen: 0, aanvaard: 1, in_behandeling: 2, offerte: 3 }
      rijen.sort((a, b) => (rang[a.status] ?? 9) - (rang[b.status] ?? 9) || b.created_at.localeCompare(a.created_at))
      const namen = await klantNamen(rijen.map((r) => r.client_id))
      return {
        key: 'aanvragen', titel: 'Aanvragen', totaal: count ?? rijen.length, alles: '/admin/aanvragen', leeg: 'Geen open aanvragen.',
        items: rijen.slice(0, OPVOLG_MAX).map((r) => ({
          id: r.id, titel: `${namen.get(r.client_id) ?? 'Klant'} – ${r.type_label}`,
          sub: [AANVRAAG_STATUS[r.status]?.team ?? r.status, r.soort === 'consultancy' ? 'consultancy' : r.soort === 'founders' ? 'Founders of Flanders' : null, r.periode_van ? `gewenst ${dagKort(r.periode_van)}` : null].filter(Boolean).join(' · '),
          href: `/admin/aanvragen?aanvraag=${r.id}`, dringend: r.status === 'ontvangen',
        })),
      }
    } catch { return null }
  }

  async function opvolgContracten(): Promise<OpvolgGroep | null> {
    try {
      const { data } = await admin.from('contracts').select('id, title, status, sent_at, created_at, expires_at, client_id').limit(500)
      const rijen = ((data ?? []) as { id: string; title: string; status: string; sent_at?: string | null; created_at?: string | null; expires_at?: string | null; client_id?: string | null }[])
        .map((c) => ({ c, fu: followUp(c) })).filter((x) => x.fu.needs)
        .sort((a, b) => (a.fu.level === 'urgent' ? 0 : 1) - (b.fu.level === 'urgent' ? 0 : 1) || (a.c.sent_at ?? a.c.created_at ?? '').localeCompare(b.c.sent_at ?? b.c.created_at ?? ''))
      const namen = await klantNamen(rijen.slice(0, OPVOLG_MAX).map((x) => x.c.client_id ?? ''))
      return {
        key: 'contracten', titel: 'Contracten opvolgen', totaal: rijen.length, alles: '/admin/contracts', leeg: 'Alle contracten zijn bij.',
        items: rijen.slice(0, OPVOLG_MAX).map(({ c, fu }) => ({
          id: c.id, titel: [c.client_id ? namen.get(c.client_id) : null, c.title].filter(Boolean).join(' – '), sub: fu.reason, href: `/admin/contracts/${c.id}`, dringend: fu.level === 'urgent',
        })),
      }
    } catch { return null }
  }

  async function opvolgMeetings(): Promise<OpvolgGroep | null> {
    try {
      const nuIso = new Date().toISOString()
      const [km, sa] = await Promise.all([
        admin.from('klant_meetings').select('id, titel, klant_naam, starts_at', { count: 'exact' }).eq('status', 'ingepland').gte('starts_at', nuIso).order('starts_at').limit(OPVOLG_MAX),
        admin.from('sales_appointments').select('id, titel, starts_at', { count: 'exact' }).eq('status', 'scheduled').gte('starts_at', nuIso).order('starts_at').limit(OPVOLG_MAX),
      ])
      const items = [
        ...((km.data ?? []) as { id: string; titel: string; klant_naam: string | null; starts_at: string }[]).map((m) => ({ id: m.id, titel: [m.klant_naam, m.titel].filter(Boolean).join(' · '), starts: m.starts_at, href: `/admin/meetings?meeting=${m.id}` })),
        ...((sa.data ?? []) as { id: string; titel: string | null; starts_at: string }[]).map((a) => ({ id: a.id, titel: a.titel || 'Leadafspraak', starts: a.starts_at, href: '/admin/meetings?tab=agenda' })),
      ].sort((a, b) => a.starts.localeCompare(b.starts)).slice(0, OPVOLG_MAX)
      const vandaag = vandaagBrussel()
      return {
        key: 'meetings', titel: 'Komende meetings', totaal: (km.count ?? 0) + (sa.count ?? 0), alles: '/admin/meetings', leeg: 'Geen meetings meer ingepland.',
        items: items.map((m) => ({ id: m.id, titel: m.titel, sub: momentKort(m.starts), href: m.href, dringend: new Date(m.starts).toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }) === vandaag })),
      }
    } catch { return null }
  }

  /**
   * Projecten die opvolging vragen: kaarten in Opvolging of Offerte gestuurd
   * waarvan de fase al 7 dagen niet veranderde (oudste eerst). Vervangt het
   * vroegere blok "Leads opvolgen" uit de belronde.
   */
  async function opvolgProjecten(): Promise<OpvolgGroep | null> {
    try {
      const grens = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const { data, count } = await admin.from('opdrachten')
        .select('id, titel, client_id, klant_vrij, status, status_gewijzigd_op, created_at', { count: 'exact' })
        .in('status', ['open', 'voorstel_gevraagd', 'voorstel_bezig', 'voorstel_klaar', 'voorstel_voorgelegd', 'interesse'])
        .lt('status_gewijzigd_op', grens).order('status_gewijzigd_op', { ascending: true }).limit(OPVOLG_MAX)
      const rijen = (data ?? []) as { id: string; titel: string; client_id: string | null; klant_vrij: string | null; status: string; status_gewijzigd_op: string | null; created_at: string }[]
      const namen = await klantNamen(rijen.map((r) => r.client_id ?? ''))
      const offerte = new Set(['voorstel_klaar', 'voorstel_voorgelegd'])
      return {
        key: 'projecten', titel: 'Projecten opvolgen', totaal: count ?? rijen.length, alles: '/admin/opdrachten', leeg: 'Geen projecten die al een week stilstaan.',
        items: rijen.map((r) => {
          const dagen = Math.floor((Date.now() - new Date(r.status_gewijzigd_op ?? r.created_at).getTime()) / 86_400_000)
          return {
            id: r.id, titel: (r.client_id ? namen.get(r.client_id) : r.klant_vrij) || r.titel,
            sub: `${r.status === 'interesse' ? 'offerte geaccepteerd, nog geen contract' : offerte.has(r.status) ? 'offerte' : 'opvolging'} · ${dagen} dagen stil · ${r.titel}`.slice(0, 80),
            href: `/admin/opdrachten?opdracht=${r.id}`, dringend: dagen >= 14,
          }
        }),
      }
    } catch { return null }
  }

  /**
   * Websiteonderhoud dat afloopt (binnen 30 dagen), verlopen is maar nog aan
   * staat, of geen startdatum heeft. Enkel zichtbaar als er iets is: lopende
   * contracten vragen geen actie.
   */
  async function opvolgOnderhoud(): Promise<OpvolgGroep | null> {
    try {
      const { data } = await admin.from('clients')
        .select('id, company_name, maintenance_included, maintenance_start_date, maintenance_months').eq('maintenance_included', true).limit(1000)
      const lijst = onderhoudOpvolgen((data ?? []) as MaintenanceClient[])
      if (!lijst.length) return null
      return {
        key: 'onderhoud', titel: 'Website-onderhoud', totaal: lijst.length, alles: '/admin/services/website', leeg: 'Alle onderhoudscontracten lopen nog.',
        items: lijst.slice(0, OPVOLG_MAX).map(({ klant, status }) => ({
          id: klant.id, titel: klant.company_name,
          sub: status.endDate ? `${resterendTekst(status)} · tot ${dagKort(status.endDate)}` : 'Startdatum ontbreekt',
          href: `/admin/clients/${klant.id}#website`, dringend: status.expired || (status.daysLeft !== null && status.daysLeft <= 7),
        })),
      }
    } catch { return null }
  }

  /**
   * Video-opleveringen die op ons wachten: feedback van de klant te verwerken,
   * of een gedeelde versie die zonder reactie (bijna) verloopt. Enkel zichtbaar
   * als er iets is. Zelfde regels als het scherm (volgendeStap).
   */
  async function opvolgOpleveringen(): Promise<OpvolgGroep | null> {
    try {
      const { data: ops } = await admin.from('opleveringen').select('id, titel, client_id, max_revisies, updated_at').is('gearchiveerd_op', null).order('updated_at', { ascending: false }).limit(200)
      const rijen = (ops ?? []) as { id: string; titel: string; client_id: string; max_revisies: number | null }[]
      if (!rijen.length) return null
      const ids = rijen.map((r) => r.id)
      const [{ data: vs }, { data: bs }, { data: fb }] = await Promise.all([
        admin.from('oplevering_versies').select('id, oplevering_id, nummer, is_finaal, bericht, gepubliceerd_op, verloopt_op, verwijderd_op').in('oplevering_id', ids),
        admin.from('oplevering_bestanden').select('versie_id').in('oplevering_id', ids),
        admin.from('oplevering_feedback').select('oplevering_id, versie_id, soort').in('oplevering_id', ids),
      ])
      const versies = (vs ?? []) as (OpVersie & { oplevering_id: string })[]
      const perVersie = new Map<string, number>()
      for (const b of (bs ?? []) as { versie_id: string }[]) perVersie.set(b.versie_id, (perVersie.get(b.versie_id) ?? 0) + 1)
      const feedback = (fb ?? []) as { oplevering_id: string; versie_id: string; soort: 'revisie' | 'goedkeuring' | 'opmerking' }[]
      const lijst = rijen.map((r) => {
        const v = versies.filter((x) => x.oplevering_id === r.id)
        const f = feedback.filter((x) => x.oplevering_id === r.id)
        const status = opleveringStatus(v, f)
        const stap = volgendeStap({ status, versies: v.map((x) => ({ ...x, bestanden_aantal: perVersie.get(x.id) ?? 0 })), revisies: revisieStand(f, r.max_revisies ?? undefined) })
        return { r, stap }
      }).filter((x) => x.stap.dringend)
      if (!lijst.length) return null
      const namen = await klantNamen(lijst.slice(0, OPVOLG_MAX).map((x) => x.r.client_id))
      return {
        key: 'opleveringen', titel: 'Video-opleveringen', totaal: lijst.length, alles: '/admin/opleveringen', leeg: 'Niets wacht op ons.',
        items: lijst.slice(0, OPVOLG_MAX).map(({ r, stap }) => ({
          id: r.id, titel: `${namen.get(r.client_id) ?? 'Klant'} – ${r.titel}`, sub: stap.tekst, href: `/admin/opleveringen?oplevering=${r.id}`, dringend: true,
        })),
      }
    } catch { return null }
  }

  /**
   * Offertes: alles wat verstuurd is en nog geen akkoord heeft (stil sinds een
   * paar dagen of verlopen = dringend, zie moetOpvolgen), plus wat de klant de
   * voorbije week accepteerde: dan moet het contract nog opgemaakt worden.
   * Enkel zichtbaar als er iets is.
   */
  async function opvolgOffertes(): Promise<OpvolgGroep | null> {
    try {
      const week = new Date(Date.now() - 7 * 86_400_000).toISOString()
      const [{ data: open, error }, { data: ok }] = await Promise.all([
        admin.from('offertes').select('id, client_id, klant_naam, titel, status, verstuurd_op, klant_geopend_op, geldig_tot, geaccepteerd_op, geaccepteerd_door').eq('status', 'verstuurd').order('verstuurd_op', { ascending: true }).limit(300),
        admin.from('offertes').select('id, client_id, klant_naam, titel, status, verstuurd_op, klant_geopend_op, geldig_tot, geaccepteerd_op, geaccepteerd_door').eq('status', 'geaccepteerd').gte('geaccepteerd_op', week).order('geaccepteerd_op', { ascending: false }).limit(50),
      ])
      if (error) return null
      type R = Pick<Offerte, 'id' | 'client_id' | 'klant_naam' | 'titel' | 'status' | 'verstuurd_op' | 'klant_geopend_op' | 'geldig_tot' | 'geaccepteerd_op' | 'geaccepteerd_door'>
      const nu = new Date()
      const verstuurd = ((open ?? []) as R[]).map((o) => ({ o, dringend: moetOpvolgen(o, nu) })).sort((a, b) => Number(b.dringend) - Number(a.dringend))
      const lijst = [...((ok ?? []) as R[]).map((o) => ({ o, dringend: true })), ...verstuurd]
      if (!lijst.length) return null
      const namen = await klantNamen(lijst.slice(0, OPVOLG_MAX).map((x) => x.o.client_id ?? ''))
      const dagen = (iso: string | null) => (iso ? Math.floor((nu.getTime() - new Date(iso).getTime()) / 86_400_000) : 0)
      return {
        key: 'offertes', titel: 'Offertes opvolgen', totaal: lijst.length, alles: '/admin/offertes', leeg: 'Geen offertes op te volgen.',
        items: lijst.slice(0, OPVOLG_MAX).map(({ o, dringend }) => {
          const w = offerteWeergave(o, nu)
          const sub = o.status === 'geaccepteerd'
            ? `Geaccepteerd ${w.sub ?? ''} · contract opmaken`.replace(/\s+/g, ' ')
            : `${w.sub ?? ''}${dringend && !isVerlopen(o, nu.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })) ? ` · ${dagen(o.verstuurd_op)} dagen geen akkoord` : w.label === 'Verlopen' ? ' · verlopen' : ''}`
          return { id: o.id, titel: [(o.client_id ? namen.get(o.client_id) : null) ?? o.klant_naam, o.titel].filter(Boolean).join(' – '), sub, href: `/admin/offertes?offerte=${o.id}`, dringend }
        }),
      }
    } catch { return null }
  }

  async function opvolgContent(): Promise<OpvolgGroep | null> {
    try {
      const { data } = await admin.from('social_content_items').select('client_id, reviewed_at, updated_at').eq('status', 'changes_requested').limit(2000)
      const perKlant = new Map<string, { n: number; laatste: string }>()
      for (const r of (data ?? []) as { client_id: string | null; reviewed_at: string | null; updated_at: string | null }[]) {
        if (!r.client_id) continue
        const op = r.reviewed_at ?? r.updated_at ?? ''
        const x = perKlant.get(r.client_id)
        if (x) { x.n++; if (op > x.laatste) x.laatste = op } else perKlant.set(r.client_id, { n: 1, laatste: op })
      }
      const lijst = [...perKlant.entries()].sort((a, b) => b[1].n - a[1].n || b[1].laatste.localeCompare(a[1].laatste))
      const namen = await klantNamen(lijst.slice(0, OPVOLG_MAX).map(([id]) => id))
      return {
        key: 'content', titel: 'Feedback op content', totaal: lijst.reduce((s, [, x]) => s + x.n, 0), alles: '/admin/services/social-media', leeg: 'Geen open feedback in de contentkalender.',
        items: lijst.slice(0, OPVOLG_MAX).map(([id, x]) => ({
          id, titel: namen.get(id) ?? 'Klant', sub: `${x.n} post${x.n === 1 ? '' : 's'} met feedback${x.laatste ? ` · laatste ${dagKort(x.laatste)}` : ''}`, href: `/admin/services/social-media?client=${id}`,
        })),
      }
    } catch { return null }
  }
}
