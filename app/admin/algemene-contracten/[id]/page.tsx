import { notFound, redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { laadContract, laadOverzicht, tijdlijn } from '@/lib/algemene-contracten/server'
import { labelsInGebruik, persoonVan } from '@/lib/algemene-contracten/model'
import { leesProfiel } from '@/lib/account-server'
import { AcDetail } from './detail'

export const dynamic = 'force-dynamic'

/** Eén algemeen contract: PDF, handtekeningen, gegevens, versturen en tijdlijn. Enkel zaakvoerders. */
export default async function AcDetailPagina({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ versturen?: string }> }) {
  const ik = await requireAdmin()
  if (!ik) redirect('/admin')
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const admin = createAdminSupabaseClient()
  const c = await laadContract(admin, id).catch(() => null)
  if (!c) notFound()
  const [{ mappen, contracten }, t, profiel] = await Promise.all([laadOverzicht(admin), tijdlijn(admin, id), leesProfiel(ik).catch(() => null)])
  const naam = (profiel ? `${profiel.voornaam} ${profiel.achternaam}`.trim() : '') || (ik.email ?? '').split('@')[0]
  const { bestand_pad: _b, huidig_pad: huidig, ...contract } = c
  void _b
  const sp = await searchParams
  return (
    <AcDetail
      contract={contract}
      heeftGetekendeVersie={!!huidig}
      mappen={mappen}
      tijdlijn={t}
      labelVoorstellen={labelsInGebruik(contracten).map((l) => l.label)}
      versturenOpen={sp.versturen === '1'}
      ik={persoonVan(naam)}
    />
  )
}
