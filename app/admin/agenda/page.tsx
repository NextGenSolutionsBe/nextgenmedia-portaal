import { redirect } from 'next/navigation'
import { magIk } from '@/lib/instellingen/laden'
import { AgendaApp } from './agenda-app'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Agenda' }

/** Agenda: spaces, mappen, lijsten, taken, meetings en docs (zie lib/agenda). */
export default async function AgendaPagina() {
  if (!(await magIk('agenda', 'bekijken'))) redirect('/admin')
  return <AgendaApp />
}
