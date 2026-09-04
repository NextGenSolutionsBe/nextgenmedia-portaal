import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

const VALID_FREQ = ['monthly', 'quarterly', 'annual']

export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('cost_entries').select('*').order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ costs: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const body = await req.json()
    const { name, category, type, cost_date, start_date, end_date, billing_frequency, amount_excl, vat_pct, notes } = body

    if (!name?.trim()) return NextResponse.json({ error: 'Naam is verplicht' }, { status: 400 })
    if (!amount_excl || Number(amount_excl) <= 0) return NextResponse.json({ error: 'Bedrag is verplicht' }, { status: 400 })
    if (type === 'one_time' && !cost_date) return NextResponse.json({ error: 'Datum is verplicht' }, { status: 400 })
    if (type === 'recurring' && !start_date) return NextResponse.json({ error: 'Startdatum is verplicht' }, { status: 400 })

    const freq = VALID_FREQ.includes(billing_frequency) ? billing_frequency : 'monthly'
    const admin = createAdminSupabaseClient()

    const { data, error } = await admin
      .from('cost_entries')
      .insert({
        name: name.trim(),
        category: category?.trim() || null,
        type: type === 'recurring' ? 'recurring' : 'one_time',
        cost_date: type === 'one_time' ? cost_date : null,
        start_date: type === 'recurring' ? start_date : null,
        end_date: type === 'recurring' ? (end_date || null) : null,
        billing_frequency: type === 'recurring' ? freq : 'monthly',
        amount_excl: Number(amount_excl),
        vat_pct: vat_pct != null ? Number(vat_pct) : 21,
        notes: notes?.trim() || null,
      })
      .select('*')
      .single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ cost: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * PATCH — een kost wijzigen, of een abonnement stopzetten of hervatten.
 *
 * Beide gaan door dezelfde deur, maar met een verschil dat ertoe doet: enkel de
 * velden die je MEESTUURT worden aangepast. De stopzet-knop stuurt alleen
 * `end_date` mee en raakt de rest dus niet aan.
 *
 * Stopzetten is nooit verwijderen: de maanden die al geteld hebben blijven
 * staan, anders verandert een afgesloten boekjaar met terugwerkende kracht.
 */
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const body = await req.json()
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: rij } = await admin
      .from('cost_entries').select('*').eq('id', id).maybeSingle()
    if (!rij) return NextResponse.json({ error: 'Kost niet gevonden' }, { status: 404 })
    const bestaand = rij as {
      type: string; name: string | null; start_date: string | null
      cost_date: string | null; end_date: string | null
    }

    const heeft = (k: string) => Object.prototype.hasOwnProperty.call(body, k)
    const patch: Record<string, unknown> = {}

    // Type mag wijzigen: iets dat je als eenmalig invoerde blijkt een
    // abonnement, of omgekeerd. De datumvelden van het oude type worden dan
    // leeggemaakt, anders blijft er een startdatum hangen bij een eenmalige
    // kost en klopt de lijst niet meer met de cijfers.
    const nieuwType = heeft('type')
      ? (body.type === 'recurring' ? 'recurring' : 'one_time')
      : bestaand.type
    if (heeft('type') && nieuwType !== bestaand.type) {
      patch.type = nieuwType
      if (nieuwType === 'recurring') patch.cost_date = null
      else { patch.start_date = null; patch.end_date = null }
    }

    if (heeft('name')) {
      const naam = String(body.name ?? '').trim()
      if (!naam) return NextResponse.json({ error: 'Naam is verplicht' }, { status: 400 })
      patch.name = naam
    }
    if (heeft('category')) patch.category = String(body.category ?? '').trim() || null
    if (heeft('notes')) patch.notes = String(body.notes ?? '').trim() || null

    if (heeft('amount_excl')) {
      const bedrag = Number(body.amount_excl)
      if (!Number.isFinite(bedrag) || bedrag <= 0) {
        return NextResponse.json({ error: 'Bedrag moet groter zijn dan nul' }, { status: 400 })
      }
      patch.amount_excl = bedrag
    }
    if (heeft('vat_pct')) {
      const btw = Number(body.vat_pct)
      if (!Number.isFinite(btw) || btw < 0 || btw > 100) {
        return NextResponse.json({ error: 'BTW moet tussen 0 en 100 liggen' }, { status: 400 })
      }
      patch.vat_pct = btw
    }
    if (heeft('billing_frequency')) {
      patch.billing_frequency = VALID_FREQ.includes(body.billing_frequency) ? body.billing_frequency : 'monthly'
    }

    const geldigeDatum = (v: unknown) => !Number.isNaN(new Date(String(v)).getTime())

    if (heeft('cost_date') && nieuwType === 'one_time') {
      if (!body.cost_date || !geldigeDatum(body.cost_date)) {
        return NextResponse.json({ error: 'Geef een geldige datum op' }, { status: 400 })
      }
      patch.cost_date = String(body.cost_date).slice(0, 10)
    }

    if (heeft('start_date') && nieuwType === 'recurring') {
      if (!body.start_date || !geldigeDatum(body.start_date)) {
        return NextResponse.json({ error: 'Geef een geldige startdatum op' }, { status: 400 })
      }
      patch.start_date = String(body.start_date).slice(0, 10)
    }

    if (heeft('end_date')) {
      // Een einddatum hoort alleen bij een abonnement. Op een eenmalige kost is
      // hij betekenisloos en zou hij enkel verwarring geven in de lijst.
      if (nieuwType !== 'recurring') {
        return NextResponse.json({ error: 'Alleen een abonnement heeft een einddatum.' }, { status: 400 })
      }
      if (body.end_date) {
        if (!geldigeDatum(body.end_date)) {
          return NextResponse.json({ error: 'Ongeldige datum' }, { status: 400 })
        }
        // Vóór de start stoppen zou een abonnement opleveren dat nooit geteld
        // heeft, terwijl het er in de lijst wel staat. Dan liever verwijderen.
        const start = String(patch.start_date ?? bestaand.start_date ?? '').slice(0, 10)
        if (start && String(body.end_date).slice(0, 10) < start) {
          return NextResponse.json({
            error: 'Die datum ligt voor de startdatum. Wil je dat dit abonnement nooit geteld heeft, verwijder het dan.',
          }, { status: 400 })
        }
        patch.end_date = String(body.end_date).slice(0, 10)
      } else {
        patch.end_date = null
      }
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Niets om te wijzigen' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('cost_entries').update(patch).eq('id', id).select('*').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, cost: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('cost_entries').delete().eq('id', id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
