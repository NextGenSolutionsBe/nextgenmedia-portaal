import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { leesProfiel } from '@/lib/account-server'
import { laadContract, pdfLink } from '@/lib/algemene-contracten/server'
import { handtekeningenOns, persoonVan, redenOnsNiet, standaardZone, wieMoetNog, zoneVoor, type AlgemeenContract } from '@/lib/algemene-contracten/model'
import { AcTekenScherm } from './teken-scherm'

export const dynamic = 'force-dynamic'

/** Tekenen namens NextGen Agency BV (elk met het eigen account) en/of de plek voor de andere partij aanduiden. Enkel zaakvoerders. */
export default async function AcTekenenPagina({ params }: { params: Promise<{ id: string }> }) {
  const ik = await requireAdmin()
  if (!ik) redirect('/admin')
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const admin = createAdminSupabaseClient()
  const c = await laadContract(admin, id).catch(() => null)
  if (!c) notFound()
  const [pdfUrl, profiel, { data: open }] = await Promise.all([
    pdfLink(admin, c, { seconden: 3600 }),
    leesProfiel(ik).catch(() => null),
    // Wat daarna nog op jouw handtekening wacht (oudste eerst), voor "Ondertekenen en volgende".
    admin.from('algemene_contracten').select('id, ons_nodig, ondertekenaar, ons_tekenaars, ons_handtekeningen, ons_getekend_op, ons_getekend_door, ons_zone, gearchiveerd_op')
      .eq('ons_nodig', true).is('ons_getekend_op', null).is('gearchiveerd_op', null).neq('id', id).order('created_at').limit(200),
  ])
  const naam = (profiel ? `${profiel.voornaam} ${profiel.achternaam}`.trim() : '') || (ik.email ?? '').split('@')[0]
  const persoon = persoonVan(naam)
  const paginas = c.paginas ?? 1
  const mijn = persoon ? handtekeningenOns(c).find((h) => h.persoon.toLowerCase() === persoon.toLowerCase()) ?? null : null
  const reden = redenOnsNiet(c, persoon)
  // Collega's die nog tekenen en hun plaats al kozen: grijs op de PDF, zodat je er niet over tekent.
  const anderen = wieMoetNog(c).filter((p) => p !== persoon && c.ons_zones?.[p]).map((p) => ({ persoon: p, zone: c.ons_zones![p] }))
  const volgende = ((open ?? []) as AlgemeenContract[]).find((x) => persoon && wieMoetNog(x).includes(persoon))

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href={`/admin/algemene-contracten/${c.id}`} className="btn-secondary px-2 shrink-0" title="Terug naar het contract"><ChevronLeft className="h-4 w-4" /></Link>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold truncate">Tekenen</h1>
          <p className="text-sm text-gray-500 mt-0.5 truncate">{c.titel}{c.tegenpartij ? ` · ${c.tegenpartij}` : ''}</p>
        </div>
      </div>
      <AcTekenScherm
        contractId={c.id}
        pdfUrl={pdfUrl}
        naam={naam}
        tegenpartij={c.tegenpartij}
        onsKan={!reden}
        reden={reden}
        onsGetekend={mijn ? { door: mijn.naam, op: mijn.op } : null}
        anderen={anderen}
        partijPlaatsen={c.partij_nodig && !c.partij_getekend_op && !c.gearchiveerd_op}
        beginOns={persoon ? zoneVoor(c, persoon, paginas) : standaardZone('ons', paginas)}
        beginPartij={c.partij_zone ?? standaardZone('partij', paginas)}
        volgendeId={volgende?.id ?? null}
      />
    </div>
  )
}
