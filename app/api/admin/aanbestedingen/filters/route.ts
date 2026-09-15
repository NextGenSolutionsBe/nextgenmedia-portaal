import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, requireAdmin } from '@/lib/supabase/server'
import { parseShortLink, isValidShortLink } from '@/lib/aanbestedingen/short-link'
import { workspacesVoor, ontvangersVoor, type Workspace } from '@/lib/aanbestedingen/workspaces'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Workspaces binnen Aanbestedingen: "Software & IT", "Marketing", "Advertising".
 *
 * Aanmaken, wijzigen en verwijderen kan enkel een beheerder — een workspace
 * bepaalt welke opdrachten iemand te zien krijgt, en aan de kennisbank
 * eronder hangen onze tarieven.
 *
 * De zichtbaarheidsregel staat in lib/aanbestedingen/workspaces.ts en nergens
 * anders. Zie daar waarom.
 */

const MISSENDE_TABEL = /aanbestedingen_filters|does not exist|schema cache/i

const HINT_MIGRATIE =
  'De tabellen voor Aanbestedingen bestaan nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

async function scope() {
  const actor = await requireStaff()
  if (!actor) return null
  return { actor, isAdmin: !!(await requireAdmin()) }
}

/** De velden uit het formulier omzetten naar kolommen, met grenzen erop. */
function velden(b: Record<string, unknown>) {
  const raw = String(b.link ?? '').trim()
  const code = parseShortLink(raw)
  if (!code || !isValidShortLink(code)) {
    return {
      fout: 'Dat lijkt geen geldige filterlink. Plak de deel-link van publicprocurement.be — die bevat "shortLink=".',
    } as const
  }
  const eigenaar = String(b.eigenaar ?? '').trim()
  return {
    payload: {
      naam: String(b.naam ?? '').trim() || 'Aanbestedingen',
      short_link: code,
      include_closed: b.includeClosed === true,
      // Leeg = geen werknemer gekoppeld: enkel beheerders zien hem.
      eigenaar: eigenaar || null,
      ai_top_x: Math.min(50, Math.max(1, Number(b.aiTopX) || 25)),
      mail_drempel: Math.min(100, Math.max(0, Number(b.mailDrempel) || 70)),
      auto_enabled: b.autoEnabled === true,
      auto_dagen: Array.isArray(b.autoDagen) && b.autoDagen.length
        ? (b.autoDagen as unknown[]).map((d) => Number(d)).filter((d) => d >= 1 && d <= 7)
        : [1, 2, 3, 4, 5, 6, 7],
      auto_uur: Math.min(23, Math.max(0, Number(b.autoUur) || 0)),
    },
  } as const
}

// GET — de workspaces die je mag zien, met wie eraan hangt en wie de mails krijgt.
export async function GET() {
  try {
    const s = await scope()
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    let rijen: Workspace[]
    try {
      rijen = await workspacesVoor(s.actor.id, s.isAdmin)
    } catch (e) {
      if (MISSENDE_TABEL.test(e instanceof Error ? e.message : '')) {
        return NextResponse.json({ workspaces: [], staff: [], isAdmin: s.isAdmin, hint: HINT_MIGRATIE })
      }
      throw e
    }

    const admin = createAdminSupabaseClient()
    const { data: staffRijen } = await admin
      .from('staff_members')
      .select('auth_user_id, name, email, active')
      .order('name')
    const staff = ((staffRijen ?? []) as {
      auth_user_id: string | null; name: string | null; email: string | null; active: boolean
    }[]).filter((r) => r.auth_user_id && r.active !== false)

    const perUser = new Map(staff.map((r) => [r.auth_user_id as string, r]))

    // Toon meteen wie de mails krijgt. Anders moet je dat afleiden uit een
    // leeg veld, en juist daar zit de verwarring.
    const workspaces = await Promise.all(rijen.map(async (w) => ({
      ...w,
      eigenaar_naam: w.eigenaar ? perUser.get(w.eigenaar)?.name ?? null : null,
      eigenaar_email: w.eigenaar ? perUser.get(w.eigenaar)?.email ?? null : null,
      ontvangers: await ontvangersVoor(w),
    })))

    return NextResponse.json({
      workspaces,
      // De keuzelijst enkel voor wie mag wijzigen.
      staff: s.isAdmin ? staff.map((r) => ({ id: r.auth_user_id, naam: r.name, email: r.email })) : [],
      isAdmin: s.isAdmin,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuwe workspace.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Enkel een beheerder kan een workspace aanmaken' }, { status: 403 })

    const v = velden(await req.json().catch(() => ({})))
    if ('fout' in v) return NextResponse.json({ error: v.fout }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data, error } = await admin
      .from('aanbestedingen_filters').insert(v.payload).select('id').single()
    if (error) {
      if (MISSENDE_TABEL.test(error.message)) {
        return NextResponse.json({ error: HINT_MIGRATIE }, { status: 503 })
      }
      // Vóór de migratie staat `eigenaar` nog op NOT NULL. Dat willen we niet
      // als een technische fout tonen maar als iets wat je zelf kan oplossen.
      if (/null value in column "eigenaar"/i.test(error.message)) {
        return NextResponse.json({
          error: 'Een workspace zonder werknemer kan pas na de laatste migratie. Draai supabase/migrations/99999999_SYNC_ALL.sql, of koppel voorlopig een werknemer.',
        }, { status: 503 })
      }
      throw new Error(error.message)
    }

    const id = (data as { id: string }).id
    // Lege kennisbank meteen aanmaken, zodat dat scherm niet leeg blijft.
    await admin.from('aanbesteding_kennis').upsert({ filter_id: id }, { onConflict: 'filter_id' })

    const meta = requestMeta(req)
    await logAudit({
      action: 'aanbestedingen.workspace.create', entityType: 'aanbestedingen_filter', entityId: id,
      summary: `Aanbestedingen: workspace ${v.payload.naam} aangemaakt`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — bestaande workspace bijwerken.
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Enkel een beheerder kan een workspace wijzigen' }, { status: 403 })

    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen workspace opgegeven' }, { status: 400 })

    const v = velden(b)
    if ('fout' in v) return NextResponse.json({ error: v.fout }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('aanbestedingen_filters').update(v.payload).eq('id', id)
    if (error) {
      if (/null value in column "eigenaar"/i.test(error.message)) {
        return NextResponse.json({
          error: 'Een workspace zonder werknemer kan pas na de laatste migratie. Draai supabase/migrations/99999999_SYNC_ALL.sql, of koppel voorlopig een werknemer.',
        }, { status: 503 })
      }
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'aanbestedingen.workspace.save', entityType: 'aanbestedingen_filter', entityId: id,
      summary: `Aanbestedingen: workspace ${v.payload.naam} bijgewerkt`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * DELETE — workspace weg, met alles wat eraan hangt (opdrachten, documenten,
 * kennisbank; dat loopt via ON DELETE CASCADE).
 */
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Enkel een beheerder kan een workspace verwijderen' }, { status: 403 })

    const id = String(req.nextUrl.searchParams.get('id') ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen workspace opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: bestaand } = await admin
      .from('aanbestedingen_filters').select('naam').eq('id', id).maybeSingle()
    if (!bestaand) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })

    const { error } = await admin.from('aanbestedingen_filters').delete().eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'aanbestedingen.workspace.delete', entityType: 'aanbestedingen_filter', entityId: id,
      summary: `Aanbestedingen: workspace ${(bestaand as { naam: string }).naam} verwijderd`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
