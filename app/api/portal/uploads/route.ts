import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, insertResilient, signedUrlMap } from '@/lib/supabase/server'
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
const KOLOMMEN = 'id, titel, beschrijving, bestandspad, bestandsnaam, mimetype, grootte, status, door_naam, created_at, map_id'

/** Zonder de kolom map_id (nog geen migratie) valt de selectie terug, zodat de
 *  pagina blijft werken in plaats van leeg te blijven met een stille fout. */
const KOLOMMEN_ZONDER_MAP = KOLOMMEN.replace(', map_id', '')

/** Hoort deze map bij deze klant? Een meegestuurd id van een andere klant zou
 *  anders bestanden in andermans map laten belanden. */
async function mapVanKlant(
  admin: ReturnType<typeof createAdminSupabaseClient>, mapId: string, clientId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('client_upload_folders').select('id')
    .eq('id', mapId).eq('client_id', clientId).maybeSingle()
  return !!data
}

/** Eigen uploads bekijken. Optioneel gefilterd op map (?map=<id> of ?map=los). */
export async function GET(req: NextRequest) {
  try {
    const g = await requirePortalPermission('files', 'view')
    if (!g.ok) return g.response

    const admin = createAdminSupabaseClient()
    const map = String(req.nextUrl.searchParams.get('map') ?? '').trim()

    const haal = async (kolommen: string) => {
      let vraag = admin
        .from('client_uploads')
        .select(kolommen)
        .eq('client_id', g.session.clientId)
        .order('created_at', { ascending: false })
        .limit(500)
      if (kolommen.includes('map_id')) {
        if (map === 'los') vraag = vraag.is('map_id', null)
        else if (map) vraag = vraag.eq('map_id', map)
      }
      return vraag
    }

    let { data, error } = await haal(KOLOMMEN)
    if (error && /map_id/i.test(error.message)) {
      ;({ data, error } = await haal(KOLOMMEN_ZONDER_MAP))
    }

    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ uploads: [], hint: HINT })
      throw new Error(error.message)
    }

    // Privébucket: een tijdelijke link per bestand, nooit een vast adres.
    // Alle links in één oproep — anders is het één HTTP-verzoek per foto.
    const rijen = (data ?? []) as unknown as Record<string, unknown>[]
    const urls = await signedUrlMap(admin, BUCKET, rijen.map((r) => String(r.bestandspad)), 60 * 60)
    const uploads = rijen.map((rij) => {
      const { bestandspad: _weg, ...rest } = rij
      void _weg
      return { ...rest, url: urls.get(String(rij.bestandspad)) ?? null }
    })

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

    // In welke map? Leeg = losse bestanden. Een map van iemand anders weigeren
    // we, in plaats van hem stilletjes te negeren.
    const mapId = String(b.map_id ?? '').trim()
    if (mapId && !(await mapVanKlant(admin, mapId, g.session.clientId))) {
      await admin.storage.from(BUCKET).remove([pad])
      return NextResponse.json({ error: 'Die map bestaat niet.' }, { status: 400 })
    }

    // insertResilient laat de kolom map_id vallen als de migratie nog niet
    // gedraaid is, zodat uploaden dan gewoon blijft werken.
    const { data: nieuw, error } = await insertResilient(admin, 'client_uploads', {
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
      map_id: mapId || null,
    }, { required: ['client_id', 'titel', 'bestandspad'] })

    if (error) {
      // Geen weesbestand achterlaten als de rij niet gemaakt kon worden.
      await admin.storage.from(BUCKET).remove([pad])
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }

    const id = String(nieuw?.id ?? '')
    await logPortalAction(g.session, 'portal.upload.toegevoegd',
      { type: 'client_upload', id }, { req, meta: { titel, map_id: mapId || null } })

    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * Een eigen upload bijwerken: titel, beschrijving, of naar een andere map.
 *
 * Dit is wat bulk-uploaden bruikbaar maakt. Twintig foto's tegelijk insturen
 * kan alleen als je niet vooraf twintig formulieren moet invullen — dus gaan
 * ze eerst naar binnen met hun bestandsnaam als titel, en kan je daarna
 * bijschaven wat de moeite waard is.
 */
export async function PATCH(req: NextRequest) {
  try {
    const g = await requirePortalPermission('files', 'upload')
    if (!g.ok) return g.response

    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen upload opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const wijziging: Record<string, unknown> = {}

    if (b.titel !== undefined) {
      const titel = String(b.titel).trim().slice(0, 200)
      if (!titel) return NextResponse.json({ error: 'De titel mag niet leeg zijn.' }, { status: 400 })
      wijziging.titel = titel
    }
    if (b.beschrijving !== undefined) {
      wijziging.beschrijving = String(b.beschrijving).trim().slice(0, 4000) || null
    }
    if (b.map_id !== undefined) {
      const mapId = String(b.map_id ?? '').trim()
      if (mapId && !(await mapVanKlant(admin, mapId, g.session.clientId))) {
        return NextResponse.json({ error: 'Die map bestaat niet.' }, { status: 400 })
      }
      wijziging.map_id = mapId || null
    }
    if (Object.keys(wijziging).length === 0) {
      return NextResponse.json({ error: 'Niets om te wijzigen.' }, { status: 400 })
    }

    // De filter op client_id is de beveiliging: zonder dat kan een id van een
    // andere klant meegestuurd worden.
    const { data, error } = await admin
      .from('client_uploads')
      .update(wijziging)
      .eq('id', id).eq('client_id', g.session.clientId)
      .select('id')

    if (error) {
      if (/map_id/i.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Upload niet gevonden' }, { status: 404 })
    }

    await logPortalAction(g.session, 'portal.upload.bijgewerkt',
      { type: 'client_upload', id }, { req, meta: wijziging })

    return NextResponse.json({ ok: true })
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
