'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Upload, Trash2 } from 'lucide-react'
import type { DocumentenInstellingen } from '@/lib/instellingen/model'
import { BESTANDSNAAM_VELDEN, voorbeeldBestandsnaam } from '@/lib/instellingen/valideer'
import type { Ctx } from './instellingen-client'
import { Kop, Groep, Tekst, Veld, OpslaanBalk, INP } from './ui'

const MAX = 2 * 1024 * 1024

export function SectieDocumenten({ ctx }: { ctx: Ctx }) {
  const bron = ctx.inst.documenten
  const [v, setV] = useState<DocumentenInstellingen>(bron)
  useEffect(() => { setV(bron) }, [bron])
  const vuil = JSON.stringify(v) !== JSON.stringify(bron)
  const { zetVuil } = ctx
  useEffect(() => { zetVuil(vuil) }, [vuil, zetVuil])
  const zet = <K extends keyof DocumentenInstellingen>(k: K, w: DocumentenInstellingen[K]) => setV((p) => ({ ...p, [k]: w }))

  const [logoV, setLogoV] = useState(() => Date.now())
  const [uploaden, setUploaden] = useState(false)
  const bestandRef = useRef<HTMLInputElement>(null)

  const upload = async (f: File) => {
    if (!['image/png', 'image/jpeg'].includes(f.type)) { toast.error('Enkel PNG- of JPG-bestanden zijn toegestaan.'); return }
    if (f.size > MAX) { toast.error('Het logo mag maximaal 2 MB groot zijn.'); return }
    setUploaden(true)
    try {
      const fd = new FormData(); fd.append('bestand', f)
      const r = await fetch('/api/admin/instellingen/logo', { method: 'POST', body: fd })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Upload mislukt')
      toast.success('Logo opgeslagen. Nieuwe documenten gebruiken het vanaf nu.')
      setLogoV(Date.now()); await ctx.herlaad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Upload mislukt') } finally { setUploaden(false); if (bestandRef.current) bestandRef.current.value = '' }
  }
  const verwijderLogo = async () => {
    setUploaden(true)
    try {
      const r = await fetch('/api/admin/instellingen/logo', { method: 'DELETE' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Mislukt')
      toast.success('Het standaardlogo geldt weer.'); await ctx.herlaad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setUploaden(false) }
  }

  const geldigeKleur = (k: string) => /^#[0-9a-fA-F]{6}$/.test(k)
  const kleurVeld = (label: string, k: 'primaire_kleur' | 'secundaire_kleur') => (
    <Veld label={label}>
      <div className="flex items-center gap-2">
        <input type="color" value={geldigeKleur(v[k]) ? v[k] : '#000000'} onChange={(e) => zet(k, e.target.value)} className="h-9 w-12 rounded border border-gray-200 p-0.5 bg-white" />
        <input className={INP} value={v[k]} onChange={(e) => zet(k, e.target.value)} maxLength={7} placeholder="#rrggbb" />
      </div>
    </Veld>
  )

  return (
    <div className="card-base">
      <Kop titel="Documenten en branding" tekst="Logo, kleuren en voettekst voor documenten die het portaal aanmaakt (zoals het bewijsdocument van een aankoopaanvraag). Enkel documenten die vanaf nu gemaakt worden veranderen; bestaande blijven exact zoals ze zijn." />
      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-5">
          <Groep titel="Logo">
            <div className="flex items-start gap-4 flex-wrap">
              <div className="h-20 w-40 rounded-lg border border-dashed border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden">
                {bron.logo_path
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={`/api/admin/instellingen/logo?v=${logoV}`} alt="Logo" className="max-h-16 max-w-[150px] object-contain" />
                  // eslint-disable-next-line @next/next/no-img-element
                  : <img src="/logo-pdf.png" alt="Standaardlogo" className="max-h-16 max-w-[150px] object-contain opacity-80" />}
              </div>
              <div className="space-y-2 text-sm">
                <input ref={bestandRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f) }} />
                <div className="flex gap-2">
                  <button type="button" onClick={() => bestandRef.current?.click()} disabled={uploaden} className="btn-secondary">{uploaden ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Logo uploaden</button>
                  {bron.logo_path && <button type="button" onClick={verwijderLogo} disabled={uploaden} className="btn-secondary text-red-600"><Trash2 className="h-4 w-4" />Standaardlogo</button>}
                </div>
                <p className="text-[11px] text-gray-400">PNG of JPG, maximaal 2 MB. Het bestand blijft privé; het wordt enkel in gegenereerde documenten gebruikt.</p>
              </div>
            </div>
          </Groep>
          <Groep titel="Kleuren">
            <div className="grid sm:grid-cols-2 gap-3">
              {kleurVeld('Primaire kleur (accent)', 'primaire_kleur')}
              {kleurVeld('Secundaire kleur (tekst en titels)', 'secundaire_kleur')}
            </div>
          </Groep>
          <Groep titel="Teksten">
            <div className="grid gap-3">
              <Veld label="Voettekst"><textarea className={INP} rows={2} value={v.voettekst} onChange={(e) => zet('voettekst', e.target.value)} maxLength={400} /></Veld>
              <Tekst label="Contactregel" value={v.contactregel} onChange={(w) => zet('contactregel', w)} placeholder="NextGenMedia · info@nextgenmedia.be · +32 …" />
            </div>
          </Groep>
          <Groep titel="Bestandsnamen">
            <Tekst label="Patroon" value={v.bestandsnaam_patroon} onChange={(w) => zet('bestandsnaam_patroon', w)} hint={`Bouwstenen: ${BESTANDSNAAM_VELDEN.join(' ')} — {nummer} is verplicht. Voorbeeld: ${voorbeeldBestandsnaam(v.bestandsnaam_patroon || '{nummer}')}`} />
          </Groep>
        </div>

        {/* Voorbeeld — hoe een nieuw document eruit zal zien. */}
        <div>
          <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-2">Voorbeeld</div>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm p-4 text-[11px] leading-relaxed" style={{ color: geldigeKleur(v.secundaire_kleur) ? v.secundaire_kleur : '#111' }}>
            <div className="flex items-start justify-between gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={bron.logo_path ? `/api/admin/instellingen/logo?v=${logoV}` : '/logo-pdf.png'} alt="" className="h-7 object-contain" />
              <div className="text-right">
                <div className="font-semibold">{ctx.inst.organisatie.handelsnaam || ctx.inst.organisatie.vennootschapsnaam || 'NextGenMedia'}</div>
                <div className="text-gray-400">Intern bewijsdocument</div>
              </div>
            </div>
            <div className="h-1 mt-3 rounded" style={{ background: geldigeKleur(v.primaire_kleur) ? v.primaire_kleur : '#fff848' }} />
            <div className="mt-3 text-sm font-bold">Bevestiging aankoopaanvraag</div>
            <div className="text-gray-400">Aanvraag AAN-2026-012 · versie 1 · certificaat BEV-2026-012</div>
            <div className="mt-3 space-y-1">
              {[['Leverancier', 'Voorbeeld BV'], ['Bedrag exclusief btw', '€ 1.250,00'], ['Status', 'Bevestigd']].map(([k, w]) => (
                <div key={k} className="flex justify-between border-b border-gray-50 py-0.5"><span className="text-gray-400">{k}</span><span>{w}</span></div>
              ))}
            </div>
            <div className="h-px mt-4" style={{ background: geldigeKleur(v.primaire_kleur) ? v.primaire_kleur : '#fff848' }} />
            <div className="mt-1.5 text-gray-400">{v.voettekst}{v.contactregel ? ` ${v.contactregel}` : ''}</div>
            <div className="mt-2 text-gray-300 font-mono">{voorbeeldBestandsnaam(v.bestandsnaam_patroon || '{nummer}')}</div>
          </div>
        </div>
      </div>
      <OpslaanBalk vuil={vuil} bezig={ctx.bezig} onOpslaan={() => ctx.opslaan('documenten', v)} onAnnuleer={() => setV(bron)} bijgewerkt={ctx.bijgewerkt.documenten} />
    </div>
  )
}
