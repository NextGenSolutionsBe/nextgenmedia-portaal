import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { decryptSecret } from '@/lib/crypto'
import { eisPersoneel, magFinancieel, magGevoelig, laadTarieven, audit, BUCKET, type Admin } from '@/lib/personeel/server'
import { isMedewerkerType } from '@/lib/personeel/model'
import { kostPer, uurOpbouw } from '@/lib/personeel/kost'
import { dagBrussel, plusDagen } from '@/lib/personeel/tijd'
import { tekst, dagOf, getal, isUuid, verschillen } from '@/lib/personeel/invoer'
import { internAccount } from '@/lib/personeel/koppeling'

export const dynamic = 'force-dynamic'

const GEVOELIGE_MAPPEN = ['identiteit', 'payroll']


/**
 * Historiek die een definitieve verwijdering blokkeert: gewerkte uren,
 * geboekte kosten en planning. Zolang daar iets van bestaat, kan een
 * medewerker enkel op inactief — de geschiedenis moet blijven kloppen.
 */
async function telHistoriek(admin: Admin, id: string): Promise<{ sessies: number; kostenposten: number; planning: number }> {
  const tel = async (tabel: string) => {
    const { count, error } = await admin.from(tabel).select('id', { count: 'exact', head: true }).eq('personeel_id', id)
    // Bij een fout (tabel ontbreekt, …) liever blokkeren dan per ongeluk verwijderen.
    return error ? 1 : (count ?? 0)
  }
  const [sessies, kostenposten, planning] = await Promise.all([tel('personeel_sessies'), tel('personeel_kostenposten'), tel('personeel_planning')])
  return { sessies, kostenposten, planning }
}

/**
 * GET — het volledige dossier. Wat je krijgt hangt af van je rechten:
 * gevoelige persoonsgegevens en de documentmappen identiteit/payroll enkel met
 * instellingenrecht op Personeel; tarieven en kosten enkel met Financiën.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
    const { admin, persoon } = g
    const [financieel, gevoelig] = await Promise.all([magFinancieel(persoon), magGevoelig(persoon)])
    const { data: p } = await admin.from('personeel').select('*').eq('id', id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Medewerker niet gevonden' }, { status: 404 })

    const vandaag = dagBrussel(new Date())
    const van = plusDagen(vandaag, -120), tot = plusDagen(vandaag, 120)
    const sessieKol = financieel ? '*' : 'id, personeel_id, start_at, eind_at, pauzes, pauze_actief_sinds, status, client_id, opdracht_id, project, taak, planning_id, verslag, links, admin_opmerking, correctie_vraag, beoordeeld_door, beoordeeld_op, bron, created_at'
    const [gev, docs, sessies, planning, beschikbaar, logboek, posten] = await Promise.all([
      gevoelig ? admin.from('personeel_gevoelig').select('*').eq('personeel_id', id).maybeSingle() : Promise.resolve({ data: null }),
      admin.from('personeel_documenten').select('*').eq('personeel_id', id).order('created_at', { ascending: false }),
      admin.from('personeel_sessies').select(sessieKol).eq('personeel_id', id).gte('start_at', `${van}T00:00:00Z`).order('start_at', { ascending: false }).limit(500),
      admin.from('personeel_planning').select('*').eq('personeel_id', id).gte('datum', van).lte('datum', tot).order('datum').order('start_tijd'),
      admin.from('personeel_beschikbaarheid').select('*').eq('personeel_id', id).gte('datum', van).lte('datum', tot).order('datum').order('start_tijd'),
      admin.from('personeel_audit').select('id, entiteit, entiteit_id, actie, oud, nieuw, reden, actor_email, created_at').eq('personeel_id', id).order('created_at', { ascending: false }).limit(300),
      financieel ? admin.from('personeel_kostenposten').select('*').eq('personeel_id', id).order('periode', { ascending: false }).order('versie', { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    ])

    // Documenten: gevoelige mappen enkel voor bevoegden; tijdelijke links (1 uur).
    const zichtbareDocs = ((docs.data ?? []) as Record<string, unknown>[]).filter((d) => gevoelig || !GEVOELIGE_MAPPEN.includes(String(d.map)))
    const paden = [...zichtbareDocs.map((d) => String(d.pad)), ...(p.profielfoto_pad ? [String(p.profielfoto_pad)] : [])]
    const { data: urls } = paden.length ? await admin.storage.from(BUCKET).createSignedUrls(paden, 3600) : { data: [] }
    const url = new Map(((urls ?? []) as { path: string | null; signedUrl: string }[]).map((u) => [u.path ?? '', u.signedUrl]))

    // Audit: bij gevoelige wijzigingen staan er nooit waarden in; kostenwijzigingen enkel met Financiën.
    const log = ((logboek.data ?? []) as Record<string, unknown>[]).filter((r) => financieel || !['tarief', 'kostenpost'].includes(String(r.entiteit)))
    const tarieven = financieel ? (await laadTarieven(admin, id)).map((t) => ({ ...t, opbouw: uurOpbouw(t), per: kostPer(t, Math.max(1, (p.standaard_werkdagen ?? []).length || 5)) })) : null

    const g2 = gev.data as Record<string, unknown> | null
    return NextResponse.json({
      historiek: await telHistoriek(admin, id),
      medewerker: { ...p, interne_notities: p.interne_notities, foto_url: p.profielfoto_pad ? url.get(String(p.profielfoto_pad)) ?? null : null },
      gevoelig: gevoelig ? {
        adres: g2?.adres ?? null, geboortedatum: g2?.geboortedatum ?? null, noodcontact: g2?.noodcontact ?? null,
        rijksregisternummer: g2?.rijksregisternummer_enc ? decryptSecret(String(g2.rijksregisternummer_enc)) : null,
        iban: g2?.iban_enc ? decryptSecret(String(g2.iban_enc)) : null,
      } : null,
      documenten: zichtbareDocs.map((d) => ({ ...d, url: url.get(String(d.pad)) ?? null })),
      verborgenDocumenten: ((docs.data ?? []) as unknown[]).length - zichtbareDocs.length,
      sessies: sessies.data ?? [], planning: planning.data ?? [], beschikbaarheid: beschikbaar.data ?? [],
      logboek: log, tarieven, kostenposten: posten.data ?? [],
      intern: await internAccount(admin, { auth_user_id: p.auth_user_id ?? null, email: p.email ?? null }),
      magFinancieel: financieel, magGevoelig: gevoelig,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** PATCH — werkgegevens en contactgegevens aanpassen (gevoelige gegevens: zie /gevoelig). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const { data: oud } = await g.admin.from('personeel').select('*').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Medewerker niet gevonden' }, { status: 404 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    const zet = (k: string, v: unknown) => { if (k in b) patch[k] = v }
    if ('voornaam' in b) { const v = tekst(b.voornaam, 80); if (!v) return NextResponse.json({ error: 'De voornaam mag niet leeg zijn.' }, { status: 400 }); patch.voornaam = v }
    zet('achternaam', tekst(b.achternaam, 120))
    zet('email', tekst(b.email, 200)?.toLowerCase() ?? null)
    zet('telefoon', tekst(b.telefoon, 50))
    if ('type' in b) { if (!isMedewerkerType(b.type)) return NextResponse.json({ error: 'Onbekend type medewerker.' }, { status: 400 }); patch.type = b.type }
    zet('functie', tekst(b.functie, 120)); zet('afdeling', tekst(b.afdeling, 120)); zet('contracttype', tekst(b.contracttype, 120))
    zet('startdatum', dagOf(b.startdatum)); zet('einddatum', dagOf(b.einddatum))
    if ('actief' in b) patch.actief = b.actief !== false
    zet('verantwoordelijke', tekst(b.verantwoordelijke, 120))
    if ('standaard_werkdagen' in b) patch.standaard_werkdagen = Array.isArray(b.standaard_werkdagen) ? [...new Set((b.standaard_werkdagen as unknown[]).map(Number).filter((n) => n >= 1 && n <= 7))].sort() : []
    zet('max_uren_dag', getal(b.max_uren_dag)); zet('max_uren_week', getal(b.max_uren_week)); zet('max_uren_maand', getal(b.max_uren_maand))
    zet('interne_notities', tekst(b.interne_notities, 5000))
    if (!Object.keys(patch).length) return NextResponse.json({ ok: true })
    // Het e-mailadres van een bestaande login wijzigen we niet stilletjes: dat moet via het account.
    if ('email' in patch && oud.auth_user_id && patch.email !== oud.email) return NextResponse.json({ error: 'Deze medewerker heeft al een login. Wijzig het e-mailadres via het tabblad Account.' }, { status: 409 })
    patch.updated_at = new Date().toISOString()
    const { error } = await g.admin.from('personeel').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    const v = verschillen(oud, patch)
    if (v) {
      delete v.oud.updated_at; delete v.nieuw.updated_at
      await audit(g.admin, { personeel_id: id, entiteit: 'medewerker', entiteit_id: id, actie: 'gewijzigd', oud: v.oud, nieuw: v.nieuw, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * DELETE { bevestig_naam } — dossier definitief verwijderen. Enkel wanneer er
 * nog geen uren, kostenposten of planning bestaan; anders 409 (op inactief
 * zetten via PATCH blijft dan de enige weg). Documenten en profielfoto gaan
 * mee uit de opslag. Een login die enkel voor dit dossier werd aangemaakt,
 * wordt mee verwijderd; een interne (werknemers)login blijft altijd bestaan.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('verwijderen'); if (!g.ok) return g.response
    const { admin } = g
    const { data: p } = await admin.from('personeel').select('*').eq('id', id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Medewerker niet gevonden' }, { status: 404 })

    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const naam = [p.voornaam, p.achternaam].filter(Boolean).join(' ').trim().toLowerCase()
    if (String(b.bevestig_naam ?? '').trim().toLowerCase() !== naam) {
      return NextResponse.json({ error: 'De ingetypte naam komt niet overeen.' }, { status: 400 })
    }

    const h = await telHistoriek(admin, id)
    if (h.sessies || h.kostenposten || h.planning) {
      return NextResponse.json({ error: 'Deze medewerker heeft al uren, kostenposten of planning. Zet het dossier op inactief; de historiek moet bewaard blijven.', historiek: h }, { status: 409 })
    }

    // Bestanden verzamelen vóór de rij (en via cascade de documenten) verdwijnt.
    const { data: docs } = await admin.from('personeel_documenten').select('pad').eq('personeel_id', id)
    const paden = [...((docs ?? []) as { pad: string | null }[]).map((d) => d.pad).filter((x): x is string => !!x), ...(p.profielfoto_pad ? [String(p.profielfoto_pad)] : [])]

    // Login: enkel verwijderen als ze uitsluitend voor dit dossier bestaat.
    let loginVerwijderd = false
    if (p.auth_user_id) {
      const uid = String(p.auth_user_id)
      const [{ gekoppeld }, { data: rol }, { data: u }] = await Promise.all([
        internAccount(admin, { auth_user_id: uid, email: p.email ?? null }),
        admin.from('user_roles').select('role').eq('user_id', uid).maybeSingle(),
        admin.auth.admin.getUserById(uid),
      ])
      const enkelDitDossier = !gekoppeld && !rol && String(u?.user?.user_metadata?.personeel_id ?? '') === id
      if (enkelDitDossier) {
        const { error: delErr } = await admin.auth.admin.deleteUser(uid)
        if (delErr) throw new Error(`Login verwijderen mislukt: ${delErr.message}`)
        loginVerwijderd = true
      }
    }

    const { error } = await admin.from('personeel').delete().eq('id', id)
    if (error) throw new Error(error.message)
    if (paden.length) { try { await admin.storage.from(BUCKET).remove(paden) } catch { /* best effort */ } }

    await audit(admin, {
      personeel_id: id, entiteit: 'medewerker', entiteit_id: id, actie: 'dossier_verwijderd',
      oud: { naam: [p.voornaam, p.achternaam].filter(Boolean).join(' '), type: p.type, email: p.email ?? null },
      nieuw: { documenten: (docs ?? []).length, login_verwijderd: loginVerwijderd },
      actor_email: g.persoon.email, actor_id: g.persoon.userId,
    })
    return NextResponse.json({ ok: true, loginVerwijderd })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
