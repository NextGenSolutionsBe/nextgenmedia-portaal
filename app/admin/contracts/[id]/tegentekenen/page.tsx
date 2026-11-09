import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, CheckCircle2 } from 'lucide-react'
import { createAdminSupabaseClient, requireAdmin, trySignedUrl } from '@/lib/supabase/server'
import { leesProfiel } from '@/lib/account-server'
import { bedrijfVoorMerk, onsZoneVan, redenNietTegentekenen } from '@/lib/contracten/tegenhandtekening'
import { formatDate } from '@/lib/utils'
import { TegentekenScherm } from './tegenteken-scherm'

export const dynamic = 'force-dynamic'

/** Het contract ook namens NextGenMedia ondertekenen, na de klant. Enkel zaakvoerders (admins). */
export default async function TegentekenenPagina({ params }: { params: { id: string } }) {
  const admin = createAdminSupabaseClient()
  const { data: c } = await admin.from('contracts').select('*').eq('id', params.id).maybeSingle()
  if (!c) notFound()
  const ik = await requireAdmin()
  const terug = (
    <Link href={`/admin/contracts/${c.id}`} className="btn-secondary px-2 shrink-0" title="Terug naar het contract"><ChevronLeft className="h-4 w-4" /></Link>
  )
  const kop = (sub: string) => (
    <div className="flex items-center gap-3">
      {terug}
      <div className="min-w-0">
        <h1 className="text-xl font-semibold truncate">Ondertekenen namens ons</h1>
        <p className="text-sm text-gray-500 mt-0.5 truncate">{c.title}{sub ? ` · ${sub}` : ''}</p>
      </div>
    </div>
  )

  if (c.tegengetekend_op) {
    return (
      <div className="space-y-6 animate-fade-in">
        {kop('')}
        <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span>Al ondertekend door {c.tegengetekend_door} op {formatDate(c.tegengetekend_op)}. Het contract staat met beide handtekeningen in de klantapp.</span>
        </div>
      </div>
    )
  }
  if (!ik) {
    return <div className="space-y-6 animate-fade-in">{kop('')}<p className="text-sm text-gray-600">Enkel een zaakvoerder kan namens NextGenMedia tekenen.</p></div>
  }
  const reden = redenNietTegentekenen(c)
  if (reden) return <div className="space-y-6 animate-fade-in">{kop('')}<p className="text-sm text-gray-600">{reden}</p></div>

  const [pdfUrl, profiel, { data: kaart }, { data: klant }] = await Promise.all([
    trySignedUrl(admin, 'contracts', (c.signed_pdf_path as string | null) ?? (c.pdf_path as string), 3600),
    leesProfiel(ik).catch(() => null),
    admin.from('opdrachten').select('merk').eq('contract_id', c.id).maybeSingle(),
    c.client_id ? admin.from('clients').select('company_name').eq('id', c.client_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const naam = profiel ? `${profiel.voornaam} ${profiel.achternaam}`.trim() : ''
  const klantNaam = (klant as { company_name?: string | null } | null)?.company_name ?? null

  return (
    <div className="space-y-6 animate-fade-in">
      {kop(klantNaam ?? '')}
      <TegentekenScherm
        contractId={c.id}
        pdfUrl={pdfUrl}
        beginZone={onsZoneVan(c)}
        beginNaam={naam}
        bedrijf={bedrijfVoorMerk((kaart as { merk?: string | null } | null)?.merk)}
        klant={{ naam: c.signer_name ?? klantNaam, op: c.signed_at ?? null, manueel: c.ondertekening_wijze === 'manueel' }}
      />
    </div>
  )
}
