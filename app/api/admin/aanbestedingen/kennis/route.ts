import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, requireAdmin, insertResilient } from '@/lib/supabase/server'
import { workspaceVoor } from '@/lib/aanbestedingen/workspaces'
import { extractText } from '@/lib/aanbestedingen/extract'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * De kennisbank van een workspace: wie we zijn, wat we eerder deden, en wat
 * onze tarieven zijn.
 *
 * Dit is het enige wat de AI over ons weet. Zonder tarieven hier komt er nooit
 * een prijs uit een analyse — dat is met opzet, en het is de reden waarom dit
 * scherm bestaat.
 *
 * Lezen mag iedereen die bij de workspace mag. Wijzigen enkel een beheerder:
 * hier staan onze tarieven, en een verkeerd tarief werkt door in elke offerte.
 */

const BUCKET = 'aanbestedingen'
const MAX_UPLOAD = 20 * 1024 * 1024

async function scope(req: NextRequest, filterId?: string) {
  const actor = await requireStaff()
  if (!actor) return null
  const isAdmin = !!(await requireAdmin())
  const id = filterId ?? String(req.nextUrl.searchParams.get('filterId') ?? '').trim()
  if (!id) return { actor, isAdmin, ws: null }
  return { actor, isAdmin, ws: await workspaceVoor(id, actor.id, isAdmin) }
}

export async function GET(req: NextRequest) {
  try {
    const s = await scope(req)
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!s.ws) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })

    const admin = createAdminSupabaseClient()
    const [kennis, referenties, tarieven, documenten] = await Promise.all([
      admin.from('aanbesteding_kennis').select('*').eq('filter_id', s.ws.id).maybeSingle(),
      admin.from('aanbesteding_referenties').select('*').eq('filter_id', s.ws.id).order('created_at'),
      admin.from('aanbesteding_tarieven').select('*').eq('filter_id', s.ws.id).order('created_at'),
      // Bewust NIET de tekst zelf meelezen: die is tot 200.000 tekens per
      // document en we hebben hier enkel de lengte nodig.
      admin.from('aanbesteding_kennisdocumenten')
        .select('id, name, kind, size_bytes, tekst_status, char_count')
        .eq('filter_id', s.ws.id).order('created_at')
        // Zonder de laatste migratie bestaat char_count nog niet; dan de lijst
        // tonen zonder tellingen in plaats van het scherm te laten struikelen.
        .then((r) => r.error
          ? admin.from('aanbesteding_kennisdocumenten')
            .select('id, name, kind, size_bytes, tekst_status')
            .eq('filter_id', s.ws!.id).order('created_at')
          : r),
    ])

    return NextResponse.json({
      workspace: { id: s.ws.id, naam: s.ws.naam },
      isAdmin: s.isAdmin,
      kennis: kennis.data ?? { filter_id: s.ws.id },
      referenties: referenties.data ?? [],
      tarieven: tarieven.data ?? [],
      documenten: documenten.data ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** PUT — de vaste gegevens (visie, ondernemingsnummer, contact). */
export async function PUT(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}))
    const s = await scope(req, String(b.filterId ?? '').trim() || undefined)
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!s.ws) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })
    if (!s.isAdmin) return NextResponse.json({ error: 'Enkel een beheerder kan dit wijzigen' }, { status: 403 })

    const tekst = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('aanbesteding_kennis').upsert({
      filter_id: s.ws.id,
      visie: tekst(b.visie, 8000),
      ondernemingsnummer: tekst(b.ondernemingsnummer, 40),
      adres: tekst(b.adres, 300),
      tekenbevoegde: tekst(b.tekenbevoegde, 150),
      contact_naam: tekst(b.contact_naam, 150),
      contact_email: tekst(b.contact_email, 200),
      contact_telefoon: tekst(b.contact_telefoon, 60),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'filter_id' })
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'aanbestedingen.kennis.save', entityType: 'aanbestedingen_filter', entityId: s.ws.id,
      summary: `Aanbestedingen ${s.ws.naam}: kennisbank bijgewerkt`,
      actorUserId: s.actor.id, actorEmail: s.actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST — een referentie, een tarief of een document toevoegen.
 *
 * Een document komt als multipart binnen; de rest als JSON.
 */
export async function POST(req: NextRequest) {
  try {
    const isBestand = (req.headers.get('content-type') ?? '').includes('multipart/form-data')
    if (isBestand) return await voegDocumentToe(req)

    const b = await req.json().catch(() => ({}))
    const s = await scope(req, String(b.filterId ?? '').trim() || undefined)
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!s.ws) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })
    if (!s.isAdmin) return NextResponse.json({ error: 'Enkel een beheerder kan dit wijzigen' }, { status: 403 })

    const admin = createAdminSupabaseClient()

    if (b.type === 'referentie') {
      const klant = String(b.klant ?? '').trim().slice(0, 200)
      if (!klant) return NextResponse.json({ error: 'Geef minstens een klant op.' }, { status: 400 })
      const { error } = await admin.from('aanbesteding_referenties').insert({
        filter_id: s.ws.id,
        klant,
        wat_we_deden: String(b.wat_we_deden ?? '').trim().slice(0, 2000),
        resultaat: String(b.resultaat ?? '').trim().slice(0, 1000),
        sector_type: String(b.sector_type ?? '').trim().slice(0, 100),
      })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    if (b.type === 'tarief') {
      const dienst = String(b.dienst ?? '').trim().slice(0, 200)
      const tarief = Number(b.tarief)
      if (!dienst) return NextResponse.json({ error: 'Geef een dienst op.' }, { status: 400 })
      // Een tarief van nul is geen tarief. Zonder deze controle sluipt er een
      // 0 in de kennisbank en rekent de analyse daar vrolijk mee.
      if (!Number.isFinite(tarief) || tarief <= 0) {
        return NextResponse.json({ error: 'Geef een tarief groter dan nul op.' }, { status: 400 })
      }
      const { error } = await admin.from('aanbesteding_tarieven').insert({
        filter_id: s.ws.id,
        dienst,
        tarief,
        eenheid: String(b.eenheid ?? 'uur').trim().slice(0, 40) || 'uur',
        opmerking: String(b.opmerking ?? '').trim().slice(0, 500),
      })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Onbekend type' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * Een eigen document toevoegen (portfolio of prijslijst) en er meteen tekst uit
 * halen. Zonder die tekst is het bestand voor de AI onzichtbaar, dus dat doen
 * we nu en niet later — en als het niet lukt, zeggen we dat meteen.
 */
async function voegDocumentToe(req: NextRequest) {
  const form = await req.formData()
  const filterId = String(form.get('filterId') ?? '').trim()
  const s = await scope(req, filterId || undefined)
  if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  if (!s.ws) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })
  if (!s.isAdmin) return NextResponse.json({ error: 'Enkel een beheerder kan dit wijzigen' }, { status: 403 })

  const bestand = form.get('bestand')
  if (!(bestand instanceof File)) return NextResponse.json({ error: 'Geen bestand meegestuurd.' }, { status: 400 })
  if (bestand.size > MAX_UPLOAD) {
    return NextResponse.json({ error: 'Dat bestand is groter dan 20 MB.' }, { status: 413 })
  }

  const kind = String(form.get('kind') ?? 'portfolio') === 'prijslijst' ? 'prijslijst' : 'portfolio'
  const bytes = new Uint8Array(await bestand.arrayBuffer())
  const admin = createAdminSupabaseClient()

  // De emmer bestaat waarschijnlijk nog niet; hem hier aanmaken scheelt een
  // handmatige stap in Supabase. Bestaat hij al, dan is dit een lege fout.
  try { await admin.storage.createBucket(BUCKET, { public: false }) } catch { /* bestaat al */ }

  const pad = `${s.ws.id}/${Date.now()}-${bestand.name.replace(/[^\w.\-]/g, '_')}`
  const { error: uploadFout } = await admin.storage.from(BUCKET)
    .upload(pad, bytes, { contentType: bestand.type || 'application/octet-stream', upsert: false })
  if (uploadFout) {
    return NextResponse.json({ error: `Uploaden mislukt: ${uploadFout.message}` }, { status: 502 })
  }

  const r = await extractText(bestand.name, bytes)

  // Veerkrachtig: char_count kwam er later bij, dus zonder de laatste migratie
  // moet dit nog steeds lukken. De naam en het pad zijn wél verplicht — zonder
  // die twee heb je een rij die naar niets wijst.
  const { error } = await insertResilient(admin, 'aanbesteding_kennisdocumenten', {
    filter_id: s.ws.id,
    name: bestand.name.slice(0, 200),
    storage_path: pad,
    size_bytes: bestand.size,
    mime: bestand.type ?? '',
    kind,
    tekst: r.leesbaar ? r.tekst.slice(0, 200_000) : null,
    char_count: r.leesbaar ? Math.min(r.tekst.length, 200_000) : 0,
    tekst_status: r.status,
    tekst_op: new Date().toISOString(),
  }, { required: ['filter_id', 'name', 'storage_path'] })
  if (error) throw new Error(error.message)

  return NextResponse.json({
    ok: true,
    leesbaar: r.leesbaar,
    tekens: r.char_count,
    // Een onleesbaar bestand is geen fout maar wel nutteloos voor de AI. Dat
    // hoort de gebruiker meteen te weten, niet pas als een analyse tegenvalt.
    waarschuwing: r.leesbaar ? undefined
      : `Er kwam geen tekst uit dit bestand (${r.status}). Het is bewaard, maar de AI kan er niets mee.`,
  })
}

/** DELETE — een referentie, tarief of document weg. */
export async function DELETE(req: NextRequest) {
  try {
    const s = await scope(req)
    if (!s) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!s.ws) return NextResponse.json({ error: 'Workspace niet gevonden' }, { status: 404 })
    if (!s.isAdmin) return NextResponse.json({ error: 'Enkel een beheerder kan dit wijzigen' }, { status: 403 })

    const type = String(req.nextUrl.searchParams.get('type') ?? '')
    const id = String(req.nextUrl.searchParams.get('id') ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen id opgegeven' }, { status: 400 })

    const tabel = type === 'referentie' ? 'aanbesteding_referenties'
      : type === 'tarief' ? 'aanbesteding_tarieven'
        : type === 'document' ? 'aanbesteding_kennisdocumenten'
          : null
    if (!tabel) return NextResponse.json({ error: 'Onbekend type' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    // Bij een document ook het bestand zelf opruimen; anders blijft er opslag
    // achter waar niemand nog bij kan.
    if (tabel === 'aanbesteding_kennisdocumenten') {
      const { data } = await admin.from(tabel).select('storage_path')
        .eq('id', id).eq('filter_id', s.ws.id).maybeSingle()
      const pad = (data as { storage_path: string } | null)?.storage_path
      if (pad) { try { await admin.storage.from(BUCKET).remove([pad]) } catch { /* niet fataal */ } }
    }

    // filter_id meefilteren: zo kan je met een geraden id niets uit een andere
    // workspace verwijderen.
    const { error } = await admin.from(tabel).delete().eq('id', id).eq('filter_id', s.ws.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
