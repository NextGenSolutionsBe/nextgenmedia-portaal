import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin, requireStaff } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { listPipelines } from '@/lib/sales/pipelines'
import { analyseerScript, lijstScripts, SCRIPTS_HINT } from '@/lib/sales/scripts'
import { extractText } from '@/lib/aanbestedingen/extract'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'

export const dynamic = 'force-dynamic'
// De AI-analyse van een lang script mag even duren.
export const maxDuration = 120

/**
 * Belscripts: uploaden, analyseren, beheren.
 *
 * Elke actieve werknemer mag zijn eigen script beheren — een setter hoeft geen
 * admin te vragen om zijn belscript bij te werken. De ruwe tekst is de bron;
 * de AI-analyse (secties + bezwaren) wordt bij het opslaan meteen gemaakt.
 */

const MIST = /sales_scripts|does not exist|schema cache/i
const MAX_BESTAND = 10 * 1024 * 1024

export async function GET() {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const uit = await lijstScripts()
    const pipelines = await listPipelines()
    return NextResponse.json({
      ...uit,
      pipelines: pipelines.map((p) => ({ id: p.id, name: p.name })),
      // Zodat Focus Mode met kiesScript hetzelfde script kiest als de server.
      mijnAuthId: actor.id,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * Nieuw script. multipart met `bestand` (pdf/docx/txt) óf een veld `tekst`.
 * De analyse draait meteen: een script zonder analyse is in Focus Mode niets
 * waard, dus dan hoor je de fout nú, niet pas tijdens het bellen.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const fd = await req.formData()
    const bestand = fd.get('bestand') as File | null
    let tekst = String(fd.get('tekst') ?? '').trim()
    let bronBestand: string | null = null

    if (bestand && bestand.size > 0) {
      if (bestand.size > MAX_BESTAND) {
        return NextResponse.json({ error: 'Bestand te groot (max 10 MB).' }, { status: 400 })
      }
      const naam = (bestand.name ?? '').toLowerCase()
      if (/\.(txt|md)$/.test(naam)) {
        // Platte tekst rechtstreeks; extractText kent dit formaat niet.
        tekst = (await bestand.text()).trim()
      } else {
        const uit = await extractText(bestand.name, new Uint8Array(await bestand.arrayBuffer()))
        if (!uit.leesbaar || !uit.tekst.trim()) {
          return NextResponse.json({
            error: `Kon geen tekst uit "${bestand.name}" halen (${uit.status}). Plak de tekst dan rechtstreeks.`,
          }, { status: 400 })
        }
        tekst = uit.tekst.trim()
      }
      bronBestand = bestand.name
    }
    if (!tekst) return NextResponse.json({ error: 'Geef een script mee: een bestand of geplakte tekst.' }, { status: 400 })

    const naam = String(fd.get('naam') ?? '').trim().slice(0, 120)
      || bronBestand?.replace(/\.[^.]+$/, '').slice(0, 120)
      || 'Belscript'

    // Van wie is dit script? 'mij' = de indiener zelf; 'algemeen' = iedereen.
    // Een ALGEMEEN script raakt iedereen die belt, dus dat zet alleen een
    // admin neer — anders overschrijft de ene setter stilzwijgend wat de
    // andere in Focus Mode voorgeschoteld krijgt.
    const wilAlgemeen = String(fd.get('eigenaar') ?? 'mij') === 'algemeen'
    if (wilAlgemeen && !(await requireAdmin())) {
      return NextResponse.json({
        error: 'Een script voor iedereen kan alleen een beheerder plaatsen. Bewaar het als je eigen script.',
      }, { status: 403 })
    }
    const eigenaar = wilAlgemeen ? null : actor.id

    // Merk is optioneel; een onbekend id wordt genegeerd, niet overgenomen.
    const pipelines = await listPipelines()
    const pipelineId = pipelines.find((p) => p.id === String(fd.get('pipelineId') ?? ''))?.id ?? null

    const { analyse, model } = await analyseerScript(tekst)

    const admin = createAdminSupabaseClient()
    const org = await getOrCreateSalesOrg()
    const { data, error } = await admin.from('sales_scripts').insert({
      sales_client_id: org.id,
      naam,
      eigenaar_auth_id: eigenaar,
      pipeline_id: pipelineId,
      ruwe_tekst: tekst,
      bron_bestand: bronBestand,
      analyse,
      analyse_model: model,
      geanalyseerd_op: new Date().toISOString(),
    }).select('id').single()

    if (error) {
      if (MIST.test(error.message)) return NextResponse.json({ error: SCRIPTS_HINT }, { status: 503 })
      throw new Error(error.message)
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'sales.script.create', entityType: 'sales_script', entityId: (data as { id: string }).id,
      summary: `Belscript "${naam}" toegevoegd en geanalyseerd`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, id: (data as { id: string }).id, analyse })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * Mag deze persoon dit script beheren?
 *
 * De eigenaar mag zijn eigen script bewerken en weggooien; een admin mag
 * alles. Een ALGEMEEN script (eigenaar null) is van iedereen en dus van
 * niemand — dat beheert alleen een admin. Zonder deze controle kon elke
 * werknemer het belscript van een collega overschrijven of verwijderen, en
 * dat merk je pas midden in een belronde.
 */
async function magBeheren(script: { eigenaar_auth_id: string | null }, actorId: string): Promise<boolean> {
  if (script.eigenaar_auth_id === actorId) return true
  return !!(await requireAdmin())
}

/** Bijwerken: naam, tekst (→ nieuwe analyse), actief, merk, eigenaar. */
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const id = String(b.id ?? '').trim()
    if (!id) return NextResponse.json({ error: 'Geen script opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const org = await getOrCreateSalesOrg()
    const { data: bestaand } = await admin
      .from('sales_scripts').select('id, naam, ruwe_tekst, eigenaar_auth_id')
      .eq('id', id).eq('sales_client_id', org.id).maybeSingle()
    if (!bestaand) return NextResponse.json({ error: 'Script niet gevonden' }, { status: 404 })
    if (!(await magBeheren(bestaand as { eigenaar_auth_id: string | null }, actor.id))) {
      return NextResponse.json({
        error: 'Dit script is van een collega. Alleen de eigenaar of een beheerder kan het aanpassen.',
      }, { status: 403 })
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (b.naam !== undefined) {
      const naam = String(b.naam).trim().slice(0, 120)
      if (!naam) return NextResponse.json({ error: 'De naam mag niet leeg zijn.' }, { status: 400 })
      patch.naam = naam
    }
    if (b.actief !== undefined) patch.actief = !!b.actief
    if (b.eigenaar !== undefined) {
      // 'algemeen' maken raakt iedereen die belt → alleen een admin.
      if (b.eigenaar === 'algemeen') {
        if (!(await requireAdmin())) {
          return NextResponse.json({ error: 'Alleen een beheerder kan een script voor iedereen zetten.' }, { status: 403 })
        }
        patch.eigenaar_auth_id = null
      } else {
        patch.eigenaar_auth_id = actor.id
      }
    }
    if (b.pipelineId !== undefined) {
      const pipelines = await listPipelines()
      patch.pipeline_id = pipelines.find((p) => p.id === String(b.pipelineId ?? ''))?.id ?? null
    }

    // Nieuwe tekst of een expliciete heranalyse → analyse opnieuw draaien.
    const nieuweTekst = b.tekst !== undefined ? String(b.tekst).trim() : null
    if (nieuweTekst !== null && !nieuweTekst) {
      return NextResponse.json({ error: 'De scripttekst mag niet leeg zijn.' }, { status: 400 })
    }
    if (nieuweTekst !== null || b.heranalyse === true) {
      const tekst = nieuweTekst ?? String((bestaand as { ruwe_tekst: string }).ruwe_tekst)
      const { analyse, model } = await analyseerScript(tekst)
      if (nieuweTekst !== null) patch.ruwe_tekst = tekst
      patch.analyse = analyse
      patch.analyse_model = model
      patch.geanalyseerd_op = new Date().toISOString()
    }

    const { error } = await admin.from('sales_scripts').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'sales.script.update', entityType: 'sales_script', entityId: id,
      summary: `Belscript "${(bestaand as { naam: string }).naam}" bijgewerkt`,
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
    if (!id) return NextResponse.json({ error: 'Geen script opgegeven' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const org = await getOrCreateSalesOrg()
    const { data: bestaand } = await admin
      .from('sales_scripts').select('id, naam, eigenaar_auth_id')
      .eq('id', id).eq('sales_client_id', org.id).maybeSingle()
    if (!bestaand) return NextResponse.json({ error: 'Script niet gevonden' }, { status: 404 })
    if (!(await magBeheren(bestaand as { eigenaar_auth_id: string | null }, actor.id))) {
      return NextResponse.json({
        error: 'Dit script is van een collega. Alleen de eigenaar of een beheerder kan het verwijderen.',
      }, { status: 403 })
    }

    const { data, error } = await admin
      .from('sales_scripts').delete()
      .eq('id', id).eq('sales_client_id', org.id)
      .select('naam')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) return NextResponse.json({ error: 'Script niet gevonden' }, { status: 404 })

    const meta = requestMeta(req)
    await logAudit({
      action: 'sales.script.delete', entityType: 'sales_script', entityId: id,
      summary: `Belscript "${(data[0] as { naam: string }).naam}" verwijderd`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
