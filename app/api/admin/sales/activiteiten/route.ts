import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { registreerActiviteit } from '@/lib/sales/activiteiten'
import { isActiviteitType, isUitkomst, type ActiviteitType } from '@/lib/sales/activiteiten-model'
import { canTransition, isStageKey, normaliseerStage, transitionError } from '@/lib/sales/stages'

export const dynamic = 'force-dynamic'

/**
 * Salesactiviteiten.
 *
 * GET  ?lead=<id>      → activiteiten van één lead (nieuwste eerst, zonder de
 *                        zacht verwijderde).
 * POST { leadId, type, duurSeconden?, uitkomst?, notitie?, opvolgdatum?,
 *        naarFase? }   → één activiteit registreren. Schrijft óók de
 *                        tijdlijnregel en werkt de lead bij (fase, opvolgdatum).
 *
 * De statistieken draaien hierop, dus wat hier binnenkomt is wat er geteld
 * wordt. Een duur wordt NOOIT verzonnen: geen duur meegegeven = geen duur.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const leadId = req.nextUrl.searchParams.get('lead') ?? ''
    if (!leadId) return NextResponse.json({ error: 'lead ontbreekt' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('sales_activiteiten')
      .select('*').eq('lead_id', leadId).is('verwijderd_op', null)
      .order('created_at', { ascending: false }).limit(200)
    if (error) {
      // Tabel nog niet aangemaakt: lege lijst, geen fout — de tijdlijn toont
      // intussen alles wat er is.
      if (/sales_activiteiten|does not exist|schema cache|relation/i.test(error.message)) {
        return NextResponse.json({ activiteiten: [] })
      }
      throw new Error(error.message)
    }
    return NextResponse.json({ activiteiten: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

const DATUM = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const leadId = String(b.leadId ?? '')
    const type = String(b.type ?? '')
    if (!leadId) return NextResponse.json({ error: 'leadId ontbreekt' }, { status: 400 })
    if (!isActiviteitType(type)) return NextResponse.json({ error: 'Onbekend activiteitstype' }, { status: 400 })
    // Fasewissels lopen via PATCH /leads/[id]; afspraken via de boekingsroute;
    // deals via de gewonnen/verloren-dialoog (ook PATCH). Hier enkel wat een
    // mens rechtstreeks registreert.
    const TOEGESTAAN: ActiviteitType[] = [
      'telefoongesprek', 'email_verstuurd', 'interne_notitie', 'opvolging', 'voorstel_verstuurd', 'lead_afgehandeld',
    ]
    if (!TOEGESTAAN.includes(type)) {
      return NextResponse.json({ error: 'Dit type registreer je via de bijhorende actie, niet rechtstreeks.' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    const { data: lead } = await admin.from('sales_leads')
      .select('id, stage_key').eq('id', leadId).maybeSingle()
    if (!lead) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })
    const huidigeFase = normaliseerStage((lead as { stage_key: string }).stage_key)

    const notitie = String(b.notitie ?? '').trim().slice(0, 4000) || null
    if (type === 'interne_notitie' && !notitie) {
      return NextResponse.json({ error: 'Een notitie zonder tekst heeft geen zin.' }, { status: 400 })
    }

    let duur: number | null = null
    if (type === 'telefoongesprek' && b.duurSeconden !== undefined && b.duurSeconden !== null && b.duurSeconden !== '') {
      const n = Number(b.duurSeconden)
      if (!Number.isFinite(n) || n < 0 || n > 6 * 3600) {
        return NextResponse.json({ error: 'De gespreksduur klopt niet.' }, { status: 400 })
      }
      duur = Math.round(n)
    }

    let uitkomst: string | null = null
    if (type === 'telefoongesprek') {
      if (b.uitkomst && !isUitkomst(b.uitkomst)) return NextResponse.json({ error: 'Onbekende uitkomst' }, { status: 400 })
      uitkomst = b.uitkomst ? String(b.uitkomst) : null
    }

    let opvolgdatum: string | null = null
    if (b.opvolgdatum) {
      const d = String(b.opvolgdatum).slice(0, 10)
      if (!DATUM.test(d)) return NextResponse.json({ error: 'De opvolgdatum klopt niet (JJJJ-MM-DD).' }, { status: 400 })
      opvolgdatum = d
    }
    if (type === 'opvolging' && !opvolgdatum && b.opvolgdatum !== null) {
      return NextResponse.json({ error: 'Kies een opvolgdatum.' }, { status: 400 })
    }

    // Optionele verplaatsing naar een andere kolom. Voorstel verstuurd → altijd
    // naar "Voorstel verstuurd", tenzij de lead al gesloten is.
    let naarFase: string | null = null
    if (typeof b.naarFase === 'string' && b.naarFase) {
      if (!isStageKey(b.naarFase)) return NextResponse.json({ error: 'Onbekende fase' }, { status: 400 })
      if (b.naarFase !== huidigeFase) {
        if (!canTransition(huidigeFase, b.naarFase)) {
          return NextResponse.json({ error: transitionError(huidigeFase, b.naarFase) ?? 'Niet toegestaan' }, { status: 400 })
        }
        naarFase = b.naarFase
      }
    }
    if (type === 'voorstel_verstuurd' && !naarFase && !['gewonnen', 'verloren', 'voorstel'].includes(huidigeFase)) {
      naarFase = 'voorstel'
    }

    // 1) De activiteit zelf.
    const { id } = await registreerActiviteit(admin, {
      leadId, medewerkerId: actor.id, medewerkerEmail: actor.email ?? null,
      type, duurSeconden: duur, uitkomst, notitie, opvolgdatum,
      naarFase, vanFase: huidigeFase,
    })

    // 2) De lead bijwerken: opvolgdatum en/of fase. Vóór de migratie kan
    //    `opvolgdatum` ontbreken — dan enkel de fase.
    const patch: Record<string, unknown> = {}
    if (opvolgdatum || (type === 'opvolging' && b.opvolgdatum === null)) patch.opvolgdatum = opvolgdatum
    if (naarFase) patch.stage_key = naarFase
    if (Object.keys(patch).length) {
      let { error } = await admin.from('sales_leads').update(patch).eq('id', leadId)
      if (error && /opvolgdatum|schema cache|PGRST204/i.test(error.message) && patch.stage_key) {
        ;({ error } = await admin.from('sales_leads').update({ stage_key: patch.stage_key }).eq('id', leadId))
      } else if (error && /opvolgdatum|schema cache|PGRST204/i.test(error.message)) {
        error = null
      }
      if (error) throw new Error(error.message)
    }
    // Een fasewissel via een activiteit is óók een fasewissel op de tijdlijn.
    if (naarFase) {
      await registreerActiviteit(admin, {
        leadId, medewerkerId: actor.id, medewerkerEmail: actor.email ?? null,
        type: 'fase_gewijzigd', vanFase: huidigeFase, naarFase,
      })
    }
    // Een opvolgdatum die meekwam met een gesprek of mail telt als opvolging.
    if (opvolgdatum && type !== 'opvolging') {
      await registreerActiviteit(admin, {
        leadId, medewerkerId: actor.id, medewerkerEmail: actor.email ?? null,
        type: 'opvolging', opvolgdatum,
      })
    }

    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
