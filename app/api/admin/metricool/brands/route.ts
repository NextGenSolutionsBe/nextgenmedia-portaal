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
    let clients: Array<{ id: string; company_name: string; metricool_blog_id: string | null; metricool_brand_name: string | null }> = []
    const full = await admin.from('clients')
      .select('id, company_name, metricool_blog_id, metricool_brand_name')
      .order('company_name', { ascending: true })
    if (full.error) {
      migrated = false
      const basic = await admin.from('clients').select('id, company_name').order('company_name', { ascending: true })
      clients = (basic.data ?? []).map((c) => ({ ...c, metricool_blog_id: null, metricool_brand_name: null }))
    } else {
      clients = (full.data ?? []) as typeof clients
    }

    const brands = await brandsPromise
    return NextResponse.json({ configured: true, migrated, brands, clients })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
