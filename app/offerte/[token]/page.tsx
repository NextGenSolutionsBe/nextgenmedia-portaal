export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import type { Metadata } from 'next'
import { FileText, Download, Clock, CheckCircle2 } from 'lucide-react'
import { createAdminSupabaseClient, getSessionUser, getUserRole, isActiveStaff } from '@/lib/supabase/server'
import { offerteVanToken, registreerGeopend } from '@/lib/offertes-server'
import { isAutomatischeBezoeker } from '@/lib/klant-geopend'
import { merkStijl } from '@/lib/merk-mail'
import { AccepteerKnop } from './accepteer-knop'
import { getekendOp } from '@/lib/offerte-fiche'

export const metadata: Metadata = { title: 'Offerte', robots: { index: false, follow: false } }

const datum = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
const euro = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })

/**
 * Publieke offertepagina: de klant bekijkt de pdf, downloadt ze en accepteert
 * met één knop. Token in de link; geen login. "Geopend" telt enkel als de
 * klant kijkt (niet als het team ingelogd is, niet bij linkvoorbeelden).
 */
export default async function OffertePagina({ params }: { params: { token: string } }) {
  const admin = createAdminSupabaseClient()
  const o = await offerteVanToken(admin, params.token)
  if (!o || o.status === 'concept') notFound()
  const m = merkStijl(o.merk)
  const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  const verlopen = o.status === 'verstuurd' && !!o.geldig_tot && o.geldig_tot < vandaag

  if (o.status === 'verstuurd' && !verlopen) {
    const h = headers()
    const ua = h.get('user-agent')
    let team = false
    try { const ik = await getSessionUser(); team = !!ik && ((await getUserRole(ik.id)) === 'admin' || (await isActiveStaff(ik.id))) } catch { team = false }
    if (!team && !isAutomatischeBezoeker(ua)) {
      const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || null
      await registreerGeopend(admin, o, ua, ip).catch(() => {})
    }
  }

  const kop = (
    <header className="bg-white border-b border-gray-200" style={{ borderBottomColor: m.accent, borderBottomWidth: 3 }}>
      <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
        <span className="text-lg font-extrabold tracking-tight text-gray-900">{m.deel1}<span style={{ borderBottom: `3px solid ${m.accent}` }}>{m.deel2}</span></span>
        <span className="text-xs text-gray-500">Offerte</span>
      </div>
    </header>
  )

  if (o.status === 'ingetrokken') {
    return (
      <div className="min-h-screen bg-gray-50">{kop}
        <main className="max-w-xl mx-auto p-6"><div className="bg-white rounded-2xl border border-gray-200 p-8 text-center">
          <FileText className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <h1 className="text-lg font-semibold">Deze offerte is niet meer geldig.</h1>
          <p className="text-sm text-gray-500 mt-1">Neem contact op met {m.naam} via {m.adres} als je vragen hebt.</p>
        </div></main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {kop}
      <main className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        <section className="bg-white rounded-2xl border border-gray-200 p-5 sm:p-6">
          <p className="text-xs text-gray-500">{[o.offertenummer ? `Offerte ${o.offertenummer}` : 'Offerte', o.klant_naam ? `voor ${o.klant_naam}` : null].filter(Boolean).join(' ')}</p>
          <h1 className="text-2xl font-semibold text-gray-900 mt-1">{o.titel}</h1>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-gray-600">
            {o.bedrag_excl !== null && o.bedrag_excl !== undefined && <span><b className="text-gray-900">{euro(Number(o.bedrag_excl))}</b> excl. btw</span>}
            {o.geldig_tot && o.status !== 'geaccepteerd' && <span className={`flex items-center gap-1 ${verlopen ? 'text-red-700' : ''}`}><Clock className="h-4 w-4" />{verlopen ? 'Verlopen op' : 'Geldig tot'} {datum(o.geldig_tot)}</span>}
          </div>
          <div className="mt-5 space-y-3">
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              {o.status === 'geaccepteerd' ? (
                <div className="rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-green-900 text-sm flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 shrink-0" />
                  <span>Aanvaard{o.geaccepteerd_door ? ` door ${o.geaccepteerd_door}` : ''}{o.geaccepteerd_op ? ` op ${getekendOp(o.geaccepteerd_op)}` : ''}{o.getekend_op ? ', met handtekening' : ''}. Bedankt!</span>
                </div>
              ) : verlopen ? (
                <p className="text-sm text-red-700">Deze offerte is verlopen. Neem contact op met {m.naam} ({m.adres}) voor een nieuwe.</p>
              ) : null}
              <a href={`/offerte/${params.token}/document?download=1`} className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50">
                <Download className="h-4 w-4" />Download pdf
              </a>
            </div>
            {o.status === 'verstuurd' && !verlopen && (
              <AccepteerKnop token={params.token} naamVoorstel={o.ontvanger_naam ?? ''} klant={o.klant_naam} accent={m.accent} opAccent={m.opAccent} />
            )}
          </div>
        </section>

        <section className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <iframe src={`/offerte/${params.token}/document`} title={`Offerte ${o.titel}`} className="w-full h-[75vh] min-h-[480px] bg-gray-100" />
        </section>

        <p className="text-xs text-gray-500 text-center">Vragen over deze offerte? Mail naar {m.adres}.</p>
      </main>
    </div>
  )
}
