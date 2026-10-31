export const dynamic = 'force-dynamic'

import { Handshake, Globe, Instagram, Facebook, Linkedin, Youtube, Music2, ArrowUpRight } from 'lucide-react'
import { requirePortalView } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { publiekeUrl } from '@/lib/marketing-media'
import { LINKS, type Partner, type LinkSleutel } from '@/lib/partners'

const ICOON: Record<LinkSleutel, React.ElementType> = { website: Globe, instagram: Instagram, facebook: Facebook, linkedin: Linkedin, tiktok: Music2, youtube: Youtube }

/** Klantapp — Onze partners: de bedrijven achter en rond NextGenMedia, met uitleg en links. */
export default async function PortalPartnersPage() {
  await requirePortalView('partners')
  const { data } = await createAdminSupabaseClient().from('onze_partners').select('*').eq('zichtbaar', true).order('volgorde').order('created_at')
  const partners = (data ?? []) as Partner[]
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Handshake className="h-6 w-6" />Onze partners</h1>
        <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">De bedrijven waarmee we samenwerken en die je kan inschakelen. Klik door naar hun website of socials.</p>
      </div>
      {partners.length === 0 ? (
        <div className="card-base text-sm text-gray-500">Hier verschijnen binnenkort onze partners.</div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {partners.map((p) => {
            const logo = publiekeUrl(p.logo_pad)
            const links = LINKS.filter((l) => p[l.key])
            return (
              <li key={p.id} className="card-base !p-0 overflow-hidden flex flex-col">
                <div className="h-32 bg-gray-50 border-b border-gray-100 flex items-center justify-center p-6">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {logo ? <img src={logo} alt={`Logo ${p.naam}`} loading="lazy" className="max-h-full max-w-[70%] object-contain" />
                    : <span className="text-2xl font-semibold text-gray-400">{p.naam}</span>}
                </div>
                <div className="p-4 sm:p-5 flex flex-col gap-3 flex-1">
                  <div>
                    <h2 className="text-base font-semibold">{p.naam}</h2>
                    {p.korte_uitleg && <p className="text-sm text-gray-600 mt-1 whitespace-pre-line">{p.korte_uitleg}</p>}
                  </div>
                  {links.length > 0 && (
                    <div className="mt-auto flex flex-wrap gap-2 pt-1">
                      {links.map((l) => {
                        const I = ICOON[l.key]
                        return l.key === 'website'
                          ? <a key={l.key} href={p[l.key]!} target="_blank" rel="noopener noreferrer" className="btn-primary !py-2 text-sm"><Globe className="h-4 w-4" />Website<ArrowUpRight className="h-3.5 w-3.5" /></a>
                          : <a key={l.key} href={p[l.key]!} target="_blank" rel="noopener noreferrer" aria-label={`${p.naam} op ${l.label}`} title={l.label}
                              className="h-10 w-10 rounded-xl border border-gray-200 bg-white flex items-center justify-center text-gray-700 hover:border-gray-900 hover:text-gray-900 transition"><I className="h-[18px] w-[18px]" /></a>
                      })}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
