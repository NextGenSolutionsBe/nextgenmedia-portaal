import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, insertResilient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { dubbelSleutel, normaliseerRij, type AbmBedrijf } from '@/lib/abm'
import { valideerSnelleKlant, zoekDubbel, type BestaandeKlant } from '@/lib/clients/snel'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f-]{36}$/i
const MIST = /abm_bedrijven|schema cache/i
const HINT = 'Account-based marketing vereist een database-migratie (abm_bedrijven).'

/**
 * Account-based marketing op Projecten: bedrijven waar we gericht achter gaan.
 *  GET → de lijst.
 *  POST { actie: 'import', rijen }  → csv/xlsx-rijen toevoegen (dubbels op btw of naam overgeslagen).
 *  POST { actie: 'nieuw', ... }     → één bedrijf.
 *  POST { actie: 'wijzig', id, ... }
 *  POST { actie: 'verwijder', id }
 *  POST { actie: 'klant', id }      → klant aanmaken (of de bestaande koppelen) voor offerte, contract, meeting of klantaccount.
 *  POST { actie: 'opdracht', id, opdracht_id } → gekoppeld aan de kaart in Opvolging.
 * Rechten: module opdrachten (bekijken / toevoegen / aanpassen / verwijderen); een klant aanmaken vraagt clients/toevoegen.
 */
export async function GET() {
  try {
    if (!(await magIk('opdrachten', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('abm_bedrijven').select('*').order('created_at', { ascending: false }).limit(3000)
    if (error) return NextResponse.json(MIST.test(error.message) ? { bedrijven: [], hint: HINT } : { error: error.message }, { status: MIST.test(error.message) ? 200 : 400 })
    const ids = [...new Set(((data ?? []) as AbmBedrijf[]).map((b) => b.client_id).filter(Boolean))] as string[]
    const { data: k } = ids.length ? await admin.from('clients').select('id, company_name').in('id', ids) : { data: [] }
    const namen = new Map(((k ?? []) as { id: string; company_name: string }[]).map((x) => [x.id, x.company_name]))
    return NextResponse.json({ bedrijven: ((data ?? []) as AbmBedrijf[]).map((b) => ({ ...b, klant_naam: b.client_id ? namen.get(b.client_id) ?? null : null })) })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)
    const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : null

    if (b.actie === 'import' || b.actie === 'nieuw') {
      const p = await magIk('opdrachten', 'toevoegen')
      if (!p) return NextResponse.json({ error: 'Je mag hier niets toevoegen.' }, { status: 403 })
      const ruw = b.actie === 'nieuw' ? [b] : Array.isArray(b.rijen) ? (b.rijen as Record<string, unknown>[]).slice(0, 2000) : []
      const { data: al, error: e0 } = await admin.from('abm_bedrijven').select('naam, btw_nummer').limit(5000)
      if (e0) return NextResponse.json({ error: MIST.test(e0.message) ? HINT : e0.message }, { status: 400 })
      const gezien = new Set(((al ?? []) as { naam: string; btw_nummer: string | null }[]).map(dubbelSleutel))
      const nieuw: Record<string, unknown>[] = []
      let dubbel = 0, ongeldig = 0
      for (const r of ruw) {
        const n = normaliseerRij(r as Record<string, unknown>)
        if (!n) { ongeldig++; continue }
        const s = dubbelSleutel(n)
        if (gezien.has(s)) { dubbel++; continue }
        gezien.add(s)
        nieuw.push({ ...n, created_by: p.naam ?? p.email ?? null })
      }
      if (b.actie === 'nieuw' && !nieuw.length) return NextResponse.json({ error: ongeldig ? 'Vul minstens de bedrijfsnaam in.' : 'Dit bedrijf staat er al in.' }, { status: 400 })
      for (let i = 0; i < nieuw.length; i += 500) {
        const { error } = await admin.from('abm_bedrijven').insert(nieuw.slice(i, i + 500))
        if (error) throw new Error(error.message)
      }
      await logAudit({ action: 'abm.import', entityType: 'abm', entityId: null, summary: `Account-based marketing: ${nieuw.length} bedrijf/bedrijven toegevoegd${dubbel ? `, ${dubbel} dubbel` : ''}${ongeldig ? `, ${ongeldig} zonder naam` : ''}`, actorUserId: p.userId, actorEmail: p.email, ...meta })
      return NextResponse.json({ ok: true, toegevoegd: nieuw.length, dubbel, ongeldig })
    }

    if (!id) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const { data: rij } = await admin.from('abm_bedrijven').select('*').eq('id', id).maybeSingle()
    const bedrijf = rij as AbmBedrijf | null
    if (!bedrijf) return NextResponse.json({ error: 'Bedrijf niet gevonden.' }, { status: 404 })

    if (b.actie === 'wijzig') {
      if (!(await magIk('opdrachten', 'aanpassen'))) return NextResponse.json({ error: 'Je mag dit niet aanpassen.' }, { status: 403 })
      const n = normaliseerRij({ ...bedrijf, ...b } as Record<string, unknown>)
      if (!n) return NextResponse.json({ error: 'Vul minstens de bedrijfsnaam in.' }, { status: 400 })
      const { error } = await admin.from('abm_bedrijven').update({ ...n, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }
    if (b.actie === 'verwijder') {
      const p = await magIk('opdrachten', 'verwijderen')
      if (!p) return NextResponse.json({ error: 'Je mag dit niet verwijderen.' }, { status: 403 })
      await admin.from('abm_bedrijven').delete().eq('id', id)
      await logAudit({ action: 'abm.verwijderd', entityType: 'abm', entityId: id, summary: `Account-based marketing: ${bedrijf.naam} weggehaald`, actorUserId: p.userId, actorEmail: p.email, ...meta })
      return NextResponse.json({ ok: true })
    }
    if (b.actie === 'opdracht') {
      if (!(await magIk('opdrachten', 'aanpassen'))) return NextResponse.json({ error: 'Je mag dit niet aanpassen.' }, { status: 403 })
      const opdrachtId = typeof b.opdracht_id === 'string' && UUID.test(b.opdracht_id) ? b.opdracht_id : null
      await admin.from('abm_bedrijven').update({ opdracht_id: opdrachtId, updated_at: new Date().toISOString() }).eq('id', id)
      return NextResponse.json({ ok: true })
    }
    if (b.actie === 'klant') {
      if (bedrijf.client_id) return NextResponse.json({ ok: true, client_id: bedrijf.client_id })
      const p = await magIk('clients', 'toevoegen')
      if (!p) return NextResponse.json({ error: 'Je hebt geen recht om klanten toe te voegen.' }, { status: 403 })
      const v = valideerSnelleKlant({ company_name: bedrijf.naam, contact_name: bedrijf.contactpersoon, email: bedrijf.email, telefoon: bedrijf.telefoon, btw_nummer: bedrijf.btw_nummer, adres_gemeente: bedrijf.gemeente })
      if (!v.ok) return NextResponse.json({ error: `Klant aanmaken lukt niet: ${v.fout} Pas het bedrijf aan.` }, { status: 400 })
      // Bestaat de klant al (btw, naam, e-mail)? Dan koppelen we die, nooit dubbel aanmaken.
      const { data: bestaande } = await admin.from('clients').select('id, company_name, email, btw_nummer, archived_at').limit(5000)
      const d = zoekDubbel(v.waarde, (bestaande ?? []) as BestaandeKlant[])
      let clientId = d && !d.gearchiveerd ? d.id : null
      if (!clientId) {
        const { data: k, error } = await insertResilient(admin, 'clients', { ...v.waarde, website_url: bedrijf.website ?? null, niche: bedrijf.sector ?? null, created_by: p.userId }, { select: 'id', required: ['company_name'] })
        if (error || !k) throw new Error(error?.message ?? 'Klant aanmaken mislukt')
        clientId = (k as { id: string }).id
        try { await admin.from('client_upload_folders').insert({ client_id: clientId, naam: 'Algemeen', door_naam: 'NextGenMedia' }) } catch { /* bijzaak */ }
        await logAudit({ action: 'client.snel_aangemaakt', entityType: 'client', entityId: clientId, summary: `Klant "${bedrijf.naam}" aangemaakt vanuit account-based marketing`, actorUserId: p.userId, actorEmail: p.email, ...meta })
      }
      await admin.from('abm_bedrijven').update({ client_id: clientId, updated_at: new Date().toISOString() }).eq('id', id)
      return NextResponse.json({ ok: true, client_id: clientId, bestond: !!d && !d.gearchiveerd })
    }
    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}
