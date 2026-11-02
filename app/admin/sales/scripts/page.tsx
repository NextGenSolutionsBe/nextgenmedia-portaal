import { redirect } from 'next/navigation'

// Koud bellen is uit de app (2 nov 2026): leads en projecten staan in Projecten.
export default function Weg() {
  redirect('/admin/opdrachten')
}
