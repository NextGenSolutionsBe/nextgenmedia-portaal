import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, insertResilient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { valideerSnelleKlant, zoekDubbel, magTochNieuw, type BestaandeKlant } from '@/lib/clients/snel'

export const dynamic = 'force-dynamic'

/**
 * POST — snel een klant aanmaken (bv. tijdens het opmaken van een contract).
 * Enkel de basisgegevens: geen login en geen diensten; die vul je later aan in
 * de klantfiche. Bestaat de klant al (btw, naam of e-mail), dan krijg je die
 * terug om te kiezen; `toch_nieuw` maakt toch een nieuwe, behalve bij een
 * actieve klant met hetzelfde btw-nummer.
 */
export async function POST(req: NextRequest) {
  try {
    const persoon = await magIk('clients', 'toevoegen')
    if (!persoon) return NextResponse.json({ error: 'Je hebt geen recht om klanten toe te voegen. Vraag het aan een beheerder.' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const v = valideerSnelleKlant(b)
    if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
    const k = v.waarde
    const admin = createAdminSupabaseClient()

    const { data: bestaande } = await admin.from('clients').select('id, company_name, email, btw_nummer, archived_at').limit(5000)
    const dubbel = zoekDubbel(k, (bestaande ?? []) as BestaandeKlant[])
    if (dubbel && !(b.toch_nieuw === true && magTochNieuw(dubbel))) {
      const waarom = dubbel.reden === 'btw' ? 'met hetzelfde btw-nummer' : dubbel.reden === 'naam' ? 'met dezelfde naam' : 'met hetzelfde e-mailadres'
      return NextResponse.json({
        error: `Er bestaat al een klant ${waarom}: ${dubbel.company_name}${dubbel.gearchiveerd ? ' (gearchiveerd)' : ''}.`,
        bestaand: { ...dubbel, mag_toch_nieuw: magTochNieuw(dubbel) },
      }, { status: 409 })
    }

    const { data: rij, error } = await insertResilient(admin, 'clients', { ...k, created_by: persoon.userId }, { select: 'id, company_name, contact_name, email', required: ['company_name'] })
    if (error || !rij) throw new Error(error?.message ?? 'Klant aanmaken mislukt')
    const klant = rij as { id: string; company_name: string; contact_name: string | null; email: string | null }

    // Zelfde startpunt als een volledig aangemaakte klant: een uploadmap "Algemeen".
    try { await admin.from('client_upload_folders').insert({ client_id: klant.id, naam: 'Algemeen', door_naam: 'NextGenMedia' }) } catch { /* bijzaak */ }

    const meta = requestMeta(req)
    await logAudit({
      action: 'client.create', entityType: 'client', entityId: klant.id, summary: `Klant snel aangemaakt: ${klant.company_name}`,
      actorUserId: persoon.userId, actorEmail: persoon.email, actorRole: persoon.isAdmin ? 'admin' : 'staff',
      metadata: { bron: typeof b.bron === 'string' ? b.bron.slice(0, 40) : 'snel' }, ip: meta.ip, userAgent: meta.userAgent,
    })
    revalidatePath('/admin/clients')
    return NextResponse.json({ klant })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'clients.snel.POST') }, { status: 500 })
  }
}
