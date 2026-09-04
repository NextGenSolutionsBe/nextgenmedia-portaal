'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, Settings2, Wallet } from 'lucide-react'
import { estimateSocialContribution, type FiscalSettings } from '@/lib/finance'

const euro = (n: number) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const inpCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
const lblCls = 'block text-xs font-medium text-gray-600 mb-1'

function NumField({ label, value, onChange, step = '0.01', suffix }: {
  label: string; value: number; onChange: (v: number) => void; step?: string; suffix?: string
}) {
  return (
    <div>
      <label className={lblCls}>{label}{suffix ? ` (${suffix})` : ''}</label>
      <input type="number" step={step} className={inpCls} value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
    </div>
  )
}

function Out({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
      <div className="text-[11px] text-gray-500 mb-1">{label}</div>
      <div className={`text-base font-bold ${color ?? 'text-gray-900'}`}>{value}</div>
    </div>
  )
}

export function FiscalSettingsForm({ settings, ebitdaFY }: { settings: FiscalSettings; ebitdaFY: number }) {
  const router = useRouter()
  const [f, setF] = useState<FiscalSettings>(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof FiscalSettings>(k: K, v: FiscalSettings[K]) => { setF(p => ({ ...p, [k]: v })); setSaved(false) }

  const jaarloon = (Number(f.salary_gross_monthly) || 0) * (Number(f.salary_months) || 0)
  const social = estimateSocialContribution(jaarloon, f)
  const restAfterSalary = ebitdaFY - jaarloon - social.annual

  const save = async () => {
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/admin/fiscal-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSaved(true); router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      {/* Loonsimulatie */}
      <div className="card-base">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-1"><Wallet className="h-4 w-4 text-gray-400" />Loon &amp; sociale bijdragen · boekjaar {f.year}</h2>
        <p className="text-xs text-gray-500 mb-4">Simuleer de bezoldiging; de sociale bijdragen worden indicatief berekend met de parameters hieronder.</p>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className={lblCls}>Bruto / maand (€)</label>
            <input type="number" step="50" className={inpCls} value={String(f.salary_gross_monthly ?? '')} onChange={e => set('salary_gross_monthly', (e.target.value === '' ? 0 : Number(e.target.value)) as never)} />
          </div>
          <div>
            <label className={lblCls}>Aantal maanden</label>
            <input type="number" step="1" min="0" max="13" className={inpCls} value={String(f.salary_months ?? '')} onChange={e => set('salary_months', (e.target.value === '' ? 0 : Number(e.target.value)) as never)} />
          </div>
          <div>
            <label className={lblCls}>Statuut</label>
            <input className={inpCls} value={f.statuut} onChange={e => set('statuut', e.target.value)} placeholder="zaakvoerder" />
          </div>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[#fff848]" checked={f.include_social_as_cost} onChange={e => set('include_social_as_cost', e.target.checked)} />
            <span>Sociale bijdragen als kost meenemen</span>
          </label>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <Out label="Jaarloon" value={euro(jaarloon)} />
          <Out label="Sociale bijdr. / kwartaal" value={euro(social.perQuarter)} />
          <Out label="Sociale bijdr. / jaar" value={euro(social.annual)} />
          <Out label="Rest na loon + bijdragen" value={euro(restAfterSalary)} color={restAfterSalary >= 0 ? 'text-green-600' : 'text-red-600'} />
        </div>
      </div>

      {/* Fiscale parameters */}
      <div className="card-base">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-1"><Settings2 className="h-4 w-4 text-gray-400" />Fiscale instellingen · boekjaar {f.year}</h2>
        <p className="text-xs text-gray-500 mb-4">Aanpasbaar omdat tarieven jaarlijks wijzigen. Indicatief — controleer met de boekhouder.</p>

        <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Vennootschapsbelasting</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <NumField label="Standaardtarief" suffix="%" value={f.corporate_tax_pct} onChange={v => set('corporate_tax_pct', v)} />
          <NumField label="Verlaagd tarief" suffix="%" value={f.reduced_tax_pct} onChange={v => set('reduced_tax_pct', v)} />
          <NumField label="Grens verlaagd tarief" suffix="€" step="1000" value={f.reduced_tax_limit} onChange={v => set('reduced_tax_limit', v)} />
        </div>

        <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Sociale bijdragen</div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <NumField label="% schijf 1" suffix="%" value={f.social_pct_band1} onChange={v => set('social_pct_band1', v)} />
          <NumField label="% schijf 2" suffix="%" value={f.social_pct_band2} onChange={v => set('social_pct_band2', v)} />
          <NumField label="Beheerskost fonds" suffix="%" value={f.mgmt_fee_pct} onChange={v => set('mgmt_fee_pct', v)} />
          <NumField label="Inkomensgrens schijf 1" suffix="€" step="1000" value={f.income_band1_limit} onChange={v => set('income_band1_limit', v)} />
          <NumField label="Inkomensgrens schijf 2" suffix="€" step="1000" value={f.income_band2_limit} onChange={v => set('income_band2_limit', v)} />
          <div />
          <NumField label="Min. kwartaalbijdrage" suffix="€" step="10" value={f.min_quarter} onChange={v => set('min_quarter', v)} />
          <NumField label="Max. kwartaalbijdrage" suffix="€" step="10" value={f.max_quarter} onChange={v => set('max_quarter', v)} />
          <div />
          <NumField label="Aanvullend" suffix="%" value={f.extra_pct} onChange={v => set('extra_pct', v)} />
          <NumField label="Aanvullend vast bedrag" suffix="€/jaar" step="10" value={f.extra_fixed} onChange={v => set('extra_fixed', v)} />
        </div>

        <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2 mt-4">Cash, BTW &amp; uitkering</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <NumField label="BTW-percentage" suffix="%" value={f.vat_pct} onChange={v => set('vat_pct', v)} />
          <NumField label="Cash reserve" suffix="%" value={f.cash_reserve_pct} onChange={v => set('cash_reserve_pct', v)} />
          <NumField label="Cash op rekening" suffix="€" step="100" value={f.cash_on_account} onChange={v => set('cash_on_account', v)} />
          <NumField label="Opnames vennoten" suffix="€" step="100" value={f.partner_draws} onChange={v => set('partner_draws', v)} />
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-4">{error}</div>}

        <div className="flex items-center gap-3 mt-4">
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Instellingen opslaan
          </button>
          {saved && <span className="text-sm text-green-600 flex items-center gap-1"><Check className="h-4 w-4" />Opgeslagen</span>}
        </div>
      </div>
    </div>
  )
}
