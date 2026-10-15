import { leesGetal } from '@/lib/getal'
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { stelClassificatieVoor, type Classificatie } from '@/lib/facturen/kosten-winst'
import { laadFactuurMetKosten, kostprijsSuggestie, logKost, raaktVesting, type FactuurRef } from '@/lib/facturen/kosten-data'

export const dynamic = 'force-dynamic'

/**
 * Kosten en winst per factuur: factuurlijnen (classificatie) en directe
 * kosten, tijdens of ná het opmaken. Raakt NOOIT de klantfactuur zelf:
 * amount_excl/amount_incl en de status blijven wat ze zijn. Alleen de interne
 * kostprijs, winst en vestingwaarde veranderen — en elke wijziging staat in
 * invoice_cost_log met oud, nieuw en effect.
 */

const UUID = /^[0-9a-f-]{36}$/i
const tekst = (v: unknown): string | null => { const s = String(v ?? '').trim(); return s || null }
const getal = (v: unknown): number | null => leesGetal(v)
const datum = (v: unknown): string | null => { const s = tekst(v); return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null }
const CLASSIFICATIES: Classificatie[] = ['dienst', 'doorgerekende_kost', 'gemengd']

function refUit(b: Record<string, unknown>): FactuurRef | null {
  const inv = tekst(b.invoice_id); const rec = tekst(b.recurring_id); const maand = tekst(b.maand)
  if (inv && UUID.test(inv)) return { invoice_id: inv }
  if (rec && UUID.test(rec) && maand && /^\d{4}-\d{2}$/.test(maand)) return { recurring_id: rec, maand }
  return null
}
const refKolommen = (ref: FactuurRef) => (ref.invoice_id ? { invoice_id: ref.invoice_id, recurring_id: null, maand: null } : { invoice_id: null, recurring_id: ref.recurring_id, maand: ref.maand })

export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sp = req.nextUrl.searchParams
    const admin = createAdminSupabaseClient()

    // Voorstel voor een nieuwe lijn: classificatie + kostprijs uit bekende bronnen.
    if (sp.get('suggestie')) {
      const omschrijving = sp.get('omschrijving') ?? ''
      const voorstel = stelClassificatieVoor(omschrijving)
      const kostprijs = await kostprijsSuggestie(admin, sp.get('client_id'), omschrijving)
      return NextResponse.json({ voorstel, kostprijs })
    }

    const ref = refUit(Object.fromEntries(sp.entries()))
    if (!ref) return NextResponse.json({ error: 'invoice_id of recurring_id + maand vereist' }, { status: 400 })
    const f = await laadFactuurMetKosten(admin, ref)
    if (!f) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    const logQuery = ref.invoice_id
      ? admin.from('invoice_cost_log').select('*').eq('invoice_id', ref.invoice_id)
      : admin.from('invoice_cost_log').select('*').eq('recurring_id', ref.recurring_id).eq('maand', ref.maand)
    const { data: log } = await logQuery.order('created_at', { ascending: false }).limit(30)
    const vesting = await raaktVesting(admin, f.kop.contract_id)
    return NextResponse.json({ kop: f.kop, lijnen: f.lijnen, kosten: f.kosten, berekend: f.berekend, log: log ?? [], raaktVesting: vesting })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json() as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const actie = String(b.action ?? '')

    // De referentie: rechtstreeks, of via de lijn/kost die gewijzigd wordt.
    let ref = refUit(b)
    if (!ref && tekst(b.cost_id)) {
      const { data } = await admin.from('invoice_costs').select('invoice_id, recurring_id, maand').eq('id', String(b.cost_id)).maybeSingle()
      if (data) ref = refUit(data as Record<string, unknown>)
    }
    if (!ref && tekst(b.line_id)) {
      const { data } = await admin.from('invoice_lines').select('invoice_id, recurring_id').eq('id', String(b.line_id)).maybeSingle()
      // Een lijn van een recurring factuur: de maand komt uit het verzoek.
      if (data) ref = refUit({ ...(data as Record<string, unknown>), maand: b.maand })
    }
    if (!ref) return NextResponse.json({ error: 'Factuurreferentie ontbreekt.' }, { status: 400 })

    const voor = await laadFactuurMetKosten(admin, ref)
    if (!voor) return NextResponse.json({ error: 'Factuur niet gevonden' }, { status: 404 })
    const vesting = await raaktVesting(admin, voor.kop.contract_id)
    const reden = tekst(b.reden)
    const nu = new Date().toISOString()
    let lineId: string | null = null, costId: string | null = null, oud: unknown = null, nieuw: unknown = null

    if (actie === 'lijn_toevoegen' || actie === 'lijn_wijzigen') {
      const velden: Record<string, unknown> = {}
      if (b.omschrijving !== undefined) velden.omschrijving = tekst(b.omschrijving)
      if (b.aantal !== undefined) velden.aantal = getal(b.aantal) ?? 1
      if (b.prijs_excl !== undefined) velden.prijs_excl = getal(b.prijs_excl) ?? 0
      if (b.btw_pct !== undefined) velden.btw_pct = getal(b.btw_pct) ?? 21
      if (b.classificatie !== undefined) velden.classificatie = CLASSIFICATIES.includes(b.classificatie as Classificatie) ? b.classificatie : 'dienst'
      if (b.opmerking !== undefined) velden.opmerking = tekst(b.opmerking)
      if (actie === 'lijn_toevoegen') {
        if (!velden.omschrijving) return NextResponse.json({ error: 'Omschrijving is verplicht.' }, { status: 400 })
        const volgnr = Math.max(0, ...voor.lijnen.map((l) => l.volgnr)) + 1
        const { data, error } = await admin.from('invoice_lines').insert({ invoice_id: ref.invoice_id ?? null, recurring_id: ref.recurring_id ?? null, volgnr, ...velden }).select('id').single()
        if (error) throw new Error(error.message)
        lineId = data.id as string; nieuw = { ...velden, volgnr }
        // Kostprijs meegegeven bij de lijn → meteen één kostrecord aan die lijn.
        const kostprijs = getal(b.kostprijs_excl)
        if (kostprijs !== null || tekst(b.leverancier)) {
          const { data: k } = await admin.from('invoice_costs').insert({
            ...refKolommen(ref), line_id: lineId, omschrijving: String(velden.omschrijving), categorie: tekst(b.categorie) ?? stelClassificatieVoor(String(velden.omschrijving)).categorie,
            leverancier: tekst(b.leverancier), kostprijs_excl: kostprijs, datum: datum(b.datum), bewijs_url: tekst(b.bewijs_url), opmerking: tekst(b.kost_opmerking), created_by: actor.id,
          }).select('id').single()
          costId = (k?.id as string | undefined) ?? null
        }
      } else {
        lineId = tekst(b.line_id)
        const bestaand = voor.lijnen.find((l) => l.id === lineId)
        if (!lineId || !bestaand) return NextResponse.json({ error: 'Lijn niet gevonden bij deze factuur.' }, { status: 404 })
        oud = bestaand; nieuw = velden
        const { error } = await admin.from('invoice_lines').update({ ...velden, updated_at: nu }).eq('id', lineId)
        if (error) throw new Error(error.message)
      }
    } else if (actie === 'lijn_verwijderen') {
      lineId = tekst(b.line_id)
      const bestaand = voor.lijnen.find((l) => l.id === lineId)
      if (!lineId || !bestaand) return NextResponse.json({ error: 'Lijn niet gevonden bij deze factuur.' }, { status: 404 })
      if (voor.kosten.some((k) => k.line_id === lineId && k.status === 'actief')) return NextResponse.json({ error: 'Er hangen nog kosten aan deze lijn. Koppel ze los of annuleer ze eerst.' }, { status: 409 })
      oud = bestaand
      const { error } = await admin.from('invoice_lines').delete().eq('id', lineId)
      if (error) throw new Error(error.message)
    } else if (actie === 'kost_toevoegen' || actie === 'kost_wijzigen') {
      const velden: Record<string, unknown> = {}
      if (b.omschrijving !== undefined) velden.omschrijving = tekst(b.omschrijving)
      if (b.categorie !== undefined) velden.categorie = tekst(b.categorie)
      if (b.leverancier !== undefined) velden.leverancier = tekst(b.leverancier)
      if (b.kostprijs_excl !== undefined) velden.kostprijs_excl = getal(b.kostprijs_excl)
      if (b.datum !== undefined) velden.datum = datum(b.datum)
      if (b.bewijs_url !== undefined) velden.bewijs_url = tekst(b.bewijs_url)
      if (b.opmerking !== undefined) velden.opmerking = tekst(b.opmerking)
      if (b.line_id !== undefined) {
        const lid = tekst(b.line_id)
        if (lid && !voor.lijnen.some((l) => l.id === lid)) return NextResponse.json({ error: 'Die lijn hoort niet bij deze factuur.' }, { status: 400 })
        velden.line_id = lid
      }
      if (velden.kostprijs_excl !== undefined && velden.kostprijs_excl !== null && Number(velden.kostprijs_excl) < 0) return NextResponse.json({ error: 'Een kostprijs kan niet negatief zijn.' }, { status: 400 })
      if (actie === 'kost_toevoegen') {
        if (!velden.omschrijving) return NextResponse.json({ error: 'Omschrijving is verplicht.' }, { status: 400 })
        if (velden.categorie === undefined) velden.categorie = stelClassificatieVoor(String(velden.omschrijving)).categorie
        const { data, error } = await admin.from('invoice_costs').insert({ ...refKolommen(ref), ...velden, created_by: actor.id }).select('id').single()
        if (error) throw new Error(error.message)
        costId = data.id as string; nieuw = velden; lineId = (velden.line_id as string | null) ?? null
      } else {
        costId = tekst(b.cost_id)
        const bestaand = voor.kosten.find((k) => k.id === costId)
        if (!costId || !bestaand) return NextResponse.json({ error: 'Kost niet gevonden bij deze factuur.' }, { status: 404 })
        oud = bestaand; nieuw = velden; lineId = bestaand.line_id
        const { error } = await admin.from('invoice_costs').update({ ...velden, updated_at: nu }).eq('id', costId)
        if (error) throw new Error(error.message)
      }
    } else if (actie === 'kost_annuleren' || actie === 'kost_herstellen') {
      costId = tekst(b.cost_id)
      const bestaand = voor.kosten.find((k) => k.id === costId)
      if (!costId || !bestaand) return NextResponse.json({ error: 'Kost niet gevonden bij deze factuur.' }, { status: 404 })
      oud = { status: bestaand.status }; nieuw = { status: actie === 'kost_annuleren' ? 'geannuleerd' : 'actief' }; lineId = bestaand.line_id
      const { error } = await admin.from('invoice_costs').update({ status: actie === 'kost_annuleren' ? 'geannuleerd' : 'actief', updated_at: nu }).eq('id', costId)
      if (error) throw new Error(error.message)
    } else if (actie === 'kost_verwijderen') {
      // Definitief verwijderen kan enkel na annuleren: zo is het een bewuste tweede
      // stap. Het logboek (invoice_cost_log) houdt de oude waarden bij.
      costId = tekst(b.cost_id)
      const bestaand = voor.kosten.find((k) => k.id === costId)
      if (!costId || !bestaand) return NextResponse.json({ error: 'Kost niet gevonden bij deze factuur.' }, { status: 404 })
      if (bestaand.status !== 'geannuleerd') return NextResponse.json({ error: 'Annuleer de kost eerst; daarna kun je ze definitief verwijderen.' }, { status: 409 })
      oud = bestaand; nieuw = null; lineId = bestaand.line_id
      const { error } = await admin.from('invoice_costs').delete().eq('id', costId)
      if (error) throw new Error(error.message)
    } else if (actie === 'geen_directe_kosten') {
      // Expliciete bevestiging — nooit aangenomen. Voor recurring geldt ze voor de hele definitie.
      const bevestigd = b.bevestigd === true || b.bevestigd === 'true'
      oud = { bevestigd: voor.kop.bevestigd }; nieuw = { bevestigd }
      const tabel = ref.invoice_id ? 'invoices' : 'recurring_invoices'
      const { error } = await admin.from(tabel).update({ geen_directe_kosten_bevestigd_op: bevestigd ? nu : null }).eq('id', ref.invoice_id ?? ref.recurring_id)
      if (error) throw new Error(error.message)
    } else {
      return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    }

    // Effect op winst en vesting: verschil vóór/na, in euro (negatief = minder winst).
    const na = await laadFactuurMetKosten(admin, ref)
    const effectWinst = na ? Math.round((na.berekend.winst - voor.berekend.winst) * 100) / 100 : null
    await logKost(admin, {
      ref, line_id: lineId, cost_id: costId, actie, oud, nieuw, effect_winst: effectWinst, effect_vesting: vesting ? effectWinst : null, reden,
      actor_user_id: actor.id, actor_email: actor.email ?? null,
    })
    try { revalidatePath('/admin/invoices'); revalidatePath('/admin/vesting'); revalidatePath('/admin/revenue/omzet') } catch { }
    return NextResponse.json({ ok: true, id: costId ?? lineId, berekend: na?.berekend ?? null, lijnen: na?.lijnen ?? [], kosten: na?.kosten ?? [], effectWinst, raaktVesting: vesting })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
