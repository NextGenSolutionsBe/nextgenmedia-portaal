import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import type { Actie } from '@/lib/instellingen/model'
import { kijkerVan, laadZicht, itemZichtbaar, ITEM_VELDEN, type Kijker, type RuwItem } from '@/lib/agenda/server'
import { controleerReeks, leesReeksItemId, keren } from '@/lib/agenda/reeksen'
import { controleerBeschikbaarheid } from '@/lib/agenda/team'
import { eigenReeks, keerAlsItem, laadBeschikbaarheid, nieuweIcalLink, trekIcalIn, icalLinksVan } from '@/lib/agenda/team-server'

export const dynamic = 'force-dynamic'

/**
 * Teamagenda (verbeterplan fase 3): reeksen (vaste blokken, herhalende afspraken en taken),
 * beschikbaarheid, iCal-links en de verschillen met ClickUp. De app plant zelf nooit iets in.
 *   GET ?reeks=<id> | ?beschikbaarheid=1 | ?ical=1 | ?verschillen=1
 *   POST { actie: 'reeks.nieuw' | 'reeks.wijzig' | 'reeks.overslaan' | 'reeks.stop' | 'reeks.verwijder' | 'reeks.keer'
 *          | 'beschikbaarheid.zet' | 'ical.nieuw' | 'ical.intrekken' | 'verschil.gezien', … }
 */

type Admin = ReturnType<typeof createAdminSupabaseClient>
type Ctx = { admin: Admin; k: Kijker }
const fout = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })
const UUID = /^[0-9a-f-]{36}$/i

async function toegang(actie: Actie): Promise<Ctx | NextResponse> {
  const persoon = await magIk('agenda', actie)
  if (!persoon) return fout('Geen toegang', 403)
  const admin = createAdminSupabaseClient()
  const k = await kijkerVan(admin, persoon)
  if (!k) return fout('Je account is nog niet gekend in de agenda.', 403)
  return { admin, k }
}

export async function GET(req: NextRequest) {
  const c = await toegang('bekijken')
  if (c instanceof NextResponse) return c
  const { admin, k } = c
  const q = req.nextUrl.searchParams
  try {
    if (q.get('reeks')) return NextResponse.json({ reeks: await eigenReeks(admin, k, q.get('reeks')).catch(async () => {
      // Lezen mag ook wie de reeks enkel ziet (niet op de reeks staat).
      const { data } = await admin.from('ag_reeksen').select('*').eq('id', q.get('reeks')).is('verwijderd_op', null).maybeSingle()
      if (!data) throw new Error('Deze reeks bestaat niet meer.')
      return data
    }) })
    if (q.get('beschikbaarheid')) return NextResponse.json({ beschikbaarheid: await laadBeschikbaarheid(admin) })
    if (q.get('ical')) return NextResponse.json({ links: await icalLinksVan(admin, k.persoonId) })
    if (q.get('verschillen')) {
      // Items die in de app aangepast werden terwijl ClickUp ondertussen iets anders zei (de import liet de app-versie staan).
      const z = await laadZicht(admin, k)
      const { data, error } = await admin.from('ag_items').select(`${ITEM_VELDEN}, clickup_verschil_op, clickup_verschil`).not('clickup_verschil_op', 'is', null).is('verwijderd_op', null).order('clickup_verschil_op', { ascending: false }).limit(200)
      if (error) return NextResponse.json({ verschillen: [] })
      const rijen = (data ?? []) as unknown as (RuwItem & { clickup_verschil_op: string; clickup_verschil: Record<string, unknown> | null })[]
      const ids = rijen.map((r) => r.id)
      const { data: tw } = ids.length ? await admin.from('ag_toegewezen').select('item_id, persoon_id').in('item_id', ids) : { data: [] }
      const wie = new Map<string, string[]>()
      for (const t of (tw ?? []) as { item_id: string; persoon_id: string }[]) wie.set(t.item_id, [...(wie.get(t.item_id) ?? []), t.persoon_id])
      const zichtbaar = rijen.filter((r) => itemZichtbaar(r, wie.get(r.id) ?? [], z))
      return NextResponse.json({ verschillen: zichtbaar.map((r) => ({ id: r.id, titel: r.titel, clickup_url: r.clickup_url, op: r.clickup_verschil_op, clickup: r.clickup_verschil })) })
    }
    return fout('Onbekende vraag')
  } catch (e) {
    return fout(e instanceof Error ? e.message : 'Er ging iets mis')
  }
}

const RECHT: Record<string, Actie> = {
  'reeks.nieuw': 'toevoegen', 'reeks.wijzig': 'aanpassen', 'reeks.overslaan': 'aanpassen', 'reeks.stop': 'aanpassen', 'reeks.verwijder': 'verwijderen', 'reeks.keer': 'aanpassen',
  'beschikbaarheid.zet': 'bekijken', 'ical.nieuw': 'bekijken', 'ical.intrekken': 'bekijken', 'verschil.gezien': 'aanpassen', 'verschil.overnemen': 'aanpassen',
}

export async function POST(req: NextRequest) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const actie = String(b.actie ?? '')
  const recht = RECHT[actie]
  if (!recht) return fout('Onbekende actie')
  const c = await toegang(recht)
  if (c instanceof NextResponse) return c
  const { admin, k } = c
  const nu = new Date().toISOString()
  try {
    if (actie === 'reeks.nieuw' || actie === 'reeks.wijzig') {
      const r = controleerReeks(b)
      if (!r.ok) return fout(r.fout)
      if (r.reeks.lijst_id) {
        const z = await laadZicht(admin, k)
        if (!z.zichtbaar.lijsten.has(r.reeks.lijst_id)) return fout('Die map bestaat niet of je kan ze niet zien.')
      }
      // Enkel jezelf, tenzij je zaakvoerder bent: wie niet mag plannen voor anderen, plant enkel voor zichzelf.
      if (!k.isAdmin && r.reeks.personen.some((p) => p !== k.persoonId)) return fout('Je kan enkel voor jezelf een reeks maken.')
      if (actie === 'reeks.nieuw') {
        const { data, error } = await admin.from('ag_reeksen').insert({ ...r.reeks, eigenaar_id: k.persoonId, gemaakt_door: k.naam }).select('id').single()
        if (error || !data) throw new Error(error?.message ?? 'Bewaren mislukt')
        return NextResponse.json({ ok: true, id: (data as { id: string }).id })
      }
      const oud = await eigenReeks(admin, k, b.id)
      const { error } = await admin.from('ag_reeksen').update({ ...r.reeks, uitzonderingen: r.reeks.uitzonderingen ?? oud.uitzonderingen, updated_at: nu }).eq('id', oud.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true, id: oud.id })
    }

    // Acties op één keer: id = "reeks:<reeks>:<datum>" of { id, datum }.
    const keer = typeof b.id === 'string' ? leesReeksItemId(b.id) : null
    const reeksId = keer?.reeksId ?? (typeof b.id === 'string' && UUID.test(b.id) ? b.id : null)
    const datum = keer?.datum ?? (typeof b.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.datum) ? b.datum : null)

    if (actie === 'reeks.overslaan') {
      const r = await eigenReeks(admin, k, reeksId)
      if (!datum || !keren({ ...r, uitzonderingen: [] }, datum, datum).length) return fout('Op die dag valt de reeks niet.')
      const lijst = b.terug === true ? r.uitzonderingen.filter((d) => d !== datum) : Array.from(new Set([...r.uitzonderingen, datum])).sort()
      const { error } = await admin.from('ag_reeksen').update({ uitzonderingen: lijst, updated_at: nu }).eq('id', r.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    if (actie === 'reeks.stop') {
      // Stoppen = vanaf die dag niet meer (wat voorbij is, blijft).
      const r = await eigenReeks(admin, k, reeksId)
      if (!datum) return fout('Vanaf wanneer?')
      const eind = new Date(Date.parse(`${datum}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
      if (eind < r.start_datum) {
        const { error } = await admin.from('ag_reeksen').update({ verwijderd_op: nu, updated_at: nu }).eq('id', r.id)
        if (error) throw new Error(error.message)
      } else {
        const { error } = await admin.from('ag_reeksen').update({ eind_datum: eind, updated_at: nu }).eq('id', r.id)
        if (error) throw new Error(error.message)
      }
      return NextResponse.json({ ok: true })
    }
    if (actie === 'reeks.verwijder') {
      // Naar de prullenbak (verwijderd_op), nooit echt weg. Keren die een eigen taak werden, blijven staan.
      const r = await eigenReeks(admin, k, reeksId)
      const { error } = await admin.from('ag_reeksen').update({ verwijderd_op: b.terug === true ? null : nu, updated_at: nu }).eq('id', r.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    if (actie === 'reeks.keer') {
      // Een keer van een herhalende taak afvinken of openen: dan wordt het een gewone taak.
      const r = await eigenReeks(admin, k, reeksId)
      if (!datum) return fout('Welke dag?')
      if (r.soort !== 'taak' && b.klaar === true) return fout('Enkel een taak vink je af.')
      const id = await keerAlsItem(admin, k, r, datum, b.klaar === true)
      return NextResponse.json({ ok: true, id })
    }
    if (actie === 'beschikbaarheid.zet') {
      // Je eigen beschikbaarheid; een zaakvoerder ook die van anderen.
      const persoon = typeof b.persoon_id === 'string' && UUID.test(b.persoon_id) ? b.persoon_id : k.persoonId
      if (persoon !== k.persoonId && !k.isAdmin) return fout('Je kan enkel je eigen beschikbaarheid aanpassen.', 403)
      const r = controleerBeschikbaarheid(b.dagen)
      if (!r.ok) return fout(r.fout)
      await admin.from('ag_beschikbaarheid').delete().eq('persoon_id', persoon)
      if (r.dagen.length) {
        const { error } = await admin.from('ag_beschikbaarheid').insert(r.dagen.map((d) => ({ ...d, persoon_id: persoon, updated_at: nu })))
        if (error) throw new Error(error.message)
      }
      return NextResponse.json({ ok: true })
    }
    if (actie === 'ical.nieuw') {
      // De link zelf toont de app één keer; we bewaren enkel de SHA-256.
      const token = await nieuweIcalLink(admin, k.persoonId, b.team === true)
      const basis = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
      return NextResponse.json({ ok: true, url: `${basis.replace(/\/$/, '')}/api/agenda/ical/${token}` })
    }
    if (actie === 'ical.intrekken') {
      await trekIcalIn(admin, k.persoonId, b.team === true)
      return NextResponse.json({ ok: true })
    }
    if (actie === 'verschil.gezien' || actie === 'verschil.overnemen') {
      // Gezien = de app-versie blijft (de melding verdwijnt, de import meldt hetzelfde niet opnieuw).
      // Overnemen = titel, status en datums uit ClickUp in de app zetten.
      if (typeof b.id !== 'string' || !UUID.test(b.id)) return fout('Onbekend item')
      const z = await laadZicht(admin, k)
      const { data } = await admin.from('ag_items').select(`${ITEM_VELDEN}, clickup_verschil`).eq('id', b.id).maybeSingle()
      const { data: tw } = await admin.from('ag_toegewezen').select('persoon_id').eq('item_id', b.id)
      if (!data || !itemZichtbaar(data as unknown as RuwItem, ((tw ?? []) as { persoon_id: string }[]).map((x) => x.persoon_id), z)) return fout('Je kan dit item niet zien.')
      const v = (data as { clickup_verschil?: { bijgewerkt?: string; titel?: string; status?: string; start_op?: string | null; eind_op?: string | null; deadline_op?: string | null } | null }).clickup_verschil
      const patch: Record<string, unknown> = { clickup_verschil_op: null }
      if (actie === 'verschil.overnemen') {
        if (!v?.bijgewerkt || !v.titel) return fout('Er is geen ClickUp-versie om over te nemen.')
        Object.assign(patch, { titel: v.titel, status: v.status === 'klaar' ? 'klaar' : 'open', start_op: v.start_op ?? null, eind_op: v.eind_op ?? null, deadline_op: v.deadline_op ?? null, clickup_bijgewerkt_op: v.bijgewerkt, updated_at: nu })
        if (v.status === 'klaar') Object.assign(patch, { afgerond_op: nu, afgerond_door: k.naam })
      }
      const { error } = await admin.from('ag_items').update(patch).eq('id', b.id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    return fout('Onbekende actie')
  } catch (e) {
    return fout(e instanceof Error ? e.message : 'Er ging iets mis')
  }
}
