import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { telefoonBE, websiteNorm, beoordeel, type Telefoon } from '@/lib/sales/lead-kwaliteit'
import { controleerSite } from '@/lib/sales/site-controle'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET — het laatste controleresultaat van deze lead (of null).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const { data } = await createAdminSupabaseClient().from('sales_lead_controle').select('*').eq('lead_id', id).maybeSingle()
    return NextResponse.json({ controle: data ?? null })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST — de lead nu controleren: geldig telefoonnummer, eigen website, en staat
 * het nummer op die website? Wijzigt niets aan de lead zelf; het resultaat
 * wordt bewaard zodat iedereen ziet of de gegevens bewezen kloppen.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: lead } = await admin.from('sales_leads')
      .select('id, sales_companies ( name, website, phone ), sales_contacts ( phone, mobile )')
      .eq('id', id).maybeSingle()
    if (!lead) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })
    const l = lead as unknown as { sales_companies: { name: string; website: string | null; phone: string | null } | null; sales_contacts: { phone: string | null; mobile: string | null } | null }

    const kandidaten: string[] = []
    let telefoon: Telefoon = telefoonBE('')
    for (const v of [l.sales_companies?.phone, l.sales_contacts?.phone, l.sales_contacts?.mobile]) {
      if (!v || !String(v).trim()) continue
      const t = telefoonBE(v)
      if (t.geldig) { kandidaten.push(t.nsn); if (!telefoon.geldig) telefoon = t }
      else if (!telefoon.geldig && telefoon.reden === 'geen telefoonnummer') telefoon = t
    }
    const website = websiteNorm(l.sales_companies?.website)
    const site = telefoon.geldig && website.geldig
      ? await controleerSite(website.url, l.sales_companies?.name ?? '', website.domein, kandidaten, 12000)
      : null
    if (site?.telefoonOpSite && telefoon.geldig && !site.nummers.has(telefoon.nsn)) {
      const alt = kandidaten.find((n) => site.nummers.has(n))
      if (alt) telefoon = telefoonBE(`0${alt}`)
    }
    const oordeel = beoordeel({ telefoon, website, site })

    const rij = {
      lead_id: id, status: oordeel.status, reden: oordeel.reden,
      telefoon_norm: telefoon.geldig ? telefoon.weergave : null, website_norm: website.geldig ? website.url : null,
      site_bereikbaar: site?.bereikbaar ?? null, telefoon_op_site: site?.telefoonOpSite ?? null, naam_op_site: site?.naamOpSite ?? null,
      bron: `handmatig · ${actor.email ?? actor.id}`, gecontroleerd_op: new Date().toISOString(),
    }
    const { error } = await admin.from('sales_lead_controle').upsert(rij, { onConflict: 'lead_id' })
    if (error) throw error
    await admin.from('sales_lead_events').insert({
      lead_id: id, kind: 'system', body: `Gegevens gecontroleerd: ${oordeel.reden}.`, actor_id: actor.id, actor_email: actor.email ?? null,
    })
    return NextResponse.json({ controle: rij })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
