import { NextResponse } from 'next/server'
import { eisPersoneel } from '@/lib/personeel/server'
import { listClickupMembers } from '@/lib/clickup'

export const dynamic = 'force-dynamic'

/** ClickUp-leden om een teamlid aan te koppelen (expertprofiel). Enkel naam, e-mail en id. */
export async function GET() {
  const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
  const leden = await listClickupMembers()
  return NextResponse.json({ leden: leden.map((m) => ({ id: m.id, naam: m.username || m.email, email: m.email })).sort((a, b) => a.naam.localeCompare(b.naam)) })
}
