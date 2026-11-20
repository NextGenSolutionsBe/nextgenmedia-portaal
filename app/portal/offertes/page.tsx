export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { FileSignature, Download, CheckCircle2, Clock, ArrowRight } from 'lucide-react'
import { requirePortalView, sessionCan } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { MERK_STIJL, mailMerkVan } from '@/lib/merk-mail'

type Rij = {
  id: string; titel: string; token: string; status: string; merk: string; bedrag_excl: number | null; geldig_tot: string | null
  verstuurd_op: string | null; geaccepteerd_op: string | null; geaccepteerd_door: string | null; offertenummer?: string | null
}

const datum = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
const euro = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })

/**
 * Klantapp — Offertes: alles wat we deze klant stuurden, met de status. Bekijken
 * en aanvaarden gebeurt op de offertepagina (dezelfde link als in de mail);
 * downloaden vraagt het recht "download". Altijd gekeyd op de geresolveerde klant.
 */
export default async function PortalOffertesPage() {
  const session = await requirePortalView('offertes')
  const magDownloaden = sessionCan(session, 'offertes', 'download')
  const admin = createAdminSupabaseClient()
  let rijen: Rij[] = []
  try {
    const { data } = await admin.from('offertes').select('*').eq('client_id', session.clientId).in('status', ['verstuurd', 'geaccepteerd']).order('verstuurd_op', { ascending: false, nullsFirst: false }).limit(100)
    rijen = (data ?? []) as Rij[]
  } catch { rijen = [] }
  const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><FileSignature className="h-6 w-6" />Offertes</h1>
        <p className="text-sm text-gray-600 mt-1">Al onze offertes voor jou. Open een offerte om ze te lezen en te aanvaarden; na je akkoord staat hier de versie met je handtekening.</p>
      </div>
      {rijen.length === 0 ? <div className="card-base text-sm text-gray-500">Er staan nog geen offertes voor je klaar.</div> : (
        <ul className="space-y-3">
          {rijen.map((o) => {
            const m = MERK_STIJL[mailMerkVan(o.merk)]
            const verlopen = o.status === 'verstuurd' && !!o.geldig_tot && o.geldig_tot < vandaag
            const status = o.status === 'geaccepteerd'
              ? { tekst: `Aanvaard${o.geaccepteerd_op ? ` op ${datum(o.geaccepteerd_op)}` : ''}`, kleur: 'bg-green-50 text-green-800 border-green-200', icoon: CheckCircle2 }
              : verlopen ? { tekst: 'Verlopen', kleur: 'bg-gray-100 text-gray-600 border-gray-200', icoon: Clock }
              : { tekst: 'Wacht op jouw akkoord', kleur: 'bg-amber-50 text-amber-900 border-amber-200', icoon: Clock }
            const Icoon = status.icoon
            return (
              <li key={o.id} className="card-base !p-0 overflow-hidden">
                <div className="flex">
                  <span className="w-1.5 shrink-0" style={{ background: m.accent }} />
                  <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-500">{[o.offertenummer, m.naam].filter(Boolean).join(' · ')}</p>
                      <p className="font-semibold text-gray-900 truncate">{o.titel}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full border ${status.kleur}`}><Icoon className="h-3.5 w-3.5" />{status.tekst}</span>
                        {o.bedrag_excl !== null && o.bedrag_excl !== undefined && <span><b className="text-gray-900">{euro(Number(o.bedrag_excl))}</b> excl. btw</span>}
                        {o.status === 'verstuurd' && o.geldig_tot && !verlopen && <span>geldig tot {datum(o.geldig_tot)}</span>}
                      </div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {magDownloaden && <a href={`/offerte/${o.token}/document?download=1`} className="btn-secondary text-sm"><Download className="h-4 w-4" />Pdf</a>}
                      <Link href={`/offerte/${o.token}`} className="btn-primary text-sm">{o.status === 'verstuurd' && !verlopen ? 'Bekijken en aanvaarden' : 'Bekijken'}<ArrowRight className="h-4 w-4" /></Link>
                    </div>
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
