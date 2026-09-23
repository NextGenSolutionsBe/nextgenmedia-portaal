import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * Werknemers en Personeel zijn samengevoegd: de interne logins, rollen en
 * modules staan nu in Personeel → Accounts en rechten. Deze route blijft
 * bestaan voor oude links.
 */
export default function WerknemersPage() {
  redirect('/admin/personeel?tab=accounts')
}
