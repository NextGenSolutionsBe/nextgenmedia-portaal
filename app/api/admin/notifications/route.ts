import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { getActor, actorCanSee } from '@/lib/actor-modules'
import { buildNotifications } from '@/lib/notifications'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Admin ÉN werknemer: het notificatiecentrum hoort bij de shell. Een werknemer
    // krijgt enkel signalen uit modules waar hij recht op heeft.
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const all = await buildNotifications()
    const KIND_MODULE: Record<string, string> = {
      invoice: 'invoices', contract: 'contracts', blog: 'blogs', website: 'content', client: 'clients',
    }
    const notifications = all.filter((n) => {
      const mod = KIND_MODULE[n.kind]
      return !mod || actorCanSee(actor, mod)
    })
    return NextResponse.json({ notifications })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
