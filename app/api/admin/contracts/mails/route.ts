import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { getEmailStatus } from '@/lib/email'

export const dynamic = 'force-dynamic'

/**
 * Verzonden contractmails — één logboek (email_messages), geen kopieën.
 *  GET ?contract_id=…&q=…      → lijst (zonder de volledige html)
 *  GET ?id=…                   → één mail volledig (tekst + html)
 *  POST {id, action:'status'}  → aflevering opvragen bij de mailprovider (enkel lezen)
 * Toont enkel wat werkelijk bewaard is; oude mails zonder inhoud worden niet aangevuld.
 */

const VELDEN = 'id, contract_id, to_email, to_client_id, cc, subject, status, error, provider_id, provider_status, provider_status_op, sent_by_email, created_at, updated_at, bijlage, template_name, kind'

export async function GET(req: NextRequest) {
  try {
    if (!(await magIk('contracts', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const sp = req.nextUrl.searchParams
    const id = sp.get('id')
    if (id) {
      const { data, error } = await admin.from('email_messages').select('*').eq('id', id).maybeSingle()
      if (error) throw new Error(error.message)
      if (!data || (data.kind !== 'contract' && !data.contract_id)) return NextResponse.json({ error: 'Mail niet gevonden' }, { status: 404 })
      return NextResponse.json({ mail: data })
    }
    let q = admin.from('email_messages').select(VELDEN).order('created_at', { ascending: false }).limit(500)
    const cid = sp.get('contract_id')
    q = cid ? q.eq('contract_id', cid) : q.or('kind.eq.contract,contract_id.not.is.null')
    const { data, error } = await q
    if (error) throw new Error(error.message)
    const rijen = (data ?? []) as Record<string, unknown>[]
    const cids = [...new Set(rijen.map((r) => r.contract_id).filter(Boolean))] as string[]
    const kids = [...new Set(rijen.map((r) => r.to_client_id).filter(Boolean))] as string[]
    const [{ data: contracten }, { data: klanten }] = await Promise.all([
      cids.length ? admin.from('contracts').select('id, title, client_id').in('id', cids) : Promise.resolve({ data: [] }),
      kids.length ? admin.from('clients').select('id, company_name').in('id', kids) : Promise.resolve({ data: [] }),
    ])
    const cMap = new Map(((contracten ?? []) as { id: string; title: string }[]).map((c) => [c.id, c.title]))
    const kMap = new Map(((klanten ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
    let mails: (Record<string, unknown> & { contract_titel: string | null; klant: string | null })[] = rijen.map((r) => ({ ...r, contract_titel: r.contract_id ? cMap.get(String(r.contract_id)) ?? null : null, klant: r.to_client_id ? kMap.get(String(r.to_client_id)) ?? null : null }))
    const zoek = (sp.get('q') ?? '').trim().toLowerCase()
    if (zoek) mails = mails.filter((m) => [m.to_email, m.cc, m.subject, m.contract_titel, m.klant].some((x) => String(x ?? '').toLowerCase().includes(zoek)))
    return NextResponse.json({ mails })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await magIk('contracts', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { id?: string; action?: string }
    if (b.action !== 'status' || !b.id) return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: m } = await admin.from('email_messages').select('id, provider_id, status').eq('id', b.id).maybeSingle()
    if (!m?.provider_id) return NextResponse.json({ error: 'Voor deze mail is geen berichtreferentie van de mailprovider bewaard.' }, { status: 400 })
    const r = await getEmailStatus(m.provider_id)
    if (!r.ok) return NextResponse.json({ error: r.restricted ? 'De mailsleutel mag de afleverstatus niet opvragen (enkel verzenden). Pas de rechten van de sleutel aan bij de mailprovider.' : 'De mailprovider gaf geen status terug.' }, { status: 400 })
    if (!r.status) return NextResponse.json({ error: 'De mailprovider gaf geen status terug.' }, { status: 400 })
    const event = (r.status.lastEvent ?? '').toLowerCase() || null
    const patch: Record<string, unknown> = { provider_status: event, provider_status_op: new Date().toISOString(), updated_at: new Date().toISOString() }
    if (event === 'delivered') patch.status = 'delivered'
    if (event === 'bounced' || event === 'failed') patch.status = 'error'
    await admin.from('email_messages').update(patch).eq('id', m.id)
    return NextResponse.json({ ok: true, provider_status: event })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
