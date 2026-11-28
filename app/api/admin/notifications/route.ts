import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { getActor, actorCanSee } from '@/lib/actor-modules'
import { buildNotifications } from '@/lib/notifications'
import { vestingMeldingVoor } from '@/lib/vesting-data-server'
import { regelsMeldingVoor, uitgavenMeldingVoor, laadVennotenData } from '@/lib/vennoot-uitgaven-server'
import { vestingRegelsMeldingVoor } from '@/lib/vesting-regels-server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { deadlineMeldingenVoor } from '@/lib/agenda/deadlines-server'
import { algemeneMeldingVoor } from '@/lib/algemene-contracten/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    // Admin ÉN werknemer: het notificatiecentrum hoort bij de shell. Een werknemer
    // krijgt enkel signalen uit modules waar hij recht op heeft.
    const actor = await getActor()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    // Alles tegelijk: de meldingen en (voor Marco, Bram en Chiara) wat zij zelf
    // nog moeten tekenen of goedkeuren. Na elkaar waren dat vijf rondes.
    const extra = async <T,>(f: () => Promise<T[]>): Promise<T[]> => { try { return await f() } catch { return [] /* melding is een extra */ } }
    const admin = createAdminSupabaseClient()
    // Uitgaven vennoten: één keer laden voor beide meldingen.
    const vennoten = actor.isAdmin ? laadVennotenData(admin, actor.userId) : null
    vennoten?.catch(() => null)
    const [all, vesting, regels, uitgaven, vestingRegels, deadlines, algemeen] = await Promise.all([
      buildNotifications(),
      // Vesting: enkel voor Marco, Bram en Chiara, en enkel wat zij zelf nog moeten tekenen.
      actor.isAdmin ? extra(() => vestingMeldingVoor(actor.userId)) : [],
      // Uitgaven vennoten: de regels wachten op jouw handtekening.
      vennoten ? extra(() => regelsMeldingVoor(actor.userId, admin, vennoten)) : [],
      // Uitgaven vennoten: uitgaven die op jouw akkoord wachten.
      vennoten ? extra(() => uitgavenMeldingVoor(actor.userId, admin, vennoten)) : [],
      // Vesting: de regels wachten op jouw handtekening.
      actor.isAdmin ? extra(() => vestingRegelsMeldingVoor(actor.userId, admin)) : [],
      // Agenda: jouw deadlines van vandaag (en wat de voorbije week niet af raakte).
      actorCanSee(actor, 'agenda') ? extra(() => deadlineMeldingenVoor(admin, actor.userId)) : [],
      // Algemene contracten: wat op jouw handtekening wacht (enkel zaakvoerders).
      actor.isAdmin ? extra(() => algemeneMeldingVoor(admin, actor.userId)) : [],
    ])
    const KIND_MODULE: Record<string, string> = {
      invoice: 'invoices', contract: 'contracts', blog: 'blogs', website: 'content', client: 'clients', formulier: 'formulieren', personeel: 'personeel', content: 'content', meeting: 'meetings', aanvraag: 'aanvragen', offerte: 'offertes', oplevering: 'opleveringen', project: 'opdrachten', ngs: 'nextgensolutions',
    }
    const gefilterd = all.filter((n) => {
      const mod = KIND_MODULE[n.kind]
      if (mod === 'personeel') return actor.isAdmin // Personeel = enkel hoofdbeheerders
      if (n.kind === 'opslag') return actor.isAdmin  // opslag = instellingen
      return !mod || actorCanSee(actor, mod)
    })
    // Zelfde volgorde als vroeger: de persoonlijke meldingen bovenaan.
    const notifications = [...deadlines, ...algemeen, ...vestingRegels, ...uitgaven, ...regels, ...vesting, ...gefilterd]
    return NextResponse.json({ notifications })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
