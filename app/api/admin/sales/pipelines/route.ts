import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, requireAdmin } from '@/lib/supabase/server'
import { listPipelines, defaultFromFor } from '@/lib/sales/pipelines'
import { reminderBody } from '@/lib/sales/reminders'
import { sendEmailMetAfzenderTerugval, baseUrl, EMAIL_FROM, resendKeyFor } from '@/lib/email'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// De twee merken (NextGenMedia, NextGenSolutions) en de instellingen van hun
// herinneringsmail: aan/uit, afzender, antwoordadres en de brochure.

export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const pipelines = await listPipelines()
    // Enkel of er een eigen sleutel ingesteld is — nooit de sleutel zelf.
    const withKeyInfo = pipelines.map((p) => ({
      ...p,
      ownKey: p.key === 'nextgensolutions' ? !!process.env.RESEND_API_KEY_SOLUTIONS : false,
      // Wat er vertrekt als het veld leeg blijft.
      fallbackFrom: defaultFromFor(p.key) ?? EMAIL_FROM,
    }))
    return NextResponse.json({ pipelines: withKeyInfo, defaultFrom: EMAIL_FROM })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()

    const pipelines = await listPipelines()
    const target = pipelines.find((p) => p.id === String(b.id ?? ''))
    if (!target) return NextResponse.json({ error: 'Pipeline niet gevonden' }, { status: 404 })

    const text = (v: unknown) => {
      const s = String(v ?? '').trim()
      return s === '' ? null : s
    }

    const admin = createAdminSupabaseClient()
    const patch: Record<string, unknown> = {
      reminder_enabled: b.reminder_enabled !== false,
      reminder_from: text(b.reminder_from),
      reminder_reply_to: text(b.reminder_reply_to),
      brochure_url: text(b.brochure_url),
      brochure_filename: text(b.brochure_filename),
    }
    // ClickUp-lijst en intern meldingsadres van dit merk. Enkel meenemen als
    // het veld meegestuurd is, zodat een oudere UI deze waarden niet wist.
    //
    // ADMIN-ONLY: waar de afspraakgegevens heen gemaild worden en in welke
    // lijst ze belanden is beheer, geen setterwerk. Een setter die dit paneel
    // opent kan de herinneringsmail aanpassen (bestaand gedrag), maar deze
    // twee velden worden voor niet-admins stil genegeerd.
    if (await requireAdmin()) {
      if ('clickup_list_id' in b) {
        const lijst = text(b.clickup_list_id)
        // ClickUp-lijst-ids zijn numeriek; al het andere is per definitie fout.
        if (lijst && !/^\d{1,20}$/.test(lijst)) {
          return NextResponse.json({ error: 'Dat is geen geldige ClickUp-lijst.' }, { status: 400 })
        }
        patch.clickup_list_id = lijst
      }
      if ('notify_email' in b) {
        const adres = text(b.notify_email)
        if (adres && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adres)) {
          return NextResponse.json({ error: 'Dat is geen geldig e-mailadres voor de melding.' }, { status: 400 })
        }
        patch.notify_email = adres
      }
    }

    let { error } = await admin.from('sales_pipelines').update(patch).eq('id', target.id)
    // Nieuwe kolommen nog niet gemigreerd → zonder die velden opnieuw.
    if (error && /clickup_list_id|notify_email|PGRST204|schema cache/i.test(error.message)) {
      delete patch.clickup_list_id
      delete patch.notify_email
      ;({ error } = await admin.from('sales_pipelines').update(patch).eq('id', target.id))
    }
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'sales.pipeline.update', entityType: 'sales_pipeline', entityId: target.id,
      summary: `Verkoop: herinneringsmail ${target.name} aangepast`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST — testmail naar jezelf. Exact dezelfde tekst, afzender en bijlage als de
 * echte herinnering, zodat je vóór de eerste prospect ziet wat er vertrekt.
 * Gaat nooit naar een prospect: het adres wordt hier ingetikt.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()

    const pipelines = await listPipelines()
    const p = pipelines.find((x) => x.id === String(b.id ?? ''))
    if (!p) return NextResponse.json({ error: 'Pipeline niet gevonden' }, { status: 404 })

    const to = String(b.to ?? '').trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return NextResponse.json({ error: 'Vul een geldig e-mailadres in' }, { status: 400 })
    }

    const lines = reminderBody({ hour: '14:00', today: false })
    const attachments = p.brochure_url
      ? [{
          filename: p.brochure_filename || 'Kennismaking.pdf',
          path: p.brochure_url.startsWith('http') ? p.brochure_url : `${baseUrl()}${p.brochure_url}`,
        }]
      : []

    const res = await sendEmailMetAfzenderTerugval({
      to,
      subject: `[TEST — ${p.name}] Tot morgen om 14:00`,
      text: lines.join('\n'),
      from: p.reminder_from || defaultFromFor(p.key),
      replyTo: p.reminder_reply_to,
      attachments,
      // Zelfde sleutel als de echte herinnering, zodat de test ook echt test.
      apiKey: resendKeyFor(p.key),
    })
    if (!res.ok) return NextResponse.json({ error: res.error ?? 'Versturen mislukt' }, { status: 502 })
    return NextResponse.json({
      ok: true,
      attached: attachments.length > 0,
      // Vertrokken vanaf het hoofdadres omdat het merkdomein niet geverifieerd
      // is bij Resend — goed om te weten, geen fout.
      afzenderTeruggevallen: !!res.afzenderTeruggevallen,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
