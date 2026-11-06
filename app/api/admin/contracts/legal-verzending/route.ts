import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { sendEmail, baseUrl } from '@/lib/email'
import { laatsteArchief, ARCHIEF_BUCKET } from '@/lib/contract-archief'
import { documentBestandsnaam } from '@/lib/contract-archief-model'
import { logAudit, requestMeta } from '@/lib/audit'
import {
  onderwerpVan, tekstVan, teVersturen, alVerstuurd, ontvangerVan, samenvatting,
  type ContractInfo, type VerzendRij,
} from '@/lib/contracten/legal-verzending'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Eenmalige archiefverzending: elk bestaand contract apart naar één adres,
 * met het contract als pdf en — als die er is — het ondertekeningscertificaat
 * als tweede pdf.
 *
 * Deze route wijzigt niets aan de contracten zelf: geen status, geen velden,
 * geen bestanden. Ze leest, mailt en schrijft enkel haar eigen verzendlijst
 * (`contract_legal_verzending`), die dubbele mails uitsluit.
 *
 * De browser stuurt in kleine rondes (max. 4 contracten per aanroep) zodat de
 * functie ruim binnen haar tijdslimiet blijft; er is bewust geen cron.
 */

const TABEL = 'contract_legal_verzending'
const CONTRACT_BUCKET = 'contracts'
/** Zoveel contracten per aanroep; de browser herhaalt tot alles weg is. */
const PER_RONDE = 4
const LINK_GELDIG = 7 * 24 * 3600

type ContractRij = ContractInfo & { signed_pdf_path: string | null; pdf_path: string | null }

async function laadContracten(admin: ReturnType<typeof createAdminSupabaseClient>): Promise<ContractRij[]> {
  const { data, error } = await admin
    .from('contracts')
    .select('id, title, status, contract_type, signed_at, start_date, end_date, pdf_path, signed_pdf_path, client_id, created_at')
    .order('created_at', { ascending: true })
    .limit(2000)
  if (error) throw new Error(error.message)
  const rijen = (data ?? []) as Record<string, unknown>[]
  const klantIds = [...new Set(rijen.map((r) => r.client_id).filter(Boolean) as string[])]
  const namen = new Map<string, string>()
  if (klantIds.length) {
    const { data: klanten } = await admin.from('clients').select('id, company_name').in('id', klantIds)
    for (const k of (klanten ?? []) as { id: string; company_name: string | null }[]) namen.set(k.id, k.company_name ?? '')
  }
  return rijen.map((r) => ({
    id: String(r.id),
    klantNaam: r.client_id ? (namen.get(String(r.client_id)) || null) : null,
    titel: (r.title as string | null) ?? null,
    contracttype: (r.contract_type as string | null) ?? null,
    status: (r.status as string | null) ?? null,
    signedAt: (r.signed_at as string | null) ?? null,
    startDatum: (r.start_date as string | null) ?? null,
    eindDatum: (r.end_date as string | null) ?? null,
    signed_pdf_path: (r.signed_pdf_path as string | null) ?? null,
    pdf_path: (r.pdf_path as string | null) ?? null,
  }))
}

async function laadVerzendingen(admin: ReturnType<typeof createAdminSupabaseClient>, ontvanger: string): Promise<VerzendRij[]> {
  const { data, error } = await admin.from(TABEL).select('contract_id, status, certificaat, fout, verstuurd_op, pogingen').eq('ontvanger', ontvanger)
  if (error) {
    // Vóór de migratie bestaat de tabel nog niet; dan is er simpelweg nog niets verstuurd.
    if (/does not exist|schema cache/i.test(error.message)) return []
    throw new Error(error.message)
  }
  return (data ?? []) as VerzendRij[]
}

/** Eén contract versturen. Raakt het contract niet aan; schrijft enkel de verzendlijst. */
async function verstuurEen(
  admin: ReturnType<typeof createAdminSupabaseClient>,
  c: ContractRij,
  ontvanger: string,
  actor: string | null,
): Promise<{ contractId: string; ok: boolean; certificaat: boolean; fout?: string }> {
  const onderwerp = onderwerpVan(c)
  let certificaat = false
  let fout: string | null = null
  let messageId: string | null = null

  try {
    const pad = c.signed_pdf_path ?? c.pdf_path
    if (!pad) throw new Error('Dit contract heeft geen pdf in de opslag.')
    const { data: contractLink, error: linkFout } = await admin.storage.from(CONTRACT_BUCKET).createSignedUrl(pad, LINK_GELDIG)
    if (linkFout || !contractLink?.signedUrl) throw new Error(`Contract-pdf niet bereikbaar: ${linkFout?.message ?? pad}`)

    // Het certificaat komt uitsluitend uit het bestaande archief: zo maken we
    // tijdens deze verzending geen enkel nieuw bestand aan.
    const archief = await laatsteArchief(admin, c.id)
    let certLink: string | null = null
    if (archief?.pad_certificaat) {
      const { data } = await admin.storage.from(ARCHIEF_BUCKET).createSignedUrl(archief.pad_certificaat, LINK_GELDIG)
      certLink = data?.signedUrl ?? null
      certificaat = !!certLink
    }

    const attachments = [
      { filename: documentBestandsnaam(c.signed_pdf_path ? 'getekend_contract' : 'origineel', c.klantNaam, c.titel, c.signedAt), path: contractLink.signedUrl },
      ...(certLink ? [{ filename: documentBestandsnaam('certificaat', c.klantNaam, c.titel, c.signedAt), path: certLink }] : []),
    ]
    const tekst = tekstVan(c, { certificaat, adminUrl: `${baseUrl()}/admin/contracts/${c.id}` })
    const res = await sendEmail({ to: ontvanger, subject: onderwerp, text: tekst, attachments })
    if (!res.ok) throw new Error(res.error ?? 'Verzenden mislukt')
    messageId = res.id ?? null
  } catch (e) {
    fout = e instanceof Error ? e.message : String(e)
  }

  const nu = new Date().toISOString()
  const rij: Record<string, unknown> = {
    contract_id: c.id, ontvanger, onderwerp, status: fout ? 'mislukt' : 'verstuurd',
    certificaat, fout, message_id: messageId, door: actor, updated_at: nu,
    verstuurd_op: fout ? null : nu,
  }
  const { data: bestaand } = await admin.from(TABEL).select('id, pogingen').eq('contract_id', c.id).eq('ontvanger', ontvanger).maybeSingle()
  if (bestaand) await admin.from(TABEL).update({ ...rij, pogingen: Number((bestaand as { pogingen: number }).pogingen ?? 1) + 1 }).eq('id', (bestaand as { id: string }).id)
  else await admin.from(TABEL).insert(rij)

  return { contractId: c.id, ok: !fout, certificaat, fout: fout ?? undefined }
}

/** GET — alle contracten met hun verzendstatus en het overzicht. */
export async function GET(req: NextRequest) {
  try {
    if (!(await magIk('contracts', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const ontvanger = ontvangerVan(new URL(req.url).searchParams.get('ontvanger'))
    const admin = createAdminSupabaseClient()
    const [contracten, verzendingen] = await Promise.all([laadContracten(admin), laadVerzendingen(admin, ontvanger)])

    // Welke contracten hebben een certificaat klaarliggen?
    const { data: arch } = await admin.from('contract_archief').select('contract_id').limit(5000)
    const metArchief = new Set(((arch ?? []) as { contract_id: string }[]).map((r) => r.contract_id))
    const per = new Map(verzendingen.map((r) => [r.contract_id, r]))

    const items = contracten.map((c) => ({
      id: c.id, klantNaam: c.klantNaam, titel: c.titel, contracttype: c.contracttype, status: c.status,
      signedAt: c.signedAt, startDatum: c.startDatum, eindDatum: c.eindDatum,
      heeftPdf: !!(c.signed_pdf_path ?? c.pdf_path),
      certificaatBeschikbaar: metArchief.has(c.id),
      verzending: per.get(c.id) ?? null,
    }))
    return NextResponse.json({ ontvanger, items, samenvatting: samenvatting(contracten, verzendingen) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST { action: 'verstuur' } — de volgende ronde contracten die nog nooit
 * succesvol verstuurd zijn. { action: 'opnieuw', id } — één mislukte mail
 * opnieuw proberen. Een contract dat al verstuurd is, gaat nooit opnieuw weg.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await magIk('contracts', 'aanpassen')
    if (!actor) return NextResponse.json({ error: 'Je hebt geen recht om contracten te versturen.' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; ontvanger?: string; max?: number }
    const ontvanger = ontvangerVan(b.ontvanger)
    const admin = createAdminSupabaseClient()
    const [contracten, verzendingen] = await Promise.all([laadContracten(admin), laadVerzendingen(admin, ontvanger)])
    const per = new Map(verzendingen.map((r) => [r.contract_id, r]))

    let ronde: ContractRij[]
    if (b.action === 'opnieuw') {
      const c = contracten.find((x) => x.id === String(b.id ?? ''))
      if (!c) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })
      if (alVerstuurd(per.get(c.id))) return NextResponse.json({ ok: true, overgeslagen: true, resultaten: [], melding: 'Deze mail is al succesvol verstuurd.' })
      ronde = [c]
    } else if (b.action === 'verstuur') {
      const max = Math.min(Math.max(Number(b.max ?? PER_RONDE) || PER_RONDE, 1), PER_RONDE)
      ronde = teVersturen(contracten, verzendingen, max) as ContractRij[]
    } else {
      return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    }

    const resultaten = []
    for (const c of ronde) {
      resultaten.push(await verstuurEen(admin, c, ontvanger, actor.email ?? null))
      // Rustig aan voor de mailprovider (en voor de mailbox van de ontvanger).
      await new Promise((r) => setTimeout(r, 600))
    }

    const na = await laadVerzendingen(admin, ontvanger)
    const rest = teVersturen(contracten, na).length
    if (resultaten.length) {
      const meta = requestMeta(req)
      await logAudit({
        action: 'contract.legal_verzending', entityType: 'contract', entityId: resultaten[0].contractId,
        summary: `Archiefmail naar ${ontvanger}: ${resultaten.filter((r) => r.ok).length} verstuurd, ${resultaten.filter((r) => !r.ok).length} mislukt (${rest} nog te doen)`,
        actorUserId: actor.userId, actorEmail: actor.email ?? null, actorRole: 'staff',
        metadata: { ontvanger, resultaten }, ip: meta.ip, userAgent: meta.userAgent,
      })
    }
    return NextResponse.json({ ok: true, resultaten, nogTeDoen: rest, samenvatting: samenvatting(contracten, na) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
