import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { formulierGuard, migratieAntwoord, isUuid } from '@/lib/formulieren/server'

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string } }

/**
 * Alle inzendingen van een formulier (nieuwste eerst), met antwoorden en de
 * veldensnapshot — zo kan het scherm zowel de tabel, het detail als de
 * Excel-export bouwen zonder tweede rekenpad. Bestanden krijgen hier GEEN
 * downloadlink; die komt pas bij het openen van één inzending.
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const g = await formulierGuard('bekijken')
    if (!g.ok) return g.response
    if (!isUuid(params.id)) return NextResponse.json({ error: 'Formulier niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('formulier_inzendingen')
      .select('id, link_id, client_id, antwoorden, velden_snapshot, naam, email, status, admin_notitie, created_at')
      .eq('formulier_id', params.id).order('created_at', { ascending: false }).limit(1000)
    if (error) return migratieAntwoord(error.message) ?? NextResponse.json({ error: safeMessage(error, 'formulier-inzendingen') }, { status: 500 })

    const rijen = (data ?? []) as { client_id: string | null; link_id: string | null }[]
    const klantIds = [...new Set(rijen.map((r) => r.client_id).filter(Boolean))] as string[]
    const linkIds = [...new Set(rijen.map((r) => r.link_id).filter(Boolean))] as string[]
    const [{ data: klanten }, { data: links }] = await Promise.all([
      klantIds.length ? admin.from('clients').select('id, company_name').in('id', klantIds) : Promise.resolve({ data: [] }),
      linkIds.length ? admin.from('formulier_links').select('id, label').in('id', linkIds) : Promise.resolve({ data: [] }),
    ])
    const klantNaam = new Map(((klanten ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
    const linkLabel = new Map(((links ?? []) as { id: string; label: string | null }[]).map((l) => [l.id, l.label]))
    const inzendingen = (data ?? []).map((r) => ({
      ...r,
      klant_naam: r.client_id ? klantNaam.get(r.client_id) ?? null : null,
      link_label: r.link_id ? linkLabel.get(r.link_id) ?? null : null,
    }))
    return NextResponse.json({ inzendingen })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'formulier-inzendingen') }, { status: 400 })
  }
}
