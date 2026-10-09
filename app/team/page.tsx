import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** Inklokken bestaat niet meer: /team opent meteen de planning. */
export default function TeamStart() {
  redirect('/team/planning')
}
