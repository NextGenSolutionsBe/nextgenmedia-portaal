import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { baseUrl } from '@/lib/email'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { bedrijfVan, projectOnderwerp } from '@/lib/opdrachten-kanban'
import { canonicalStatus } from '@/lib/contract-status'
import { offerteLink } from '@/lib/offertes'
import { MERK_STIJL } from '@/lib/merk-mail'
import { laadOpvolgingen } from '@/lib/mail-opvolging/server'
import { projectMailVoorstellen, standaardVoorstel, isProjectMailSoort, type ProjectMailInfo } from '@/lib/opdrachten-mail'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Opvolgmail vanuit de projectkaart.
 *  GET  → voorstellen (herinnering contract, opvolging offerte, na de meeting,
 *         even polsen, samen zitten, eigen mail), het adres van de klant en het
 *         voorstel dat het best past. Versturen gebeurt in het mailvenster (voorbeeld
 *         en bevestiging): het contract via de contractroute, de rest via /api/admin/email/send.
 *  POST { actie: 'verstuurd', email_id, aan, onderwerp, soort } → na een gelukte
 *         mail: notitie op de kaart en de mail in de opvolging (telt als "wij mailden").
 * Module Projecten: bekijken voor de voorstellen, aanpassen om te registreren.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OPEN_CONTRACT = new Set(['verzonden', 'geopend', 'ingevuld'])

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('opdrachten', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Project niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const { data: o } = await admin.from('opdrachten').select('id, titel, client_id, klant_vrij, diensten, merk, contract_id').eq('id', id).maybeSingle()
    if (!o) return NextResponse.json({ error: 'Project niet gevonden' }, { status: 404 })
    const vandaag = new Date().toISOString().slice(0, 10)

    const [klantR, contractR, offerteR, inR, opv, ident] = await Promise.all([
      o.client_id ? admin.from('clients').select('company_name, contact_name, email').eq('id', o.client_id).maybeSingle() : Promise.resolve({ data: null }),
      o.contract_id ? admin.from('contracts').select('id, title, status, sent_at, expires_at, access_token, signer_email, signer_name').eq('id', o.contract_id).maybeSingle() : Promise.resolve({ data: null }),
      admin.from('offertes').select('id, titel, status, verstuurd_op, geldig_tot, token, ontvanger_email').eq('opdracht_id', id).eq('status', 'verstuurd').order('verstuurd_op', { ascending: false }).limit(1),
      admin.from('mail_berichten').select('van, verzonden_op').eq('opdracht_id', id).eq('richting', 'in').order('verzonden_op', { ascending: false }).limit(1),
      laadOpvolgingen(admin, { opdrachtId: id }).catch(() => []),
      leesAdminIdentiteit().catch(() => null),
    ])
    const klant = klantR.data as { company_name: string | null; contact_name: string | null; email: string | null } | null
    const c = contractR.data as { id: string; title: string | null; status: string | null; sent_at: string | null; expires_at: string | null; access_token: string | null; signer_email: string | null; signer_name: string | null } | null
    const of = ((offerteR.data ?? []) as { id: string; titel: string; verstuurd_op: string | null; geldig_tot: string | null; token: string | null; ontvanger_email: string | null }[])[0] ?? null
    const laatsteIn = ((inR.data ?? []) as { van: string | null }[])[0]?.van ?? null

    const contractOpen = !!c && !!c.access_token && OPEN_CONTRACT.has(canonicalStatus(c.status)) && !(c.expires_at && String(c.expires_at).slice(0, 10) < vandaag)
    const offerteOpen = !!of && !!of.token && !(of.geldig_tot && String(of.geldig_tot).slice(0, 10) < vandaag)
    const p = (opv as Awaited<ReturnType<typeof laadOpvolgingen>>)[0]
    const meeting = [...(p?.gebeurtenissen ?? [])].reverse().find((g) => g.soort === 'meeting') ?? null
    const merk = bedrijfVan(o.merk as string | null, o.diensten as string[] | null) === 'nextgensolutions' ? 'nextgensolutions' : 'nextgenmedia'
    const basis = baseUrl().replace(/\/$/, '')

    const info: ProjectMailInfo = {
      contact: (contractOpen ? c?.signer_name : null) || klant?.contact_name || null,
      klant: klant?.company_name ?? (o.klant_vrij as string | null) ?? null,
      onderwerp: projectOnderwerp(o.diensten as string[] | null, o.titel as string | null),
      afzender: ident?.naam ? ident.naam.split(' ')[0] : null,
      merkNaam: MERK_STIJL[merk].naam,
      contract: contractOpen && c ? { titel: c.title ?? 'Contract', link: `${basis}/sign/${c.access_token}`, verstuurdOp: c.sent_at, verlooptOp: c.expires_at ? String(c.expires_at).slice(0, 10) : null } : null,
      offerte: offerteOpen && of ? { titel: of.titel, link: offerteLink(basis, of.token!), verstuurdOp: of.verstuurd_op, geldigTot: of.geldig_tot ? String(of.geldig_tot).slice(0, 10) : null } : null,
      meeting: meeting ? { titel: meeting.titel, op: meeting.op } : null,
      status: p?.opvolging?.status ?? null,
    }
    const aan = (contractOpen ? c?.signer_email : null) || (offerteOpen ? of?.ontvanger_email : null) || klant?.email || laatsteIn || ''
    return NextResponse.json({
      aan, client_id: o.client_id ?? null, merk, contract_id: contractOpen ? c!.id : null,
      // Per soort het beste adres: de ondertekenaar voor het contract, de ontvanger van de offerte, anders de klant.
      adressen: { contract: contractOpen ? c?.signer_email ?? null : null, offerte: offerteOpen ? of?.ontvanger_email ?? null : null, klant: klant?.email || laatsteIn || null },
      voorstellen: projectMailVoorstellen(info), standaard: standaardVoorstel(info),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'project-mail.GET') }, { status: 500 }) }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const p = await magIk('opdrachten', 'aanpassen')
    if (!p) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Project niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    if (b.actie !== 'verstuurd') return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    const emailId = typeof b.email_id === 'string' && UUID.test(b.email_id) ? b.email_id : null
    if (!emailId) return NextResponse.json({ error: 'Onbekende mail' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const [{ data: o }, { data: m }] = await Promise.all([
      admin.from('opdrachten').select('id, client_id').eq('id', id).maybeSingle(),
      admin.from('email_messages').select('id, status, to_email, from_email, subject, created_at').eq('id', emailId).maybeSingle(),
    ])
    if (!o) return NextResponse.json({ error: 'Project niet gevonden' }, { status: 404 })
    // Enkel een mail die echt vertrok, telt.
    if (!m || m.status !== 'sent') return NextResponse.json({ error: 'Deze mail is niet verstuurd.' }, { status: 400 })
    const aan = String(m.to_email ?? '').split(/[,;]/).map((x) => x.trim().toLowerCase()).filter(Boolean)
    const soort = isProjectMailSoort(b.soort) ? b.soort : 'eigen'
    const naam = p.naam ?? p.email ?? null
    await voegNotitieToe(admin, id, `Mail verstuurd aan ${aan.join(', ')}: "${String(m.subject ?? '').slice(0, 200)}"`, 'systeem', { id: p.userId, email: p.email ?? null, naam })
    // In de opvolging: telt als "wij mailden" (de mail vertrok via de app, dus de mailbox ziet ze niet).
    const { error } = await admin.from('mail_berichten').insert({
      message_id: `app:${m.id}`, mailbox: 'app', map: 'verzonden', richting: 'uit', van: m.from_email ?? null, aan,
      onderwerp: String(m.subject ?? '').slice(0, 300), verzonden_op: m.created_at ?? new Date().toISOString(), tegenpartij: aan[0] ?? null,
      client_id: o.client_id ?? null, opdracht_id: id,
    })
    if (error && !/duplicate|unique|23505/i.test(error.message)) console.warn('[project-mail]', error.message)
    await logAudit({ action: 'opdracht.mail', entityType: 'opdracht', entityId: id, summary: `Opvolgmail (${soort}) aan ${aan.join(', ')}`, actorUserId: p.userId, actorEmail: p.email ?? null, ...requestMeta(req) })
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'project-mail.POST') }, { status: 500 }) }
}
