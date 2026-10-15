export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { getActor, actorCanSee } from '@/lib/actor-modules'
import { TodayPanel } from './today-panel'
import { ContractsWidget } from './contracts-widget'
import { RecentActivity } from './recent-activity'
import { SalesToday } from './sales-today'

// Compact Command Center: Vandaag (acties) + kritieke contracten + recente
// activiteit. Notificaties leven in het globale belletje. De zware module-
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

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Command Center</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {today.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Vandaag — dagelijkse acties (de werkplek). Elke regel hangt aan een
          module, zodat een werknemer enkel ziet waar hij bij kan. */}
      <Suspense fallback={<div className="card-base text-sm text-gray-400">Vandaag laden…</div>}>
        <TodayPanel modules={actor?.modules ?? null} />
      </Suspense>

      {can('sales') && (
        <Suspense fallback={<div className="card-base text-sm text-gray-400">Verkoop laden…</div>}>
          <SalesToday />
        </Suspense>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Kritieke contracten + opvolging */}
        {can('contracts') && (
          <Suspense fallback={<div className="card-base text-sm text-gray-400">Contracten laden…</div>}>
            <ContractsWidget />
          </Suspense>
        )}

        {/* Recente activiteit — het audit-log loopt over alle modules heen en
            blijft daarom admin-only. */}
        {isAdmin && (
          <Suspense fallback={<div className="card-base text-sm text-gray-400">Activiteit laden…</div>}>
            <RecentActivity />
          </Suspense>
        )}
      </div>
    </div>
  )
}
