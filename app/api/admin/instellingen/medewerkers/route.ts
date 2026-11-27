import { NextRequest, NextResponse } from 'next/server'
import { dossierVoorWerknemer } from '@/lib/personeel/koppeling'
import { randomBytes } from 'crypto'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { sanitizeModules } from '@/lib/staff'
import { eisBeheer, eisHoofdbeheerder } from '@/lib/instellingen/api'
import { STAFF_ROLLEN } from '@/lib/instellingen/model'
import { lijstMedewerkers } from '@/lib/instellingen/medewerkers-server'
import { netteBedrijven } from '@/lib/team/rollen'
import { laadSjablonen, stappenToevoegen, onboardingOverzicht } from '@/lib/team/rollen-server'

export const dynamic = 'force-dynamic'

// GET — overzicht (wie de instellingen mag beheren).
export async function GET() {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const [medewerkers, onboarding] = await Promise.all([lijstMedewerkers(), onboardingOverzicht(createAdminSupabaseClient())])
    return NextResponse.json({ medewerkers, onboarding: Object.fromEntries(onboarding), ik: g.persoon.userId, magBeheren: g.persoon.isAdmin })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuwe medewerker (hoofdbeheerder). Geen uitnodigingsmail: die gaat
// enkel via de aparte knop. Zonder wachtwoord krijgt het account een
// willekeurig, onbekend wachtwoord tot er een uitnodiging verstuurd wordt.
export async function POST(req: NextRequest) {
  try {
    const g = await eisHoofdbeheerder(); if (!g.ok) return g.response
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!b) return NextResponse.json({ error: 'Ongeldige gegevens.' }, { status: 400 })
    const voornaam = String(b.voornaam ?? '').trim().slice(0, 80)
    const achternaam = String(b.achternaam ?? '').trim().slice(0, 80)
    const functie = String(b.functie ?? '').trim().slice(0, 120) || null
    const email = String(b.email ?? '').trim().toLowerCase()
    const rol = STAFF_ROLLEN.includes(b.rol as never) ? (b.rol as string) : 'medewerker'
    const permissions = sanitizeModules(b.permissions)
    const wachtwoord = typeof b.password === 'string' && b.password ? b.password : null
    // Fase 4: rolsjabloon, toegang per bedrijf, start- en einddatum (alles optioneel).
    const datum = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
    const start_datum = datum(b.start_datum), eind_datum = datum(b.eind_datum)
    if (start_datum && eind_datum && eind_datum < start_datum) return NextResponse.json({ error: 'De einddatum ligt na de startdatum.' }, { status: 400 })
    const bedrijven = netteBedrijven(b.bedrijven)
    const sjabloon = typeof b.sjabloon === 'string' && b.sjabloon ? (await laadSjablonen(createAdminSupabaseClient(), true)).find((x) => x.key === b.sjabloon) ?? null : null
    if (!voornaam) return NextResponse.json({ error: 'Voornaam is verplicht.' }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return NextResponse.json({ error: 'Vul een geldig e-mailadres in.' }, { status: 400 })
    if (wachtwoord && wachtwoord.length < 8) return NextResponse.json({ error: 'Een wachtwoord telt minstens 8 tekens.' }, { status: 400 })
    const naam = `${voornaam} ${achternaam}`.trim()

    const admin = createAdminSupabaseClient()
    const { data: bezet } = await admin.from('staff_members').select('id').eq('email', email).maybeSingle()
    if (bezet) return NextResponse.json({ error: 'Er bestaat al een medewerker met dit e-mailadres.' }, { status: 409 })

    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email, password: wachtwoord ?? randomBytes(24).toString('base64url'), email_confirm: true, user_metadata: { full_name: naam },
    })
    if (authErr || !created.user) return NextResponse.json({ error: /already|exists|registered/i.test(authErr?.message ?? '') ? 'Dit e-mailadres is al in gebruik als login.' : `Account aanmaken mislukt: ${authErr?.message ?? 'onbekend'}` }, { status: 400 })
    const uid = created.user.id

    // Rol-rij best-effort (zie /api/admin/staff): staff_members is de bron van waarheid.
    const rolRij = await admin.from('user_roles').upsert({ user_id: uid, role: 'employee' }, { onConflict: 'user_id,role' })
    if (rolRij.error) console.warn('user_roles employee insert overgeslagen:', rolRij.error.message)

    const basis = { auth_user_id: uid, name: naam, email, active: true, permissions, created_by: g.persoon.userId, voornaam, achternaam: achternaam || null, functie, rol }
    const fase4 = { rol_sjabloon: sjabloon?.key ?? null, bedrijven: bedrijven.length ? bedrijven : null, start_datum, eind_datum }
    let ins = await admin.from('staff_members').insert({ ...basis, ...fase4 }).select('id').single()
    // Vóór de migratie van fase 4 bestaan die kolommen nog niet: dan zonder.
    if (ins.error && /rol_sjabloon|bedrijven|start_datum|eind_datum/.test(ins.error.message)) ins = await admin.from('staff_members').insert(basis).select('id').single()
    const { data: row, error: rowErr } = ins
    if (rowErr || !row) {
      await admin.auth.admin.deleteUser(uid).catch(() => {})
      return NextResponse.json({ error: `Medewerker aanmaken mislukt: ${rowErr?.message ?? 'onbekend'}` }, { status: 400 })
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'staff.created', entityType: 'staff_member', entityId: row.id, summary: `Medewerker aangemaakt (${email}, ${rol})`,
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: 'admin',
      metadata: { rol, functie, modules: permissions, wachtwoordGezet: !!wachtwoord, sjabloon: sjabloon?.key ?? null, bedrijven, start_datum, eind_datum }, ip: meta.ip, userAgent: meta.userAgent,
    })
    // Onboarding-checklist uit het sjabloon (best-effort: het account bestaat al).
    if (sjabloon?.onboarding.length) { try { await stappenToevoegen(admin, row.id, sjabloon.onboarding) } catch { /* */ } }
    // Werknemers en Personeel zijn één geheel: elke interne login krijgt een
    // personeelsdossier (uren, planning, documenten) op dezelfde login.
    try { await dossierVoorWerknemer(admin, { id: row.id, auth_user_id: uid, email, name: naam, voornaam, achternaam: achternaam || null, functie, active: true }, g.persoon.email) } catch { /* dossier is best-effort */ }
    try { revalidatePath('/admin/werknemers'); revalidatePath('/admin/instellingen'); revalidatePath('/admin/personeel') } catch { /* */ }
    return NextResponse.json({ ok: true, id: row.id, uitnodigingNodig: !wachtwoord })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
