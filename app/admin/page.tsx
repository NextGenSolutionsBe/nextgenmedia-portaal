export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { getActor, actorCanSee } from '@/lib/actor-modules'
import { TodayPanel } from './today-panel'
import { RecentActivity } from './recent-activity'
import { OpvolgingPanel } from './opvolging-panel'
import { TakenBlok } from '@/components/admin/taken-blok'
import { MailProjecten } from '@/components/admin/mail-projecten'
import { magIk } from '@/lib/instellingen/laden'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { mijnDeadlines } from '@/lib/agenda/deadlines-server'
import { DeadlinesBlok } from './agenda/deadlines-blok'
import { SnelleAgendaKnoppen } from './agenda/inspreken'

/** Jouw deadlines van vandaag (en wat de voorbije week niet af raakte). Niets = geen blok. */
async function AgendaDeadlines({ userId }: { userId: string }) {
  const [lijst, aanpassen] = await Promise.all([
    mijnDeadlines(createAdminSupabaseClient(), userId).catch(() => []),
    magIk('agenda', 'aanpassen'),
  ])
  return <DeadlinesBlok begin={lijst} magAanpassen={!!aanpassen} />
}

// Compact Command Center: wat beslist moet worden (nieuwe projecten), taken,
// Op te volgen (enkel blokken waar iets in staat, dringendste eerst) en wat
// daar niet al in staat. Recente activiteit ingeklapt onderaan. Het vroegere
// contractenblok met tellers staat niet meer hier: de opvolging zit in
// "Op te volgen", de cijfers in Klantcontracten. Notificaties leven in het globale belletje. De zware module-
// widgets (finance/lifecycle/blogs/framer/scripts) zijn verplaatst naar hun
// eigen modules — niet verwijderd, enkel niet meer op het dashboard.
//
// BELANGRIJK: dit scherm is niet per module afgeschermd door de middleware
// (iedereen mag /admin), dus filteren we hier zelf. Een appointment setter met
// enkel de Verkoop-module hoort hier geen klanten, contracten of facturen te
// zien — die ziet enkel zijn eigen pipeline.
export default async function CommandCenter() {
  const today = new Date()
  const actor = await getActor()
  const can = (key: string) => !!actor && actorCanSee(actor, key)
  const isAdmin = !!actor?.isAdmin
  const [agendaToevoegen, meetingsPlannen] = await Promise.all([
    can('agenda') ? magIk('agenda', 'toevoegen') : null,
    can('meetings') ? magIk('meetings', 'toevoegen') : null,
  ])

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Command Center</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {today.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })}
          </p>
        </div>
        {/* Snel: een taak inspreken (komt in de agenda) of een meeting inplannen. */}
        <SnelleAgendaKnoppen magToevoegen={!!agendaToevoegen} magMeetings={!!meetingsPlannen} />
      </div>

      {/* Jouw deadlines van vandaag, het uur groot vooraan. */}
      {actor && can('agenda') && (
        <Suspense fallback={null}>
          <AgendaDeadlines userId={actor.userId} />
        </Suspense>
      )}

      {/* Nieuwe projecten uit de mail: Ja (projectkaart) of Nee. Enkel als er iets te beslissen is. */}
      {can('opdrachten') && <MailProjecten />}

      {/* Taken aan elkaar toewijzen, gesynchroniseerd met ClickUp. */}
      {actor && <TakenBlok />}

      {/* Op te volgen — bovenaan: concreet wie en wat, per module afgeschermd. */}
      <Suspense fallback={<div className="card-base text-sm text-gray-400">Opvolging laden…</div>}>
        <OpvolgingPanel modules={actor?.modules ?? null} />
      </Suspense>

      {/* Vandaag — enkel wat niet al bij "Op te volgen" staat (blogs, websitefeedback, klanttaken). */}
      <Suspense fallback={null}>
        <TodayPanel modules={actor?.modules ?? null} />
      </Suspense>

      {/* Recente activiteit — ingeklapt onderaan: nuttig om iets terug te vinden, geen dagelijkse actie. Admin-only (audit-log). */}
      {isAdmin && (
        <details className="card-base group">
          <summary className="cursor-pointer list-none text-sm font-semibold text-gray-700 flex items-center gap-2">
            <span className="text-gray-400 group-open:rotate-90 transition-transform">›</span>Recente activiteit
          </summary>
          <div className="mt-3">
            <Suspense fallback={<div className="text-sm text-gray-400">Laden…</div>}>
              <RecentActivity kaal />
            </Suspense>
          </div>
        </details>
      )}
    </div>
  )
}
