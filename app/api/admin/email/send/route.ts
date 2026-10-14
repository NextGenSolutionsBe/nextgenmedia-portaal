import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { sendEmail, EMAIL_FROM } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function requireAdminUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
/** Schrijven die ontbrekende (niet-gemigreerde) kolommen laat vallen en opnieuw probeert. */
async function veerkrachtig(admin: Admin, tabel: string, op: 'insert' | 'update', rij: Record<string, unknown>, id?: string): Promise<{ id: string | null; fout: string | null }> {
  const p = { ...rij }
  for (let i = 0; i < 12; i++) {
    const q = op === 'insert' ? admin.from(tabel).insert(p).select('id').single() : admin.from(tabel).update(p).eq('id', id)
    const { data, error } = await q
    if (!error) return { id: op === 'insert' ? String(data.id) : id ?? null, fout: null }
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in p) { delete p[col]; continue }
    return { id: null, fout: String(error.message || 'Opslaan mislukt') }
  }
  return { id: null, fout: 'Opslaan mislukt' }
}

/**
 * POST — iemand van het team verstuurt bewust een mail naar een klant (nooit
 * automatisch; altijd vanuit de MailComposer met voorbeeld).
 *  · verzend_sleutel: één per verzendpoging. Dezelfde klik (dubbelklik, netwerk
 *    dat opnieuw probeert) verstuurt nooit twee keer; een eerder gelukte poging
 *    geeft gewoon haar resultaat terug.
 *  · deadline_id: de goedkeuringstermijn waarbij deze mail hoort. Na een gelukte
 *    verzending krijgt die termijn het tijdstip en de deadline die in de mail stond.
 * Elke poging wordt EERST gelogd (status 'bezig'), dan verstuurd en bijgewerkt
 * naar 'sent' of 'error'. Een fout van de mailprovider (of geen sleutel
 * geconfigureerd) komt als fout terug: nooit doen alsof er gemaild werd.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireAdminUser()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json()
    const toEmail = (b.to_email as string)?.trim()
    const subject = (b.subject as string)?.trim()
    const body = (b.body as string) ?? ''
    const ctaText = (b.cta_text as string)?.trim() || null
    const ctaLink = (b.cta_link as string)?.trim() || null
    if (!toEmail) return NextResponse.json({ error: 'Geen e-mailadres voor deze klant' }, { status: 400 })
    if (!subject) return NextResponse.json({ error: 'Onderwerp is verplicht' }, { status: 400 })
    // Een nooit ingevulde placeholder ({{voornaam}}, …) mag nooit vertrekken.
    if (/\{\{\s*[a-z_]+\s*\}\}/i.test(`${subject}\n${body}`)) return NextResponse.json({ error: 'De mail bevat nog een niet ingevulde code tussen {{ }}. Pas de tekst aan voor je verstuurt.' }, { status: 400 })
    const sleutel = typeof b.verzend_sleutel === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(b.verzend_sleutel) ? b.verzend_sleutel : null
    const deadlineId = typeof b.deadline_id === 'string' && UUID.test(b.deadline_id) ? b.deadline_id : null
    const clientId = typeof b.to_client_id === 'string' && UUID.test(b.to_client_id) ? b.to_client_id : null

    const admin = createAdminSupabaseClient()

    // De termijn moet van dezelfde klant zijn; anders koppelen we niets.
    let deadline: { id: string; deadline: string } | null = null
    if (deadlineId) {
      const { data: d } = await admin.from('content_goedkeuring_deadlines').select('id, client_id, deadline').eq('id', deadlineId).maybeSingle()
      if (!d || d.client_id !== clientId) return NextResponse.json({ error: 'Deze goedkeuringstermijn hoort niet bij deze klant.' }, { status: 400 })
      deadline = { id: d.id, deadline: d.deadline }
    }

    // 0. Werd deze verzendpoging al verwerkt?
    let herprobeerId: string | null = null
    if (sleutel) {
      const { data: al, error: alFout } = await admin.from('email_messages').select('id, status, created_at').eq('verzend_sleutel', sleutel).maybeSingle()
      if (!alFout && al) {
        if (al.status === 'sent') return NextResponse.json({ ok: true, id: al.id, al_verstuurd: true, verstuurd_op: al.created_at })
        if (al.status === 'bezig') return NextResponse.json({ error: 'Deze mail wordt al verstuurd. Wacht even en vernieuw de pagina.' }, { status: 409 })
        herprobeerId = String(al.id)   // vorige poging mislukte: dezelfde rij opnieuw gebruiken
      }
    }

    const htmlOpts = { bodyText: body, ctaText, ctaLink }
    const html = buildEmailHtml(htmlOpts)
    const text = buildEmailText(htmlOpts)
    const nu = () => new Date().toISOString()
    const rij = {
      to_email: toEmail, to_client_id: clientId, subject, body, html, from_email: EMAIL_FROM,
      template_id: b.template_id && UUID.test(String(b.template_id)) ? b.template_id : null, template_name: b.template_name || null,
      kind: b.kind || 'generic', audience: 'client', related_id: deadline?.id ?? null, verzend_sleutel: sleutel,
      sent_by: user.id, sent_by_email: user.email ?? null, updated_at: nu(),
    }

    // 1. Eerst loggen.
    let logId: string | null = herprobeerId
    if (herprobeerId) {
      await veerkrachtig(admin, 'email_messages', 'update', { ...rij, verzend_sleutel: undefined, status: 'bezig', error: null }, herprobeerId)
    } else {
      const r = await veerkrachtig(admin, 'email_messages', 'insert', { ...rij, status: 'bezig' })
      if (r.fout && /duplicate key|unique/i.test(r.fout)) return NextResponse.json({ error: 'Deze mail wordt al verstuurd. Wacht even en vernieuw de pagina.' }, { status: 409 })
      logId = r.id
    }

    // 2. Versturen.
    const result = await sendEmail({ to: toEmail, subject, text, html })

    // 3. Resultaat vastleggen. Lukte het vooraf loggen niet, dan alsnog achteraf (zoals voorheen).
    const resultaat = { status: result.ok ? 'sent' : 'error', error: result.ok ? null : result.error ?? 'Onbekende fout', provider_id: result.id || null, updated_at: nu() }
    if (logId) await veerkrachtig(admin, 'email_messages', 'update', resultaat, logId)
    else logId = (await veerkrachtig(admin, 'email_messages', 'insert', { ...rij, verzend_sleutel: null, ...resultaat })).id

    if (!result.ok) return NextResponse.json({ error: result.error || 'Verzenden mislukt', log_id: logId }, { status: 400 })

    // 4. De goedkeuringstermijn weet nu wanneer en met welke deadline er gemaild werd.
    const verstuurdOp = nu()
    if (deadline) await veerkrachtig(admin, 'content_goedkeuring_deadlines', 'update', { mail_verstuurd_op: verstuurdOp, mail_deadline: deadline.deadline, mail_message_id: logId, updated_at: verstuurdOp }, deadline.id)

    return NextResponse.json({ ok: true, id: logId, provider_id: result.id ?? null, verstuurd_op: verstuurdOp })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
