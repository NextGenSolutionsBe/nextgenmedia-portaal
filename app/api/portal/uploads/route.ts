import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { safeMessage } from '@/lib/api-error'
import {
  BUCKET, MAX_BYTES, mimeToegestaan, padHoortBij, schooneNaam,
} from '@/lib/client-uploads'

export const dynamic = 'force-dynamic'

const MIST = /client_uploads|does not exist|schema cache/i
const HINT = 'De tabel voor klantuploads bestaat nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

/** Wat de klant zelf van zijn uploads te zien krijgt. `admin_notitie` zit hier
 *  bewust NIET bij: dat is een interne aantekening. */
const KOLOMMEN = 'id, titel, beschrijving, bestandspad, bestandsnaam, mimetype, grootte, status, door_naam, created_at'

/** Eigen uploads bekijken. */
export async function GET() {
  try {
    const g = await requirePortalPermission('files', 'view')
    if (!g.ok) return g.response

    const admin = createAdminSupabaseClient()
    const { data, error } = await admin
      .from('client_uploads')
      .select(KOLOMMEN)
      .eq('client_id', g.session.clientId)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ uploads: [], hint: HINT })
      throw new Error(error.message)
    }

    // Privébucket: een tijdelijke link per bestand, nooit een vast adres.
    const uploads = await Promise.all((data ?? []).map(async (r) => {
      const rij = r as Record<string, unknown>
      const { data: s } = await admin.storage
        .from(BUCKET).createSignedUrl(String(rij.bestandspad), 60 * 60)
      const { bestandspad: _weg, ...rest } = rij
      void _weg
      return { ...rest, url: s?.signedUrl ?? null }
    }))

    return NextResponse.json({ uploads })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * Stap 2 van een upload: bevestigen dat het bestand er staat, met titel en
 * beschrijving erbij.
 *
 * Alles wordt hier opnieuw gecontroleerd. De browser heeft net rechtstreeks
 * naar de opslag geschreven, dus wat hier binnenkomt is een bewering — niet
 * iets wat wij zelf gezien hebben. Vandaar dat we het bestand ook echt opzoeken
 * voordat we een rij aanmaken.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await requirePortalPermission('files', 'upload')
    if (!g.ok) return g.response

    const b = await req.json().catch(() => ({}))
    const pad = String(b.pad ?? '')
    const titel = String(b.titel ?? '').trim()
    const beschrijving = String(b.beschrijving ?? '').trim()
    const mime = String(b.mimetype ?? '').toLowerCase()

    if (!titel) return NextResponse.json({ error: 'Geef een titel op.' }, { status: 400 })
    // Het pad moet met het eigen client_id beginnen — anders wijst het naar het
    // materiaal van een andere klant.
    if (!padHoortBij(pad, g.session.clientId)) {
      return NextResponse.json({ error: 'Dit bestandspad hoort niet bij deze klant.' }, { status: 400 })
    }
    if (!mimeToegestaan(mime)) {
      return NextResponse.json({ error: 'Dit bestandstype kunnen we niet aannemen.' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // Staat het bestand er echt, en hoe groot is het? Op de opgegeven grootte
    // vertrouwen zou betekenen dat iemand een rij kan aanmaken zonder bestand.
    const map = pad.slice(0, pad.lastIndexOf('/'))
    const naam = pad.slice(pad.lastIndexOf('/') + 1)
    const { data: gevonden } = await admin.storage.from(BUCKET).list(map, { search: naam, limit: 1 })
    const bestand = (gevonden ?? [])[0]
    if (!bestand) {
      return NextResponse.json({ error: 'Het bestand is niet aangekomen. Probeer de upload opnieuw.' }, { status: 400 })
    }

    const grootte = Number((bestand.metadata as { size?: number } | null)?.size ?? 0)
    if (grootte > MAX_BYTES) {
      await admin.storage.from(BUCKET).remove([pad])
      return NextResponse.json({ error: 'Dit bestand is te groot.' }, { status: 400 })
    }

    const { data: nieuw, error } = await admin.from('client_uploads').insert({
      client_id: g.session.clientId,
      titel: titel.slice(0, 200),
      beschrijving: beschrijving.slice(0, 4000) || null,
      bestandspad: pad,
      bestandsnaam: schooneNaam(b.bestandsnaam),
      mimetype: mime,
      grootte,
      door_email: g.session.email,
      door_naam: g.session.name,
      auth_user_id: g.session.userId,
      status: 'nieuw',
    }).select('id').single()

    if (error) {
      // Geen weesbestand achterlaten als de rij niet gemaakt kon worden.
      await admin.storage.from(BUCKET).remove([pad])
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }

    await logPortalAction(g.session, 'portal.upload.toegevoegd',
      { type: 'client_upload', id: (nieuw as { id: string }).id }, { req, meta: { titel } })

    return NextResponse.json({ ok: true, id: (nieuw as { id: string }).id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * Eigen upload weghalen.
 *
 * Alleen zolang wij er nog niets mee gedaan hebben: staat de status op
 * 'verwerkt', dan hangt het materiaal ergens aan vast en is weggooien geen
 * opruimen meer maar iets stukmaken.
 */
export async function DELETE(req: NextRequest) {
  try {
    const g = await requirePortalPermission('files', 'upload')
    if (!g.ok) return g.response

    const id = String(req.nextUrl.searchParams.get('id') ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen upload opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: rij } = await admin
      .from('client_uploads')
      .select('id, client_id, bestandspad, status, titel')
      .eq('id', id)
      .maybeSingle()

    // Bestaat niet óf van een andere klant: hetzelfde antwoord. Het verschil zou
    // verklappen dat er elders een upload met dit id bestaat.
    if (!rij || rij.client_id !== g.session.clientId) {
      return NextResponse.json({ error: 'Upload niet gevonden' }, { status: 404 })
    }
    if (rij.status === 'verwerkt') {
      return NextResponse.json(
        { error: 'Dit materiaal is al verwerkt. Vraag ons om het te verwijderen.' },
        { status: 400 },
      )
    }

    await admin.storage.from(BUCKET).remove([rij.bestandspad])
    const { error } = await admin.from('client_uploads').delete().eq('id', id)
    if (error) throw new Error(error.message)

    await logPortalAction(g.session, 'portal.upload.verwijderd',
      { type: 'client_upload', id }, { req, meta: { titel: rij.titel } })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
