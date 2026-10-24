import { Suspense } from 'react'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { listPipelines } from '@/lib/sales/pipelines'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { plannerRechten } from '@/lib/meetings/rechten'
import { Calendar } from './calendar'
import { MeetingInplanner, type InplannerTab } from './inplanner'

export const dynamic = 'force-dynamic'

/**
 * Meeting Inplanner — de centrale plek voor alle meetings.
 *  · Overzicht: alle meetings (intern, klantboekingen én verkoopafspraken)
 *  · Calendar: de centrale agenda (lijst, week, maand) met alle meetings,
 *    verkoopafspraken, ClickUp-meetings en Google-afspraken van één persoon.
 *    Slepen op een vrij moment plant een meeting of een afspraak voor een lead
 *    (met de setter-, merk- en ClickUp-regels die daar al golden); slepen van
 *    een meeting verplaatst ze. Vervangt de vroegere Verkoopagenda.
 *  · Klantboekingen: de publieke boekingslink en zijn instellingen
 */
export default async function MeetingsPage({ searchParams }: { searchParams: Record<string, string> | Promise<Record<string, string>> }) {
  const sp = await Promise.resolve(searchParams)
  const rechten = await plannerRechten()
  const verkoop = rechten.verkoop.bekijken
  // Calendar is er voor iedereen die meetings of verkoopafspraken mag zien.
  const kalender = verkoop || rechten.meetings.bekijken

  let agenda: React.ReactNode = null
  if (kalender) {
    const [pipeline, pipelines, admin] = await Promise.all([getOrCreateSalesOrg(), listPipelines(), requireAdmin()])
    // Vanuit de pipeline of Focusmode ("Meeting inplannen" bij een lead): de
    // agenda opent meteen op het merk van die lead, zoals voorheen.
    let initialMerkId = ''
    if (verkoop && sp.lead) {
      const db = createAdminSupabaseClient()
      const { data: lead } = await db.from('sales_leads')
        .select('pipeline_id').eq('id', sp.lead).eq('sales_client_id', pipeline.id).maybeSingle()
      initialMerkId = (lead as { pipeline_id: string | null } | null)?.pipeline_id ?? ''
    }
    // Vanuit het overzicht ("Bewerken of verplaatsen"): die afspraak meteen open.
    let initialAppt: { id: string; startsAt: string; calendarId: string | null } | null = null
    if (verkoop && sp.afspraak && /^[0-9a-f-]{36}$/i.test(sp.afspraak)) {
      const db = createAdminSupabaseClient()
      const { data: a } = await db.from('sales_appointments').select('id, starts_at, calendar_id').eq('id', sp.afspraak).maybeSingle()
      if (a) initialAppt = { id: a.id as string, startsAt: a.starts_at as string, calendarId: (a.calendar_id as string | null) ?? null }
    }
    agenda = (
      <Calendar
        verkoop={verkoop}
        client={{
          id: pipeline.id, name: pipeline.name, timezone: pipeline.timezone,
          slot_interval_min: pipeline.slot_interval_min, default_duration_min: pipeline.default_duration_min,
        }}
        pipelines={pipelines.map((p) => ({ id: p.id, key: p.key, name: p.name, defaultCalendarId: p.default_calendar_id ?? null }))}
        isAdmin={!!admin}
        initialLeadId={verkoop ? sp.lead : undefined}
        initialMerkId={initialMerkId}
        initialAppt={initialAppt}
      />
    )
  }

  const tabs: InplannerTab[] = ['overzicht', ...(kalender ? ['agenda' as const] : []), ...(rechten.meetings.aanpassen || rechten.verkoop.aanpassen ? ['klantboekingen' as const] : [])]
  const gevraagd = (sp.tab === 'agenda' || sp.lead || sp.afspraak) ? 'agenda' : sp.tab === 'klantboekingen' ? 'klantboekingen' : 'overzicht'
  const start = tabs.includes(gevraagd as InplannerTab) ? gevraagd as InplannerTab : 'overzicht'

  return (
    <Suspense>
      <MeetingInplanner tabs={tabs} startTab={start} agenda={agenda} />
    </Suspense>
  )
}
