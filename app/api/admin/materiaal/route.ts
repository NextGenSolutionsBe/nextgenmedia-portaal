import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { sendEmail, EMAIL_FROM } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { mailUitgeleend, mailTeruggebracht, typeUitPersoneel, ONTLENER_TYPES, type Uitlening } from '@/lib/materiaal/model'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Materiaalbeheer & uitleenregistratie.
 *  GET  → materiaal, categorieën, ontleners (personeel = centrale bron + externen),
 *         uitleningen en activiteiten.
 *  POST → acties. Rechten (backend, niet enkel knoppen):
 *    · bekijken     — alles zien
 *    · goedkeuren   — uitlenen, terugnemen, mail opnieuw, corrigeren (standaard enkel beheerders)
 *    · instellingen — materiaal, categorieën en medewerkers beheren
 * Atomair: een unieke index laat nooit twee actieve uitleningen per item toe;
 * terugnemen werkt enkel op een nog openstaande uitlening; elke handeling heeft
 * een actie_sleutel zodat dubbelklikken of opnieuw proberen niets dubbel doet.
 * Een mislukte mail maakt de registratie nooit ongedaan.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: any }
const UUID = /^[0-9a-f-]{36}$/i
const ISO = /^\d{4}-\d{2}-\d{2}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const BUCKET = 'documenten'
const tekst = (v: unknown, max = 500) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null }
const getal = (v: unknown) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null }
const tijdstip = (v: unknown): string | null => { if (!v) return null; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString() }

async function rechten() {
  const [bekijken, uitlenen, beheren] = await Promise.all([magIk('materiaal', 'bekijken'), magIk('materiaal', 'goedkeuren'), magIk('materiaal', 'instellingen')])
  const p = bekijken ?? uitlenen ?? beheren
  return { persoon: p, bekijken: !!(bekijken || uitlenen || beheren), uitlenen: !!uitlenen, beheren: !!beheren }
}
const wie = (p: { naam: string | null; email: string } | null) => (p ? p.naam || p.email : null)

async function log(admin: Admin, rij: { soort: string; item_id?: string | null; ontlener_id?: string | null; uitlening_id?: string | null; door: string | null; opmerking?: string | null; meta?: Record<string, unknown> | null }) {
  await admin.from('materiaal_activiteiten').insert({ ...rij, op: new Date().toISOString() })
}

/** Personeel is de centrale bron: elke medewerker krijgt automatisch een ontlener (naam en e-mail volgen Personeel). */
async function syncPersoneel(admin: Admin) {
  const [{ data: mensen }, { data: ontl }] = await Promise.all([
    admin.from('personeel').select('id, voornaam, achternaam, email, telefoon, type, actief'),
    admin.from('materiaal_ontleners').select('id, personeel_id, voornaam, achternaam, email, telefoon, type, gearchiveerd_op').not('personeel_id', 'is', null),
  ])
  const per = new Map(((ontl ?? []) as Record<string, unknown>[]).map((o) => [String(o.personeel_id), o]))
  for (const m of (mensen ?? []) as { id: string; voornaam: string; achternaam: string | null; email: string | null; telefoon: string | null; type: string; actief: boolean }[]) {
    const o = per.get(m.id)
    if (!o) {
      if (m.actief === false) continue
      await admin.from('materiaal_ontleners').upsert({ personeel_id: m.id, voornaam: m.voornaam, achternaam: m.achternaam, email: m.email, telefoon: m.telefoon, type: typeUitPersoneel(m.type) }, { onConflict: 'personeel_id', ignoreDuplicates: true })
    } else if (o.voornaam !== m.voornaam || (o.achternaam ?? null) !== (m.achternaam ?? null) || (m.email && o.email !== m.email)) {
      await admin.from('materiaal_ontleners').update({ voornaam: m.voornaam, achternaam: m.achternaam, ...(m.email ? { email: m.email } : {}), updated_at: new Date().toISOString() }).eq('id', o.id)
    }
  }
}

export async function GET() {
  try {
    const r = await rechten()
    if (!r.bekijken) return NextResponse.json({ error: 'Geen toegang tot Materiaalbeheer.' }, { status: 403 })
    const admin = createAdminSupabaseClient() as unknown as Admin
    try { await syncPersoneel(admin) } catch { /* personeel is een gemak, geen vereiste */ }
    const [{ data: items }, { data: categorieen }, { data: ontleners }, { data: uitleningen }, { data: activiteiten }] = await Promise.all([
      admin.from('materiaal_items').select('*').order('naam'),
      admin.from('materiaal_categorieen').select('*').order('volgorde').order('naam'),
      admin.from('materiaal_ontleners').select('*').order('voornaam'),
      admin.from('materiaal_uitleningen').select('*').order('uitgeleend_op', { ascending: false }).limit(5000),
      admin.from('materiaal_activiteiten').select('*').order('op', { ascending: false }).limit(2000),
    ])
    // Foto's: tijdelijke links (privé-bucket).
    const metFoto = ((items ?? []) as { id: string; foto_pad: string | null }[]).filter((i) => i.foto_pad)
    const urls = new Map<string, string>()
    if (metFoto.length) {
      const { data } = await admin.storage.from(BUCKET).createSignedUrls(metFoto.map((i) => i.foto_pad), 3600)
      for (const [i, d] of ((data ?? []) as { signedUrl?: string }[]).entries()) if (d?.signedUrl) urls.set(metFoto[i].id, d.signedUrl)
    }
    return NextResponse.json({
      items: ((items ?? []) as Record<string, unknown>[]).map((i) => ({ ...i, foto_url: urls.get(String(i.id)) ?? null })),
      categorieen: categorieen ?? [], ontleners: ontleners ?? [], uitleningen: uitleningen ?? [], activiteiten: activiteiten ?? [],
      kan: { uitlenen: r.uitlenen, beheren: r.beheren }, ik: wie(r.persoon),
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

type Ontlener = { id: string; voornaam: string; achternaam: string | null; email: string | null }
type Item = { id: string; naam: string }

/** Mail versturen en de status op de uitlening(en) bijhouden. Een mislukte mail laat de registratie staan. */
async function verstuurMail(admin: Admin, soort: 'uit' | 'terug', ontlener: Ontlener, uitleningIds: string[], onderwerp: string, body: string, door: string | null): Promise<'verzonden' | 'mislukt' | 'geen_email'> {
  const kol = soort === 'uit' ? 'mail_uit' : 'mail_terug'
  if (!ontlener.email || !EMAIL.test(ontlener.email)) {
    await admin.from('materiaal_uitleningen').update({ [`${kol}_status`]: 'geen_email', [`${kol}_fout`]: 'Geen geldig e-mailadres', [`${kol}_op`]: new Date().toISOString() }).in('id', uitleningIds)
    return 'geen_email'
  }
  await admin.from('materiaal_uitleningen').update({ [`${kol}_status`]: 'bezig', [`${kol}_fout`]: null }).in('id', uitleningIds)
  const html = buildEmailHtml({ bodyText: body }), text = buildEmailText({ bodyText: body })
  const res = await sendEmail({ to: ontlener.email, subject: onderwerp, text, html })
  await admin.from('materiaal_uitleningen').update({ [`${kol}_status`]: res.ok ? 'verzonden' : 'mislukt', [`${kol}_fout`]: res.ok ? null : res.error ?? 'Onbekende fout', [`${kol}_id`]: res.id ?? null, [`${kol}_op`]: new Date().toISOString() }).in('id', uitleningIds)
  try { await admin.from('email_messages').insert({ to_email: ontlener.email, subject: onderwerp, body, html, from_email: EMAIL_FROM, kind: 'materiaal', audience: 'medewerker', status: res.ok ? 'sent' : 'error', error: res.ok ? null : res.error, provider_id: res.id ?? null, sent_by_email: door, related_id: uitleningIds[0] }) } catch { /* logboek E-mailcenter is een extra */ }
  return res.ok ? 'verzonden' : 'mislukt'
}

export async function POST(req: NextRequest) {
  try {
    const r = await rechten()
    if (!r.bekijken) return NextResponse.json({ error: 'Geen toegang tot Materiaalbeheer.' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const actie = String(b.actie ?? '')
    const admin = createAdminSupabaseClient() as unknown as Admin
    const ik = wie(r.persoon)
    const nu = new Date().toISOString()
    const mag = (soort: 'uitlenen' | 'beheren') => (r[soort] ? null : NextResponse.json({ error: soort === 'uitlenen' ? 'Enkel een bevoegde beheerder kan materiaal uitlenen of terugnemen.' : 'Enkel een beheerder kan materiaal en medewerkers beheren.' }, { status: 403 }))

    // ── Uitlenen (één of meerdere items aan dezelfde persoon) ──
    if (actie === 'uitlenen') {
      const nee = mag('uitlenen'); if (nee) return nee
      const ids = (Array.isArray(b.item_ids) ? b.item_ids : [b.item_id]).map(String).filter((x) => UUID.test(x))
      const ontlenerId = String(b.ontlener_id ?? '')
      const sleutel = typeof b.sleutel === 'string' && /^[0-9a-zA-Z-]{8,64}$/.test(b.sleutel) ? b.sleutel : null
      if (!ids.length) return NextResponse.json({ error: 'Kies het materiaal.' }, { status: 400 })
      if (!UUID.test(ontlenerId)) return NextResponse.json({ error: 'Kies aan wie je uitleent.' }, { status: 400 })
      if (!sleutel) return NextResponse.json({ error: 'Ongeldige handeling — herlaad het venster.' }, { status: 400 })
      const op = tijdstip(b.uitgeleend_op) ?? nu
      const verwacht = typeof b.verwacht_terug === 'string' && ISO.test(b.verwacht_terug) ? b.verwacht_terug : null
      const opmerking = tekst(b.opmerking, 1000)
      const { data: ontlener } = await admin.from('materiaal_ontleners').select('id, voornaam, achternaam, email, gearchiveerd_op').eq('id', ontlenerId).maybeSingle()
      if (!ontlener) return NextResponse.json({ error: 'Medewerker niet gevonden.' }, { status: 404 })
      if (ontlener.gearchiveerd_op) return NextResponse.json({ error: 'Deze medewerker is gearchiveerd.' }, { status: 400 })
      const { data: items } = await admin.from('materiaal_items').select('id, naam, gearchiveerd_op').in('id', ids)
      const gelukt: { uitlening_id: string; item: Item; nieuw: boolean }[] = []; const fouten: string[] = []
      for (const id of ids) {
        const item = ((items ?? []) as (Item & { gearchiveerd_op: string | null })[]).find((x) => x.id === id)
        if (!item) { fouten.push('Onbekend materiaal'); continue }
        if (item.gearchiveerd_op) { fouten.push(`${item.naam} is gearchiveerd`); continue }
        const actieSleutel = `${sleutel}:${id}`
        const { data, error } = await admin.from('materiaal_uitleningen').insert({ item_id: id, ontlener_id: ontlenerId, uitgeleend_op: op, verwacht_terug: verwacht, opmerking, uitgeleend_door: ik, actie_sleutel: actieSleutel }).select('id').single()
        if (error) {
          if (/actie_sleutel/.test(error.message) || (error.code === '23505' && /actie_sleutel/.test(String(error.details ?? '')))) {
            // Dezelfde handeling liep al (dubbelklik/netwerk): niets dubbel, geen tweede mail.
            const { data: al } = await admin.from('materiaal_uitleningen').select('id').eq('actie_sleutel', actieSleutel).maybeSingle()
            if (al) { gelukt.push({ uitlening_id: al.id, item, nieuw: false }); continue }
          }
          if (error.code === '23505') { fouten.push(`${item.naam} is al uitgeleend`); continue }
          throw new Error(error.message)
        }
        gelukt.push({ uitlening_id: data.id, item, nieuw: true })
        await log(admin, { soort: 'uitgeleend', item_id: id, ontlener_id: ontlenerId, uitlening_id: data.id, door: ik, opmerking, meta: { uitgeleend_op: op, verwacht_terug: verwacht } })
      }
      const nieuw = gelukt.filter((g) => g.nieuw)
      let mail: string | null = null
      if (nieuw.length) {
        const m = mailUitgeleend(ontlener.voornaam, nieuw.map((g) => ({ naam: g.item.naam, uitgeleend_op: op, verwacht_terug: verwacht })))
        mail = await verstuurMail(admin, 'uit', ontlener, nieuw.map((g) => g.uitlening_id), m.onderwerp, m.tekst, ik)
      }
      if (!gelukt.length) return NextResponse.json({ error: fouten.join(' · ') || 'Niets uitgeleend.' }, { status: 409 })
      return NextResponse.json({ ok: true, uitgeleend: gelukt.length, fouten, mail })
    }

    // ── Terugnemen (één item, één klik + bevestiging) ──
    if (actie === 'terugnemen') {
      const nee = mag('uitlenen'); if (nee) return nee
      const uid = String(b.uitlening_id ?? '')
      if (!UUID.test(uid)) return NextResponse.json({ error: 'Onbekende uitlening.' }, { status: 400 })
      const op = tijdstip(b.teruggebracht_op) ?? nu
      const terugOpmerking = tekst(b.terug_opmerking, 1000)
      // Atomair: enkel een nog openstaande uitlening — een tweede klik vindt niets meer.
      const { data: rijen, error } = await admin.from('materiaal_uitleningen').update({ teruggebracht_op: op, terug_opmerking: terugOpmerking, teruggenomen_door: ik }).eq('id', uid).is('teruggebracht_op', null).is('geannuleerd_op', null).select('*')
      if (error) throw new Error(error.message)
      const u = ((rijen ?? []) as Uitlening[])[0]
      if (!u) return NextResponse.json({ error: 'Dit materiaal is al als teruggebracht geregistreerd.', code: 'al_terug' }, { status: 409 })
      await log(admin, { soort: 'teruggebracht', item_id: u.item_id, ontlener_id: u.ontlener_id, uitlening_id: u.id, door: ik, opmerking: terugOpmerking, meta: { teruggebracht_op: op } })
      const [{ data: ontlener }, { data: item }] = await Promise.all([admin.from('materiaal_ontleners').select('id, voornaam, achternaam, email').eq('id', u.ontlener_id).maybeSingle(), admin.from('materiaal_items').select('id, naam').eq('id', u.item_id).maybeSingle()])
      const m = mailTeruggebracht(ontlener?.voornaam ?? '', { naam: item?.naam ?? 'Materiaal', uitgeleend_op: u.uitgeleend_op, teruggebracht_op: op })
      const mail = ontlener ? await verstuurMail(admin, 'terug', ontlener, [u.id], m.onderwerp, m.tekst, ik) : null
      return NextResponse.json({ ok: true, mail })
    }

    // ── Mislukte mail opnieuw verzenden ──
    if (actie === 'mail.opnieuw') {
      const nee = mag('uitlenen'); if (nee) return nee
      const uid = String(b.uitlening_id ?? ''); const soort = b.soort === 'terug' ? 'terug' : 'uit'
      const kol = soort === 'uit' ? 'mail_uit_status' : 'mail_terug_status'
      // Enkel een mislukte (of zonder adres) mail; tegelijk klikken verstuurt maar één keer.
      const { data: rijen } = await admin.from('materiaal_uitleningen').update({ [kol]: 'bezig' }).eq('id', uid).in(kol, ['mislukt', 'geen_email']).select('*')
      const u = ((rijen ?? []) as Uitlening[])[0]
      if (!u) return NextResponse.json({ error: 'Deze mail is niet mislukt of wordt al verstuurd.' }, { status: 409 })
      if (soort === 'terug' && !u.teruggebracht_op) return NextResponse.json({ error: 'Nog niet teruggebracht.' }, { status: 400 })
      const [{ data: ontlener }, { data: item }] = await Promise.all([admin.from('materiaal_ontleners').select('id, voornaam, achternaam, email').eq('id', u.ontlener_id).maybeSingle(), admin.from('materiaal_items').select('id, naam').eq('id', u.item_id).maybeSingle()])
      const m = soort === 'uit' ? mailUitgeleend(ontlener?.voornaam ?? '', [{ naam: item?.naam ?? 'Materiaal', uitgeleend_op: u.uitgeleend_op, verwacht_terug: u.verwacht_terug }]) : mailTeruggebracht(ontlener?.voornaam ?? '', { naam: item?.naam ?? 'Materiaal', uitgeleend_op: u.uitgeleend_op, teruggebracht_op: u.teruggebracht_op })
      const mail = ontlener ? await verstuurMail(admin, soort, ontlener, [u.id], m.onderwerp, m.tekst, ik) : 'mislukt'
      await log(admin, { soort: 'mail_opnieuw', item_id: u.item_id, ontlener_id: u.ontlener_id, uitlening_id: u.id, door: ik, meta: { soort, resultaat: mail } })
      return NextResponse.json({ ok: true, mail })
    }

    // ── Correctie of annulering van een foutieve registratie (met audittrail) ──
    if (actie === 'uitlening.corrigeer' || actie === 'uitlening.annuleer') {
      const nee = mag('uitlenen'); if (nee) return nee
      const uid = String(b.uitlening_id ?? '')
      const reden = tekst(b.reden, 500)
      if (!UUID.test(uid)) return NextResponse.json({ error: 'Onbekende uitlening.' }, { status: 400 })
      if (!reden) return NextResponse.json({ error: 'Geef de reden van de correctie.' }, { status: 400 })
      const { data: oud } = await admin.from('materiaal_uitleningen').select('*').eq('id', uid).maybeSingle()
      if (!oud) return NextResponse.json({ error: 'Onbekende uitlening.' }, { status: 404 })
      if (oud.geannuleerd_op) return NextResponse.json({ error: 'Deze registratie is al geannuleerd.' }, { status: 409 })
      if (actie === 'uitlening.annuleer') {
        const { data: rij } = await admin.from('materiaal_uitleningen').update({ geannuleerd_op: nu, geannuleerd_door: ik, annuleer_reden: reden }).eq('id', uid).is('geannuleerd_op', null).select('id')
        if (!rij?.length) return NextResponse.json({ error: 'Deze registratie is al geannuleerd.' }, { status: 409 })
        await log(admin, { soort: 'geannuleerd', item_id: oud.item_id, ontlener_id: oud.ontlener_id, uitlening_id: uid, door: ik, opmerking: reden, meta: { oud } })
        return NextResponse.json({ ok: true })
      }
      const patch: Record<string, unknown> = {}
      if ('uitgeleend_op' in b) { const t = tijdstip(b.uitgeleend_op); if (!t) return NextResponse.json({ error: 'Ongeldige uitleendatum.' }, { status: 400 }); patch.uitgeleend_op = t }
      if ('verwacht_terug' in b) patch.verwacht_terug = typeof b.verwacht_terug === 'string' && ISO.test(b.verwacht_terug) ? b.verwacht_terug : null
      if ('teruggebracht_op' in b && oud.teruggebracht_op) { const t = tijdstip(b.teruggebracht_op); if (!t) return NextResponse.json({ error: 'Ongeldige retourdatum.' }, { status: 400 }); patch.teruggebracht_op = t }
      if ('opmerking' in b) patch.opmerking = tekst(b.opmerking, 1000)
      if (!Object.keys(patch).length) return NextResponse.json({ error: 'Niets gewijzigd.' }, { status: 400 })
      const terug = String(patch.teruggebracht_op ?? oud.teruggebracht_op ?? ''), uit = String(patch.uitgeleend_op ?? oud.uitgeleend_op)
      if (terug && terug < uit) return NextResponse.json({ error: 'De retourdatum ligt vóór de uitleendatum.' }, { status: 400 })
      const { error } = await admin.from('materiaal_uitleningen').update(patch).eq('id', uid)
      if (error) throw new Error(error.message)
      await log(admin, { soort: 'correctie', item_id: oud.item_id, ontlener_id: oud.ontlener_id, uitlening_id: uid, door: ik, opmerking: reden, meta: { oud: Object.fromEntries(Object.keys(patch).map((k) => [k, oud[k]])), nieuw: patch } })
      return NextResponse.json({ ok: true })
    }

    // ── Vanaf hier: beheer (materiaal, categorieën, medewerkers) ──
    const nee = mag('beheren'); if (nee) return nee

    if (actie === 'item.maak' || actie === 'item.wijzig') {
      const naam = tekst(b.naam, 160)
      const categorie = typeof b.categorie_id === 'string' && UUID.test(b.categorie_id) ? b.categorie_id : null
      if (!naam) return NextResponse.json({ error: 'Geef het materiaal een naam.' }, { status: 400 })
      if (!categorie) return NextResponse.json({ error: 'Kies een categorie.' }, { status: 400 })
      const velden = {
        naam, categorie_id: categorie, merk: tekst(b.merk, 120), model: tekst(b.model, 120), serienummer: tekst(b.serienummer, 120),
        aankoopdatum: typeof b.aankoopdatum === 'string' && ISO.test(b.aankoopdatum) ? b.aankoopdatum : null, aankoopwaarde: getal(b.aankoopwaarde), opmerkingen: tekst(b.opmerkingen, 2000),
      }
      if (actie === 'item.maak') {
        // Zelfde serienummer twee keer = waarschijnlijk dubbel geregistreerd.
        if (velden.serienummer) { const { data: al } = await admin.from('materiaal_items').select('id, naam').eq('serienummer', velden.serienummer).is('gearchiveerd_op', null).maybeSingle(); if (al) return NextResponse.json({ error: `Serienummer ${velden.serienummer} is al geregistreerd (${al.naam}).` }, { status: 409 }) }
        const { data, error } = await admin.from('materiaal_items').insert({ ...velden, created_by: ik }).select('id').single()
        if (error) throw new Error(error.message)
        await log(admin, { soort: 'item_toegevoegd', item_id: data.id, door: ik, meta: velden })
        return NextResponse.json({ ok: true, id: data.id })
      }
      const id = String(b.id ?? '')
      const { data: oud } = await admin.from('materiaal_items').select('*').eq('id', id).maybeSingle()
      if (!oud) return NextResponse.json({ error: 'Materiaal niet gevonden.' }, { status: 404 })
      const { error } = await admin.from('materiaal_items').update({ ...velden, updated_at: nu }).eq('id', id)
      if (error) throw new Error(error.message)
      const gewijzigd = Object.fromEntries(Object.entries(velden).filter(([k, v]) => String(oud[k] ?? '') !== String(v ?? '')))
      if (Object.keys(gewijzigd).length) await log(admin, { soort: 'item_gewijzigd', item_id: id, door: ik, meta: { oud: Object.fromEntries(Object.keys(gewijzigd).map((k) => [k, oud[k]])), nieuw: gewijzigd } })
      return NextResponse.json({ ok: true, id })
    }
    if (actie === 'item.archiveer' || actie === 'item.herstel') {
      const id = String(b.id ?? '')
      if (actie === 'item.archiveer') {
        const { data: act } = await admin.from('materiaal_uitleningen').select('id').eq('item_id', id).is('teruggebracht_op', null).is('geannuleerd_op', null).maybeSingle()
        if (act) return NextResponse.json({ error: 'Dit materiaal is uitgeleend. Neem het eerst terug.' }, { status: 409 })
      }
      const { error } = await admin.from('materiaal_items').update(actie === 'item.archiveer' ? { gearchiveerd_op: nu, gearchiveerd_door: ik } : { gearchiveerd_op: null, gearchiveerd_door: null }).eq('id', id)
      if (error) throw new Error(error.message)
      await log(admin, { soort: actie === 'item.archiveer' ? 'item_gearchiveerd' : 'item_hersteld', item_id: id, door: ik })
      return NextResponse.json({ ok: true })
    }
    if (actie === 'categorie.maak') {
      const naam = tekst(b.naam, 60)
      if (!naam) return NextResponse.json({ error: 'Geef de categorie een naam.' }, { status: 400 })
      const { data, error } = await admin.from('materiaal_categorieen').insert({ naam }).select('id').single()
      if (error) return NextResponse.json({ error: /duplicate|unique/i.test(error.message) ? 'Die categorie bestaat al.' : error.message }, { status: 400 })
      return NextResponse.json({ ok: true, id: data.id })
    }
    if (actie === 'ontlener.maak' || actie === 'ontlener.wijzig') {
      const voornaam = tekst(b.voornaam, 80), achternaam = tekst(b.achternaam, 80), email = tekst(b.email, 200)
      if (!voornaam || !achternaam) return NextResponse.json({ error: 'Voornaam en achternaam zijn verplicht.' }, { status: 400 })
      if (!email || !EMAIL.test(email)) return NextResponse.json({ error: 'Een geldig e-mailadres is nodig voor de bevestigingsmails.' }, { status: 400 })
      const type = ONTLENER_TYPES.some((t) => t.key === b.type) ? b.type : null
      const velden = { voornaam, achternaam, email, telefoon: tekst(b.telefoon, 40), type }
      if (actie === 'ontlener.maak') {
        const { data: al } = await admin.from('materiaal_ontleners').select('id, voornaam, achternaam').ilike('email', email).maybeSingle()
        if (al) return NextResponse.json({ error: `${al.voornaam} ${al.achternaam ?? ''} staat al in de lijst met dit e-mailadres.`.trim() }, { status: 409 })
        const { data, error } = await admin.from('materiaal_ontleners').insert({ ...velden, created_by: ik }).select('id').single()
        if (error) throw new Error(error.message)
        await log(admin, { soort: 'ontlener_toegevoegd', ontlener_id: data.id, door: ik, meta: velden })
        return NextResponse.json({ ok: true, id: data.id })
      }
      const id = String(b.id ?? '')
      const { data: oud } = await admin.from('materiaal_ontleners').select('*').eq('id', id).maybeSingle()
      if (!oud) return NextResponse.json({ error: 'Medewerker niet gevonden.' }, { status: 404 })
      // Gekoppeld aan Personeel: naam komt uit Personeel (één bron); e-mail, telefoon en type mogen hier.
      const patch = oud.personeel_id ? { email, telefoon: velden.telefoon, type } : velden
      const { error } = await admin.from('materiaal_ontleners').update({ ...patch, updated_at: nu }).eq('id', id)
      if (error) throw new Error(error.message)
      await log(admin, { soort: 'ontlener_gewijzigd', ontlener_id: id, door: ik, meta: { oud: Object.fromEntries(Object.keys(patch).map((k) => [k, oud[k]])), nieuw: patch } })
      return NextResponse.json({ ok: true, id })
    }
    if (actie === 'ontlener.archiveer' || actie === 'ontlener.herstel') {
      const id = String(b.id ?? '')
      if (actie === 'ontlener.archiveer') {
        const { data: act } = await admin.from('materiaal_uitleningen').select('id').eq('ontlener_id', id).is('teruggebracht_op', null).is('geannuleerd_op', null).limit(1)
        if (act?.length) return NextResponse.json({ error: 'Deze persoon heeft nog materiaal in gebruik.' }, { status: 409 })
      }
      const { error } = await admin.from('materiaal_ontleners').update({ gearchiveerd_op: actie === 'ontlener.archiveer' ? nu : null }).eq('id', id)
      if (error) throw new Error(error.message)
      await log(admin, { soort: 'ontlener_gearchiveerd', ontlener_id: id, door: ik, meta: { gearchiveerd: actie === 'ontlener.archiveer' } })
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
