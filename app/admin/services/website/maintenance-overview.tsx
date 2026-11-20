import Link from 'next/link'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { maintenanceStatus, formatNL, resterendTekst, verstreken, REMINDER_DAYS, type MaintenanceClient } from '@/lib/maintenance'
import { Wrench, Globe, Code2, ArrowUpRight } from 'lucide-react'

// Alle onderhoudscontracten van websites: wanneer ze startten, tot wanneer ze
// lopen en hoeveel tijd er nog rest. Verlopen, bijna afgelopen en pakketten
// zonder startdatum staan bovenaan, want daar is actie nodig. Start en looptijd
// pas je aan in de Website-kaart van de klant.

type Rij = MaintenanceClient & { website_url?: string | null; website_platform?: string | null }

const datum = (d: string | null) => (d ? formatNL(new Date(`${d}T00:00:00.000Z`)) : null)

export async function MaintenanceOverview() {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('clients')
    .select('id, company_name, maintenance_included, maintenance_start_date, maintenance_months, maintenance_reminder_sent_for, website_url, website_platform')
    .eq('maintenance_included', true)

  const nu = new Date()
  const rows = ((data ?? []) as Rij[])
    .map((c) => ({ client: c, status: maintenanceStatus(c, nu) }))
    .sort((a, b) => (a.status.daysLeft ?? -Infinity) - (b.status.daysLeft ?? -Infinity))

  const tel = {
    lopend: rows.filter((r) => r.status.daysLeft !== null && !r.status.expired && !r.status.expiringSoon).length,
    binnenkort: rows.filter((r) => r.status.expiringSoon).length,
    verlopen: rows.filter((r) => r.status.expired).length,
    zonderStart: rows.filter((r) => r.status.daysLeft === null).length,
  }

  return (
    <div className="card-base">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Wrench className="h-4 w-4 text-gray-400" />Onderhoudscontracten
          <span className="text-xs font-normal text-gray-500">· {rows.length}</span>
        </h2>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className="status-badge bg-gray-100 text-gray-700">{tel.lopend} lopend</span>
          {tel.binnenkort > 0 && <span className="status-badge bg-amber-100 text-amber-800">{tel.binnenkort} binnen {REMINDER_DAYS} dagen af</span>}
          {tel.verlopen > 0 && <span className="status-badge bg-red-100 text-red-700">{tel.verlopen} verlopen</span>}
          {tel.zonderStart > 0 && <span className="status-badge bg-amber-100 text-amber-800">{tel.zonderStart} zonder startdatum</span>}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-500 py-2">Nog geen enkele klant met websiteonderhoud. Zet het aan in de Website-kaart van de klant (Onderhoud inbegrepen, startdatum en looptijd).</p>
      ) : (
        <ul className="divide-y divide-gray-100 -mx-1">
          {rows.map(({ client, status }) => {
            const tone = status.expired ? 'text-red-700' : status.expiringSoon || status.daysLeft === null ? 'text-amber-700' : 'text-gray-900'
            const balk = status.expired ? 'bg-red-500' : status.expiringSoon ? 'bg-amber-500' : 'bg-gray-900'
            const v = verstreken(status, nu)
            return (
              <li key={client.id}>
                <Link href={`/admin/clients/${client.id}#website`} className="group grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] gap-x-4 gap-y-1.5 items-center px-1 py-3 rounded-lg hover:bg-gray-50">
                  <div className="min-w-0">
                    <div className="font-medium text-sm text-gray-900 truncate flex items-center gap-1">
                      {client.company_name}<ArrowUpRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500 shrink-0" />
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1.5 mt-0.5">
                      {client.website_platform === 'custom' ? <><Code2 className="h-3 w-3" />Custom code</> : client.website_platform === 'framer' ? <><Globe className="h-3 w-3" />Framer</> : null}
                      {client.website_url && <span className="truncate">{client.website_url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>}
                    </div>
                  </div>
                  <div className="hidden sm:block text-xs text-gray-600">
                    {status.startDate
                      ? <>{datum(status.startDate)} <span className="text-gray-400">tot</span> {datum(status.endDate)}<span className="text-gray-400"> · {Number(client.maintenance_months) > 0 ? client.maintenance_months : 12} mnd</span></>
                      : <span className="text-amber-700">Startdatum nog invullen</span>}
                  </div>
                  <div className={`text-sm font-medium text-right tabular-nums ${tone}`}>{resterendTekst(status, nu)}</div>
                  <div className="col-span-2 sm:col-span-3">
                    <div className="sm:hidden text-xs text-gray-600 mb-1">
                      {status.startDate ? <>{datum(status.startDate)} tot {datum(status.endDate)}</> : <span className="text-amber-700">Startdatum nog invullen</span>}
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      {v !== null && <div className={`h-full rounded-full ${balk}`} style={{ width: `${Math.max(2, v * 100)}%` }} />}
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      <p className="text-[11px] text-gray-400 mt-3">Start en looptijd pas je aan in de Website-kaart van de klant. Een pakket dat binnen {REMINDER_DAYS} dagen afloopt of verlopen is, staat ook in het Command Center.</p>
    </div>
  )
}
