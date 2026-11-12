import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Appointment setting is opgegaan in de Meeting Inplanner (tab Calendar).
 * Oude links — bladwijzers, mails met "Open in de app", de Google-koppeling die
 * hierheen terugkeert — sturen we door met hun parameters (bv. ?lead=…).
 * De agenda zelf (calendar.tsx en de dialogen hiernaast) wordt daar hergebruikt.
 */
export default async function SalesAppointmentsPage({ searchParams }: { searchParams: Record<string, string> | Promise<Record<string, string>> }) {
  const sp = await Promise.resolve(searchParams)
  const q = new URLSearchParams({ tab: 'agenda' })
  for (const [k, v] of Object.entries(sp ?? {})) if (typeof v === 'string' && k !== 'tab') q.set(k, v)
  redirect(`/admin/meetings?${q}`)
}
