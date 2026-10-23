import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { communityRechten, actorVan, naamVan } from '@/lib/community/server'
import { verstuurBericht } from '@/lib/community/versturen'
import { OPEN_STATUSSEN, isStatus, isCategorie, isOpen, magNaarStatus, STATUS_LABEL, type Status } from '@/lib/community/model'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UUID = /^[0-9a-f-]{36}$/i
const LIJST_VELDEN = 'id, client_id, kanaal_id, bron, netwerk, extern_id, parent_extern_id, post_tekst, post_url, auteur_naam, auteur_handle, tekst, ontvangen_op, antwoord_mogelijk_tot, categorie, status, voorstellen, gekozen_tekst, verstuur_fout, verstuurd_op, verstuurd_door'

/**
 * Inbox community management.
 *  GET            → lijst (standaard open berichten), gesorteerd op deadline; enkel
 *                   klanten met community management aan. ?id= → één bericht met draad.
 *  POST {actie}   → 'tekst' (antwoord bewaren), 'status' (naar klant / negeren /
 *                   terug naar nieuw / te beantwoorden) of 'versturen' (bevestigd
 *                   door de ingelogde persoon, na de preview in de inbox).
 */
export async function GET(req: NextRequest) {
  try {
    const r = await communityRechten()
    if (!r.bekijken) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sp = req.nextUrl.searchParams
    const admin = createAdminSupabaseClient()

    const { data: inst, error: instErr } = await admin.from('community_instellingen').select('client_id, klant_keurt_goed').eq('actief', true)
    if (instErr && /does not exist|schema cache/i.test(instErr.message)) return NextResponse.json({ error: 'De tabellen voor community management bestaan nog niet (migratie).' }, { status: 503 })
    const actief = ((inst ?? []) as { client_id: string; klant_keurt_goed: boolean }[])
    const klantIds = actief.map((x) => x.client_id)

    const id = sp.get('id')
    if (id) {
      if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
      const { data: b } = await admin.from('community_berichten').select('*').eq('id', id).maybeSingle()
      if (!b || !klantIds.includes(b.client_id)) return NextResponse.json({ error: 'Bericht niet gevonden (of community management staat uit voor deze klant).' }, { status: 404 })
      const draadQ = admin.from('community_berichten').select('id, auteur_naam, tekst, ontvangen_op, status, extern_id, parent_extern_id').eq('kanaal_id', b.kanaal_id).neq('id', b.id).order('ontvangen_op', { ascending: true }).limit(30)
      const { data: draad } = b.bron === 'dm'
        ? await draadQ.eq('bron', 'dm').eq('parent_extern_id', b.parent_extern_id ?? '')
        : b.post_extern_id ? await draadQ.eq('bron', 'comment').eq('post_extern_id', b.post_extern_id) : { data: [] }
      const [{ data: klant }, { data: kanaal }] = await Promise.all([
        admin.from('clients').select('id, company_name, email').eq('id', b.client_id).maybeSingle(),
        admin.from('community_kanalen').select('id, naam').eq('id', b.kanaal_id).maybeSingle(),
      ])
      return NextResponse.json({ bericht: { ...b, raw: undefined }, draad: draad ?? [], klant, kanaal, klantKeurtGoed: actief.find((x) => x.client_id === b.client_id)?.klant_keurt_goed ?? true, magAanpassen: r.aanpassen })
    }

    if (!klantIds.length) return NextResponse.json({ berichten: [], klanten: [], kanalen: [], magAanpassen: r.aanpassen })
    const [{ data: klanten }, { data: kanalen }] = await Promise.all([
      admin.from('clients').select('id, company_name').in('id', klantIds).order('company_name'),
      admin.from('community_kanalen').select('id, client_id, naam, netwerken, actief, laatst_gesynct, laatste_fout').in('client_id', klantIds).order('naam'),
    ])

    const statussen = (sp.get('status') ?? '').split(',').filter(isStatus)
    let q = admin.from('community_berichten').select(LIJST_VELDEN).in('client_id', klantIds)
      .in('status', statussen.length ? statussen : OPEN_STATUSSEN)
    const klant = sp.get('klant'); if (klant && UUID.test(klant)) q = q.eq('client_id', klant)
    const kanaal = sp.get('kanaal'); if (kanaal && UUID.test(kanaal)) q = q.eq('kanaal_id', kanaal)
    const netwerk = sp.get('netwerk'); if (netwerk) q = q.eq('netwerk', netwerk)
    const bron = sp.get('bron'); if (bron === 'comment' || bron === 'dm') q = q.eq('bron', bron)
    const categorie = sp.get('categorie')
    if (categorie === 'geen') q = q.is('categorie', null)
    else if (isCategorie(categorie)) q = q.eq('categorie', categorie)
    const { data, error } = await q.order('antwoord_mogelijk_tot', { ascending: true, nullsFirst: false }).order('ontvangen_op', { ascending: false }).limit(300)
    if (error) throw new Error(error.message)
    return NextResponse.json({ berichten: data ?? [], klanten: klanten ?? [], kanalen: kanalen ?? [], magAanpassen: r.aanpassen })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const r = await communityRechten()
    if (!r.aanpassen || !r.persoon) return NextResponse.json({ error: 'Je mag geen berichten behandelen.' }, { status: 403 })
    const body = await req.json().catch(() => ({}))
    const id = String(body.id ?? '')
    if (!UUID.test(id)) return NextResponse.json({ error: 'id ontbreekt' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: b } = await admin.from('community_berichten').select('id, client_id, status, netwerk, bron').eq('id', id).maybeSingle()
    if (!b) return NextResponse.json({ error: 'Bericht niet gevonden' }, { status: 404 })
    const { data: inst } = await admin.from('community_instellingen').select('actief').eq('client_id', b.client_id).maybeSingle()
    if (!inst?.actief) return NextResponse.json({ error: 'Community management staat uit voor deze klant.' }, { status: 409 })
    const { ip, userAgent } = requestMeta(req)
    const actor = actorVan(r.persoon)
    const audit = (action: string, summary: string, metadata: Record<string, unknown>) =>
      logAudit({ action, entityType: 'community_bericht', entityId: id, summary, actorUserId: actor.userId, actorEmail: actor.email, actorRole: actor.rol, metadata: { client_id: b.client_id, actor_naam: actor.naam, ...metadata }, ip, userAgent })

    if (body.actie === 'versturen') {
      const u = await verstuurBericht({ berichtId: id, tekst: String(body.tekst ?? ''), bevestigdDoor: naamVan(r.persoon), actor, via: 'beheer' })
      if (!u.ok) return NextResponse.json({ error: u.fout }, { status: u.status })
      return NextResponse.json({ ok: true, verstuurdOp: u.verstuurdOp })
    }

    if (body.actie === 'tekst') {
      if (!isOpen(b.status) && b.status !== 'fout') return NextResponse.json({ error: 'Dit bericht is niet meer open.' }, { status: 409 })
      const tekst = String(body.tekst ?? '').trim().slice(0, 2000) || null
      await admin.from('community_berichten').update({ gekozen_tekst: tekst, bijgewerkt_op: new Date().toISOString() }).eq('id', id)
      return NextResponse.json({ ok: true })
    }

    if (body.actie === 'status') {
      const naar = body.status as Status
      if (!isStatus(naar) || !magNaarStatus(b.status, naar)) return NextResponse.json({ error: `Van "${STATUS_LABEL[b.status as Status] ?? b.status}" naar "${STATUS_LABEL[naar] ?? naar}" kan niet.` }, { status: 409 })
      const { data: gewijzigd } = await admin.from('community_berichten')
        .update({ status: naar, ...(naar !== 'genegeerd' ? { verstuur_fout: null } : {}), bijgewerkt_op: new Date().toISOString() })
        .eq('id', id).eq('status', b.status).select('id')
      if (!gewijzigd?.length) return NextResponse.json({ error: 'Dit bericht werd intussen gewijzigd. Vernieuw de lijst.' }, { status: 409 })
      await audit('community.status', `${STATUS_LABEL[b.status as Status] ?? b.status} → ${STATUS_LABEL[naar]}`, { van: b.status, naar, via: 'beheer' })
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
