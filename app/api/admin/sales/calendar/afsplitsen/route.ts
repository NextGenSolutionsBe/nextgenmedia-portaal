import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { listCalendars } from '@/lib/sales/google-calendar'
import { listPipelines } from '@/lib/sales/pipelines'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Een agenda AFSPLITSEN uit een al gekoppeld Google-account.
 *
 * De werkelijkheid bij NextGen: álle vier de agenda's (Marco/Bram × NGM/NGS)
 * zijn sub-agenda's binnen één Google-account. Vier keer inloggen bij Google
 * is dan onzin — één koppeling heeft al toegang tot alle vier. Deze route
 * maakt van zo'n sub-agenda een eigen kiesbare agenda in de app: eigen naam,
 * eigen merk, eigen ClickUp-persoon, en afspraken worden erin GESCHREVEN
 * (niet in de hoofdagenda van het account).
 *
 * De tokens worden gedeeld met de bronkoppeling (dezelfde versleutelde
 * waarden gekopieerd): het is en blijft hetzelfde Google-account. De invite
 * naar de prospect vertrekt dus van dat account — precies zoals gevraagd.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()

    const bronId = String(b.bronId ?? '')
    const googleCalendarId = String(b.googleCalendarId ?? '')
    const naam = String(b.naam ?? '').trim().slice(0, 60)
    if (!bronId || !googleCalendarId) return NextResponse.json({ error: 'Bron en agenda zijn vereist' }, { status: 400 })
    if (!naam) return NextResponse.json({ error: 'Geef de agenda een naam (bv. “Marco — NextGenMedia”)' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const org = await getOrCreateSalesOrg()

    // De bron moet een koppeling van ónszelf zijn — een id van buiten mag hier
    // niets mee kunnen.
    const { data: bron } = await admin.from('sales_calendar_connections')
      .select('*').eq('id', bronId).eq('sales_client_id', org.id).maybeSingle()
    if (!bron) return NextResponse.json({ error: 'Bronkoppeling niet gevonden' }, { status: 404 })
    const bronRij = bron as Record<string, unknown>

    // Bestaat de gekozen agenda echt in dit account, en mogen we erin schrijven?
    // We nemen niets over van wat de browser beweert.
    const agendas = await listCalendars(bronId)
    const gekozen = agendas.find((c) => c.id === googleCalendarId)
    if (!gekozen) return NextResponse.json({ error: 'Deze agenda staat niet (meer) in het gekoppelde account.' }, { status: 400 })
    if (gekozen.accessRole !== 'owner' && gekozen.accessRole !== 'writer') {
      return NextResponse.json({ error: `In “${gekozen.summary}” kunnen we niet schrijven (alleen-lezen). Kies een eigen agenda.` }, { status: 400 })
    }

    // Merk: enkel een pipeline van onszelf. ClickUp-persoon: enkel een getal.
    const pipelines = await listPipelines()
    const pipelineId = pipelines.find((p) => p.id === String(b.pipelineId ?? ''))?.id ?? null
    const clickupRaw = Number(b.clickupAssigneeId)
    const clickupAssigneeId = Number.isFinite(clickupRaw) && clickupRaw > 0 ? Math.round(clickupRaw) : null

    // Al gekoppeld voor dit merk? Dan is dít de rij die je zoekt — geen dubbel.
    {
      let q = admin.from('sales_calendar_connections').select('id, name')
        .eq('sales_client_id', org.id).eq('provider', 'google').eq('calendar_id', googleCalendarId)
      q = pipelineId ? q.eq('pipeline_id', pipelineId) : q.is('pipeline_id', null)
      const { data: dubbel } = await q.maybeSingle()
      if (dubbel) {
        return NextResponse.json({
          error: `Deze Google-agenda is al gekoppeld als “${(dubbel as { name: string | null }).name ?? 'agenda'}” voor dat merk.`,
        }, { status: 409 })
      }
    }

    // De nieuwe koppeling: zelfde account en tokens (versleuteld gekopieerd,
    // nooit ontsleuteld onderweg), maar een eigen schrijfagenda en identiteit.
    const insert: Record<string, unknown> = {
      sales_client_id: org.id,
      provider: 'google',
      name: naam,
      account_email: bronRij.account_email ?? null,
      calendar_id: googleCalendarId,
      active: true,
      access_token: bronRij.access_token,
      refresh_token: bronRij.refresh_token,
      token_expires_at: bronRij.token_expires_at,
      status: 'connected',
      pipeline_id: pipelineId,
      clickup_assignee_id: clickupAssigneeId,
      /**
       * Wat blokkeert deze agenda? NIET blind de keuze van de bron erven: daar
       * staan vaak álle merkagenda's aangevinkt, en dan zou een afspraak van
       * Bram de agenda van Marco dichtzetten — twee verschillende mensen die
       * gerust tegelijk een afspraak kunnen hebben.
       *
       * Voorstel: de schrijfagenda zelf + alle agenda's van DEZELFDE persoon
       * (zelfde eerste woord in de agendanaam: "Marco - NGM" hoort bij
       * "Marco - NGS", niet bij "Bram - NGM"). Bijstellen kan altijd via de
       * knop "Agenda's" — daar staat precies deze lijst met vinkjes.
       */
      busy_calendar_ids: (() => {
        const persoon = gekozen.summary.trim().split(/[\s—–-]+/)[0]?.toLowerCase() ?? ''
        const zelfdePersoon = persoon.length >= 3
          ? agendas.filter((c) => c.summary.trim().toLowerCase().startsWith(persoon)).map((c) => c.id)
          : []
        return [...new Set([googleCalendarId, ...zelfdePersoon])]
      })(),
      // De handtekening hoort bij de PERSOON; de naam zegt wie dat is, dus die
      // velden laten we bewust leeg tot iemand ze via "Handtekening" instelt.
    }

    const { data: nieuw, error } = await admin.from('sales_calendar_connections')
      .insert(insert).select('id').single()
    if (error) {
      if (/duplicate|unique|23505/i.test(error.message)) {
        return NextResponse.json({ error: 'Deze agenda is net al gekoppeld voor dat merk.' }, { status: 409 })
      }
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'sales.calendar.split', entityType: 'sales_calendar_connection', entityId: String((nieuw as { id: string }).id),
      summary: `Verkoop: agenda “${naam}” afgesplitst uit ${String(bronRij.account_email ?? 'gekoppeld account')}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true, id: (nieuw as { id: string }).id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
