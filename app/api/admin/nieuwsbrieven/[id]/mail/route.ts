import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { bouwNieuwsbriefMail } from '@/lib/nieuwsbrief-mail'
import { afmeldLink, appLink, ontvangers, verstuurNieuwsbrief } from '@/lib/nieuwsbrieven-server'
import type { Nieuwsbrief } from '@/lib/nieuwsbrieven'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Nieuwsbrief per mail. Nooit automatisch: GET geeft het voorbeeld en de
 * ontvangers, POST verstuurt na de bevestiging in de admin naar de gekozen
 * adressen. Enkel een gepubliceerde nieuwsbrief (de mail linkt naar de klantapp).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await magIk('nieuwsbrieven', 'aanpassen'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabaseClient()
  const { data: n } = await admin.from('nieuwsbrieven').select('*').eq('id', id).maybeSingle()
  if (!n) return NextResponse.json({ error: 'Nieuwsbrief niet gevonden.' }, { status: 404 })
  const voorbeeld = bouwNieuwsbriefMail(n as Nieuwsbrief, { appLink: appLink(n.slug), afmeldLink: afmeldLink('voorbeeld@nextgenmedia.be') })
  return NextResponse.json({ voorbeeld: { onderwerp: voorbeeld.onderwerp, html: voorbeeld.html }, ontvangers: await ontvangers(admin, id) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const persoon = await magIk('nieuwsbrieven', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Je mag geen nieuwsbrieven versturen.' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: n } = await admin.from('nieuwsbrieven').select('*').eq('id', id).maybeSingle()
    if (!n) return NextResponse.json({ error: 'Nieuwsbrief niet gevonden.' }, { status: 404 })
    if (n.status !== 'gepubliceerd') return NextResponse.json({ error: 'Publiceer de nieuwsbrief eerst: de mail linkt naar de klantapp.' }, { status: 409 })
    const b = await req.json().catch(() => ({})) as { emails?: unknown; bevestigd?: unknown }
    if (b.bevestigd !== true) return NextResponse.json({ error: 'Bevestig het versturen.' }, { status: 400 })
    const emails = Array.isArray(b.emails) ? b.emails.map(String) : []
    if (!emails.length) return NextResponse.json({ error: 'Kies minstens één ontvanger.' }, { status: 400 })
    const r = await verstuurNieuwsbrief(admin, n as Nieuwsbrief, emails, { userId: persoon.userId, email: persoon.email, naam: persoon.naam || persoon.email })
    await logAudit({ action: 'nieuwsbrief.mail', entityType: 'nieuwsbrief', entityId: id, actorUserId: persoon.userId, actorEmail: persoon.email, summary: `${n.titel}: ${r.verstuurd} verstuurd`, metadata: { verstuurd: r.verstuurd, overgeslagen: r.overgeslagen, mislukt: r.mislukt.length } })
    return NextResponse.json(r)
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'nieuwsbrieven.mail') }, { status: 500 }) }
}
