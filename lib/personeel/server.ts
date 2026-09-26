import 'server-only'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, getSessionUser } from '@/lib/supabase/server'
import { magIk, leesPersoon, type IngelogdePersoon } from '@/lib/instellingen/laden'
import { sendEmail, baseUrl } from '@/lib/email'
import type { Actie } from '@/lib/instellingen/model'
import { normaliseerTarief, periodeKost, type Tarief, type Werkstuk } from './kost'
import { besluitBoeking, bronSleutel, boekdatum, kostNaam, type ActuelePost } from './kostenposten'
import { dagBrussel, gewerkteMinuten, type Pauze } from './tijd'
import { normaliseerMeldingInstellingen, type MeldingEvent, type MeldingInstellingen } from './model'

/**
 * Serverlaag van Personeel. Twee ingangen, strikt gescheiden:
 *  · beheer  (/api/admin/personeel) — via de rechtenmatrix (module 'personeel');
 *    financiële gegevens enkel met rechten op Financiën, gevoelige
 *    persoonsgegevens enkel met instellingenrecht op Personeel.
 *  · team    (/api/team) — de ingelogde medewerker, uitsluitend eigen data.
 */

export type Admin = ReturnType<typeof createAdminSupabaseClient>
export const BUCKET = 'personeel'

// ── Beheer: rechten ──────────────────────────────────────────────────────────

type Guard = { ok: true; persoon: IngelogdePersoon; admin: Admin } | { ok: false; response: NextResponse }

export async function eisPersoneel(actie: Actie): Promise<Guard> {
  const persoon = await magIk('personeel', actie)
  if (!persoon) return { ok: false, response: NextResponse.json({ error: actie === 'bekijken' ? 'Geen toegang tot Personeel.' : 'Je hebt hiervoor geen recht in Personeel.' }, { status: 403 }) }
  return { ok: true, persoon, admin: createAdminSupabaseClient() }
}

/** Mag deze persoon lonen, tarieven en personeelskosten zien? */
export async function magFinancieel(persoon: IngelogdePersoon | null): Promise<boolean> {
  if (!persoon) return false
  if (persoon.isAdmin) return true
  return !!(await magIk('finance', 'bekijken'))
}

/** Mag deze persoon gevoelige persoonsgegevens (rijksregister, IBAN, adres…) zien? */
export async function magGevoelig(persoon: IngelogdePersoon | null): Promise<boolean> {
  if (!persoon) return false
  if (persoon.isAdmin) return true
  return !!(await magIk('personeel', 'instellingen'))
}

export async function eisFinancieel(): Promise<Guard> {
  const g = await eisPersoneel('bekijken'); if (!g.ok) return g
  if (!(await magFinancieel(g.persoon))) return { ok: false, response: NextResponse.json({ error: 'Financiële personeelsgegevens zijn enkel zichtbaar met rechten op Financiën.' }, { status: 403 }) }
  return g
}

// ── Team: de ingelogde medewerker ────────────────────────────────────────────

export type TeamLid = { id: string; voornaam: string; achternaam: string | null; email: string | null; type: string; functie: string | null; profielfoto_pad: string | null; auth_user_id: string }

/**
 * De medewerker achter de sessie. Enkel actieve medewerkers met een niet-
 * geblokkeerde login. Staat de koppeling nog op e-mailadres (uitnodiging net
 * aanvaard), dan leggen we ze hier bij het eerste bezoek.
 */
export async function leesTeamLid(): Promise<TeamLid | null> {
  const user = await getSessionUser()
  if (!user) return null
  const admin = createAdminSupabaseClient()
  const kol = 'id, voornaam, achternaam, email, type, functie, profielfoto_pad, auth_user_id, actief, account_status'
  let { data } = await admin.from('personeel').select(kol).eq('auth_user_id', user.id).maybeSingle()
  if (!data && user.email) {
    const { data: opEmail } = await admin.from('personeel').select(kol).ilike('email', user.email).is('auth_user_id', null).maybeSingle()
    if (opEmail && opEmail.account_status !== 'geblokkeerd') {
      await admin.from('personeel').update({ auth_user_id: user.id, account_status: 'actief', updated_at: new Date().toISOString() }).eq('id', opEmail.id)
      data = { ...opEmail, auth_user_id: user.id, account_status: 'actief' }
    }
  }
  if (!data || data.actief === false || data.account_status === 'geblokkeerd') return null
  if (data.account_status === 'uitgenodigd') await admin.from('personeel').update({ account_status: 'actief' }).eq('id', data.id)
  return data as TeamLid
}

type TeamGuard = { ok: true; lid: TeamLid; admin: Admin } | { ok: false; response: NextResponse }
export async function eisTeamLid(): Promise<TeamGuard> {
  const lid = await leesTeamLid()
  if (!lid) return { ok: false, response: NextResponse.json({ error: 'Geen toegang.' }, { status: 403 }) }
  return { ok: true, lid, admin: createAdminSupabaseClient() }
}

// ── Audit ────────────────────────────────────────────────────────────────────

export async function audit(admin: Admin, r: {
  personeel_id: string | null; entiteit: string; entiteit_id?: string | null; actie: string
  oud?: unknown; nieuw?: unknown; reden?: string | null; actor_email?: string | null; actor_id?: string | null
}): Promise<void> {
  try {
    await admin.from('personeel_audit').insert({
      personeel_id: r.personeel_id, entiteit: r.entiteit, entiteit_id: r.entiteit_id ?? null, actie: r.actie,
      oud: r.oud ?? null, nieuw: r.nieuw ?? null, reden: r.reden ?? null, actor_email: r.actor_email ?? null, actor_id: r.actor_id ?? null,
    })
  } catch (e) { console.error('[personeel-audit]', e instanceof Error ? e.message : e) }
}

// ── Tarieven en kosten ───────────────────────────────────────────────────────

export async function laadTarieven(admin: Admin, personeelId: string): Promise<Tarief[]> {
  const { data } = await admin.from('personeel_tarieven').select('*').eq('personeel_id', personeelId).order('geldig_vanaf', { ascending: true })
  return ((data ?? []) as Record<string, unknown>[]).map(normaliseerTarief)
}

type SessieRij = { id: string; start_at: string; eind_at: string | null; pauzes: Pauze[] | null; status: string; kost_bedrag: number | null; client_id: string | null; project: string | null }

/** Goedgekeurde sessies van een maand als werkstukken (met hun vastgelegde kost). */
export async function goedgekeurdeWerkstukken(admin: Admin, personeelId: string, periode: string): Promise<{ werk: Werkstuk[]; ids: string[] }> {
  const van = `${periode}-01`
  const tot = boekdatum(periode)
  // Ruim ophalen (een dag rond de grenzen), daarna exact op Brusselse dag filteren.
  const { data } = await admin.from('personeel_sessies').select('id, start_at, eind_at, pauzes, status, kost_bedrag, client_id, project')
    .eq('personeel_id', personeelId).eq('status', 'goedgekeurd')
    .gte('start_at', `${van}T00:00:00Z`).lte('start_at', `${tot}T23:59:59Z`)
  const werk: Werkstuk[] = []
  const ids: string[] = []
  for (const s of (data ?? []) as SessieRij[]) {
    const dag = dagBrussel(s.start_at)
    if (dag.slice(0, 7) !== periode) continue
    ids.push(s.id)
    werk.push({ dag, minuten: gewerkteMinuten(s), vasteKost: s.kost_bedrag === null ? null : Number(s.kost_bedrag), ref: s.id, client_id: s.client_id, project: s.project })
  }
  return { werk, ids }
}

/**
 * De definitieve personeelskost van één maand (her)boeken in Financiën.
 * Idempotent: zelfde bedrag = geen boeking; ander bedrag = nieuwe versie en de
 * kost in Financiën wordt bijgewerkt; nul = de kost wordt ingetrokken. Elke
 * versie blijft bewaard, zodat een correctie altijd terug te vinden is.
 */
export async function herboekMaand(admin: Admin, personeelId: string, periode: string, actor: string | null, reden: string): Promise<{ actie: string; verschil?: number }> {
  const [{ data: p }, tarieven, { werk, ids }] = await Promise.all([
    admin.from('personeel').select('voornaam, achternaam').eq('id', personeelId).maybeSingle(),
    laadTarieven(admin, personeelId),
    goedgekeurdeWerkstukken(admin, personeelId, periode),
  ])
  const naam = [p?.voornaam, p?.achternaam].filter(Boolean).join(' ') || 'Medewerker'
  const kost = periodeKost(tarieven, werk, { van: `${periode}-01`, tot: boekdatum(periode) })
  const { data: act } = await admin.from('personeel_kostenposten').select('id, versie, bedrag, uren, cost_entry_id')
    .eq('personeel_id', personeelId).eq('periode', periode).eq('soort', 'definitief').eq('actueel', true).maybeSingle()
  const actueel: ActuelePost | null = act ? { id: act.id, versie: Number(act.versie), bedrag: Number(act.bedrag), uren: Number(act.uren), cost_entry_id: act.cost_entry_id } : null
  const besluit = besluitBoeking(kost, actueel)
  if (besluit.actie === 'geen') return { actie: 'geen' }

  const sleutel = bronSleutel(personeelId, periode)
  const btwPct = tarieven.length ? tarieven[tarieven.length - 1].btw_pct : 0
  const notitie = `Automatisch uit Personeel: ${kost.uren} goedgekeurde uren, ${kost.dagen} gewerkte dagen. Opbouw: ${kost.regels.map((r) => `${r.label} € ${r.bedrag.toFixed(2)}`).join('; ')}.`

  if (besluit.actie === 'intrekken') {
    await admin.from('personeel_kostenposten').update({ actueel: false }).eq('id', besluit.vorigeId)
    const { data: nieuw } = await admin.from('personeel_kostenposten').insert({
      personeel_id: personeelId, periode, soort: 'definitief', bedrag: 0, uren: 0, berekening: kost, sessie_ids: ids,
      versie: (actueel?.versie ?? 0) + 1, actueel: true, vorige_id: besluit.vorigeId, verschil: besluit.verschil, reden, created_by: actor,
    }).select('id').single()
    if (nieuw) await admin.from('personeel_kostenposten').update({ vervangen_door: nieuw.id }).eq('id', besluit.vorigeId)
    await admin.from('cost_entries').delete().eq('bron_sleutel', sleutel)
    await audit(admin, { personeel_id: personeelId, entiteit: 'kostenpost', entiteit_id: periode, actie: 'kost_ingetrokken', oud: { bedrag: actueel?.bedrag }, nieuw: { bedrag: 0 }, reden, actor_email: actor })
    return { actie: 'intrekken', verschil: besluit.verschil }
  }

  // Kost in Financiën aanmaken of bijwerken (één rij per medewerker en maand).
  const kostRij = {
    name: kostNaam(naam, periode), category: 'Personeel', type: 'one_time', cost_date: boekdatum(periode), start_date: null, end_date: null,
    billing_frequency: 'monthly', amount_excl: besluit.bedrag, vat_pct: btwPct, notes: notitie, bron: 'personeel', bron_sleutel: sleutel,
  }
  const { data: bestaandeKost } = await admin.from('cost_entries').select('id').eq('bron_sleutel', sleutel).maybeSingle()
  let costId: string | null = bestaandeKost?.id ?? null
  if (costId) await admin.from('cost_entries').update(kostRij).eq('id', costId)
  else {
    const { data: ins, error } = await admin.from('cost_entries').insert(kostRij).select('id').single()
    if (error) throw new Error(`Kost boeken in Financiën mislukt: ${error.message}`)
    costId = ins.id
  }

  if (actueel) await admin.from('personeel_kostenposten').update({ actueel: false }).eq('id', actueel.id)
  const { data: post, error: postFout } = await admin.from('personeel_kostenposten').insert({
    personeel_id: personeelId, periode, soort: 'definitief', bedrag: besluit.bedrag, uren: besluit.uren, berekening: kost, sessie_ids: ids,
    versie: besluit.versie, actueel: true, vorige_id: actueel?.id ?? null, verschil: besluit.actie === 'correctie' ? besluit.verschil : besluit.bedrag,
    cost_entry_id: costId, reden, created_by: actor,
  }).select('id').single()
  if (postFout) throw new Error(`Kostenpost bewaren mislukt: ${postFout.message}`)
  if (actueel && post) await admin.from('personeel_kostenposten').update({ vervangen_door: post.id }).eq('id', actueel.id)
  await audit(admin, {
    personeel_id: personeelId, entiteit: 'kostenpost', entiteit_id: periode, actie: besluit.actie === 'nieuw' ? 'kost_geboekt' : 'kost_gecorrigeerd',
    oud: actueel ? { bedrag: actueel.bedrag, uren: actueel.uren, versie: actueel.versie } : null,
    nieuw: { bedrag: besluit.bedrag, uren: besluit.uren, versie: besluit.versie }, reden, actor_email: actor,
  })
  return { actie: besluit.actie, verschil: besluit.actie === 'correctie' ? besluit.verschil : besluit.bedrag }
}

// ── Meldingen ────────────────────────────────────────────────────────────────

export async function leesMeldingInstellingen(admin: Admin): Promise<MeldingInstellingen> {
  try {
    const { data } = await admin.from('app_settings').select('value').eq('key', 'personeel_meldingen').maybeSingle()
    return normaliseerMeldingInstellingen(data?.value)
  } catch { return normaliseerMeldingInstellingen(null) }
}

/**
 * Een melding: in-app (tabel personeel_meldingen) en/of e-mail, volgens de
 * instellingen per soort. personeel_id null = voor de admins. Een `sleutel`
 * voorkomt dat dezelfde herinnering twee keer vertrekt. Best-effort: een
 * mislukte melding breekt nooit de actie zelf.
 */
export async function meld(admin: Admin, m: { personeel_id: string | null; event: MeldingEvent; titel: string; tekst?: string; link?: string; sleutel?: string }): Promise<void> {
  try {
    const inst = (await leesMeldingInstellingen(admin))[m.event]
    if (inst.inapp) {
      const { error } = await admin.from('personeel_meldingen').insert({ personeel_id: m.personeel_id, event: m.event, titel: m.titel, tekst: m.tekst ?? null, link: m.link ?? null, sleutel: m.sleutel ?? null })
      if (error && /duplicate|unique/i.test(error.message)) return // al gemeld
    }
    if (!inst.email) return
    let naar: string | null = null
    if (m.personeel_id) {
      const { data } = await admin.from('personeel').select('email, account_status').eq('id', m.personeel_id).maybeSingle()
      if (data?.email && data.account_status !== 'geblokkeerd') naar = data.email
    } else {
      const { data } = await admin.from('app_settings').select('value').eq('key', 'organisatie').maybeSingle()
      naar = ((data?.value as { email?: string } | null)?.email) || process.env.ADMIN_NOTIFY_EMAIL || null
    }
    if (!naar) return
    const link = m.link ? `${baseUrl()}${m.link}` : null
    await sendEmail({ to: naar, subject: m.titel, text: [m.tekst ?? m.titel, link ? `\n${link}` : ''].join('\n') })
  } catch (e) { console.error('[personeel-melding]', e instanceof Error ? e.message : e) }
}

export { leesPersoon }
