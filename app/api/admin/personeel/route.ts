import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, magFinancieel, magGevoelig, laadTarieven, audit, BUCKET } from '@/lib/personeel/server'
import { bouwDashboard, type DSessie, type DPlanning } from '@/lib/personeel/dashboard'
import { isMedewerkerType } from '@/lib/personeel/model'
import { dagBrussel, periodeBereik, plusDagen } from '@/lib/personeel/tijd'
import { tekst, dagOf, getal } from '@/lib/personeel/invoer'
import type { Tarief } from '@/lib/personeel/kost'
import { dossierVoorWerknemer } from '@/lib/personeel/koppeling'

export const dynamic = 'force-dynamic'

/**
 * GET ?van&tot — het personeelsoverzicht: per medewerker de uren (gewerkt,
 * goedgekeurd, gepland), het eerstvolgende werkmoment, wat nog open staat en —
 * enkel met rechten op Financiën — de personeelskost in de periode.
 */
export async function GET(req: NextRequest) {
  try {
    const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
    const { admin, persoon } = g
    const sp = req.nextUrl.searchParams
    const vandaag = dagBrussel(new Date())
    const std = periodeBereik('maand', vandaag)
    const van = dagOf(sp.get('van')) ?? std.van, tot = dagOf(sp.get('tot')) ?? std.tot
    const financieel = await magFinancieel(persoon)

    const [{ data: mensen, error }, { data: sessies }, { data: planning }, { data: volgende }, { data: openS }, { data: openB }] = await Promise.all([
      admin.from('personeel').select('id, voornaam, achternaam, email, telefoon, type, functie, afdeling, actief, profielfoto_pad, account_status, startdatum, einddatum, created_at, auth_user_id').order('voornaam'),
      admin.from('personeel_sessies').select('id, personeel_id, start_at, eind_at, pauzes, status, client_id, project, kost_bedrag').gte('start_at', `${plusDagen(van, -1)}T00:00:00Z`).lte('start_at', `${plusDagen(tot, 1)}T23:59:59Z`).limit(5000),
      admin.from('personeel_planning').select('id, personeel_id, datum, start_tijd, eind_tijd, status, client_id, project').gte('datum', van).lte('datum', tot).limit(5000),
      admin.from('personeel_planning').select('personeel_id, datum, start_tijd, eind_tijd, project, taak').gte('datum', vandaag).neq('status', 'geannuleerd').order('datum').order('start_tijd').limit(500),
      admin.from('personeel_sessies').select('personeel_id, status').in('status', ['ingediend', 'correctie_gevraagd', 'actief']).limit(2000),
      admin.from('personeel_beschikbaarheid').select('personeel_id').eq('status', 'ingediend').limit(2000),
    ])
    if (error) throw new Error(error.message)
    const lijst = (mensen ?? []) as Record<string, unknown>[]

    const tarieven = new Map<string, Tarief[]>()
    if (financieel) for (const m of lijst) tarieven.set(String(m.id), await laadTarieven(admin, String(m.id)))

    const d = bouwDashboard({
      medewerkers: lijst.map((m) => ({ id: String(m.id), naam: String(m.voornaam), type: String(m.type), actief: m.actief !== false })),
      tarieven, sessies: (sessies ?? []) as DSessie[], planning: (planning ?? []) as DPlanning[], periode: { van, tot },
    })
    const perM = new Map(d.perMedewerker.map((r) => [r.sleutel, r]))
    const eerst = new Map<string, Record<string, unknown>>()
    const nuUur = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
    for (const p of (volgende ?? []) as Record<string, string>[]) {
      if (eerst.has(p.personeel_id)) continue
      if (p.datum === vandaag && p.eind_tijd.slice(0, 5) < nuUur) continue
      eerst.set(p.personeel_id, p)
    }
    const open = new Map<string, { uren: number; beschikbaar: number; actief: boolean }>()
    const o = (id: string) => { let x = open.get(id); if (!x) { x = { uren: 0, beschikbaar: 0, actief: false }; open.set(id, x) } return x }
    for (const s of (openS ?? []) as { personeel_id: string; status: string }[]) { if (s.status === 'actief') o(s.personeel_id).actief = true; else o(s.personeel_id).uren++ }
    for (const b of (openB ?? []) as { personeel_id: string }[]) o(b.personeel_id).beschikbaar++

    const paden = lijst.map((m) => m.profielfoto_pad).filter(Boolean) as string[]
    const { data: urls } = paden.length ? await admin.storage.from(BUCKET).createSignedUrls(paden, 3600) : { data: [] }
    const fotoUrl = new Map(((urls ?? []) as { path: string | null; signedUrl: string }[]).map((u) => [u.path ?? '', u.signedUrl]))

    const medewerkers = lijst.map((m) => {
      const r = perM.get(String(m.id))
      const op = open.get(String(m.id))
      return {
        ...m,
        foto_url: m.profielfoto_pad ? fotoUrl.get(String(m.profielfoto_pad)) ?? null : null,
        uren: r?.uren ?? 0, goedgekeurd: r?.goedgekeurd ?? 0, gepland: r?.gepland ?? 0,
        kost: financieel ? (r?.kostWerkelijk ?? 0) : null,
        kostVerwacht: financieel ? (r?.kostVerwacht ?? 0) : null,
        volgende: eerst.get(String(m.id)) ?? null,
        openUren: op?.uren ?? 0, openBeschikbaar: op?.beschikbaar ?? 0, actiefIngeklokt: op?.actief ?? false,
      }
    })
    // Interne werknemers (logins met modules) zonder personeelsdossier.
    const { data: staff } = await admin.from('staff_members').select('id, name, email, auth_user_id, active, verwijderd_at').is('verwijderd_at', null)
    const gekoppeld = new Set(lijst.map((m) => (m as { auth_user_id?: string | null }).auth_user_id).filter(Boolean))
    const zonderDossier = ((staff ?? []) as { id: string; name: string | null; email: string | null; auth_user_id: string | null; active: boolean }[])
      .filter((x) => x.auth_user_id && !gekoppeld.has(x.auth_user_id)).map((x) => ({ id: x.id, naam: x.name, email: x.email, actief: x.active !== false }))
    return NextResponse.json({ medewerkers, zonderDossier, van, tot, magFinancieel: financieel, magGevoelig: await magGevoelig(persoon) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** POST — een nieuwe medewerker (dossier) aanmaken. Enkel de naam is verplicht. */
export async function POST(req: NextRequest) {
  try {
    const g = await eisPersoneel('toevoegen'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    // Dossier voor een bestaande werknemer (zelfde login, geen tweede account).
    if (typeof b.staff_id === 'string') {
      const { data: st } = await g.admin.from('staff_members').select('id, auth_user_id, email, name, voornaam, achternaam, functie, active, verwijderd_at').eq('id', b.staff_id).maybeSingle()
      if (!st) return NextResponse.json({ error: 'Werknemer niet gevonden' }, { status: 404 })
      const r = await dossierVoorWerknemer(g.admin, st, g.persoon.email)
      if (!r) return NextResponse.json({ error: 'Deze werknemer heeft geen login om te koppelen.' }, { status: 400 })
      await audit(g.admin, { personeel_id: r.id, entiteit: 'account', entiteit_id: r.id, actie: r.nieuw ? 'dossier_voor_werknemer' : 'login_gekoppeld', nieuw: { werknemer: st.email }, actor_email: g.persoon.email, actor_id: g.persoon.userId })
      return NextResponse.json({ ok: true, id: r.id })
    }
    const voornaam = tekst(b.voornaam, 80)
    if (!voornaam) return NextResponse.json({ error: 'Vul minstens een voornaam in.' }, { status: 400 })
    const type = isMedewerkerType(b.type) ? b.type : 'werknemer'
    const rij = {
      voornaam, achternaam: tekst(b.achternaam, 120), email: tekst(b.email, 200)?.toLowerCase() ?? null, telefoon: tekst(b.telefoon, 50),
      type, functie: tekst(b.functie, 120), afdeling: tekst(b.afdeling, 120), contracttype: tekst(b.contracttype, 120),
      startdatum: dagOf(b.startdatum), einddatum: dagOf(b.einddatum), actief: b.actief !== false,
      max_uren_dag: getal(b.max_uren_dag), max_uren_week: getal(b.max_uren_week), max_uren_maand: getal(b.max_uren_maand),
      created_by: g.persoon.email,
    }
    const { data, error } = await g.admin.from('personeel').insert(rij).select('id').single()
    if (error) throw new Error(error.message)
    await audit(g.admin, { personeel_id: data.id, entiteit: 'medewerker', entiteit_id: data.id, actie: 'aangemaakt', nieuw: rij, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
