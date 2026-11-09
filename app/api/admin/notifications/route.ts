import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { getActor, actorCanSee } from '@/lib/actor-modules'
import { buildNotifications } from '@/lib/notifications'
import { vestingMeldingVoor } from '@/lib/vesting-data-server'
import { regelsMeldingVoor } from '@/lib/vennoot-uitgaven-server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Admin ÉN werknemer: het notificatiecentrum hoort bij de shell. Een werknemer
    // krijgt enkel signalen uit modules waar hij recht op heeft.
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const all = await buildNotifications()
    const KIND_MODULE: Record<string, string> = {
      invoice: 'invoices', contract: 'contracts', blog: 'blogs', website: 'content', client: 'clients', formulier: 'formulieren', personeel: 'personeel', content: 'content', meeting: 'meetings', aanvraag: 'aanvragen', offerte: 'offertes', oplevering: 'opleveringen',
    }
    const notifications = all.filter((n) => {
      const mod = KIND_MODULE[n.kind]
      if (mod === 'personeel') return actor.isAdmin // Personeel = enkel hoofdbeheerders
      if (n.kind === 'opslag') return actor.isAdmin  // opslag = instellingen
      return !mod || actorCanSee(actor, mod)
    })
    // Vesting: enkel voor Marco, Bram en Chiara, en enkel wat zij zelf nog moeten tekenen.
    if (actor.isAdmin) {
      try { notifications.unshift(...(await vestingMeldingVoor(actor.userId))) } catch { /* melding is een extra */ }
      // Uitgaven vennoten: de regels wachten op jouw handtekening.
      try { notifications.unshift(...(await regelsMeldingVoor(actor.userId, createAdminSupabaseClient()))) } catch { /* melding is een extra */ }
    }
    return NextResponse.json({ notifications })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
