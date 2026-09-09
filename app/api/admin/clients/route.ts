import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, isActiveStaff, insertResilient } from '@/lib/supabase/server'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { validateBtw } from '@/lib/btw'
import { encryptSecret } from '@/lib/crypto'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const ServiceCfgSchema = z.object({
  start_month: z.string(),                          // YYYY-MM
  contract_months: z.number().int().min(1).max(60),
})

const CreateClientSchema = z.object({
  company_name: z.string().min(1).max(120),
  contact_name: z.string().max(120).optional().or(z.literal('')),
  email: z.string().email(),
  password: z.string().min(8).max(72),
  niche: z.string().max(120).optional().or(z.literal('')),
  website_url: z.string().max(300).optional().or(z.literal('')),
  btw_nummer: z.string().max(20).optional().or(z.literal('')),
  services: z.array(z.string()).min(1),
  platforms: z.array(z.string()).optional().default([]),
  posts_per_month: z.number().int().min(0).max(60).optional().default(0),
  reels_per_month: z.number().int().min(0).max(60).optional().default(0),
  stories_per_month: z.number().int().min(0).max(60).optional().default(0),
  webdesign_maintenance_included: z.boolean().optional().default(false),
  // Website-administratie (intern): hoe is de site gebouwd + CMS/beheer + onderhoud.
  website_platform: z.enum(['framer', 'custom']).nullable().optional(),
  website_admin_url: z.string().max(500).optional().or(z.literal('')),
  framer_project_url: z.string().max(500).optional().or(z.literal('')),
  framer_api_key: z.string().max(500).optional().or(z.literal('')),
  cms_enabled: z.boolean().optional().default(false),
  maintenance_start_date: z.string().max(10).optional().or(z.literal('')),
  maintenance_months: z.number().int().min(1).max(120).optional().default(12),
  ads_budget: z.number().nullable().optional(),
  // Per-service start month + duration
  service_configs: z.record(ServiceCfgSchema).optional().default({}),
})

function addMonths(iso: string, months: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

function toFirstOfMonth(yearMonth: string): string {
  // Accepts YYYY-MM or YYYY-MM-DD
  return yearMonth.slice(0, 7) + '-01'
}

export async function POST(req: NextRequest) {
  try {
    // Verify admin
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

    const { data: roleData } = await supabase
      .from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) {
      return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    }

    const body = await req.json()
    const data = CreateClientSchema.parse(body)
    const admin = createAdminSupabaseClient()

    // BTW valideren (optioneel).
    const btw = validateBtw(data.btw_nummer)
    if (!btw.ok) return NextResponse.json({ error: btw.error }, { status: 400 })

    // Helper: get per-service config with fallback
    const today = new Date()
    const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const getServiceCfg = (slug: string) =>
      data.service_configs[slug] ?? { start_month: defaultMonth, contract_months: 12 }

    // Create auth user
    const { data: created, error: authErr } = await admin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.contact_name || data.company_name },
    })
    if (authErr || !created.user) {
      throw new Error(`Account aanmaken mislukt: ${authErr?.message ?? 'onbekend'}`)
    }
    const newUserId = created.user.id

    await admin.from('user_roles').insert({ user_id: newUserId, role: 'client' })

    // Create client — veerkrachtig: als de migratie met de nieuwe website-/
    // onderhoudskolommen nog niet gedraaid is, worden die kolommen automatisch
    // weggelaten i.p.v. dat het aanmaken van de klant faalt.
    const { data: clientRow, error: clientErr } = await insertResilient(
      admin,
      'clients',
      {
        owner_user_id: newUserId,
        company_name: data.company_name,
        contact_name: data.contact_name || null,
        email: data.email,
        niche: data.niche || null,
        website_url: data.website_url || null,
        // Website-administratie. Framer-velden enkel bewaren bij een Framer-site;
        // de beheerlink enkel bij custom code — zo blijft de data eenduidig.
        website_platform: data.website_platform ?? null,
        website_admin_url: data.website_platform === 'custom' ? (data.website_admin_url || null) : null,
        framer_project_url: data.website_platform === 'framer' ? (data.framer_project_url || null) : null,
        // Versleuteld opslaan — zie lib/crypto.ts (vereist BLOG_ENC_KEY).
        framer_api_key: data.website_platform === 'framer' && data.framer_api_key
          ? encryptSecret(data.framer_api_key) : null,
        cms_enabled: data.website_platform === 'framer' ? !!data.cms_enabled : false,
        maintenance_included: !!data.webdesign_maintenance_included,
        maintenance_start_date: data.webdesign_maintenance_included ? (data.maintenance_start_date || null) : null,
        maintenance_months: data.maintenance_months ?? 12,
      },
      // Deze kolommen zijn essentieel: ontbreken ze, dan is er echt iets mis.
      { select: 'id', required: ['owner_user_id', 'company_name', 'email'] },
    )

    if (clientErr || !clientRow) {
      await admin.auth.admin.deleteUser(newUserId)
      throw new Error(`Klant aanmaken mislukt: ${clientErr?.message}`)
    }
    const client = { id: String(clientRow.id) }

    // Wachtwoord wordt BEWUST niet bewaard: Supabase Auth heeft het al veilig
    // gehasht. Een leesbare kopie zou bij een datalek alle klantwachtwoorden
    // prijsgeven (die mensen vaak hergebruiken). Admin kan altijd een nieuw
    // wachtwoord instellen via de credentials-kaart.

    // BTW-nummer (best effort — kolom kan nog ontbreken vóór migratie).
    if (btw.value) { try { await admin.from('clients').update({ btw_nummer: btw.value }).eq('id', client.id) } catch { } }

    // Create client_services — active: false by default.
    // Portal access is granted separately by admin AFTER the client signs the contract.
    const serviceRows = data.services.map((slug) => ({
      client_id: client.id,
      service_slug: slug,
      config: slug === 'webdesign'
        ? { maintenance_included: data.webdesign_maintenance_included }
        : slug === 'ads'
        ? { budget: data.ads_budget }
        : {},
      active: false,
    }))
    if (serviceRows.length > 0) {
      await admin.from('client_services').insert(serviceRows)
    }

    // Create service_contracts — per service with its own start date and duration
    type ContractInsert = {
      client_id: string
      service_slug: string
      model: string
      status: 'pending'
      start_date: string | null
      end_date: string | null
      renewal_reminder_at: string | null
      config: Record<string, unknown>
    }
    const contractRows: ContractInsert[] = []

    for (const slug of data.services) {
      const cfg = getServiceCfg(slug)
      const liveStart = toFirstOfMonth(cfg.start_month)
      const contractEnd = addMonths(liveStart, cfg.contract_months)

      if (slug === 'social-media') {
        contractRows.push({
          client_id: client.id, service_slug: slug, model: 'social_recurring',
          status: 'pending', start_date: liveStart, end_date: contractEnd,
          renewal_reminder_at: addMonths(contractEnd, -1),
          config: {
            reels: data.reels_per_month,
            posts: data.posts_per_month,
            stories: data.stories_per_month,
            channels: data.platforms,
            contract_months: cfg.contract_months,
          },
        })
      } else if (slug === 'webdesign') {
        contractRows.push({
          client_id: client.id, service_slug: slug, model: 'webdesign_project',
          status: 'pending', start_date: liveStart, end_date: contractEnd,
          renewal_reminder_at: addMonths(contractEnd, -1),
          config: {},
        })
        if (data.webdesign_maintenance_included) {
          contractRows.push({
            client_id: client.id, service_slug: slug, model: 'webdesign_maintenance',
            status: 'pending', start_date: liveStart, end_date: addMonths(liveStart, 12),
            renewal_reminder_at: addMonths(liveStart, 11),
            config: {},
          })
        }
      } else {
        const modelMap: Record<string, string> = {
          'marketing-consultancy': 'consultancy_hours',
          'grafisch-ontwerp':       'design_project',
          'ads':                    'ads_retainer',
          'foto-video':             'photo_video_project',
        }
        contractRows.push({
          client_id: client.id, service_slug: slug,
          model: modelMap[slug] ?? 'design_project',
          status: 'pending', start_date: liveStart, end_date: contractEnd,
          renewal_reminder_at: addMonths(contractEnd, -1),
          config: slug === 'ads' ? { budget: data.ads_budget } : {},
        })
      }
    }

    if (contractRows.length > 0) {
      await admin.from('service_contracts').insert(contractRows)
    }

    // Framer-site met CMS: de inhoud meteen ophalen zodat de klant direct een
    // gevulde CMS heeft. Best-effort — een mislukte import mag het aanmaken van
    // de klant nooit ongedaan maken (de admin kan altijd "CMS ophalen" klikken).
    if (data.website_platform === 'framer' && data.cms_enabled && data.framer_project_url && data.framer_api_key) {
      try {
        const { importFramerCms } = await import('@/lib/cms-import')
        await importFramerCms(client.id)
      } catch { /* zie CMS-kaart op de klantdetail */ }
    }

    // Invalidate caches so new client appears in lists immediately
    try {
      revalidatePath('/admin/clients')
      revalidatePath('/admin')
    } catch { }

    return NextResponse.json({ ok: true, clientId: client.id })
  } catch (err) {
    const message = err instanceof z.ZodError
      ? err.errors.map((e) => e.message).join(', ')
      : err instanceof Error ? err.message : 'Onbekende fout'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
