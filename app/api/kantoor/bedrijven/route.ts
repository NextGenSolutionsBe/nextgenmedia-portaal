import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { sendEmail, baseUrl } from '@/lib/email'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Beheer van de bedrijven in het Kantoor en hun logins. ADMIN-ONLY: wie hier
 * bij kan, bepaalt wie er straks bedragen ziet.
 *
 * Over logins: wij maken GEEN accounts aan en zien nooit een wachtwoord. We
 * versturen een uitnodiging; de partner kiest zelf zijn wachtwoord. Dat is
 * dezelfde weg als het klantenportaal en het enige nette: een wachtwoord dat
 * wij instellen, is een wachtwoord dat wij kennen.
 */

const tekst = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const [{ data: bedrijven, error }, { data: leden }] = await Promise.all([
      admin.from('kantoor_bedrijven').select('id, naam, is_eigen, email, actief').order('is_eigen', { ascending: false }).order('naam'),
      admin.from('kantoor_leden').select('id, bedrijf_id, email, naam, actief, auth_user_id, uitgenodigd_op'),
    ])
    if (error) {
      if (/kantoor_|does not exist|schema cache/i.test(error.message)) {
        return NextResponse.json({ bedrijven: [], leden: [], hint: 'Draai eerst de migratie.' })
      }
      throw new Error(error.message)
    }
    // auth_user_id niet naar de browser: alleen of iemand al actief is.
    const veiligeLeden = ((leden ?? []) as { id: string; bedrijf_id: string; email: string; naam: string | null; actief: boolean; auth_user_id: string | null; uitgenodigd_op: string | null }[])
      .map(({ auth_user_id, ...rest }) => ({ ...rest, actief_account: !!auth_user_id }))
    return NextResponse.json({ bedrijven: bedrijven ?? [], leden: veiligeLeden })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — bedrijf toevoegen, of iemand uitnodigen bij een bedrijf.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const admin = createAdminSupabaseClient()

    // ── Bedrijf toevoegen ────────────────────────────────────────────────────
    if (b.actie === 'bedrijf') {
      const naam = tekst(b.naam, 120)
      if (!naam) return NextResponse.json({ error: 'Geef het bedrijf een naam.' }, { status: 400 })
      const { data, error } = await admin.from('kantoor_bedrijven')
        .insert({ naam, is_eigen: !!b.is_eigen, email: tekst(b.email, 160) })
        .select('id').single()
      if (error) {
        if (/duplicate|unique|23505/i.test(error.message)) {
          return NextResponse.json({ error: 'Dat bedrijf staat er al.' }, { status: 409 })
        }
        throw new Error(error.message)
      }
      return NextResponse.json({ ok: true, id: (data as { id: string }).id })
    }

    // ── Iemand uitnodigen ────────────────────────────────────────────────────
    if (b.actie === 'uitnodigen') {
      const bedrijfId = String(b.bedrijf_id ?? '')
      const email = String(b.email ?? '').trim().toLowerCase()
      if (!bedrijfId) return NextResponse.json({ error: 'Kies een bedrijf.' }, { status: 400 })
      if (!isEmail(email)) return NextResponse.json({ error: 'Dat is geen geldig e-mailadres.' }, { status: 400 })

      const { data: bedrijf } = await admin.from('kantoor_bedrijven')
        .select('id, naam').eq('id', bedrijfId).maybeSingle()
      if (!bedrijf) return NextResponse.json({ error: 'Dat bedrijf bestaat niet.' }, { status: 400 })

      // Bestaat het account al? Dan meteen koppelen; anders komt de koppeling
      // tot stand zodra deze persoon voor het eerst inlogt (zie lib/kantoor/auth.ts).
      let authUserId: string | null = null
      try {
        const { data: lijst } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
        authUserId = lijst?.users.find((u) => (u.email ?? '').toLowerCase() === email)?.id ?? null
      } catch { /* niet kritiek */ }

      const { error } = await admin.from('kantoor_leden').insert({
        bedrijf_id: bedrijfId, email, naam: tekst(b.naam, 120),
        auth_user_id: authUserId, uitgenodigd_op: new Date().toISOString(),
      })
      if (error) {
        if (/duplicate|unique|23505/i.test(error.message)) {
          return NextResponse.json({ error: 'Dit adres is al gekoppeld aan dat bedrijf.' }, { status: 409 })
        }
        throw new Error(error.message)
      }

      /**
       * Uitnodiging versturen. Bestaat het account nog niet, dan stuurt
       * Supabase een invite waarmee de partner ZELF een wachtwoord kiest.
       * Bestaat het al, dan volstaat een mail met de link.
       */
      let mailStatus = 'verstuurd'
      const link = `${baseUrl()}/kantoor`
      if (!authUserId) {
        try {
          const { error: invErr } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: link })
          if (invErr) mailStatus = `uitnodiging mislukt: ${invErr.message}`
        } catch (e) {
          mailStatus = `uitnodiging mislukt: ${e instanceof Error ? e.message : 'onbekend'}`
        }
      } else {
        const res = await sendEmail({
          to: email,
          subject: `Je bent toegevoegd aan het Kantoor van ${(bedrijf as { naam: string }).naam}`,
          text: [
            `Je hebt nu toegang tot het Kantoor namens ${(bedrijf as { naam: string }).naam}.`,
            '',
            'Daar zie je de opdrachten die we aan elkaar doorgeven en wat je eraan verdient.',
            '',
            link,
          ].join('\n'),
        })
        if (!res.ok) mailStatus = `mail mislukt: ${res.error}`
      }

      const meta = requestMeta(req)
      await logAudit({
        action: 'kantoor.lid.invite', entityType: 'kantoor_bedrijf', entityId: bedrijfId,
        summary: `Kantoor: ${email} uitgenodigd voor ${(bedrijf as { naam: string }).naam}`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
        ip: meta.ip, userAgent: meta.userAgent,
      })
      return NextResponse.json({ ok: true, mailStatus })
    }

    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * PATCH — een bedrijf op non-actief zetten of weer aanzetten.
 *
 * Dit is het alternatief voor verwijderen zodra er opdrachten aan hangen: het
 * bedrijf verdwijnt uit alle keuzelijsten, maar de historie en de cijfers
 * blijven kloppen.
 */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const id = String(b.bedrijf_id ?? '')
    if (!id) return NextResponse.json({ error: 'bedrijf_id ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('kantoor_bedrijven')
      .update({ actief: !!b.actief }).eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: b.actief ? 'kantoor.bedrijf.activate' : 'kantoor.bedrijf.archive',
      entityType: 'kantoor_bedrijf', entityId: id,
      summary: `Kantoor: bedrijf ${b.actief ? 'weer actief' : 'op non-actief'} gezet`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?lid= — toegang intrekken. DELETE ?bedrijf= — bedrijf verwijderen.
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    // ── Bedrijf verwijderen ──────────────────────────────────────────────────
    const bedrijfId = req.nextUrl.searchParams.get('bedrijf') ?? ''
    if (bedrijfId) {
      const admin = createAdminSupabaseClient()
      const { data: bedrijf } = await admin.from('kantoor_bedrijven')
        .select('id, naam').eq('id', bedrijfId).maybeSingle()
      if (!bedrijf) return NextResponse.json({ error: 'Bedrijf niet gevonden' }, { status: 404 })

      /**
       * Hangen er opdrachten aan, dan verwijderen we NIET. Die opdrachten
       * dragen bedragen die in de omzet- en kostencijfers meetellen; het
       * bedrijf weghalen zou die cijfers stilletjes veranderen. In dat geval
       * is "op non-actief zetten" het juiste antwoord — dat zeggen we ook.
       */
      const { count } = await admin.from('kantoor_opdrachten')
        .select('id', { count: 'exact', head: true })
        .or(`factureert_id.eq.${bedrijfId},ontvangt_id.eq.${bedrijfId}`)
      if ((count ?? 0) > 0) {
        return NextResponse.json({
          error: `Dit bedrijf staat bij ${count} opdracht${count === 1 ? '' : 'en'}. Die tellen mee in de cijfers, dus verwijderen kan niet — zet het bedrijf op non-actief.`,
          kanArchiveren: true,
        }, { status: 409 })
      }

      // Geen opdrachten → echt weg. De leden verdwijnen mee (cascade); de
      // ACCOUNTS blijven bestaan, die kunnen bij een ander bedrijf horen.
      const { error } = await admin.from('kantoor_bedrijven').delete().eq('id', bedrijfId)
      if (error) throw new Error(error.message)

      const meta0 = requestMeta(req)
      await logAudit({
        action: 'kantoor.bedrijf.delete', entityType: 'kantoor_bedrijf', entityId: bedrijfId,
        summary: `Kantoor: bedrijf "${(bedrijf as { naam: string }).naam}" verwijderd`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
        ip: meta0.ip, userAgent: meta0.userAgent,
      })
      return NextResponse.json({ ok: true })
    }

    const lidId = req.nextUrl.searchParams.get('lid') ?? ''
    if (!lidId) return NextResponse.json({ error: 'lid ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    // Enkel de koppeling weghalen — het account zelf laten we met rust: dat
    // kan bij andere bedrijven horen, en accounts verwijderen doen wij niet.
    const { error } = await admin.from('kantoor_leden').delete().eq('id', lidId)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'kantoor.lid.remove', entityType: 'kantoor_lid', entityId: lidId,
      summary: 'Kantoor: toegang ingetrokken',
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
