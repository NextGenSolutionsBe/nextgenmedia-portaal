import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'

export const dynamic = 'force-dynamic'

/**
 * Smalle leadkiezer voor het boekingspaneel in de agenda.
 *
 * WAAROM DIT BESTAAT — de agenda haalde vroeger /api/admin/sales/leads?pipeline=all
 * op: 2711 leads, 2,7 MB JSON, om er vervolgens enkel naam, e-mail en merk uit
 * te vissen en er 2711 <option>-elementen van te maken. Dat kostte een fetch van
 * enkele seconden én een trage keuzelijst. Deze route geeft hooguit een
 * handvol treffers terug, en enkel de velden die het paneel echt gebruikt.
 *
 * Zoeken gebeurt op bedrijfsnaam én contactpersoon. Die twee lopen in aparte
 * (parallelle) query's — zie de toelichting bij de zoekstap hieronder.
 */

const MAX = 25

/** Jokertekens in de zoekterm onschadelijk maken: '%' zou anders alles matchen. */
function veiligPatroon(term: string): string {
  return `%${term.replace(/[\\%_]/g, (t) => `\\${t}`)}%`
}

type Rij = {
  id: string
  pipeline_id: string | null
  sales_companies: { name: string | null } | null
  sales_contacts: { name: string | null; email: string | null } | null
}

const SELECTIE = 'id, pipeline_id, sales_companies ( name ), sales_contacts ( name, email )'

export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    const salesClientId = (await getOrCreateSalesOrg()).id
    const admin = createAdminSupabaseClient()

    // Merken lopen hier bewust door elkaar: bij het boeken moet je een lead uit
    // beide pipelines kunnen aanduiden.
    const basis = () => admin
      .from('sales_leads')
      .select(SELECTIE)
      .eq('sales_client_id', salesClientId)
      .is('archived_at', null)
      .limit(MAX)

    let rijen: Rij[] = []

    if (!q) {
      // Nog niets getypt → de laatst bijgewerkte leads, als startpunt.
      const { data } = await basis().order('updated_at', { ascending: false })
      rijen = (data ?? []) as unknown as Rij[]
    } else {
      const patroon = veiligPatroon(q)

      /**
       * Eerst de bedrijven en contacten zoeken, dán de leads erbij halen.
       *
       * Bewust NIET met een ingebedde filter (`sales_companies!inner` +
       * ilike op de ingebedde kolom): elders in deze codebase brak zo'n inner
       * join stilletjes op een FK-onduidelijkheid, en een leadkiezer die af en
       * toe niets vindt is erger dan een extra query. Dit gebruikt enkel
       * gewone filters op kolommen van de tabel zelf.
       */
      const [bedrijven, contacten] = await Promise.all([
        admin.from('sales_companies').select('id').ilike('name', patroon).limit(MAX),
        admin.from('sales_contacts').select('id').ilike('name', patroon).limit(MAX),
      ])
      const bedrijfIds = ((bedrijven.data ?? []) as { id: string }[]).map((r) => r.id)
      const contactIds = ((contacten.data ?? []) as { id: string }[]).map((r) => r.id)

      const [viaBedrijf, viaContact] = await Promise.all([
        bedrijfIds.length ? basis().in('company_id', bedrijfIds) : Promise.resolve({ data: [] }),
        contactIds.length ? basis().in('contact_id', contactIds) : Promise.resolve({ data: [] }),
      ])

      // Een lead kan langs beide wegen binnenkomen; één keer tonen volstaat.
      const gezien = new Set<string>()
      for (const bron of [viaBedrijf.data, viaContact.data]) {
        for (const r of (bron ?? []) as unknown as Rij[]) {
          if (gezien.has(r.id)) continue
          gezien.add(r.id)
          rijen.push(r)
        }
      }
    }

    const leads = rijen.slice(0, MAX).map((r) => ({
      id: r.id,
      label: [r.sales_companies?.name, r.sales_contacts?.name].filter(Boolean).join(' · ') || 'Lead',
      email: r.sales_contacts?.email ?? null,
      pipelineId: r.pipeline_id ?? null,
    }))

    return NextResponse.json({ leads })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
