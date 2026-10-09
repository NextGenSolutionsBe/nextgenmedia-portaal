import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesPersoon, magIk } from '@/lib/instellingen/laden'
import { magFinancieel, laadTarieven } from '@/lib/personeel/server'
import { safeMessage } from '@/lib/api-error'
import { tariefOp } from '@/lib/personeel/kost'
import { berekenVideoKost, berekeningTekst, leesUren, videoTarief, type VideoBerekening, type VideoTarief } from '@/lib/kosten/video-editing'

export const dynamic = 'force-dynamic'

/**
 * Kosten "Video editing student" — gekoppeld aan Personeel.
 *  GET                         → medewerkers en klanten (keuzelijsten)
 *  GET ?personeel_id&datum     → het tarief dat op die datum geldt (of null)
 *  POST                        → kost boeken met een momentopname van uren, tarieven en berekening
 *  PATCH                       → bewerken; rekent met de opgeslagen tarieven, tenzij uitdrukkelijk opnieuw opgehaald
 * Registreert kosten, voert geen betaling uit. Tarieven zijn financieel:
 * enkel hoofdbeheerders of wie Financiën mag bekijken.
 */

const ISO = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/i
const CATEGORIE = 'Video editing student'

async function toegang(schrijven: boolean) {
  const p = await leesPersoon()
  if (!p) return { fout: NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 }) }
  if (!(await magFinancieel(p))) return { fout: NextResponse.json({ error: 'Tarieven en kosten zijn enkel zichtbaar met rechten op Financiën.' }, { status: 403 }) }
  if (schrijven && !p.isAdmin && !(await magIk('finance', 'aanpassen'))) return { fout: NextResponse.json({ error: 'Je mag geen kosten boeken.' }, { status: 403 }) }
  return { p }
}

const naamVan = (m: { voornaam: string; achternaam: string | null }) => [m.voornaam, m.achternaam].filter(Boolean).join(' ')

export async function GET(req: NextRequest) {
  try {
    const t = await toegang(false); if (t.fout) return t.fout
    const admin = createAdminSupabaseClient()
    const pid = req.nextUrl.searchParams.get('personeel_id'), datum = req.nextUrl.searchParams.get('datum')
    if (pid) {
      if (!UUID.test(pid) || !datum || !ISO.test(datum)) return NextResponse.json({ error: 'Kies een medewerker en een datum.' }, { status: 400 })
      const tar = tariefOp(await laadTarieven(admin, pid), datum)
      return NextResponse.json({ tarief: tar ? videoTarief(tar) : null })
    }
    const [{ data: mensen }, { data: klanten }] = await Promise.all([
      admin.from('personeel').select('id, voornaam, achternaam, type, actief').order('voornaam'),
      admin.from('clients').select('id, company_name').is('archived_at', null).order('company_name'),
    ])
    return NextResponse.json({
      medewerkers: ((mensen ?? []) as { id: string; voornaam: string; achternaam: string | null; type: string; actief: boolean }[]).map((m) => ({ id: m.id, naam: naamVan(m), type: m.type, actief: m.actief !== false })),
      klanten: klanten ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

type Rij = Record<string, unknown>
function rij(b: VideoBerekening, naam: string, omschrijving: string, datum: string, clientId: string | null) {
  return {
    name: `${omschrijving || 'Video editing'} — ${naam} — ${String(b.uren).replace('.', ',')} u`, category: CATEGORIE, type: 'one_time', cost_date: datum,
    amount_excl: b.bedrag, vat_pct: b.btw_pct, notes: `${omschrijving || 'Video editing'}\n${berekeningTekst(b)}`, client_id: clientId,
    berekening: { ...b, naam, omschrijving: omschrijving || 'Video editing', datum },
  }
}

export async function POST(req: NextRequest) {
  try {
    const t = await toegang(true); if (t.fout) return t.fout
    const admin = createAdminSupabaseClient()
    const b = (await req.json().catch(() => ({}))) as Rij
    const pid = String(b.personeel_id ?? ''), datum = String(b.datum ?? ''), uren = leesUren(b.uren)
    const omschrijving = String(b.omschrijving ?? 'Video editing').trim().slice(0, 200) || 'Video editing'
    const clientId = typeof b.client_id === 'string' && UUID.test(b.client_id) ? b.client_id : null
    const sleutel = typeof b.sleutel === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(b.sleutel) ? b.sleutel : null
    if (!UUID.test(pid)) return NextResponse.json({ error: 'Kies een student of medewerker.' }, { status: 400 })
    if (!ISO.test(datum)) return NextResponse.json({ error: 'Kies de datum van de prestatie.' }, { status: 400 })
    if (uren === null) return NextResponse.json({ error: 'Geef het aantal uren (bv. 2,5), tussen 0 en 24.' }, { status: 400 })
    if (!sleutel) return NextResponse.json({ error: 'Ongeldige opslagactie — herlaad het venster.' }, { status: 400 })
    const bronSleutel = `video_editing:${sleutel}`
    const { data: al } = await admin.from('cost_entries').select('id').eq('bron_sleutel', bronSleutel).maybeSingle()
    if (al) return NextResponse.json({ ok: true, id: al.id, al_opgeslagen: true })   // dubbelklik: zelfde actie, geen tweede boeking

    const { data: m } = await admin.from('personeel').select('id, voornaam, achternaam').eq('id', pid).maybeSingle()
    if (!m) return NextResponse.json({ error: 'Medewerker niet gevonden.' }, { status: 404 })
    const naam = naamVan(m as { voornaam: string; achternaam: string | null })
    const tar = tariefOp(await laadTarieven(admin, pid), datum)
    if (!tar) return NextResponse.json({ error: `Voor ${naam} is op ${datum.split('-').reverse().join('/')} geen uurtarief ingevuld. Vul het eerst in bij Personeel → ${naam} → Tarief.`, code: 'geen_tarief' }, { status: 400 })
    const ber = berekenVideoKost(uren, videoTarief(tar))
    if (!(ber.bedrag > 0)) return NextResponse.json({ error: `Het uurtarief van ${naam} staat op € 0. Vul het tarief aan bij Personeel.`, code: 'geen_tarief' }, { status: 400 })

    // Mogelijke dubbele boeking: zelfde student, datum en uren.
    if (b.bevestig_dubbel !== true) {
      const { data: zelfde } = await admin.from('cost_entries').select('id, berekening').eq('bron', 'video_editing').eq('personeel_id', pid).eq('cost_date', datum)
      if (((zelfde ?? []) as { berekening: { uren?: number } | null }[]).some((x) => Number(x.berekening?.uren) === uren)) return NextResponse.json({ error: `Er staat al ${uren} u video editing voor ${naam} op deze datum. Toch nog een keer boeken?`, code: 'mogelijk_dubbel' }, { status: 409 })
    }
    const { data, error } = await admin.from('cost_entries').insert({ ...rij(ber, naam, omschrijving, datum, clientId), personeel_id: pid, bron: 'video_editing', bron_sleutel: bronSleutel, created_by: t.p!.userId }).select('id').single()
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) { const { data: x } = await admin.from('cost_entries').select('id').eq('bron_sleutel', bronSleutel).maybeSingle(); if (x) return NextResponse.json({ ok: true, id: x.id, al_opgeslagen: true }) }
      throw new Error(/personeel_id|berekening|client_id/.test(error.message) ? 'De databank is nog niet bijgewerkt voor studentenkosten.' : error.message)
    }
    try { revalidatePath('/admin/revenue/kosten'); revalidatePath('/admin/revenue') } catch { }
    return NextResponse.json({ ok: true, id: data.id, berekening: ber })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const t = await toegang(true); if (t.fout) return t.fout
    const admin = createAdminSupabaseClient()
    const b = (await req.json().catch(() => ({}))) as Rij
    const id = String(b.id ?? '')
    if (!UUID.test(id)) return NextResponse.json({ error: 'Onbekende kost.' }, { status: 400 })
    const { data: k } = await admin.from('cost_entries').select('*').eq('id', id).maybeSingle()
    if (!k || k.bron !== 'video_editing') return NextResponse.json({ error: 'Deze kost is geen video editing-kost.' }, { status: 400 })
    const oud = (k.berekening ?? {}) as Partial<VideoBerekening> & { naam?: string; omschrijving?: string }
    const datum = ISO.test(String(b.datum ?? '')) ? String(b.datum) : String(k.cost_date).slice(0, 10)
    const uren = b.uren === undefined ? Number(oud.uren) : leesUren(b.uren)
    if (uren === null || !(uren > 0)) return NextResponse.json({ error: 'Geef het aantal uren (bv. 2,5), tussen 0 en 24.' }, { status: 400 })
    const omschrijving = b.omschrijving === undefined ? (oud.omschrijving ?? 'Video editing') : (String(b.omschrijving).trim().slice(0, 200) || 'Video editing')
    const clientId = b.client_id === undefined ? (k.client_id ?? null) : (typeof b.client_id === 'string' && UUID.test(b.client_id) ? b.client_id : null)
    // Momentopname: standaard de opgeslagen tarieven. Enkel op uitdrukkelijke vraag het actuele tarief van die datum.
    let tarief: VideoTarief
    if (b.herbereken_tarief === true) {
      const tar = k.personeel_id ? tariefOp(await laadTarieven(admin, k.personeel_id), datum) : null
      if (!tar) return NextResponse.json({ error: 'Op deze datum is geen uurtarief ingevuld.', code: 'geen_tarief' }, { status: 400 })
      tarief = videoTarief(tar)
    } else {
      if (oud.loon_uur === undefined || oud.totaal_uur === undefined) return NextResponse.json({ error: 'Van deze kost is geen berekening bewaard.' }, { status: 400 })
      tarief = { tarief_id: String(oud.tarief_id ?? ''), geldig_vanaf: String(oud.geldig_vanaf ?? ''), basis_label: String(oud.basis_label ?? 'Brutouurloon'), loon_uur: Number(oud.loon_uur), totaal_uur: Number(oud.totaal_uur), lasten_uur: Number(oud.lasten_uur ?? 0), btw_pct: Number(oud.btw_pct ?? 0) }
    }
    const ber = berekenVideoKost(uren, tarief)
    const { error } = await admin.from('cost_entries').update({ ...rij(ber, oud.naam ?? 'Medewerker', omschrijving, datum, clientId), updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin/revenue/kosten'); revalidatePath('/admin/revenue') } catch { }
    return NextResponse.json({ ok: true, berekening: ber })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
