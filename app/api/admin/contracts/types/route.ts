import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { NIET_TOEGEWEZEN, normaliseerType, gelijkType, keurNaamGoed, typeVanContract } from '@/lib/contracten/types'
import { lijstTypes, ontbreekt } from '@/lib/contracten/db'

/**
 * Contracttypes beheren. De types staan in `contract_types`; die tabel bestaat
 * pas na de migratie, dus ELKE lezing valt terug op de startlijst + de types die
 * al op contracten staan. Zo werkt het scherm ook vóór de migratie.
 *
 * Rechten: contracts.bekijken → GET, contracts.aanpassen → POST/PATCH/DELETE.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const persoon = await magIk('contracts', 'bekijken')
    if (!persoon) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { types, tabelAanwezig } = await lijstTypes(admin)
    return NextResponse.json({ types: types.filter((t) => t.actief || t.aantal > 0), tabelAanwezig })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** POST — nieuw contracttype toevoegen. */
export async function POST(req: NextRequest) {
  try {
    const persoon = await magIk('contracts', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const body = await req.json().catch(() => ({})) as { naam?: string }
    const naam = normaliseerType(body.naam)

    const { types, tabelAanwezig } = await lijstTypes(admin)
    const fout = keurNaamGoed(body.naam, types.map((t) => t.naam))
    if (fout) {
      // Bestaat het type al, dan is dat geen fout voor de combobox: geef het terug.
      const bestaand = types.find((t) => gelijkType(t.naam, naam))
      if (bestaand) return NextResponse.json({ ok: true, naam: bestaand.naam, bestond: true })
      return NextResponse.json({ error: fout }, { status: 400 })
    }
    if (!tabelAanwezig) {
      // Vóór de migratie bestaat de tabel niet. Het type mag wél gebruikt worden
      // (het wordt gewoon op het contract opgeslagen), maar niet bewaard.
      return NextResponse.json({ ok: true, naam, bewaard: false })
    }

    const volgorde = types.reduce((m, t) => Math.max(m, t.volgorde), 0) + 1
    const { data, error } = await admin.from('contract_types')
      .insert({ naam, actief: true, volgorde, created_by: persoon.userId })
      .select('id, naam').maybeSingle()
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) return NextResponse.json({ ok: true, naam, bestond: true })
      if (ontbreekt(error.message)) return NextResponse.json({ ok: true, naam, bewaard: false })
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'contract_type.created', entityType: 'contract_type', entityId: data?.id ?? null,
      summary: `Contracttype "${naam}" toegevoegd`,
      actorUserId: persoon.userId, actorEmail: persoon.email, actorRole: persoon.rol,
      metadata: { naam }, ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath('/admin/contracts') } catch { /* buiten een request-context */ }
    return NextResponse.json({ ok: true, naam, id: data?.id ?? null, bewaard: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** PATCH — contracttype hernoemen; alle contracten met die waarde gaan mee. */
export async function PATCH(req: NextRequest) {
  try {
    const persoon = await magIk('contracts', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const body = await req.json().catch(() => ({})) as { van?: string; naar?: string; actief?: boolean }
    const van = normaliseerType(body.van)
    const naar = normaliseerType(body.naar)
    if (!van) return NextResponse.json({ error: 'Geef op welk contracttype hernoemd moet worden.' }, { status: 400 })

    const { types, tabelAanwezig } = await lijstTypes(admin)
    const huidig = types.find((t) => gelijkType(t.naam, van))
    if (!huidig) return NextResponse.json({ error: `Het contracttype "${van}" bestaat niet.` }, { status: 404 })

    if (naar && !gelijkType(van, naar)) {
      const fout = keurNaamGoed(body.naar, types.map((t) => t.naam), van)
      if (fout) return NextResponse.json({ error: fout }, { status: 400 })
    }
    const nieuweNaam = naar || huidig.naam

    // 1. De rij hernoemen (bestaat de tabel niet, dan volstaat stap 2).
    if (tabelAanwezig && huidig.id) {
      const patch: Record<string, unknown> = { naam: nieuweNaam }
      if (typeof body.actief === 'boolean') patch.actief = body.actief
      const { error } = await admin.from('contract_types').update(patch).eq('id', huidig.id)
      if (error && !ontbreekt(error.message)) throw new Error(error.message)
    }

    // 2. Elk contract dat de oude naam draagt in één keer meenemen. Hoofdletter-
    //    varianten kunnen niet met één eq(); we halen de betrokken id's op.
    let gewijzigd = 0
    if (!gelijkType(van, nieuweNaam) || huidig.naam !== nieuweNaam) {
      try {
        const { data } = await admin.from('contracts').select('id, contract_type').limit(5000)
        const ids = ((data ?? []) as Array<{ id: string; contract_type: string | null }>)
          .filter((c) => gelijkType(typeVanContract(c.contract_type), van))
          .map((c) => c.id)
        for (let i = 0; i < ids.length; i += 200) {
          const brok = ids.slice(i, i + 200)
          const { error } = await admin.from('contracts').update({ contract_type: nieuweNaam }).in('id', brok)
          if (error) { if (ontbreekt(error.message)) break; throw new Error(error.message) }
          gewijzigd += brok.length
        }
      } catch (e) { if (!ontbreekt(e instanceof Error ? e.message : e)) throw e }
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'contract_type.renamed', entityType: 'contract_type', entityId: huidig.id,
      summary: `Contracttype "${huidig.naam}" hernoemd naar "${nieuweNaam}" (${gewijzigd} contracten bijgewerkt)`,
      actorUserId: persoon.userId, actorEmail: persoon.email, actorRole: persoon.rol,
      metadata: { van: huidig.naam, naar: nieuweNaam, gewijzigd }, ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath('/admin/contracts') } catch { /* buiten een request-context */ }
    return NextResponse.json({ ok: true, naam: nieuweNaam, gewijzigd })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** DELETE ?naam=… — enkel deactiveren, en enkel als geen enkel contract het gebruikt. */
export async function DELETE(req: NextRequest) {
  try {
    const persoon = await magIk('contracts', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const naam = normaliseerType(req.nextUrl.searchParams.get('naam'))
    if (!naam) return NextResponse.json({ error: 'Geef op welk contracttype uitgeschakeld moet worden.' }, { status: 400 })
    if (gelijkType(naam, NIET_TOEGEWEZEN)) {
      return NextResponse.json({ error: `"${NIET_TOEGEWEZEN}" is de terugval voor contracten zonder type en kan niet uitgeschakeld worden.` }, { status: 400 })
    }

    const { types, tabelAanwezig } = await lijstTypes(admin)
    const huidig = types.find((t) => gelijkType(t.naam, naam))
    if (!huidig) return NextResponse.json({ error: `Het contracttype "${naam}" bestaat niet.` }, { status: 404 })
    if (huidig.aantal > 0) {
      return NextResponse.json({
        error: `"${huidig.naam}" wordt gebruikt door ${huidig.aantal} contract${huidig.aantal === 1 ? '' : 'en'}. Hernoem het type of geef die contracten eerst een ander type.`,
      }, { status: 409 })
    }
    if (!tabelAanwezig || !huidig.id) {
      return NextResponse.json({ error: 'Contracttypes kunnen pas beheerd worden nadat de databasemigratie gedraaid is.' }, { status: 400 })
    }

    const { error } = await admin.from('contract_types').update({ actief: false }).eq('id', huidig.id)
    if (error && !ontbreekt(error.message)) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'contract_type.deactivated', entityType: 'contract_type', entityId: huidig.id,
      summary: `Contracttype "${huidig.naam}" uitgeschakeld`,
      actorUserId: persoon.userId, actorEmail: persoon.email, actorRole: persoon.rol,
      metadata: { naam: huidig.naam }, ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath('/admin/contracts') } catch { /* buiten een request-context */ }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
