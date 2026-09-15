import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { eisBeheer, eisHoofdbeheerder, maskeer } from '@/lib/instellingen/api'
import type { Integratie } from '@/lib/instellingen/integraties'
import { clickupConfigured, clickupTest, facturatieLijst, facturatieAssigneeId, findMemberId, INVOICE_ASSIGNEE_NAME } from '@/lib/clickup'
import { sleutelRechten } from '@/lib/email'
import { metricoolConfigured, listBrands } from '@/lib/metricool'
import { googleConfigured } from '@/lib/sales/google-calendar'
import { draaiClickupAgendaSync, syncGezondheid } from '@/lib/sales/clickup-agenda-sync'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

async function laatste(admin: Admin, tabel: string, kolom: string): Promise<string | null> {
  try {
    const { data } = await admin.from(tabel).select(kolom).not(kolom, 'is', null).order(kolom, { ascending: false }).limit(1).maybeSingle()
    return (data?.[kolom] as string | undefined) ?? null
  } catch { return null }
}

async function overzicht(): Promise<Integratie[]> {
  const admin = createAdminSupabaseClient()
  const [lijst, agenda, contentSync, mailLaatste, framerLaatste, google] = await Promise.all([
    clickupConfigured() ? facturatieLijst().catch(() => null) : Promise.resolve(null),
    syncGezondheid().catch(() => null),
    laatste(admin, 'social_content_items', 'clickup_synced_at').then((v) => v ?? laatste(admin, 'social_content_items', 'synced_at')),
    laatste(admin, 'email_messages', 'created_at'),
    laatste(admin, 'framer_logs', 'created_at'),
    Promise.resolve(admin.from('sales_calendar_connections').select('id', { count: 'exact', head: true })).then((r: { count: number | null }) => r.count ?? 0).catch(() => 0),
  ])

  const uit: Integratie[] = []
  uit.push({
    key: 'clickup', naam: 'ClickUp', omschrijving: 'Contentkalender, afspraken en facturatietaken.',
    status: clickupConfigured() ? 'actief' : 'niet_ingesteld', sleutel: maskeer(process.env.CLICKUP_API_KEY),
    laatsteSync: agenda?.laatsteOkOp ?? contentSync ?? null,
    details: [
      lijst ? (lijst.ok ? `Facturatielijst: ${lijst.pad}` : `Facturatielijst: ${lijst.reden}`) : 'Facturatielijst: niet gecontroleerd',
      agenda?.actief ? `Agendasync: ${agenda.verouderd ? 'verouderd' : 'in orde'}${agenda.laatsteFout ? ` · laatste fout: ${agenda.laatsteFout.slice(0, 120)}` : ''}` : 'Agendasync: niet actief',
    ],
    kanTesten: clickupConfigured(), kanSync: clickupConfigured() && !!agenda?.actief,
  })
  const resend = process.env.RESEND_API_KEY
  uit.push({
    key: 'resend', naam: 'Resend (e-mail)', omschrijving: 'Verzending van portaalmails en inlogcodes.',
    status: resend ? 'actief' : 'niet_ingesteld', sleutel: maskeer(resend), laatsteSync: mailLaatste,
    details: [
      `Afzender: ${process.env.EMAIL_FROM || 'NextGenMedia <info@nextgenmedia.be>'}`,
      process.env.RESEND_API_KEY_SOLUTIONS ? `Tweede merk (Solutions): ${maskeer(process.env.RESEND_API_KEY_SOLUTIONS)}` : 'Tweede merk (Solutions): niet ingesteld',
    ],
    kanTesten: !!resend, kanSync: false,
  })
  uit.push({
    key: 'metricool', naam: 'Metricool', omschrijving: 'Socialmediakalender per klant (alleen lezen).',
    status: metricoolConfigured() ? 'actief' : 'niet_ingesteld', sleutel: maskeer(process.env.METRICOOL_USER_TOKEN), laatsteSync: null,
    details: ['Dagelijkse ophaling via cron om 06:00 en 07:00.'], kanTesten: metricoolConfigured(), kanSync: false,
  })
  uit.push({
    key: 'anthropic', naam: 'Anthropic (NextGen AI)', omschrijving: 'AI-voorstellen, contractvelden en blogteksten.',
    status: process.env.ANTHROPIC_API_KEY ? 'actief' : 'niet_ingesteld', sleutel: maskeer(process.env.ANTHROPIC_API_KEY), laatsteSync: null,
    details: [`Model: ${process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'}`], kanTesten: false, kanSync: false,
  })
  uit.push({
    key: 'google', naam: 'Google Agenda', omschrijving: 'Bezette agenda’s voor de afsprakenplanner.',
    status: googleConfigured() ? 'actief' : 'niet_ingesteld', sleutel: maskeer(process.env.GOOGLE_CLIENT_SECRET), laatsteSync: null,
    details: [`${google} gekoppelde agenda${google === 1 ? '' : '’s'}`], kanTesten: false, kanSync: false,
  })
  uit.push({
    key: 'framer', naam: 'Framer CMS', omschrijving: 'Blogpublicatie naar klantwebsites.',
    status: process.env.FRAMER_ENABLED === 'true' ? 'actief' : 'niet_ingesteld', sleutel: null, laatsteSync: framerLaatste,
    details: [process.env.FRAMER_ENABLED === 'true' ? 'Ingeschakeld (FRAMER_ENABLED).' : 'Uitgeschakeld tot de API-verificatie rond is.'], kanTesten: false, kanSync: false,
  })
  uit.push({
    key: 'supabase', naam: 'Supabase (database & opslag)', omschrijving: 'De databank, authenticatie en bestandsopslag van het portaal.',
    status: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'actief' : 'niet_ingesteld', sleutel: maskeer(process.env.SUPABASE_SERVICE_ROLE_KEY), laatsteSync: null,
    details: [`Project: ${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/^https?:\/\//, '') || 'onbekend'}`], kanTesten: true, kanSync: false,
  })
  return uit
}

// GET — status van alle koppelingen (zonder geheimen).
export async function GET() {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    return NextResponse.json({ integraties: await overzicht() })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST { key, actie: 'test' | 'sync' } — verbinding testen of opnieuw synchroniseren (hoofdbeheerder).
export async function POST(req: NextRequest) {
  try {
    const g = await eisHoofdbeheerder(); if (!g.ok) return g.response
    const b = (await req.json().catch(() => null)) as { key?: string; actie?: string } | null
    const key = b?.key ?? '', actie = b?.actie === 'sync' ? 'sync' : 'test'
    let resultaat: { ok: boolean; bericht: string }
    const t0 = Date.now()
    try {
      if (actie === 'sync') {
        if (key !== 'clickup') return NextResponse.json({ error: 'Voor deze koppeling bestaat geen handmatige synchronisatie.' }, { status: 400 })
        const r = (await draaiClickupAgendaSync()) as unknown as Record<string, unknown>
        resultaat = { ok: !r.fout, bericht: r.fout ? `Synchronisatie mislukt: ${String(r.fout).slice(0, 200)}` : `Synchronisatie klaar: ${r.aangemaakt ?? 0} aangemaakt, ${r.bijgewerkt ?? 0} bijgewerkt, ${r.verwijderd ?? 0} verwijderd.` }
      } else if (key === 'clickup') {
        const r = await clickupTest()
        const [assignee, bramId, lijst] = await Promise.all([facturatieAssigneeId(), findMemberId(INVOICE_ASSIGNEE_NAME), facturatieLijst()])
        resultaat = {
          ok: true,
          bericht: `Verbonden als ${r.gebruiker} (werkruimte ${r.workspace}). Facturatielijst: ${lijst.ok ? lijst.pad : lijst.reden}. Verantwoordelijke facturatietaken: ${assignee ?? 'geen'}; ${INVOICE_ASSIGNEE_NAME} gevonden als lid: ${bramId ?? 'niet gevonden'}.`,
        }
      } else if (key === 'resend') {
        const r = await sleutelRechten(process.env.RESEND_API_KEY)
        resultaat = { ok: r === 'volledig' || r === 'beperkt', bericht: r === 'volledig' ? 'Sleutel werkt (volledige rechten).' : r === 'beperkt' ? 'Sleutel werkt, maar met beperkte rechten (ingeplande mails intrekken lukt niet).' : r === 'ontbreekt' ? 'Geen sleutel ingesteld.' : 'Resend gaf geen bruikbaar antwoord.' }
      } else if (key === 'metricool') {
        const brands = await listBrands()
        resultaat = { ok: true, bericht: `Verbonden: ${brands.length} merk${brands.length === 1 ? '' : 'en'} gevonden.` }
      } else if (key === 'supabase') {
        const { error } = await createAdminSupabaseClient().from('app_settings').select('key', { count: 'exact', head: true })
        resultaat = { ok: !error, bericht: error ? `Databank antwoordt met een fout: ${error.message}` : 'Databank bereikbaar.' }
      } else {
        return NextResponse.json({ error: 'Voor deze koppeling bestaat geen verbindingstest.' }, { status: 400 })
      }
    } catch (e) {
      resultaat = { ok: false, bericht: `Test mislukt: ${e instanceof Error ? e.message.slice(0, 200) : 'onbekende fout'}` }
    }
    const meta = requestMeta(req)
    await logAudit({
      action: `integratie.${actie}`, entityType: 'integratie', entityId: key,
      summary: `${key}: ${actie === 'sync' ? 'handmatige synchronisatie' : 'verbindingstest'} — ${resultaat.ok ? 'geslaagd' : 'mislukt'}`,
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: g.persoon.rol,
      metadata: { ok: resultaat.ok, duurMs: Date.now() - t0 }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ...resultaat, duurMs: Date.now() - t0 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
