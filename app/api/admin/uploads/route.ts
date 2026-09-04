import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, signedUrlMap } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { BUCKET, LOSSE_BESTANDEN, STATUSSEN, type Status } from '@/lib/client-uploads'

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

/** Status bijwerken en/of een interne aantekening plaatsen. */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen upload opgegeven' }, { status: 400 })

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
    if (Object.keys(wijziging).length === 0) {
      return NextResponse.json({ error: 'Niets om te wijzigen.' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('client_uploads').update(wijziging).eq('id', id)
    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'upload.bijgewerkt', entityType: 'client_upload', entityId: id,
      summary: `Klantupload bijgewerkt${wijziging.status ? ` → ${wijziging.status}` : ''}`,
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
