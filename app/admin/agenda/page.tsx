import { redirect } from 'next/navigation'
import { magIk } from '@/lib/instellingen/laden'
import { AgendaApp } from './agenda-app'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Agenda' }

/** Agenda: spaces, mappen, lijsten, taken, meetings en docs (zie lib/agenda). */
export default async function AgendaPagina() {
  const persoon = await magIk('agenda', 'bekijken')
  if (!persoon) redirect('/admin')
  // De zwevende knoppen rechtsboven staan er enkel voor admins (zie app/admin/layout.tsx).
  return <AgendaApp metTopbalk={persoon.isAdmin} />
}
