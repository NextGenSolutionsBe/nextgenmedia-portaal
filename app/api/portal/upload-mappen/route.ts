import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { safeMessage } from '@/lib/api-error'
import { leesMapNaam } from '@/lib/client-uploads'

export const dynamic = 'force-dynamic'

/**
 * Mappen waarin een klant zijn beeldmateriaal ordent.
 *
 * Een map is niets meer dan een naam met een beschrijving; de bestanden zelf
 * blijven waar ze zijn en verwijzen ernaar. Daardoor kan een map weg zonder
 * dat er ook maar één foto verdwijnt — die komen dan weer bij de losse
 * bestanden te staan.
 */

const MIST = /client_upload_folders|map_id|does not exist|schema cache/i
const HINT = 'Mappen zijn nog niet beschikbaar. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

export async function GET() {
  try {
    const g = await requirePortalPermission('files', 'view')
    if (!g.ok) return g.response

    const admin = createAdminSupabaseClient()
    const { data, error } = await admin
      .from('client_upload_folders')
      .select('id, naam, beschrijving, door_naam, created_at')
      .eq('client_id', g.session.clientId)
      .order('created_at', { ascending: false })

    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ mappen: [], hint: HINT })
      throw new Error(error.message)
    }
    return NextResponse.json({ mappen: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const g = await requirePortalPermission('files', 'upload')
    if (!g.ok) return g.response

    const b = await req.json().catch(() => ({}))
    const naam = leesMapNaam(b.naam)
    if ('fout' in naam) return NextResponse.json({ error: naam.fout }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('client_upload_folders').insert({
      client_id: g.session.clientId,
      naam: naam.naam,
      beschrijving: String(b.beschrijving ?? '').trim().slice(0, 2000) || null,
      door_naam: g.session.name,
      door_email: g.session.email,
      auth_user_id: g.session.userId,
    }).select('id, naam, beschrijving, door_naam, created_at').single()

    if (error) {
      // De unieke index slaat toe: dat is geen fout van de klant maar een
      // verwijzing naar de map die er al staat.
      if (/duplicate key|unique/i.test(error.message)) {
        return NextResponse.json({ error: `Er is al een map "${naam.naam}".` }, { status: 409 })
      }
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }

    await logPortalAction(g.session, 'portal.uploadmap.aangemaakt',
      { type: 'client_upload_folder', id: (data as { id: string }).id }, { req, meta: { naam: naam.naam } })

    return NextResponse.json({ ok: true, map: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const g = await requirePortalPermission('files', 'upload')
    if (!g.ok) return g.response

    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen map opgegeven' }, { status: 400 })

    const wijziging: Record<string, unknown> = {}
    if (b.naam !== undefined) {
      const naam = leesMapNaam(b.naam)
      if ('fout' in naam) return NextResponse.json({ error: naam.fout }, { status: 400 })
      wijziging.naam = naam.naam
    }
    if (b.beschrijving !== undefined) {
      wijziging.beschrijving = String(b.beschrijving).trim().slice(0, 2000) || null
    }
    if (Object.keys(wijziging).length === 0) {
      return NextResponse.json({ error: 'Niets om te wijzigen.' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    // De filter op client_id is de beveiliging: zonder dat kan een id van een
    // andere klant meegestuurd worden.
    const { data, error } = await admin
      .from('client_upload_folders')
      .update(wijziging)
      .eq('id', id).eq('client_id', g.session.clientId)
      .select('id')

    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        return NextResponse.json({ error: 'Er is al een map met die naam.' }, { status: 409 })
      }
      throw new Error(error.message)
    }
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Map niet gevonden' }, { status: 404 })
    }

    await logPortalAction(g.session, 'portal.uploadmap.bijgewerkt',
      { type: 'client_upload_folder', id }, { req, meta: wijziging })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * Map weghalen.
 *
 * De bestanden blijven bestaan en komen bij de losse bestanden terecht — de
 * database regelt dat met ON DELETE SET NULL. Beeldmateriaal van een klant
 * weggooien omdat er een mapje verdwijnt zou nooit de bedoeling zijn.
 */
export async function DELETE(req: NextRequest) {
  try {
    const g = await requirePortalPermission('files', 'upload')
    if (!g.ok) return g.response

    const id = String(req.nextUrl.searchParams.get('id') ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen map opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data, error } = await admin
      .from('client_upload_folders')
      .delete()
      .eq('id', id).eq('client_id', g.session.clientId)
      .select('id, naam')

    if (error) throw new Error(error.message)
    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'Map niet gevonden' }, { status: 404 })
    }

    await logPortalAction(g.session, 'portal.uploadmap.verwijderd',
      { type: 'client_upload_folder', id }, { req, meta: { naam: data[0].naam } })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
