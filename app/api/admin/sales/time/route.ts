import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, requireAdmin } from '@/lib/supabase/server'
import { getOrCreateSetter, listSetters, monthPeriod } from '@/lib/sales/setters'
import { valideerPeriode, type Blok } from '@/lib/sales/tijd-invoer'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * De gewerkte periodes van een setter: bekijken, bijboeken, aanpassen en verwijderen.
 *
 * Een admin ziet en beheert die van iedereen. Een setter enkel de zijne — ook
 * bij het verwijderen, en dat wordt hier gecontroleerd en niet in het scherm.
 */

async function scope() {
  const actor = await requireStaff()
  if (!actor) return null
  const isAdmin = !!(await requireAdmin())
  const me = isAdmin
    ? null
    : await getOrCreateSetter(actor.id, actor.email?.split('@')[0] ?? 'Setter', actor.email ?? null)
  return { actor, isAdmin, meId: me?.id ?? null }
}

// GET ?month=YYYY-MM-01&setter=<id>
export async function GET(req: NextRequest) {
  try {
    const s = await scope()
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const sp = req.nextUrl.searchParams
    const m = sp.get('month')
    const base = m ? new Date(`${m}T12:00:00`) : new Date()
    const period = monthPeriod(Number.isFinite(base.getTime()) ? base : new Date())

    // Wie mag je zien? Een setter altijd enkel zichzelf.
    let ids: string[]
    if (s.isAdmin) {
      const all = await listSetters()
      const wanted = sp.get('setter') ?? ''
      ids = all.some((x) => x.id === wanted) ? [wanted] : all.map((x) => x.id)
    } else {
      if (!s.meId) return NextResponse.json({ entries: [] })
      ids = [s.meId]
    }
    if (ids.length === 0) return NextResponse.json({ entries: [] })

    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('sales_time_entries')
      .select('id, setter_id, started_at, ended_at, note, source')
      .in('setter_id', ids)
      .gte('started_at', period.from.toISOString())
      .lt('started_at', period.to.toISOString())
      .order('started_at', { ascending: false })
      .limit(400)

    const setters = await listSetters()
    const nameById = new Map(setters.map((x) => [x.id, x.name]))
    const entries = ((data ?? []) as {
      id: string; setter_id: string; started_at: string; ended_at: string | null
      note: string | null; source: string
    }[]).map((e) => ({ ...e, setterName: nameById.get(e.setter_id) ?? 'Setter' }))

    return NextResponse.json({ entries, isAdmin: s.isAdmin })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST — een gewerkte periode handmatig bijboeken (van–tot).
 *
 * Naast de timer, niet in de plaats ervan: wie vergeet te starten of belt
 * terwijl de app dicht staat, moet die tijd achteraf kunnen noteren.
 *
 * Deze uren worden uitbetaald, dus de controle hoort HIER en niet enkel in het
 * scherm. De zwaarste is de overlaptoets: twee blokken over hetzelfde uur
 * betekent twee keer betalen, en dat valt op een maandoverzicht niet op.
 */
export async function POST(req: NextRequest) {
  try {
    const s = await scope()
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))

    // Voor wie? Een admin mag voor iemand anders boeken, een setter enkel voor
    // zichzelf — ook als het scherm iets anders meestuurt.
    let setterId: string
    if (s.isAdmin) {
      const gevraagd = String(b.setterId ?? '')
      const all = await listSetters()
      if (!all.some((x) => x.id === gevraagd)) {
        return NextResponse.json({ error: 'Kies eerst voor wie je de tijd boekt.' }, { status: 400 })
      }
      setterId = gevraagd
    } else {
      if (!s.meId) return NextResponse.json({ error: 'Geen setterprofiel' }, { status: 403 })
      setterId = s.meId
    }

    const admin = createAdminSupabaseClient()

    /**
     * Alles ophalen wat kán overlappen. Een blok van hoogstens MAX_UREN kan
     * nooit verder terugreiken dan een dag vóór de nieuwe start, dus een venster
     * van twee dagen rondom de invoer volstaat — en dat blijft klein.
     *
     * De lopende timer (ended_at is null) kan ouder zijn dan dat venster, dus
     * die halen we er apart bij.
     */
    const ruwStart = new Date(String(b.startIso ?? '')).getTime()
    const vanaf = new Date((Number.isFinite(ruwStart) ? ruwStart : Date.now()) - 36 * 3600_000).toISOString()
    const tot = new Date((Number.isFinite(ruwStart) ? ruwStart : Date.now()) + 36 * 3600_000).toISOString()

    const [{ data: rond }, { data: lopend }] = await Promise.all([
      admin.from('sales_time_entries').select('started_at, ended_at')
        .eq('setter_id', setterId).gte('started_at', vanaf).lt('started_at', tot).limit(200),
      admin.from('sales_time_entries').select('started_at, ended_at')
        .eq('setter_id', setterId).is('ended_at', null).limit(5),
    ])
    const bestaande = [...((rond ?? []) as Blok[]), ...((lopend ?? []) as Blok[])]

    const check = valideerPeriode(String(b.startIso ?? ''), String(b.eindIso ?? ''), bestaande)
    if (!check.ok) return NextResponse.json({ error: check.fout }, { status: 400 })

    const { error } = await admin.from('sales_time_entries').insert({
      setter_id: setterId,
      started_at: new Date(check.startMs).toISOString(),
      ended_at: new Date(check.eindMs).toISOString(),
      note: String(b.note ?? '').trim().slice(0, 200) || null,
      source: 'manual',
    })
    if (error) throw new Error(error.message)

    // Handmatig geboekte uren horen in het logboek: ze zijn niet door de timer
    // gestempeld, dus dit is de enige plek waar zichtbaar blijft wie ze inbracht.
    const meta = requestMeta(req)
    const uren = ((check.eindMs - check.startMs) / 3600_000).toFixed(2)
    await logAudit({
      action: 'sales.time.manual', entityType: 'sales_setter', entityId: setterId,
      summary: `Verkoop: ${uren} u handmatig geboekt op ${new Date(check.startMs).toLocaleString('nl-BE')}`,
      actorUserId: s.actor.id, actorEmail: s.actor.email ?? null, actorRole: s.isAdmin ? 'admin' : 'employee',
      ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * PATCH { id, startIso?, eindIso?, note? } — een periode rechtzetten.
 *
 * Zelfde regels als bijboeken (valideerPeriode): geen toekomst, geen blok
 * boven MAX_UREN en vooral GEEN OVERLAP met een ander blok van dezelfde setter
 * — het blok zelf telt daarbij uiteraard niet mee. Een lopende timer heeft nog
 * geen eindtijd: daarvan kan je enkel de notitie aanpassen.
 */
export async function PATCH(req: NextRequest) {
  try {
    const s = await scope()
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: row } = await admin.from('sales_time_entries')
      .select('id, setter_id, started_at, ended_at, note').eq('id', id).maybeSingle()
    if (!row) return NextResponse.json({ error: 'Periode niet gevonden' }, { status: 404 })
    const entry = row as { id: string; setter_id: string; started_at: string; ended_at: string | null; note: string | null }
    if (!s.isAdmin && entry.setter_id !== s.meId) {
      return NextResponse.json({ error: 'Dit is niet jouw tijdregistratie' }, { status: 403 })
    }

    const patch: Record<string, unknown> = {}
    if (b.note !== undefined) patch.note = String(b.note ?? '').trim().slice(0, 200) || null

    const wiltTijd = b.startIso !== undefined || b.eindIso !== undefined
    let check: { startMs: number; eindMs: number } | null = null
    if (wiltTijd) {
      if (entry.ended_at === null) {
        return NextResponse.json({ error: 'Deze timer loopt nog. Stop hem eerst; daarna kan je begin en einde aanpassen.' }, { status: 409 })
      }
      const startIso = String(b.startIso ?? entry.started_at)
      const eindIso = String(b.eindIso ?? entry.ended_at)
      const ruwStart = new Date(startIso).getTime()
      const basis = Number.isFinite(ruwStart) ? ruwStart : Date.now()
      const [{ data: rond }, { data: lopend }] = await Promise.all([
        admin.from('sales_time_entries').select('id, started_at, ended_at')
          .eq('setter_id', entry.setter_id)
          .gte('started_at', new Date(basis - 36 * 3600_000).toISOString())
          .lt('started_at', new Date(basis + 36 * 3600_000).toISOString()).limit(200),
        admin.from('sales_time_entries').select('id, started_at, ended_at')
          .eq('setter_id', entry.setter_id).is('ended_at', null).limit(5),
      ])
      const bestaande = [...((rond ?? []) as (Blok & { id: string })[]), ...((lopend ?? []) as (Blok & { id: string })[])]
        .filter((x) => x.id !== id)
      const uit = valideerPeriode(startIso, eindIso, bestaande)
      if (!uit.ok) return NextResponse.json({ error: uit.fout }, { status: 400 })
      check = uit
      patch.started_at = new Date(uit.startMs).toISOString()
      patch.ended_at = new Date(uit.eindMs).toISOString()
    }
    if (!Object.keys(patch).length) return NextResponse.json({ ok: true })

    const { error } = await admin.from('sales_time_entries').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    // Uren aanpassen verandert wat er uitbetaald wordt → in het logboek, met
    // het oude en het nieuwe blok, zodat achteraf te zien is wat er wijzigde.
    const meta = requestMeta(req)
    const blok = (van: string | number, tot: string | number | null) =>
      `${new Date(van).toLocaleString('nl-BE')}–${tot === null ? 'lopend' : new Date(tot).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}`
    await logAudit({
      action: 'sales.time.edit', entityType: 'sales_setter', entityId: entry.setter_id,
      summary: check
        ? `Verkoop: gewerkte periode ${blok(entry.started_at, entry.ended_at)} aangepast naar ${blok(check.startMs, check.eindMs)}`
        : `Verkoop: notitie van gewerkte periode ${blok(entry.started_at, entry.ended_at)} aangepast`,
      actorUserId: s.actor.id, actorEmail: s.actor.email ?? null, actorRole: s.isAdmin ? 'admin' : 'employee',
      ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id= — één periode wissen.
export async function DELETE(req: NextRequest) {
  try {
    const s = await scope()
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: row } = await admin.from('sales_time_entries')
      .select('id, setter_id, started_at, ended_at').eq('id', id).maybeSingle()
    if (!row) return NextResponse.json({ error: 'Periode niet gevonden' }, { status: 404 })

    const entry = row as { id: string; setter_id: string; started_at: string; ended_at: string | null }
    // Een setter mag enkel zijn eigen tijd wissen.
    if (!s.isAdmin && entry.setter_id !== s.meId) {
      return NextResponse.json({ error: 'Dit is niet jouw tijdregistratie' }, { status: 403 })
    }

    const { error } = await admin.from('sales_time_entries').delete().eq('id', id)
    if (error) throw new Error(error.message)

    // Uren wissen verandert wat er uitbetaald wordt, dus dit hoort in het
    // logboek — ook wanneer iemand zijn eigen tijd verwijdert.
    const meta = requestMeta(req)
    await logAudit({
      action: 'sales.time.delete', entityType: 'sales_setter', entityId: entry.setter_id,
      summary: `Verkoop: gewerkte periode van ${new Date(entry.started_at).toLocaleString('nl-BE')} verwijderd`,
      actorUserId: s.actor.id, actorEmail: s.actor.email ?? null, actorRole: s.isAdmin ? 'admin' : 'employee',
      ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true, wasRunning: entry.ended_at === null })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
