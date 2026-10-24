import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { metricoolConfigured, listBrands } from '@/lib/metricool'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET — alle Metricool-merken + de huidige app-klant-koppelingen (voor het koppelscherm).
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!metricoolConfigured()) {
      return NextResponse.json({ configured: false, brands: [], clients: [] })
    }
    const admin = createAdminSupabaseClient()
    const brandsPromise = listBrands()

    // Veerkrachtig: als de metricool-kolommen nog niet gemigreerd zijn, valt de
    // query terug op enkel id+naam zodat de klantenlijst tóch verschijnt.
    let migrated = true
    let clients: Array<{ id: string; company_name: string; metricool_blog_id: string | null; metricool_brand_name: string | null; metricool_feedback_url: string | null }> = []
    // Eerst met feedbacklink; ontbreekt die kolom nog, dan zonder; anders enkel id+naam.
    const met = await admin.from('clients')
      .select('id, company_name, metricool_blog_id, metricool_brand_name, metricool_feedback_url')
      .order('company_name', { ascending: true })
    if (!met.error) {
      clients = (met.data ?? []) as typeof clients
    } else {
      const full = await admin.from('clients')
        .select('id, company_name, metricool_blog_id, metricool_brand_name')
        .order('company_name', { ascending: true })
      if (full.error) {
        migrated = false
        const basic = await admin.from('clients').select('id, company_name').order('company_name', { ascending: true })
        clients = (basic.data ?? []).map((c) => ({ ...c, metricool_blog_id: null, metricool_brand_name: null, metricool_feedback_url: null }))
      } else {
        clients = ((full.data ?? []) as Array<Omit<(typeof clients)[number], 'metricool_feedback_url'>>).map((c) => ({ ...c, metricool_feedback_url: null }))
      }
    }

    const brands = await brandsPromise
    return NextResponse.json({ configured: true, migrated, brands, clients })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
