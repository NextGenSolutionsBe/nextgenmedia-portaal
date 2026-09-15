import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesInstellingen, bewaarInstelling } from '@/lib/instellingen/laden'
import { eisBeheer } from '@/lib/instellingen/api'
import { vergeetInstellingenCache } from '@/lib/instellingen/edge'
import { INSTELLINGEN_SLEUTELS, MODULES, type InstellingenSleutel, type AlleInstellingen } from '@/lib/instellingen/model'
import { valideerOrganisatie, valideerFacturatie, valideerDocumenten, valideerModules, valideerRechten, verschillen, uittreksel } from '@/lib/instellingen/valideer'
import { controleerFacturatieLijst, INVOICING_LIST_ENV, INVOICING_ASSIGNEE_ENV } from '@/lib/clickup'

export const dynamic = 'force-dynamic'

const LABEL: Record<InstellingenSleutel, string> = {
  organisatie: 'Bedrijfsgegevens', modules: 'Tabbladen en modules', rechten: 'Gebruikersrechten', facturatie: 'Facturatie-instellingen', documenten: 'Documenten en branding',
}

// GET — alle instellingen + context voor de pagina.
export async function GET() {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const inst = await leesInstellingen()
    const admin = createAdminSupabaseClient()
    const { data: rijen } = await admin.from('app_settings').select('key, updated_at, updated_by_email')
    return NextResponse.json({
      instellingen: inst,
      modules: MODULES,
      persoon: { rol: g.persoon.rol, isAdmin: g.persoon.isAdmin, email: g.persoon.email },
      bijgewerkt: Object.fromEntries(((rijen ?? []) as { key: string; updated_at: string; updated_by_email: string | null }[]).map((r) => [r.key, { op: r.updated_at, door: r.updated_by_email }])),
      // Het lijst-id is geen geheim; het toont welke waarde de omgeving voorstelt.
      omgeving: { clickupLijstEnv: (process.env[INVOICING_LIST_ENV] ?? '').trim() || null, clickupAssigneeEnv: (process.env[INVOICING_ASSIGNEE_ENV] ?? '').trim() || null },
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PUT — één sleutel opslaan (één upsert = atomisch), met validatie en logboek.
export async function PUT(req: NextRequest) {
  try {
    const g = await eisBeheer(); if (!g.ok) return g.response
    const b = (await req.json().catch(() => null)) as { sleutel?: string; waarde?: unknown; bevestigingen?: unknown } | null
    const sleutel = b?.sleutel as InstellingenSleutel
    if (!b || !INSTELLINGEN_SLEUTELS.includes(sleutel)) return NextResponse.json({ error: 'Onbekende instelling.' }, { status: 400 })
    const bevestigingen = Array.isArray(b.bevestigingen) ? b.bevestigingen.filter((x): x is string => typeof x === 'string') : []
    const huidig = await leesInstellingen()

    let nieuw: AlleInstellingen[InstellingenSleutel]
    let extra: Record<string, unknown> = {}
    switch (sleutel) {
      case 'organisatie': { const v = valideerOrganisatie(b.waarde); if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 }); nieuw = v.waarde; break }
      case 'modules': { const v = valideerModules(b.waarde, huidig.modules, bevestigingen); if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 }); nieuw = v.waarde; break }
      case 'rechten': { const v = valideerRechten(b.waarde); if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 }); nieuw = v.waarde; break }
      case 'documenten': { const v = valideerDocumenten(b.waarde, huidig.documenten); if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 }); nieuw = v.waarde; break }
      case 'facturatie': {
        const v = valideerFacturatie(b.waarde); if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
        const w = v.waarde
        // De ClickUp-lijst wijzigt enkel na een geslaagde structuurcontrole via
        // de API én een uitdrukkelijke bevestiging. Er wordt nooit een lijst
        // aangemaakt of gezocht, en bestaande taken blijven waar ze staan.
        if (w.clickup_lijst_id !== huidig.facturatie.clickup_lijst_id) {
          if (w.clickup_lijst_id) {
            if (!bevestigingen.includes('clickup_lijst')) return NextResponse.json({ error: 'Controleer en bevestig eerst de ClickUp-lijst voordat je opslaat.' }, { status: 400 })
            let c
            try { c = await controleerFacturatieLijst(w.clickup_lijst_id) }
            catch (e) { return NextResponse.json({ error: `De lijst kon niet gecontroleerd worden: ${e instanceof Error ? e.message.slice(0, 200) : 'onbekende fout'}. Er is niets gewijzigd.` }, { status: 400 }) }
            if (!c.ok) return NextResponse.json({ error: `De lijst staat niet op de verwachte plaats (${c.afwijkingen.join('; ')}). Er is niets gewijzigd.` }, { status: 400 })
            w.clickup_lijst_pad = c.pad
            extra = { clickup_lijst: { id: c.listId, pad: c.pad } }
          } else {
            w.clickup_lijst_pad = ''
          }
        } else {
          w.clickup_lijst_pad = huidig.facturatie.clickup_lijst_pad
        }
        nieuw = w
        break
      }
      default: return NextResponse.json({ error: 'Onbekende instelling.' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    const { oud } = await bewaarInstelling(admin, sleutel, nieuw, g.persoon.email)
    vergeetInstellingenCache()
    const velden = verschillen(huidig[sleutel], nieuw)
    const meta = requestMeta(req)
    await logAudit({
      action: `instellingen.${sleutel}`, entityType: 'instellingen', entityId: sleutel,
      summary: `Instellingen · ${LABEL[sleutel]} opgeslagen${velden.length ? ` (${velden.slice(0, 8).join(', ')}${velden.length > 8 ? ', …' : ''})` : ' (geen wijzigingen)'}`,
      actorUserId: g.persoon.userId, actorEmail: g.persoon.email, actorRole: g.persoon.rol,
      metadata: { velden, oud: uittreksel(oud ?? huidig[sleutel], velden), nieuw: uittreksel(nieuw, velden), bevestigingen, ...extra },
      ip: meta.ip, userAgent: meta.userAgent,
    })
    try { revalidatePath('/admin', 'layout') } catch { /* best-effort */ }
    return NextResponse.json({ ok: true, instellingen: { ...huidig, [sleutel]: nieuw } })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
