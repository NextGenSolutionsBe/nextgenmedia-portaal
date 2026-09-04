import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { resolveKantoorSessie, magHandelenAls, actiefBedrijf } from '@/lib/kantoor/auth'
import {
  voorBedrijf, samenvatting, standaardZichtbaar, pctNaarCents,
  type KantoorOpdracht, type Soort,
} from '@/lib/kantoor/model'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const MIST = /kantoor_|does not exist|schema cache/i
const HINT = 'De tabellen voor het Kantoor bestaan nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

const KOLOMMEN = `id, soort, factureert_id, ontvangt_id, titel, omschrijving, klant_naam,
  totaal_cents, vergoeding_cents, vergoeding_pct, bedragen_zichtbaar, status, afgerond_op, created_at`

const tekst = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

/** Euro-invoer → centen. Aanvaardt "1234,50" en "1234.50". */
function naarCents(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return 0
  const s = String(v).replace(/\s/g, '').replace(',', '.')
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.round(n * 100)
}

/**
 * GET — de opdrachten waar het actieve bedrijf partij in is, al gefilterd op
 * wat dat bedrijf mag zien. De filtering gebeurt hier op de SERVER: de browser
 * krijgt de verborgen bedragen niet eens te zien.
 */
export async function GET(req: NextRequest) {
  try {
    const sessie = await resolveKantoorSessie()
    if (!sessie) return NextResponse.json({ error: 'Geen toegang tot het Kantoor' }, { status: 403 })

    const bedrijf = actiefBedrijf(sessie, req.nextUrl.searchParams.get('bedrijf'))
    if (!bedrijf) return NextResponse.json({ error: 'Geen bedrijf gekoppeld' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const [{ data: rijen, error }, { data: bedrijven }] = await Promise.all([
      admin.from('kantoor_opdrachten').select(KOLOMMEN)
        .or(`factureert_id.eq.${bedrijf.id},ontvangt_id.eq.${bedrijf.id}`)
        .order('created_at', { ascending: false }).limit(1000),
      admin.from('kantoor_bedrijven').select('id, naam, is_eigen, email, actief').eq('actief', true).order('naam'),
    ])
    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ opdrachten: [], hint: HINT, bedrijven: [], mijnBedrijven: sessie.bedrijven })
      throw new Error(error.message)
    }

    const naamVan = new Map(((bedrijven ?? []) as { id: string; naam: string }[]).map((b) => [b.id, b.naam]))
    const compleet = ((rijen ?? []) as unknown as KantoorOpdracht[]).map((o) => ({
      ...o,
      factureert_naam: naamVan.get(o.factureert_id) ?? 'Onbekend',
      ontvangt_naam: naamVan.get(o.ontvangt_id) ?? 'Onbekend',
    }))

    // Ons eigen team ziet alle bedragen; een partner alleen wat afgesproken is.
    const zichtbaar = compleet
      .map((o) => voorBedrijf(o, bedrijf.id, sessie.isAdmin))
      .filter((o): o is NonNullable<typeof o> => o !== null)

    return NextResponse.json({
      opdrachten: zichtbaar,
      samenvatting: samenvatting(zichtbaar),
      bedrijven: bedrijven ?? [],
      mijnBedrijven: sessie.bedrijven,
      actiefBedrijfId: bedrijf.id,
      isAdmin: sessie.isAdmin,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuwe samenwerking vastleggen.
export async function POST(req: NextRequest) {
  try {
    const sessie = await resolveKantoorSessie()
    if (!sessie) return NextResponse.json({ error: 'Geen toegang tot het Kantoor' }, { status: 403 })
    const b = await req.json().catch(() => ({}))

    const soort = (['onderaanneming', 'doorverwijzing'].includes(String(b.soort)) ? b.soort : null) as Soort | null
    if (!soort) return NextResponse.json({ error: 'Kies onderaanneming of doorverwijzing.' }, { status: 400 })

    const titel = tekst(b.titel, 200)
    if (!titel) return NextResponse.json({ error: 'Geef de opdracht een titel.' }, { status: 400 })

    const factureertId = String(b.factureert_id ?? '')
    const ontvangtId = String(b.ontvangt_id ?? '')
    if (!factureertId || !ontvangtId) return NextResponse.json({ error: 'Beide bedrijven zijn vereist.' }, { status: 400 })
    if (factureertId === ontvangtId) {
      return NextResponse.json({ error: 'Een bedrijf kan geen opdracht aan zichzelf doorgeven.' }, { status: 400 })
    }

    // Je mag alleen een opdracht vastleggen waar je zelf partij in bent.
    // Zonder deze rem kon iemand een afspraak verzinnen tussen twee andere
    // bedrijven — en die zou dan in hún cijfers opduiken.
    if (!magHandelenAls(sessie, factureertId) && !magHandelenAls(sessie, ontvangtId)) {
      return NextResponse.json({ error: 'Je kunt alleen opdrachten vastleggen waar je eigen bedrijf bij betrokken is.' }, { status: 403 })
    }

    const totaal = naarCents(b.totaal)
    if (totaal === null) return NextResponse.json({ error: 'Het totaalbedrag klopt niet.' }, { status: 400 })

    // Vergoeding: rechtstreeks in euro, of als percentage van het totaal.
    let vergoeding: number | null
    let pct: number | null = null
    if (b.vergoeding_pct !== undefined && b.vergoeding_pct !== null && String(b.vergoeding_pct) !== '') {
      const p = Number(String(b.vergoeding_pct).replace(',', '.'))
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        return NextResponse.json({ error: 'Het percentage moet tussen 0 en 100 liggen.' }, { status: 400 })
      }
      pct = p
      vergoeding = pctNaarCents(totaal, p)
    } else {
      vergoeding = naarCents(b.vergoeding)
      if (vergoeding === null) return NextResponse.json({ error: 'De vergoeding klopt niet.' }, { status: 400 })
    }
    if (vergoeding > totaal) {
      return NextResponse.json({ error: 'De vergoeding kan niet hoger zijn dan het totaalbedrag.' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('kantoor_opdrachten').insert({
      soort,
      factureert_id: factureertId,
      ontvangt_id: ontvangtId,
      titel,
      omschrijving: tekst(b.omschrijving, 4000),
      klant_naam: tekst(b.klant_naam, 160),
      totaal_cents: totaal,
      vergoeding_cents: vergoeding,
      vergoeding_pct: pct,
      bedragen_zichtbaar: typeof b.bedragen_zichtbaar === 'boolean'
        ? b.bedragen_zichtbaar : standaardZichtbaar(soort),
      status: 'lopend',
      aangemaakt_door: sessie.userId,
    }).select('id').single()

    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'kantoor.opdracht.create', entityType: 'kantoor_opdracht', entityId: String((data as { id: string }).id),
      summary: `Kantoor: ${soort} vastgelegd — ${titel}`,
      actorUserId: sessie.userId, actorEmail: sessie.email, actorRole: sessie.isAdmin ? 'admin' : 'partner',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id: (data as { id: string }).id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — status of gegevens bijwerken.
export async function PATCH(req: NextRequest) {
  try {
    const sessie = await resolveKantoorSessie()
    if (!sessie) return NextResponse.json({ error: 'Geen toegang tot het Kantoor' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '')
    if (!id) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: bestaand } = await admin.from('kantoor_opdrachten')
      .select('id, factureert_id, ontvangt_id, totaal_cents, status').eq('id', id).maybeSingle()
    if (!bestaand) return NextResponse.json({ error: 'Opdracht niet gevonden' }, { status: 404 })

    const rij = bestaand as { factureert_id: string; ontvangt_id: string; totaal_cents: number; status: string }
    const magErbij = magHandelenAls(sessie, rij.factureert_id) || magHandelenAls(sessie, rij.ontvangt_id)
    if (!magErbij) return NextResponse.json({ error: 'Geen toegang tot deze opdracht' }, { status: 403 })

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if ('status' in b) {
      const s = String(b.status)
      if (!['lopend', 'afgerond', 'geannuleerd'].includes(s)) {
        return NextResponse.json({ error: 'Onbekende status.' }, { status: 400 })
      }
      patch.status = s
      // Afrondmoment bepaalt in welke maand omzet én kosten boeken. Bij
      // heropenen weer leeg, anders blijft een oude maand meetellen.
      patch.afgerond_op = s === 'afgerond' ? new Date().toISOString() : null
    }

    // Bedragen wijzigen mag ALLEEN wie factureert: die stuurt de factuur en
    // kent het echte bedrag. Anders kon een onderaannemer zijn eigen
    // vergoeding verhogen.
    const magBedragen = magHandelenAls(sessie, rij.factureert_id)
    if (('totaal' in b || 'vergoeding' in b || 'vergoeding_pct' in b) && !magBedragen) {
      return NextResponse.json({ error: 'Alleen het bedrijf dat factureert kan de bedragen aanpassen.' }, { status: 403 })
    }

    let totaal = rij.totaal_cents
    if ('totaal' in b) {
      const t = naarCents(b.totaal)
      if (t === null) return NextResponse.json({ error: 'Het totaalbedrag klopt niet.' }, { status: 400 })
      totaal = t
      patch.totaal_cents = t
    }
    if ('vergoeding_pct' in b && b.vergoeding_pct !== null && String(b.vergoeding_pct) !== '') {
      const p = Number(String(b.vergoeding_pct).replace(',', '.'))
      if (!Number.isFinite(p) || p < 0 || p > 100) {
        return NextResponse.json({ error: 'Het percentage moet tussen 0 en 100 liggen.' }, { status: 400 })
      }
      patch.vergoeding_pct = p
      patch.vergoeding_cents = pctNaarCents(totaal, p)
    } else if ('vergoeding' in b) {
      const v = naarCents(b.vergoeding)
      if (v === null) return NextResponse.json({ error: 'De vergoeding klopt niet.' }, { status: 400 })
      if (v > totaal) return NextResponse.json({ error: 'De vergoeding kan niet hoger zijn dan het totaalbedrag.' }, { status: 400 })
      patch.vergoeding_cents = v
      patch.vergoeding_pct = null
    }

    if ('titel' in b) {
      const t = tekst(b.titel, 200)
      if (!t) return NextResponse.json({ error: 'De titel mag niet leeg zijn.' }, { status: 400 })
      patch.titel = t
    }
    if ('omschrijving' in b) patch.omschrijving = tekst(b.omschrijving, 4000)
    if ('klant_naam' in b) patch.klant_naam = tekst(b.klant_naam, 160)
    // Alleen wie factureert bepaalt of zijn marge zichtbaar is.
    if ('bedragen_zichtbaar' in b) {
      if (!magBedragen) return NextResponse.json({ error: 'Alleen het bedrijf dat factureert bepaalt wat zichtbaar is.' }, { status: 403 })
      patch.bedragen_zichtbaar = !!b.bedragen_zichtbaar
    }

    const { error } = await admin.from('kantoor_opdrachten').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
