import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { STATUSSEN, type OpdrachtStatus } from '@/lib/opdrachten'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

const MIST = /opdrachten|does not exist|schema cache/i
const HINT = 'De tabel voor opdrachten bestaat nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

const KOLOMMEN = 'id, client_id, klant_vrij, titel, omschrijving, status, deadline, wie, afgerond_op, created_at'

const geldigeStatus = (v: unknown): OpdrachtStatus | null => {
  const s = String(v ?? '')
  return STATUSSEN.some((x) => x.key === s) ? (s as OpdrachtStatus) : null
}

const tekst = (v: unknown, max: number): string | null => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

/** Datum als YYYY-MM-DD, of null. Onzin wordt geweigerd, niet stil bewaard. */
const datum = (v: unknown): string | null | undefined => {
  const s = String(v ?? '').trim()
  if (!s) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined
}

// GET — alle opdrachten, met de klantnaam erbij voor de lijst.
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()

    const { data, error } = await admin.from('opdrachten').select(KOLOMMEN).limit(1000)
    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ opdrachten: [], klanten: [], hint: HINT })
      throw new Error(error.message)
    }

    // Klantnamen los ophalen: één query in plaats van een join per rij.
    const { data: klantRijen } = await admin
      .from('clients').select('id, company_name').is('archived_at', null).order('company_name')
    const klanten = ((klantRijen ?? []) as { id: string; company_name: string | null }[])
      .map((c) => ({ id: c.id, naam: c.company_name ?? '(zonder naam)' }))
    const naamVan = new Map(klanten.map((c) => [c.id, c.naam]))

    const opdrachten = ((data ?? []) as Record<string, unknown>[]).map((o) => ({
      ...o,
      klant_naam: o.client_id ? naamVan.get(String(o.client_id)) ?? null : (o.klant_vrij ?? null),
    }))

    return NextResponse.json({ opdrachten, klanten })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuwe opdracht.
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))

    const titel = tekst(b.titel, 200)
    if (!titel) return NextResponse.json({ error: 'Geef de opdracht een titel.' }, { status: 400 })

    const deadline = datum(b.deadline)
    if (deadline === undefined) return NextResponse.json({ error: 'Die deadline begrijpen we niet.' }, { status: 400 })

    // Klant: ofwel een bestaand dossier, ofwel een vrije naam. Een client_id
    // van buiten controleren we — anders hangt de opdracht aan niets.
    const admin = createAdminSupabaseClient()
    let clientId: string | null = null
    if (b.client_id) {
      const { data: k } = await admin.from('clients').select('id').eq('id', String(b.client_id)).maybeSingle()
      if (!k) return NextResponse.json({ error: 'Die klant bestaat niet.' }, { status: 400 })
      clientId = String(b.client_id)
    }

    const { data, error } = await admin.from('opdrachten').insert({
      client_id: clientId,
      klant_vrij: clientId ? null : tekst(b.klant_vrij, 120),
      titel,
      omschrijving: tekst(b.omschrijving, 4000),
      status: geldigeStatus(b.status) ?? 'open',
      deadline,
      wie: tekst(b.wie, 60),
      aangemaakt_door_email: actor.email ?? null,
    }).select('id').single()

    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'opdracht.create', entityType: 'opdracht', entityId: String((data as { id: string }).id),
      summary: `Opdracht toegevoegd: ${titel}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id: (data as { id: string }).id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — bijwerken. Enkel de meegestuurde velden veranderen.
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '')
    if (!id) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

    if ('titel' in b) {
      const t = tekst(b.titel, 200)
      if (!t) return NextResponse.json({ error: 'De titel mag niet leeg zijn.' }, { status: 400 })
      patch.titel = t
    }
    if ('omschrijving' in b) patch.omschrijving = tekst(b.omschrijving, 4000)
    if ('wie' in b) patch.wie = tekst(b.wie, 60)
    if ('deadline' in b) {
      const d = datum(b.deadline)
      if (d === undefined) return NextResponse.json({ error: 'Die deadline begrijpen we niet.' }, { status: 400 })
      patch.deadline = d
    }
    if ('client_id' in b) {
      if (b.client_id) {
        const { data: k } = await admin.from('clients').select('id').eq('id', String(b.client_id)).maybeSingle()
        if (!k) return NextResponse.json({ error: 'Die klant bestaat niet.' }, { status: 400 })
        patch.client_id = String(b.client_id)
        patch.klant_vrij = null
      } else {
        patch.client_id = null
      }
    }
    if ('klant_vrij' in b && !patch.client_id) patch.klant_vrij = tekst(b.klant_vrij, 120)

    if ('status' in b) {
      const s = geldigeStatus(b.status)
      if (!s) return NextResponse.json({ error: 'Onbekende status.' }, { status: 400 })
      patch.status = s
      // Afrondmoment automatisch zetten en weer wissen: zo klopt "wanneer was
      // dit klaar" altijd, ook als iemand een opdracht heropent.
      patch.afgerond_op = s === 'afgerond' ? new Date().toISOString() : null
    }

    const { error } = await admin.from('opdrachten').update(patch).eq('id', id)
    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id= — echt weg. Afgehandelde opdrachten hoor je af te ronden, niet
// te verwijderen; dit is voor wat er per ongeluk bij kwam.
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!id) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('opdrachten').delete().eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'opdracht.delete', entityType: 'opdracht', entityId: id,
      summary: 'Opdracht verwijderd',
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
