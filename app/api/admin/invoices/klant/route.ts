import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { normalizeBtw, validateBtw } from '@/lib/btw'
import type { KlantInfo } from '@/lib/facturatie/item-model'

export const dynamic = 'force-dynamic'

/**
 * Klantgegevens vanuit Facturen — altijd de CENTRALE klantenlijst (clients),
 * nooit een kopie: wat hier aangepast wordt, staat meteen ook in de klanthub.
 *  GET ?id=        → facturatiegegevens van één klant
 *  GET ?btw=       → bestaat er al een klant met dit btw-nummer?
 *  POST            → nieuwe klant (enkel naam + btw-nummer verplicht)
 *  PATCH { id, … } → facturatiegegevens aanvullen (contact, e-mail, telefoon, btw, adres)
 */

const UUID = /^[0-9a-f-]{36}$/i
const KOLOMMEN = 'id, company_name, contact_name, email, facturatie_email, telefoon, btw_nummer, adres_straat, adres_postcode, adres_gemeente, adres_land'
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const tekst = (v: unknown, max: number): string | null => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null }

type Rij = { id: string; company_name: string; contact_name: string | null; email: string | null; facturatie_email: string | null; telefoon: string | null; btw_nummer: string | null; adres_straat: string | null; adres_postcode: string | null; adres_gemeente: string | null; adres_land: string | null }
const naarInfo = (r: Rij): KlantInfo => ({
  id: r.id, naam: r.company_name, contact: r.contact_name, email: r.email, facturatie_email: r.facturatie_email, telefoon: r.telefoon,
  btw: r.btw_nummer, straat: r.adres_straat, postcode: r.adres_postcode, gemeente: r.adres_gemeente, land: r.adres_land,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function zoekOpBtw(admin: { from: (t: string) => any }, btw: string, behalve?: string): Promise<{ id: string; naam: string } | null> {
  const doel = normalizeBtw(btw)
  if (!doel) return null
  const { data } = await admin.from('clients').select('id, company_name, btw_nummer').not('btw_nummer', 'is', null)
  const hit = ((data ?? []) as { id: string; company_name: string; btw_nummer: string }[]).find((k) => k.id !== behalve && normalizeBtw(k.btw_nummer) === doel)
  return hit ? { id: hit.id, naam: hit.company_name } : null
}

/** Optionele velden uit de invoer, gevalideerd. */
function optioneel(b: Record<string, unknown>): { velden: Record<string, unknown>; fout?: string } {
  const v: Record<string, unknown> = {}
  if ('contact' in b) v.contact_name = tekst(b.contact, 120)
  if ('email' in b) { const e = tekst(b.email, 200)?.toLowerCase() ?? null; if (e && !EMAIL.test(e)) return { velden: v, fout: 'Het e-mailadres is niet geldig.' }; v.email = e }
  if ('facturatie_email' in b) { const e = tekst(b.facturatie_email, 200)?.toLowerCase() ?? null; if (e && !EMAIL.test(e)) return { velden: v, fout: 'Het facturatie-e-mailadres is niet geldig.' }; v.facturatie_email = e }
  if ('telefoon' in b) v.telefoon = tekst(b.telefoon, 40)
  if ('straat' in b) v.adres_straat = tekst(b.straat, 200)
  if ('postcode' in b) v.adres_postcode = tekst(b.postcode, 20)
  if ('gemeente' in b) v.adres_gemeente = tekst(b.gemeente, 120)
  if ('land' in b) v.adres_land = tekst(b.land, 80)
  return { velden: v }
}

export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const sp = req.nextUrl.searchParams
    const btw = sp.get('btw')
    if (btw !== null) return NextResponse.json({ bestaand: await zoekOpBtw(admin, btw, sp.get('behalve') ?? undefined) })
    const id = sp.get('id') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldige klant' }, { status: 400 })
    const { data } = await admin.from('clients').select(KOLOMMEN).eq('id', id).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
    return NextResponse.json({ klant: naarInfo(data as Rij) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const naam = tekst(b.naam, 200)
    if (!naam) return NextResponse.json({ error: 'De naam of bedrijfsnaam is verplicht.' }, { status: 400 })
    if (!tekst(b.btw, 40)) return NextResponse.json({ error: 'Het btw-nummer is verplicht.' }, { status: 400 })
    const btw = validateBtw(String(b.btw))
    if (!btw.ok) return NextResponse.json({ error: btw.error ?? 'Ongeldig btw-nummer.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const bestaand = await zoekOpBtw(admin, btw.value)
    if (bestaand) return NextResponse.json({ error: `Er bestaat al een klant met dit btw-nummer: ${bestaand.naam}.`, bestaand }, { status: 409 })
    const o = optioneel(b)
    if (o.fout) return NextResponse.json({ error: o.fout }, { status: 400 })
    const { data, error } = await admin.from('clients').insert({ company_name: naam, btw_nummer: btw.value, created_by: actor.id, ...o.velden }).select(KOLOMMEN).single()
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({ action: 'client.create', entityType: 'client', entityId: (data as Rij).id, summary: `Klant aangemaakt vanuit Facturen: ${naam} (${btw.value})`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent })
    try { revalidatePath('/admin/clients') } catch { /* */ }
    return NextResponse.json({ klant: naarInfo(data as Rij) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = String(b.id ?? '')
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldige klant' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('clients').select(KOLOMMEN).eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
    const o = optioneel(b)
    if (o.fout) return NextResponse.json({ error: o.fout }, { status: 400 })
    const patch: Record<string, unknown> = { ...o.velden }
    if ('btw' in b) {
      const btw = validateBtw(String(b.btw ?? ''))
      if (!btw.ok) return NextResponse.json({ error: btw.error ?? 'Ongeldig btw-nummer.' }, { status: 400 })
      if (btw.value) {
        const dubbel = await zoekOpBtw(admin, btw.value, id)
        if (dubbel) return NextResponse.json({ error: `Dit btw-nummer hoort al bij ${dubbel.naam}.`, bestaand: dubbel }, { status: 409 })
      }
      patch.btw_nummer = btw.value || null
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ klant: naarInfo(oud as Rij) })
    patch.updated_at = new Date().toISOString()
    const { data, error } = await admin.from('clients').update(patch).eq('id', id).select(KOLOMMEN).single()
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({ action: 'client.facturatiegegevens', entityType: 'client', entityId: id, summary: `Facturatiegegevens aangepast vanuit Facturen (${Object.keys(patch).filter((k) => k !== 'updated_at').join(', ')})`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent })
    try { revalidatePath(`/admin/clients/${id}`) } catch { /* */ }
    return NextResponse.json({ klant: naarInfo(data as Rij) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
