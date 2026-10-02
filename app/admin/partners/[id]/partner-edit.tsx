'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Pencil, Check } from 'lucide-react'
import { Dialoog, INP } from '@/app/admin/instellingen/ui'
import { GetalInvoer } from '@/components/ui/getal-invoer'

const ROLES = [
  { slug: 'photographer', label: 'Fotograaf' },
  { slug: 'videographer', label: 'Videograaf' },
  { slug: 'editor', label: 'Editor' },
  { slug: 'designer', label: 'Designer' },
  { slug: 'copywriter', label: 'Copywriter' },
  { slug: 'developer', label: 'Developer' },
  { slug: 'strategist', label: 'Strateeg' },
  { slug: 'other', label: 'Overig' },
]

export type PartnerGegevens = {
  name: string
  company: string | null
  phone: string | null
  vat_number: string | null
  iban: string | null
  region: string | null
  roles: string[]
  hourly_rate: number | null
  commission_pct: number | null
  bio: string | null
  notes: string | null
}

/** Knop + dialoog om alle gegevens van een partner te bewerken. */
export function PartnerEdit({ partnerId, partner }: { partnerId: string; partner: PartnerGegevens }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [bezig, setBezig] = useState(false)
  const leeg = () => ({
    name: partner.name ?? '',
    company: partner.company ?? '',
    phone: partner.phone ?? '',
    vat_number: partner.vat_number ?? '',
    iban: partner.iban ?? '',
    region: partner.region ?? '',
    roles: partner.roles ?? [],
    hourly_rate: partner.hourly_rate,
    commission_pct: partner.commission_pct ?? 10,
    bio: partner.bio ?? '',
    notes: partner.notes ?? '',
  })
  const [form, setForm] = useState(leeg)
  const zet = <K extends keyof ReturnType<typeof leeg>>(k: K, v: ReturnType<typeof leeg>[K]) => setForm((f) => ({ ...f, [k]: v }))

  const openen = () => { setForm(leeg()); setOpen(true) }

  const opslaan = async () => {
    if (!form.name.trim()) { toast.error('Naam is verplicht'); return }
    setBezig(true)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          company: form.company,
          phone: form.phone,
          vat_number: form.vat_number,
          iban: form.iban,
          region: form.region,
          roles: form.roles,
          hourly_rate: form.hourly_rate,
          commission_pct: form.commission_pct ?? 0,
          bio: form.bio,
          notes: form.notes,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      toast.success('Gegevens opgeslagen.')
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally {
      setBezig(false)
    }
  }

  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <>
      <button onClick={openen} className="btn-secondary text-xs">
        <Pencil className="h-3.5 w-3.5" />Bewerken
      </button>

      {open && (
        <Dialoog titel="Partnergegevens bewerken" onSluit={() => !bezig && setOpen(false)} breed>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Naam *</label>
                <input className={INP} value={form.name} onChange={(e) => zet('name', e.target.value)} maxLength={160} />
              </div>
              <div>
                <label className={lbl}>Bedrijf</label>
                <input className={INP} value={form.company} onChange={(e) => zet('company', e.target.value)} maxLength={160} />
              </div>
              <div>
                <label className={lbl}>Telefoon</label>
                <input className={INP} type="tel" value={form.phone} onChange={(e) => zet('phone', e.target.value)} maxLength={60} />
              </div>
              <div>
                <label className={lbl}>Regio</label>
                <input className={INP} value={form.region} onChange={(e) => zet('region', e.target.value)} maxLength={160} />
              </div>
              <div>
                <label className={lbl}>BTW-nummer</label>
                <input className={INP} value={form.vat_number} onChange={(e) => zet('vat_number', e.target.value)} maxLength={60} />
              </div>
              <div>
                <label className={lbl}>IBAN</label>
                <input className={INP} value={form.iban} onChange={(e) => zet('iban', e.target.value)} maxLength={60} />
              </div>
              <div>
                <label className={lbl}>Uurtarief (€)</label>
                <GetalInvoer className={INP} waarde={form.hourly_rate} leeg={0} min={0}
                  onWaarde={(n) => zet('hourly_rate', n || null)} placeholder="Geen" />
              </div>
              <div>
                <label className={lbl}>Standaardcommissie (%)</label>
                <GetalInvoer className={INP} waarde={form.commission_pct} min={0} max={100}
                  onWaarde={(n) => zet('commission_pct', n)} />
                <p className="text-[11px] text-gray-400 mt-1">Het echte percentage stel je per doorverwijzing in.</p>
              </div>
            </div>

            <div>
              <label className={lbl}>Rollen</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {ROLES.map((r) => {
                  const aan = form.roles.includes(r.slug)
                  return (
                    <button key={r.slug} type="button"
                      onClick={() => zet('roles', aan ? form.roles.filter((x) => x !== r.slug) : [...form.roles, r.slug])}
                      className={`px-2 py-1.5 rounded-lg border text-xs transition-colors ${aan ? 'border-[#fff848] bg-[#fff848]/10 text-black' : 'border-gray-200 text-gray-500'}`}>
                      {r.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className={lbl}>Bio</label>
              <textarea rows={3} className={INP} value={form.bio} onChange={(e) => zet('bio', e.target.value)} maxLength={4000} />
            </div>
            <div>
              <label className={lbl}>Interne notities</label>
              <textarea rows={3} className={INP} value={form.notes} onChange={(e) => zet('notes', e.target.value)} maxLength={4000} />
            </div>

            <p className="text-[11px] text-gray-400">Het e-mailadres (login) wijzig je via de kaart ‘Login-gegevens’.</p>

            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={() => setOpen(false)} disabled={bezig} className="btn-secondary">Annuleren</button>
              <button type="button" onClick={opslaan} disabled={bezig} className="btn-primary">
                {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Opslaan
              </button>
            </div>
          </div>
        </Dialoog>
      )}
    </>
  )
}
