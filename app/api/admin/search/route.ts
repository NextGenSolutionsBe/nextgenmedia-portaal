import { safeMessage } from '@/lib/api-error'
import { soortLabel as eventSoortLabel, type EventSoort } from '@/lib/events'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { getActor, actorCanSee } from '@/lib/actor-modules'
import { FEATURES } from '@/lib/features'
import { kolomInfo, kolomVan } from '@/lib/opdrachten-kanban'
import { dienstLabel } from '@/lib/formulieren/model'
import { typeVanContract } from '@/lib/contracten/types'
import { datumKort, uur } from '@/lib/meetings/model'
import { STATUS, soortLabel, type AanvraagSoort } from '@/lib/aanvragen/model'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// Globale zoekfunctie over de belangrijkste entiteiten. Admin-only.
// Geeft direct klikbare resultaten met deep-links terug.

type Result = { type: string; label: string; title: string; subtitle?: string; href: string }

export async function GET(req: NextRequest) {
  try {
    // Admin ÉN werknemer mogen zoeken; een werknemer ziet enkel resultaten uit de
    // modules waar hij recht op heeft (anders lekt de zoekbalk data).
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const may = (m: string) => actorCanSee(actor, m)
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) return NextResponse.json({ results: [] })

    const admin = createAdminSupabaseClient()
    const like = `%${q}%`
    const L = 6

    // Elk los wrappen zodat een ontbrekende tabel/kolom de hele zoekopdracht nooit breekt.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const safe = async <T,>(p: PromiseLike<{ data: T[] | null }>): Promise<T[]> => { try { return (await p).data ?? [] } catch { return [] } }

    const [clients, contracts, blogs, invoices, forecast, tasks, partners, opdrachten, formulieren, meetings, aanvragen] = await Promise.all([
      safe(admin.from('clients').select('id, company_name, btw_nummer').ilike('company_name', like).limit(L)),
      safe(admin.from('contracts').select('id, title, signer_name, signer_email, contract_type').or(`title.ilike.${like},signer_name.ilike.${like},signer_email.ilike.${like},contract_type.ilike.${like}`).limit(L)),
      safe(admin.from('blogs').select('id, titel, status').ilike('titel', like).limit(L)),
      safe(admin.from('invoices').select('id, description, status, client_id, amount_incl').or(`description.ilike.${like}`).limit(L)),
      safe(admin.from('revenue_entries').select('id, title, client_id').ilike('title', like).limit(L)),
      safe(admin.from('client_tasks').select('id, title, client_id, status').ilike('title', like).limit(L)),
      safe(admin.from('freelancers').select('id, name').ilike('name', like).limit(L)),
      safe(admin.from('opdrachten').select('id, titel, status').ilike('titel', like).limit(L)),
      safe(admin.from('formulieren').select('id, titel, dienst, doel').is('gearchiveerd_op', null).or(`titel.ilike.${like},doel.ilike.${like}`).limit(L)),
      safe(admin.from('klant_meetings').select('id, titel, klant_naam, starts_at, status').or(`titel.ilike.${like},klant_naam.ilike.${like}`).order('starts_at', { ascending: false }).limit(L)),
      safe(admin.from('klant_aanvragen').select('id, client_id, soort, type_label, status, created_at').or(`type_label.ilike.${like},wat.ilike.${like}`).order('created_at', { ascending: false }).limit(L)),
    ]) as [
      { id: string; company_name: string; btw_nummer?: string | null }[],
      { id: string; title: string; signer_name?: string | null; signer_email?: string | null; contract_type?: string | null }[],
      { id: string; titel: string; status?: string | null }[],
      { id: string; description?: string | null; status?: string | null; client_id?: string | null; amount_incl?: number | null }[],
      { id: string; title?: string | null; client_id?: string | null }[],
      { id: string; title: string; client_id?: string | null; status?: string | null }[],
      { id: string; name: string }[],
      { id: string; titel: string; status?: string | null }[],
      { id: string; titel: string; dienst?: string | null; doel?: string | null }[],
      { id: string; titel: string; klant_naam: string; starts_at: string; status: string }[],
      { id: string; client_id: string; soort: string; type_label: string; status: string; created_at: string }[],
    ]

    // Vaste prioriteitsvolgorde: klanten → contracten → facturen → taken → blogs → prognose → partners.
    const results: Result[] = []
    if (may('clients')) for (const c of clients) results.push({ type: 'client', label: 'Klant', title: c.company_name, subtitle: c.btw_nummer ?? undefined, href: `/admin/clients/${c.id}` })
    if (may('contracts')) for (const c of contracts) {
      // Contracttype eerst in de ondertitel: dat is waarop de klantmappen gefilterd worden.
      const ondertitel = [typeVanContract(c.contract_type), c.signer_name ?? c.signer_email ?? null].filter(Boolean).join(' · ')
      results.push({ type: 'contract', label: 'Contract', title: c.title, subtitle: ondertitel || undefined, href: `/admin/contracts/${c.id}` })
    }
    if (may('invoices')) for (const i of invoices) results.push({ type: 'invoice', label: 'Factuur', title: i.description || 'Factuur', subtitle: i.status ?? undefined, href: `/admin/invoices` })
    if (may('clients')) for (const t of tasks) results.push({ type: 'task', label: 'Taak', title: t.title, subtitle: t.status ?? undefined, href: t.client_id ? `/admin/clients/${t.client_id}#taken` : '/admin/clients' })
    // Uitgeschakelde features niet in de zoekresultaten (lib/features.ts).
    if (FEATURES.blogs && may('blogs')) for (const b of blogs) results.push({ type: 'blog', label: 'Blog', title: b.titel, subtitle: b.status ?? undefined, href: `/admin/blogs` })
    // Prognose bestaat niet meer als los concept — omzet volgt uit facturen.
    if (FEATURES.partners && may('partners')) for (const p of partners) results.push({ type: 'partner', label: 'Partner', title: p.name, href: `/admin/partners/${p.id}` })
    if (may('opdrachten')) for (const o of opdrachten) results.push({ type: 'opdracht', label: 'Opdracht', title: o.titel, subtitle: kolomInfo(kolomVan(o.status)).label, href: `/admin/opdrachten?opdracht=${o.id}` })
    if (may('meetings')) for (const m of meetings) results.push({ type: 'meeting', label: 'Meeting', title: `${m.klant_naam} · ${m.titel}`, subtitle: m.status === 'geannuleerd' ? 'Geannuleerd' : `${datumKort(m.starts_at)} ${uur(m.starts_at)}`, href: `/admin/meetings?meeting=${m.id}` })
    if (may('formulieren')) for (const f of formulieren) results.push({ type: 'formulier', label: 'Formulier', title: f.titel, subtitle: f.doel ?? dienstLabel(f.dienst), href: `/admin/formulieren/${f.id}` })
    if (may('events')) {
      const ev = await safe(admin.from('klant_events').select('id, titel, soort, soort_label, status, start_op').or(`titel.ilike.${like},spreker.ilike.${like}`).order('start_op', { ascending: false }).limit(L)) as { id: string; titel: string; soort: string; soort_label: string | null; status: string; start_op: string }[]
      for (const e of ev) results.push({ type: 'event', label: eventSoortLabel({ soort: e.soort as EventSoort, soort_label: e.soort_label }), title: e.titel, subtitle: e.status === 'geannuleerd' ? 'Geannuleerd' : e.status === 'concept' ? `Concept · ${datumKort(e.start_op)}` : `${datumKort(e.start_op)} ${uur(e.start_op)}`, href: `/admin/events?event=${e.id}` })
    }
    if (may('opleveringen')) {
      const extraKlant = clients.length ? `,client_id.in.(${clients.map((c) => c.id).join(',')})` : ''
      const op = await safe(admin.from('opleveringen').select('id, titel, client_id, gearchiveerd_op').or(`titel.ilike.${like}${extraKlant}`).order('updated_at', { ascending: false }).limit(L)) as { id: string; titel: string; client_id: string; gearchiveerd_op: string | null }[]
      const naamVan = new Map(clients.map((c) => [c.id, c.company_name]))
      for (const o of op) results.push({ type: 'oplevering', label: 'Oplevering', title: o.titel, subtitle: `${naamVan.get(o.client_id) ?? ''}${o.gearchiveerd_op ? ' · archief' : ''}`.replace(/^ · /, ''), href: `/admin/opleveringen?oplevering=${o.id}` })
    }
    if (may('aanvragen')) {
      // Ook aanvragen van een gevonden klant (op klantnaam), niet enkel op dienst of tekst.
      const extra = clients.length ? await safe(admin.from('klant_aanvragen').select('id, client_id, soort, type_label, status, created_at').in('client_id', clients.map((c) => c.id)).order('created_at', { ascending: false }).limit(L)) as typeof aanvragen : []
      const alle = [...aanvragen, ...extra.filter((x) => !aanvragen.some((y) => y.id === x.id))].slice(0, L)
      const ids = [...new Set(alle.map((a) => a.client_id))]
      const namen = new Map((ids.length ? await safe(admin.from('clients').select('id, company_name').in('id', ids)) as { id: string; company_name: string }[] : []).map((c) => [c.id, c.company_name]))
      for (const a of alle) results.push({ type: 'aanvraag', label: soortLabel(a.soort as AanvraagSoort), title: `${namen.get(a.client_id) ?? 'Klant'} · ${a.type_label}`, subtitle: `${STATUS[a.status as keyof typeof STATUS]?.team ?? a.status} · ${datumKort(a.created_at)}`, href: `/admin/aanvragen?aanvraag=${a.id}` })
    }

    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
