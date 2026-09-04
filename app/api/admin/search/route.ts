import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { getActor, actorCanSee } from '@/lib/actor-modules'
import { FEATURES } from '@/lib/features'
import { statusInfo } from '@/lib/opdrachten'

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

    const [clients, contracts, blogs, invoices, forecast, tasks, partners, opdrachten] = await Promise.all([
      safe(admin.from('clients').select('id, company_name, btw_nummer').ilike('company_name', like).limit(L)),
      safe(admin.from('contracts').select('id, title, signer_name, signer_email').or(`title.ilike.${like},signer_name.ilike.${like},signer_email.ilike.${like}`).limit(L)),
      safe(admin.from('blogs').select('id, titel, status').ilike('titel', like).limit(L)),
      safe(admin.from('invoices').select('id, description, status, client_id, amount_incl').or(`description.ilike.${like}`).limit(L)),
      safe(admin.from('revenue_entries').select('id, title, client_id').ilike('title', like).limit(L)),
      safe(admin.from('client_tasks').select('id, title, client_id, status').ilike('title', like).limit(L)),
      safe(admin.from('freelancers').select('id, name').ilike('name', like).limit(L)),
      safe(admin.from('opdrachten').select('id, titel, status').ilike('titel', like).limit(L)),
    ]) as [
      { id: string; company_name: string; btw_nummer?: string | null }[],
      { id: string; title: string; signer_name?: string | null; signer_email?: string | null }[],
      { id: string; titel: string; status?: string | null }[],
      { id: string; description?: string | null; status?: string | null; client_id?: string | null; amount_incl?: number | null }[],
      { id: string; title?: string | null; client_id?: string | null }[],
      { id: string; title: string; client_id?: string | null; status?: string | null }[],
      { id: string; name: string }[],
      { id: string; titel: string; status?: string | null }[],
    ]

    // Vaste prioriteitsvolgorde: klanten → contracten → facturen → taken → blogs → prognose → partners.
    const results: Result[] = []
    if (may('clients')) for (const c of clients) results.push({ type: 'client', label: 'Klant', title: c.company_name, subtitle: c.btw_nummer ?? undefined, href: `/admin/clients/${c.id}` })
    if (may('contracts')) for (const c of contracts) results.push({ type: 'contract', label: 'Contract', title: c.title, subtitle: c.signer_name ?? c.signer_email ?? undefined, href: `/admin/contracts/${c.id}` })
    if (may('invoices')) for (const i of invoices) results.push({ type: 'invoice', label: 'Factuur', title: i.description || 'Factuur', subtitle: i.status ?? undefined, href: `/admin/invoices` })
    if (may('clients')) for (const t of tasks) results.push({ type: 'task', label: 'Taak', title: t.title, subtitle: t.status ?? undefined, href: t.client_id ? `/admin/clients/${t.client_id}#taken` : '/admin/clients' })
    // Uitgeschakelde features niet in de zoekresultaten (lib/features.ts).
    if (FEATURES.blogs && may('blogs')) for (const b of blogs) results.push({ type: 'blog', label: 'Blog', title: b.titel, subtitle: b.status ?? undefined, href: `/admin/blogs` })
    // Prognose bestaat niet meer als los concept — omzet volgt uit facturen.
    if (FEATURES.partners && may('partners')) for (const p of partners) results.push({ type: 'partner', label: 'Partner', title: p.name, href: `/admin/partners/${p.id}` })
    if (may('opdrachten')) for (const o of opdrachten) results.push({ type: 'opdracht', label: 'Opdracht', title: o.titel, subtitle: statusInfo(o.status).label, href: '/admin/opdrachten' })

    return NextResponse.json({ results })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
