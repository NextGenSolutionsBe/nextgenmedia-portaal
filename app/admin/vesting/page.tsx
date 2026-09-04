export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatEuro, formatDate, SERVICE_LABELS } from '@/lib/utils'
import { TrendingUp, Target, Layers, Users, Rocket } from 'lucide-react'
import {
  mergeVestingConfig, vestingStatus, START_PCT, MAX_PCT, BRAM_NOW, BRAM_MIN, CHIARA_FIXED, type VestingConfig,
} from '@/lib/vesting'
import { VestingForm } from './vesting-form'
import { VestingConfigForm, VestingDelete } from './vesting-config-form'

type Reg = { id: string; client_name: string | null; service_slug: string | null; entry_date: string; net_revenue: number; type: string; outreach: boolean | null; closing: boolean | null; attribution_pct: number; vesting_revenue: number }
const TYPE_LABEL: Record<string, string> = { inbound: 'Inbound', outbound: 'Outbound' }

export default async function VestingPage() {
  const admin = createAdminSupabaseClient()
  const [{ data: cfgRow }, { data: regRows }] = await Promise.all([
    admin.from('vesting_config').select('*').eq('id', 1).maybeSingle(),
    admin.from('vesting_revenue').select('*').order('entry_date', { ascending: false }),
  ])
  const cfg: VestingConfig = mergeVestingConfig(cfgRow)
  const regs = (regRows ?? []) as Reg[]

  const total = regs.reduce((s, r) => s + Number(r.vesting_revenue), 0)
  const st = vestingStatus(total, cfg)
  const barFill = Math.min(100, Math.max(0, ((st.pct - START_PCT) / (MAX_PCT - START_PCT)) * 100))

  // Simulatie (informatief): niet-verworven valt terug naar Bram
  const marcoCurrent = st.currentInt
  const nietVerworven = MAX_PCT - marcoCurrent
  const bramCurrent = BRAM_NOW - (marcoCurrent - START_PCT) // = 70 - marcoCurrent

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Vestiging</h1>
          <p className="text-sm text-gray-500 mt-0.5">Berekening van het vestigingsprincipe — uitsluitend informatief</p>
        </div>
        <VestingForm />
      </div>

      {/* Aandeelhouders */}
      <div>
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Aandeelhouders</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card"><div className="font-semibold mb-2">Bram</div><div className="text-2xl font-bold">{BRAM_NOW}%</div><div className="text-xs text-gray-400 mt-1">Minimum eindpositie {BRAM_MIN}%</div></div>
          <div className="stat-card"><div className="font-semibold mb-2">Chiara</div><div className="text-2xl font-bold">{CHIARA_FIXED}%</div><div className="text-xs text-gray-400 mt-1">Vast — kan nooit wijzigen</div></div>
          <div className="stat-card"><div className="font-semibold mb-2">Marco</div><div className="text-2xl font-bold">{START_PCT}% → {MAX_PCT}%</div><div className="text-xs text-gray-400 mt-1">Start {START_PCT}% · maximum {MAX_PCT}%</div></div>
        </div>
      </div>

      {/* Vestigingsprogressie */}
      <div className="card-base">
        <h2 className="font-semibold mb-1 flex items-center gap-2"><Rocket className="h-4 w-4 text-[#c5b800]" />Vestigingsprogressie Marco</h2>
        <div className="text-xs text-gray-400 mb-4">{START_PCT}% → {MAX_PCT}% · vestigingsjaar {st.year} (schijf 3: {formatEuro(st.s3rate)}/%)</div>

        <div className="flex items-end justify-between mb-1">
          <span className="text-3xl font-bold">{st.currentInt}%</span>
          {!st.atMax
            ? <span className="text-sm text-gray-500">volgende doel <span className="font-semibold text-gray-800">{st.nextInt}%</span></span>
            : <span className="text-sm font-semibold text-green-600">Maximum bereikt</span>}
        </div>
        <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-[#fff848] rounded-full transition-all" style={{ width: `${barFill}%` }} />
        </div>
        <div className="flex justify-between text-[11px] text-gray-400 mt-1"><span>{START_PCT}%</span><span>{MAX_PCT}%</span></div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Box label="Huidig percentage" value={`${st.currentInt}%`} />
          <Box label="Volgende mijlpaal" value={st.atMax ? '—' : `${st.nextInt}%`} />
          <Box label="Nog nodig" value={st.atMax ? '€0' : formatEuro(st.neededForNext)} color="text-amber-600" />
          <Box label="Resterende %" value={`${MAX_PCT - st.currentInt}%`} />
        </div>
      </div>

      {/* Schijven + berekening */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card-base">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Layers className="h-4 w-4 text-gray-400" />Schijven</h2>
          <ul className="text-sm text-gray-600 space-y-2">
            <li><span className="font-medium">Schijf 1</span> — {START_PCT}% reeds verworven.</li>
            <li><span className="font-medium">Schijf 2</span> — {START_PCT}% → {START_PCT + 5}%: {formatEuro(cfg.schijf2_per)} netto omzet per extra %.</li>
            <li><span className="font-medium">Schijf 3</span> — {START_PCT + 5}% → {MAX_PCT}%: jaar 1 {formatEuro(cfg.schijf3_y1)}/%, jaar 2 {formatEuro(cfg.schijf3_y2)}/%, jaar 3 {formatEuro(cfg.schijf3_y3)}/%.</li>
          </ul>
          <p className="text-[11px] text-gray-400 mt-3">Huidig vestigingsjaar wordt automatisch bepaald op basis van de startdatum.</p>
        </div>

        <div className="card-base">
          <h2 className="font-semibold mb-3 flex items-center gap-2"><Target className="h-4 w-4 text-gray-400" />Berekening Marco</h2>
          <div className="grid grid-cols-2 gap-3">
            <Box label="Totaal verzameld" value={formatEuro(total)} color="text-green-600" />
            <Box label="Huidige positie" value={`${st.currentInt}%`} />
            <Box label="Volgende doel" value={st.atMax ? 'Max' : `${st.nextInt}%`} />
            <Box label="Resterende omzet nodig" value={st.atMax ? '€0' : formatEuro(st.neededForNext)} color="text-amber-600" />
          </div>
        </div>
      </div>

      {/* Simulatie */}
      <div className="card-base">
        <h2 className="font-semibold mb-1">Simulatie — als Marco vandaag stopt</h2>
        <p className="text-xs text-gray-400 mb-4">Niet-verworven aandelen vallen terug naar Bram.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="stat-card"><div className="font-semibold mb-1">Bram</div><div className="text-2xl font-bold">{bramCurrent}%</div><div className="text-xs text-gray-400 mt-1">{BRAM_MIN}% min + {nietVerworven}% niet-verworven</div></div>
          <div className="stat-card"><div className="font-semibold mb-1">Chiara</div><div className="text-2xl font-bold">{CHIARA_FIXED}%</div><div className="text-xs text-gray-400 mt-1">ongewijzigd</div></div>
          <div className="stat-card"><div className="font-semibold mb-1">Marco</div><div className="text-2xl font-bold text-green-600">{marcoCurrent}%</div><div className="text-xs text-gray-400 mt-1">verworven aandeel</div></div>
        </div>
      </div>

      {/* Historiek */}
      <div className="card-base">
        <h2 className="font-semibold mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-gray-400" />Historiek</h2>
        {regs.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Nog geen vestigingsomzet geregistreerd</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="border-b border-gray-100">
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Datum</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Klant</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Dienst</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Type</th>
                <th className="text-right py-2 text-xs text-gray-500 font-medium">Omzet</th>
                <th className="text-right py-2 text-xs text-gray-500 font-medium">%</th>
                <th className="text-right py-2 text-xs text-gray-500 font-medium">Vestigingsomzet</th>
                <th className="py-2"></th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {regs.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50/50">
                    <td className="py-2.5 text-gray-500 text-xs">{formatDate(r.entry_date)}</td>
                    <td className="py-2.5 font-medium">{r.client_name ?? '—'}</td>
                    <td className="py-2.5 text-gray-500">{r.service_slug ? (SERVICE_LABELS[r.service_slug] ?? r.service_slug) : '—'}</td>
                    <td className="py-2.5 text-gray-500">
                      {TYPE_LABEL[r.type] ?? r.type}
                      <span className="text-gray-400 text-xs"> · {
                        r.type === 'outbound'
                          ? [r.outreach ? 'Outreach' : null, r.closing ? 'Closing' : null].filter(Boolean).join(' + ') || 'geen'
                          : (r.closing ? 'Closing' : 'geen')
                      }</span>
                    </td>
                    <td className="py-2.5 text-right">{formatEuro(Number(r.net_revenue))}</td>
                    <td className="py-2.5 text-right text-gray-400">{Number(r.attribution_pct)}%</td>
                    <td className="py-2.5 text-right font-semibold text-green-600">{formatEuro(Number(r.vesting_revenue))}</td>
                    <td className="py-2.5 text-right"><VestingDelete id={r.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <VestingConfigForm cfg={cfg} />

      <div className="card-base bg-amber-50/40 border-amber-200/60">
        <p className="text-sm text-amber-800"><strong>Disclaimer.</strong> Dit dashboard is uitsluitend informatief en wijzigt geen echte aandelen. Het toont enkel de berekening van het vestigingsprincipe uit de samenwerkingsovereenkomst.</p>
      </div>
    </div>
  )
}

function Box({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      <div className={`text-base font-bold ${color ?? 'text-gray-900'}`}>{value}</div>
    </div>
  )
}
