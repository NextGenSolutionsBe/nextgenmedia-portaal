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

/** Kortste wachtwoord dat we aanvaarden. Korter is geen wachtwoord maar een gok. */
const MIN_WACHTWOORD = 10

/**
 * Het auth-account bij een e-mailadres, mét de twee velden die zeggen of het
 * ooit gebruikt is. Supabase heeft geen "zoek op e-mail", vandaar de lijst.
 */
async function zoekAuthGebruiker(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  email: string,
): Promise<{ id: string; last_sign_in_at?: string | null; email_confirmed_at?: string | null } | null> {
  try {
    const { data: lijst } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const u = lijst?.users.find((x) => (x.email ?? '').toLowerCase() === email.toLowerCase())
    return u ? { id: u.id, last_sign_in_at: u.last_sign_in_at, email_confirmed_at: u.email_confirmed_at } : null
  } catch {
    return null
  }
}

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
    /**
     * De ECHTE toestand van elk account erbij zoeken.
     *
     * Hier zat de leugen in het scherm: het toonde "actief" zodra er een
     * auth_user_id stond. Maar een uitnodiging maakt dat account meteen aan —
     * zónder wachtwoord en onbevestigd. Er stond dus "toegevoegd" bij iemand
     * die er nooit in geraakte. Nu kijken we naar wat telt: kan deze persoon
     * inloggen (bevestigd of ooit ingelogd), of niet?
     */
    const rijen = ((leden ?? []) as {
      id: string; bedrijf_id: string; email: string; naam: string | null
      actief: boolean; auth_user_id: string | null; uitgenodigd_op: string | null
    }[])

    const perEmail = new Map<string, { bevestigd: boolean; laatsteLogin: string | null }>()
    try {
      const { data: lijst } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      for (const u of lijst?.users ?? []) {
        if (!u.email) continue
        perEmail.set(u.email.toLowerCase(), {
          bevestigd: !!u.email_confirmed_at,
          laatsteLogin: u.last_sign_in_at ?? null,
        })
      }
    } catch { /* zonder deze lijst tonen we gewoon "onbekend" i.p.v. te falen */ }

    // auth_user_id gaat niet naar de browser; enkel de afgeleide toestand.
    const veiligeLeden = rijen.map(({ auth_user_id, ...rest }) => {
      const auth = perEmail.get(rest.email.toLowerCase())
      const kanInloggen = !!auth && (auth.bevestigd || !!auth.laatsteLogin)
      return {
        ...rest,
        heeft_account: !!auth || !!auth_user_id,
        kan_inloggen: kanInloggen,
        laatste_login: auth?.laatsteLogin ?? null,
        /** 'klaar' = kan inloggen · 'wacht' = account bestaat maar is nooit gebruikt · 'geen' = nog geen account. */
        toestand: kanInloggen ? 'klaar' : (auth || auth_user_id) ? 'wacht' : 'geen',
      }
    })
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

    /**
     * ── Iemand toegang geven ─────────────────────────────────────────────────
     *
     * WAAROM DIT ANDERS WERKT DAN VOORHEEN. De oude weg was een Supabase-invite:
     * die maakt het account meteen aan (zonder wachtwoord, onbevestigd) en
     * stuurt een mail via de mailer van Supabase — niet via onze eigen Resend.
     * Kwam die mail niet aan, dan stond de partner er in ons scherm als
     * "toegevoegd" terwijl hij nergens in kon. Precies wat er gebeurde.
     *
     * Nu kiezen WIJ een wachtwoord en is het account meteen bruikbaar. Geen
     * mail die moet aankomen, geen link die kan verlopen: je geeft het
     * wachtwoord door zoals jij wil, en de partner logt gewoon in.
     *
     * Twee gevallen bij een adres dat AL een account heeft:
     *  · nog nooit ingelogd (bv. een oude, mislukte uitnodiging) → we mogen er
     *    veilig een wachtwoord op zetten;
     *  · wél eerder ingelogd → we raken dat wachtwoord NIET aan. Die persoon
     *    heeft een lopend account; we koppelen enkel het bedrijf erbij.
     */
    if (b.actie === 'uitnodigen') {
      const bedrijfId = String(b.bedrijf_id ?? '')
      const email = String(b.email ?? '').trim().toLowerCase()
      const wachtwoord = String(b.wachtwoord ?? '')
      if (!bedrijfId) return NextResponse.json({ error: 'Kies een bedrijf.' }, { status: 400 })
      if (!isEmail(email)) return NextResponse.json({ error: 'Dat is geen geldig e-mailadres.' }, { status: 400 })
      if (wachtwoord && wachtwoord.length < MIN_WACHTWOORD) {
        return NextResponse.json({ error: `Een wachtwoord van minstens ${MIN_WACHTWOORD} tekens, graag.` }, { status: 400 })
      }

      const { data: bedrijf } = await admin.from('kantoor_bedrijven')
        .select('id, naam').eq('id', bedrijfId).maybeSingle()
      if (!bedrijf) return NextResponse.json({ error: 'Dat bedrijf bestaat niet.' }, { status: 400 })
      const bedrijfNaam = (bedrijf as { naam: string }).naam

      const bestaand = await zoekAuthGebruiker(admin, email)
      const heeftGebruikt = !!bestaand && (!!bestaand.last_sign_in_at || !!bestaand.email_confirmed_at)

      let authUserId = bestaand?.id ?? null
      let wachtwoordGezet = false

      if (!bestaand) {
        // Nieuw account. Zonder wachtwoord heeft dit geen zin: dat is exact de
        // situatie waarin iemand "toegevoegd" leek maar niet binnen geraakte.
        if (!wachtwoord) {
          return NextResponse.json({
            error: 'Kies een wachtwoord voor deze partner — anders bestaat het account wel, maar kan er niemand mee inloggen.',
            wachtwoordNodig: true,
          }, { status: 400 })
        }
        const { data: gemaakt, error: maakErr } = await admin.auth.admin.createUser({
          email,
          password: wachtwoord,
          // Meteen bevestigd: er komt geen bevestigingsmail aan te pas, dus
          // wachten op een klik zou het account eeuwig onbruikbaar houden.
          email_confirm: true,
          user_metadata: { name: tekst(b.naam, 120) ?? undefined },
        })
        if (maakErr || !gemaakt?.user) {
          return NextResponse.json({ error: `Account aanmaken mislukt: ${maakErr?.message ?? 'onbekend'}` }, { status: 400 })
        }
        authUserId = gemaakt.user.id
        wachtwoordGezet = true
      } else if (wachtwoord && !heeftGebruikt) {
        // Slapend account uit een eerdere, mislukte uitnodiging: veilig om er
        // alsnog een wachtwoord op te zetten.
        const { error: zetErr } = await admin.auth.admin.updateUserById(bestaand.id, {
          password: wachtwoord, email_confirm: true,
        })
        if (zetErr) return NextResponse.json({ error: `Wachtwoord instellen mislukt: ${zetErr.message}` }, { status: 400 })
        wachtwoordGezet = true
      }

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
       * Een berichtje via ONZE mailer (Resend) — dezelfde weg als alle andere
       * mail in de app, dus die komt aan. Het WACHTWOORD staat er bewust niet
       * in: dat geef je zelf door, per telefoon of bericht. Standaard sturen we
       * niets; enkel als je het vinkje aanzet.
       */
      let mailStatus: string | null = null
      if (b.stuurMail) {
        const link = `${baseUrl()}/kantoor`
        const res = await sendEmail({
          to: email,
          subject: `Je hebt toegang tot het Kantoor van ${bedrijfNaam}`,
          text: [
            `Je hebt nu toegang tot het Kantoor namens ${bedrijfNaam}.`,
            '',
            'Daar zie je de opdrachten die we aan elkaar doorgeven en wat je eraan verdient.',
            '',
            link,
            '',
            heeftGebruikt
              ? 'Je logt in met je bestaande e-mailadres en wachtwoord.'
              : 'Het wachtwoord krijg je apart van ons doorgestuurd.',
          ].join('\n'),
        })
        mailStatus = res.ok ? 'verstuurd' : `mail mislukt: ${res.error}`
      }

      const meta = requestMeta(req)
      await logAudit({
        action: 'kantoor.lid.invite', entityType: 'kantoor_bedrijf', entityId: bedrijfId,
        // Het wachtwoord zelf komt hier NOOIT in — enkel dát er één gezet is.
        summary: `Kantoor: ${email} toegang gegeven tot ${bedrijfNaam}${wachtwoordGezet ? ' (wachtwoord ingesteld)' : ''}`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
        ip: meta.ip, userAgent: meta.userAgent,
      })
      return NextResponse.json({
        ok: true, mailStatus, wachtwoordGezet,
        bestaandAccount: heeftGebruikt,
      })
    }

    /**
     * ── Wachtwoord (opnieuw) instellen ───────────────────────────────────────
     *
     * Voor wie zijn wachtwoord kwijt is, of voor een lid dat nog uit de oude
     * uitnodigingsflow komt. Bij een account dat AL gebruikt wordt, vragen we
     * eerst een uitdrukkelijke bevestiging: dan zet je iemand buiten tot je hem
     * het nieuwe wachtwoord bezorgt.
     */
    if (b.actie === 'wachtwoord') {
      const lidId = String(b.lid_id ?? '')
      const wachtwoord = String(b.wachtwoord ?? '')
      if (!lidId) return NextResponse.json({ error: 'Kies eerst een lid.' }, { status: 400 })
      if (wachtwoord.length < MIN_WACHTWOORD) {
        return NextResponse.json({ error: `Een wachtwoord van minstens ${MIN_WACHTWOORD} tekens, graag.` }, { status: 400 })
      }

      const { data: lid } = await admin.from('kantoor_leden')
        .select('id, email, auth_user_id').eq('id', lidId).maybeSingle()
      if (!lid) return NextResponse.json({ error: 'Dit lid bestaat niet (meer).' }, { status: 404 })
      const l = lid as { id: string; email: string; auth_user_id: string | null }

      const bestaand = await zoekAuthGebruiker(admin, l.email)
      const heeftGebruikt = !!bestaand && (!!bestaand.last_sign_in_at || !!bestaand.email_confirmed_at)
      if (heeftGebruikt && !b.bevestigd) {
        return NextResponse.json({
          error: 'Dit account is al in gebruik. Een nieuw wachtwoord sluit deze persoon buiten tot je het doorgeeft — bevestig als je dat wil.',
          bevestigingNodig: true,
        }, { status: 409 })
      }

      if (bestaand) {
        const { error: zetErr } = await admin.auth.admin.updateUserById(bestaand.id, {
          password: wachtwoord, email_confirm: true,
        })
        if (zetErr) return NextResponse.json({ error: `Wachtwoord instellen mislukt: ${zetErr.message}` }, { status: 400 })
        if (!l.auth_user_id) await admin.from('kantoor_leden').update({ auth_user_id: bestaand.id }).eq('id', l.id)
      } else {
        const { data: gemaakt, error: maakErr } = await admin.auth.admin.createUser({
          email: l.email, password: wachtwoord, email_confirm: true,
        })
        if (maakErr || !gemaakt?.user) {
          return NextResponse.json({ error: `Account aanmaken mislukt: ${maakErr?.message ?? 'onbekend'}` }, { status: 400 })
        }
        await admin.from('kantoor_leden').update({ auth_user_id: gemaakt.user.id }).eq('id', l.id)
      }

      const meta = requestMeta(req)
      await logAudit({
        action: 'kantoor.lid.wachtwoord', entityType: 'kantoor_lid', entityId: l.id,
        summary: `Kantoor: wachtwoord ingesteld voor ${l.email}`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
        ip: meta.ip, userAgent: meta.userAgent,
      })
      return NextResponse.json({ ok: true })
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
