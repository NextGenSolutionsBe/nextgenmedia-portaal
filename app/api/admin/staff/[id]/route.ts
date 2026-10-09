import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { sanitizeModules } from '@/lib/staff'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// PATCH — werknemer bijwerken: naam / actief / permissions / wachtwoord.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const b = await req.json()
    const admin = createAdminSupabaseClient()

    const { data: staff } = await admin.from('staff_members').select('auth_user_id, email').eq('id', id).maybeSingle()
    if (!staff) return NextResponse.json({ error: 'Werknemer niet gevonden' }, { status: 404 })

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (typeof b.name === 'string') patch.name = b.name.trim() || null
    if (typeof b.active === 'boolean') patch.active = b.active
    if (Array.isArray(b.permissions)) patch.permissions = sanitizeModules(b.permissions)

    /**
     * E-mailadres wijzigen.
     *
     * Het adres is ook de login, dus dit moet op TWEE plekken tegelijk goed
     * gaan: bij de authenticatie en in staff_members. Lukt het tweede niet, dan
     * draaien we het eerste terug — anders logt iemand in met een adres dat
     * nergens anders bekend is, en dat is een half kapotte account waar je
     * lastig achter komt.
     *
     * De 2FA-instelling hangt aan auth_user_id en verhuist dus vanzelf mee.
     */
    const nieuwEmail = typeof b.email === 'string' ? b.email.trim().toLowerCase() : null
    let oudEmailTeruggedraaid: string | null = null

    if (nieuwEmail && nieuwEmail !== (staff.email ?? '').toLowerCase()) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nieuwEmail)) {
        return NextResponse.json({ error: 'Dat is geen geldig e-mailadres.' }, { status: 400 })
      }

      // Al in gebruik bij een andere werknemer? Dat vóór zijn met een leesbare
      // melding in plaats van een databasefout over een unieke index.
      const { data: bezet } = await admin.from('staff_members')
        .select('id').eq('email', nieuwEmail).neq('id', id).maybeSingle()
      if (bezet) {
        return NextResponse.json({ error: 'Dat adres is al van een andere werknemer.' }, { status: 409 })
      }

      if (staff.auth_user_id) {
        const { error } = await admin.auth.admin.updateUserById(staff.auth_user_id, {
          email: nieuwEmail,
          // Meteen bruikbaar; er gaat bewust geen bevestigingsmail naar de
          // werknemer, net zoals bij het instellen van een wachtwoord.
          email_confirm: true,
        })
        if (error) {
          return NextResponse.json({
            error: /already|exists|registered/i.test(error.message)
              ? 'Dat adres is al in gebruik als login.'
              : error.message,
          }, { status: 400 })
        }
        oudEmailTeruggedraaid = staff.email ?? null
      }
      patch.email = nieuwEmail
    }

    if (b.password) {
      if (String(b.password).length < 8) return NextResponse.json({ error: 'Wachtwoord moet minstens 8 tekens zijn' }, { status: 400 })
      if (staff.auth_user_id) {
        const { error } = await admin.auth.admin.updateUserById(staff.auth_user_id, { password: String(b.password), email_confirm: true })
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    const { error } = await admin.from('staff_members').update(patch).eq('id', id)
    if (error) {
      // De login is al omgezet maar de rest niet: terugdraaien, anders blijft
      // er een account achter waarvan het inlogadres nergens meer klopt.
      if (oudEmailTeruggedraaid && staff.auth_user_id) {
        try {
          await admin.auth.admin.updateUserById(staff.auth_user_id, {
            email: oudEmailTeruggedraaid, email_confirm: true,
          })
        } catch (e) {
          console.error('[staff] e-mail terugdraaien mislukt:', e instanceof Error ? e.message : e)
          return NextResponse.json({
            error: `Het adres is wél op de login gezet maar niet bij de werknemer, en terugdraaien lukte ook niet. De login is nu ${nieuwEmail}. Neem contact op voordat je iets anders probeert.`,
          }, { status: 500 })
        }
      }
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'staff.updated', entityType: 'staff_member', entityId: id,
      summary: `Werknemer bijgewerkt${patch.email ? ` (e-mail ${staff.email ?? '?'} → ${patch.email})` : ''}${Array.isArray(b.permissions) ? ' (rechten)' : ''}${typeof b.active === 'boolean' ? (b.active ? ' (geactiveerd)' : ' (gedeactiveerd)') : ''}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { modules: Array.isArray(b.permissions) ? sanitizeModules(b.permissions) : undefined }, ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath('/admin/werknemers') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — werknemer + auth-account verwijderen.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: staff } = await admin.from('staff_members').select('auth_user_id, email').eq('id', id).maybeSingle()
    if (!staff) return NextResponse.json({ error: 'Werknemer niet gevonden' }, { status: 404 })

    const { error } = await admin.from('staff_members').delete().eq('id', id)
    if (error) throw new Error(error.message)
    if (staff.auth_user_id) {
      try { await admin.from('user_roles').delete().eq('user_id', staff.auth_user_id) } catch { }
      try { await admin.auth.admin.deleteUser(staff.auth_user_id) } catch { }
    }
    const meta = requestMeta(req)
    await logAudit({
      action: 'staff.deleted', entityType: 'staff_member', entityId: id,
      summary: `Werknemer verwijderd (${staff.email ?? id})`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath('/admin/werknemers') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
