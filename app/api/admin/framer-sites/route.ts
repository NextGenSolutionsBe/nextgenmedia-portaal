import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { volgendeVerlenging, dagenTotVerlenging, perMaand, type Facturatie } from '@/lib/framer-sites'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Framer-sites: welke klantwebsites draaien op Framer, wat kosten ze en wanneer
 * verlengen ze.
 *
 * Een site hoeft NIET aan een klant uit de app te hangen — niet elke Framer-site
 * hoort bij een klant die hier bestaat. `naam` is daarom het verplichte veld en
 * `client_id` de optionele koppeling.
 */

const MIST_TABEL = /framer_sites|does not exist|schema cache/i
const HINT = 'De tabel voor Framer-sites bestaat nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

function velden(b: Record<string, unknown>) {
  const naam = String(b.naam ?? '').trim()
  if (!naam) return { fout: 'Geef een naam op.' } as const

  const bedrag = Number(b.bedrag_excl)
  if (!Number.isFinite(bedrag) || bedrag < 0) return { fout: 'Bedrag mag niet negatief zijn.' } as const

  const btw = Number(b.vat_pct)
  if (!Number.isFinite(btw) || btw < 0 || btw > 100) return { fout: 'BTW moet tussen 0 en 100 liggen.' } as const

  const datum = (v: unknown) => {
    const s = String(v ?? '').slice(0, 10)
    return s && !Number.isNaN(new Date(s).getTime()) ? s : null
  }

  return {
    payload: {
      naam: naam.slice(0, 200),
      // Leeg = geen koppeling. Bewust geen stille standaardklant.
      client_id: String(b.client_id ?? '').trim() || null,
      site_url: String(b.site_url ?? '').trim().slice(0, 300) || null,
      plan: String(b.plan ?? '').trim().slice(0, 60) || null,
      bedrag_excl: bedrag,
      vat_pct: btw,
      facturatie: b.facturatie === 'monthly' ? 'monthly' : 'annual',
      renew_op: datum(b.renew_op),
      opgezegd_op: datum(b.opgezegd_op),
      notitie: String(b.notitie ?? '').trim().slice(0, 1000) || null,
    },
  } as const
}

export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()

    const { data, error } = await admin.from('framer_sites').select('*').order('naam')
    if (error) {
      if (MIST_TABEL.test(error.message)) return NextResponse.json({ sites: [], clients: [], hint: HINT })
      throw new Error(error.message)
    }

    // LET OP: de kolom heet company_name, niet name. Met 'name' faalt de query
    // stil en blijft de klantenlijst leeg zonder foutmelding.
    const { data: clientRijen } = await admin
      .from('clients').select('id, company_name').order('company_name')
    const clients = ((clientRijen ?? []) as { id: string; company_name: string | null }[])
      .map((c) => ({ id: c.id, name: c.company_name }))
    const naamVan = new Map(clients.map((c) => [c.id, c.name]))

    const nu = new Date()
    const sites = ((data ?? []) as Record<string, unknown>[]).map((s) => {
      const facturatie = (s.facturatie === 'monthly' ? 'monthly' : 'annual') as Facturatie
      const anker = s.renew_op as string | null
      const gestopt = !!s.opgezegd_op
      return {
        ...s,
        client_naam: s.client_id ? naamVan.get(s.client_id as string) ?? null : null,
        // Berekend, niet opgeslagen: zo staat er nooit een datum uit het verleden.
        volgende_verlenging: anker && !gestopt
          ? volgendeVerlenging(anker, facturatie, nu).toISOString().slice(0, 10)
          : null,
        dagen_tot: anker && !gestopt ? dagenTotVerlenging(anker, facturatie, nu) : null,
        per_maand: gestopt ? 0 : perMaand(Number(s.bedrag_excl) || 0, facturatie),
      }
    })

    return NextResponse.json({ sites, clients })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const v = velden(await req.json().catch(() => ({})))
    if ('fout' in v) return NextResponse.json({ error: v.fout }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('framer_sites').insert(v.payload).select('id').single()
    if (error) {
      if (MIST_TABEL.test(error.message)) return NextResponse.json({ error: HINT }, { status: 503 })
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'framer.site.create', entityType: 'framer_site', entityId: (data as { id: string }).id,
      summary: `Framer: ${v.payload.naam} toegevoegd`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id: (data as { id: string }).id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen site opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    // Alleen opzeggen of hervatten: dan raken we de rest van de rij niet aan.
    if (Object.keys(b).length === 2 && Object.prototype.hasOwnProperty.call(b, 'opgezegd_op')) {
      const stop = b.opgezegd_op ? String(b.opgezegd_op).slice(0, 10) : null
      const { error } = await admin.from('framer_sites').update({ opgezegd_op: stop }).eq('id', id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    const v = velden(b)
    if ('fout' in v) return NextResponse.json({ error: v.fout }, { status: 400 })

    const { error } = await admin.from('framer_sites').update(v.payload).eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'framer.site.update', entityType: 'framer_site', entityId: id,
      summary: `Framer: ${v.payload.naam} bijgewerkt`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = String(req.nextUrl.searchParams.get('id') ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen site opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('framer_sites').delete().eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'framer.site.delete', entityType: 'framer_site', entityId: id,
      summary: 'Framer: site verwijderd',
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
