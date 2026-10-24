import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, insertResilient, requireStaff, signedUrlMap } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import {
  BUCKET, LOSSE_BESTANDEN, MAX_BYTES, STATUSSEN, mimeToegestaan, padHoortBij, schooneNaam, type Status,
} from '@/lib/client-uploads'

export const dynamic = 'force-dynamic'

/**
 * Wat klanten hebben aangeleverd, over alle klanten heen.
 *
 * Bewust een eigen dashboard en geen tabblad onder Social Media: materiaal
 * komt binnen los van de kalender, en wie 's ochtends kijkt wat er nieuw is
 * wil dat in één lijst zien — niet per klant moeten rondklikken.
 */

const MIST = /client_uploads|does not exist|schema cache/i
const HINT = 'De tabel voor klantuploads bestaat nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const status = String(req.nextUrl.searchParams.get('status') ?? '').trim()
    const klant = String(req.nextUrl.searchParams.get('client') ?? '').trim()

    const KOLOMMEN = 'id, client_id, titel, beschrijving, bestandspad, bestandsnaam, mimetype, grootte, status, admin_notitie, door_naam, door_email, created_at, map_id'

    const haal = async (kolommen: string) => {
      let vraag = admin
        .from('client_uploads')
        .select(kolommen)
        .order('created_at', { ascending: false })
        .limit(500)
      if (status && (STATUSSEN as readonly string[]).includes(status)) vraag = vraag.eq('status', status)
      if (klant) vraag = vraag.eq('client_id', klant)
      return vraag
    }

    // Zonder de kolom map_id (migratie nog niet gedraaid) valt de selectie
    // terug, zodat het scherm blijft werken in plaats van leeg te blijven.
    let { data, error } = await haal(KOLOMMEN)
    if (error && /map_id/i.test(error.message)) {
      ;({ data, error } = await haal(KOLOMMEN.replace(', map_id', '')))
    }
    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ uploads: [], clients: [], hint: HINT })
      throw new Error(error.message)
    }

    const { data: mapRijen } = await admin.from('client_upload_folders').select('id, naam')
    const mapNaam = new Map(
      ((mapRijen ?? []) as { id: string; naam: string }[]).map((m) => [m.id, m.naam]),
    )

    // LET OP: de kolom heet company_name, niet name.
    const { data: klantRijen } = await admin
      .from('clients').select('id, company_name').order('company_name')
    const clients = ((klantRijen ?? []) as { id: string; company_name: string | null }[])
      .map((c) => ({ id: c.id, naam: c.company_name ?? '(zonder naam)' }))
    const naamVan = new Map(clients.map((c) => [c.id, c.naam]))

    const rijen = (data ?? []) as unknown as Record<string, unknown>[]
    // Alle bestanden in één keer laten tekenen in plaats van één per rij.
    const urls = await signedUrlMap(admin, BUCKET, rijen.map((r) => String(r.bestandspad)), 60 * 60)

    const uploads = rijen.map((rij) => {
      const { bestandspad: _weg, ...rest } = rij
      void _weg
      return {
        ...rest,
        client_naam: naamVan.get(String(rij.client_id)) ?? '(onbekende klant)',
        map_naam: rij.map_id ? mapNaam.get(String(rij.map_id)) ?? LOSSE_BESTANDEN : LOSSE_BESTANDEN,
        url: urls.get(String(rij.bestandspad)) ?? null,
      }
    })

    return NextResponse.json({ uploads, clients })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** Hoe een medewerker heet in de kolommen door_naam/door_email. */
function staffNaam(actor: { email?: string | null; user_metadata?: Record<string, unknown> }): string | null {
  const m = actor.user_metadata ?? {}
  const naam = String(m.full_name ?? m.name ?? '').trim()
  return naam || (actor.email ? String(actor.email).split('@')[0] : null)
}

/**
 * Stap 2 van een upload door een medewerker: bevestigen dat het bestand er
 * staat en de rij aanmaken in de map van de klant.
 *
 * Spiegel van /api/portal/uploads POST. Alles wordt opnieuw gecontroleerd:
 * het pad moet bij de opgegeven klant horen (padHoortBij), het bestandstype
 * moet op de witte lijst staan, en de grootte lezen we uit de opslag — niet
 * uit het verzoek. Status 'gezien': wij hebben het zelf geplaatst, dus er is
 * niets "nieuws" om te bekijken.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json().catch(() => ({}))
    const clientId = String(b.client_id ?? '').trim()
    const pad = String(b.pad ?? '')
    const mime = String(b.mimetype ?? '').toLowerCase()
    const titel = String(b.titel ?? '').trim() || schooneNaam(b.bestandsnaam).replace(/\.[^.]+$/, '')
    const beschrijving = String(b.beschrijving ?? '').trim()

    if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
      return NextResponse.json({ error: 'Geen klant opgegeven.' }, { status: 400 })
    }
    if (!padHoortBij(pad, clientId)) {
      return NextResponse.json({ error: 'Dit bestandspad hoort niet bij deze klant.' }, { status: 400 })
    }
    if (!mimeToegestaan(mime)) {
      return NextResponse.json({ error: 'Dit bestandstype kunnen we niet aannemen.' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    const { data: klant } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle()
    if (!klant) return NextResponse.json({ error: 'Klant niet gevonden.' }, { status: 404 })

    // Staat het bestand er echt, en hoe groot is het?
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

    // Submap: moet van déze klant zijn, anders weigeren i.p.v. stil negeren.
    const mapId = String(b.map_id ?? '').trim()
    if (mapId) {
      const { data: mapRij } = await admin
        .from('client_upload_folders').select('id').eq('id', mapId).eq('client_id', clientId).maybeSingle()
      if (!mapRij) {
        await admin.storage.from(BUCKET).remove([pad])
        return NextResponse.json({ error: 'Die map bestaat niet bij deze klant.' }, { status: 400 })
      }
    }

    const { data: nieuw, error } = await insertResilient(admin, 'client_uploads', {
      client_id: clientId,
      titel: titel.slice(0, 200) || 'bestand',
      beschrijving: beschrijving.slice(0, 4000) || null,
      bestandspad: pad,
      bestandsnaam: schooneNaam(b.bestandsnaam),
      mimetype: mime,
      grootte,
      door_email: actor.email ?? null,
      door_naam: staffNaam(actor),
      auth_user_id: actor.id,
      status: 'gezien',
      map_id: mapId || null,
    }, { required: ['client_id', 'titel', 'bestandspad'] })

    if (error) {
      await admin.storage.from(BUCKET).remove([pad])
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }

    const id = String(nieuw?.id ?? '')
    const meta = requestMeta(req)
    await logAudit({
      action: 'upload.toegevoegd', entityType: 'client_upload', entityId: id,
      summary: `Bestand door medewerker in klantmap gezet: ${titel}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent, metadata: { client_id: clientId, map_id: mapId || null, grootte },
    })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * Status bijwerken, een interne aantekening plaatsen, en/of het bestand aan
 * een (andere) klant koppelen.
 *
 * Bij het koppelen blijft het bestand in de opslag waar het staat: de
 * groepering per klant is virtueel (op client_id), het pad is enkel een
 * opslagadres. Verplaatsen zou een kopie + verwijdering vergen zonder winst.
 */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen upload opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const wijziging: Record<string, unknown> = {}
    if (b.status !== undefined) {
      const s = String(b.status)
      if (!(STATUSSEN as readonly string[]).includes(s)) {
        return NextResponse.json({ error: `"${s}" is geen geldige status.` }, { status: 400 })
      }
      wijziging.status = s as Status
    }
    if (b.admin_notitie !== undefined) {
      wijziging.admin_notitie = String(b.admin_notitie).trim().slice(0, 2000) || null
    }
    if (b.titel !== undefined) {
      const t = String(b.titel ?? '').trim()
      if (!t) return NextResponse.json({ error: 'Titel mag niet leeg zijn.' }, { status: 400 })
      wijziging.titel = t.slice(0, 200)
    }
    if (b.beschrijving !== undefined) {
      wijziging.beschrijving = String(b.beschrijving ?? '').trim().slice(0, 4000) || null
    }
    // Andere map (binnen dezelfde klant). Leeg = losse bestanden.
    if (b.map_id !== undefined && b.client_id === undefined) {
      const mapId = String(b.map_id ?? '').trim()
      if (mapId) {
        const { data: huidig } = await admin.from('client_uploads').select('client_id').eq('id', id).maybeSingle()
        if (!huidig) return NextResponse.json({ error: 'Upload niet gevonden' }, { status: 404 })
        const { data: mapRij } = await admin
          .from('client_upload_folders').select('id').eq('id', mapId).eq('client_id', huidig.client_id).maybeSingle()
        if (!mapRij) return NextResponse.json({ error: 'Die map bestaat niet bij deze klant.' }, { status: 400 })
      }
      wijziging.map_id = mapId || null
    }
    if (b.client_id !== undefined) {
      const clientId = String(b.client_id ?? '').trim()
      if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
        return NextResponse.json({ error: 'Geen geldige klant opgegeven.' }, { status: 400 })
      }
      const { data: klant } = await admin.from('clients').select('id').eq('id', clientId).maybeSingle()
      if (!klant) return NextResponse.json({ error: 'Klant niet gevonden.' }, { status: 404 })
      wijziging.client_id = clientId
      // Een submap hoort bij één klant; bij het overzetten vervalt ze dus.
      wijziging.map_id = null
    }
    if (Object.keys(wijziging).length === 0) {
      return NextResponse.json({ error: 'Niets om te wijzigen.' }, { status: 400 })
    }

    const { data: rijen, error } = await admin.from('client_uploads').update(wijziging).eq('id', id).select('id')
    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      // map_id ontbreekt nog (migratie niet gedraaid): dan zonder die kolom.
      if (/map_id/i.test(error.message) && 'map_id' in wijziging) {
        const { map_id: _weg, ...rest } = wijziging
        void _weg
        const { error: e2 } = await admin.from('client_uploads').update(rest).eq('id', id)
        if (e2) throw new Error(e2.message)
      } else {
        throw new Error(error.message)
      }
    } else if (!rijen || rijen.length === 0) {
      return NextResponse.json({ error: 'Upload niet gevonden' }, { status: 404 })
    }

    const meta = requestMeta(req)
    await logAudit({
      action: wijziging.client_id ? 'upload.toegewezen' : 'upload.bijgewerkt', entityType: 'client_upload', entityId: id,
      summary: wijziging.client_id
        ? `Klantupload aan klant gekoppeld (${wijziging.client_id})`
        : `Klantupload bijgewerkt${wijziging.status ? ` → ${wijziging.status}` : ''}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * Weghalen. Het bestand gaat óók uit de opslag — een rij verwijderen en het
 * bestand laten staan levert materiaal op dat nergens meer in beeld komt maar
 * wel opslag kost, en dat is bij klantmateriaal precies wat je niet wil.
 */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const id = String(req.nextUrl.searchParams.get('id') ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen upload opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: rij } = await admin
      .from('client_uploads').select('bestandspad, titel').eq('id', id).maybeSingle()
    if (!rij) return NextResponse.json({ error: 'Upload niet gevonden' }, { status: 404 })

    await admin.storage.from(BUCKET).remove([rij.bestandspad])
    const { error } = await admin.from('client_uploads').delete().eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'upload.verwijderd', entityType: 'client_upload', entityId: id,
      summary: `Klantupload verwijderd: ${rij.titel}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
