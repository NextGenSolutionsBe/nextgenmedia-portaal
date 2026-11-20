'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Eye, EyeOff, ImagePlus, Loader2, Pencil, Plus, Trash2, Globe } from 'lucide-react'
import { Dialoog, Bevestig, INP } from '@/app/admin/instellingen/ui'
import { LINKS, type Partner, type LinkSleutel } from '@/lib/partners'
import { laadAfbeeldingOp } from '@/lib/marketing-upload'

type Rij = Partner & { logo_url: string | null }
type Concept = { naam: string; korte_uitleg: string; logo_pad: string | null; logo_url: string | null } & Record<LinkSleutel, string>
const LBL = 'block text-xs font-medium text-gray-600 mb-1'
const leeg = (): Concept => ({ naam: '', korte_uitleg: '', logo_pad: null, logo_url: null, website: '', instagram: '', facebook: '', linkedin: '', tiktok: '', youtube: '' })

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Mislukt')
  return j as T
}

export function PartnersAdmin({ magAanpassen }: { magAanpassen: boolean }) {
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [bewerk, setBewerk] = useState<{ id: string | null; c: Concept } | null>(null)
  const [weg, setWeg] = useState<Rij | null>(null)
  const laad = useCallback(async () => {
    try { setRijen((await api<{ partners: Rij[] }>('/api/admin/onze-partners')).partners) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setRijen([]) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const wissel = async (r: Rij, patch: Partial<Rij>) => {
    setRijen((l) => l?.map((x) => (x.id === r.id ? { ...x, ...patch } : x)) ?? l)
    try { await api(`/api/admin/onze-partners/${r.id}`, { method: 'PATCH', body: JSON.stringify(patch) }) } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); laad() }
  }
  const schuif = async (i: number, richting: -1 | 1) => {
    if (!rijen) return
    const j = i + richting
    if (j < 0 || j >= rijen.length) return
    const nieuw = [...rijen]; [nieuw[i], nieuw[j]] = [nieuw[j], nieuw[i]]
    setRijen(nieuw)
    try { await Promise.all([api(`/api/admin/onze-partners/${nieuw[i].id}`, { method: 'PATCH', body: JSON.stringify({ volgorde: i + 1 }) }), api(`/api/admin/onze-partners/${nieuw[j].id}`, { method: 'PATCH', body: JSON.stringify({ volgorde: j + 1 }) })]) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); laad() }
  }

  return (
    <div className="space-y-3">
      {magAanpassen && <button type="button" onClick={() => setBewerk({ id: null, c: leeg() })} className="btn-primary"><Plus className="h-4 w-4" />Partner toevoegen</button>}
      {rijen === null ? <div className="card-base flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        : rijen.length === 0 ? <div className="card-base text-sm text-gray-500">Nog geen partners. Voeg je eerste bedrijf toe: het verschijnt meteen in de klantapp onder “Onze partners”.</div>
        : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rijen.map((r, i) => (
              <li key={r.id} className={`card-base !p-4 flex flex-col gap-3 ${r.zichtbaar ? '' : 'opacity-60'}`}>
                <div className="flex items-start gap-3">
                  <div className="h-14 w-14 rounded-xl border border-gray-100 bg-white flex items-center justify-center overflow-hidden shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {r.logo_url ? <img src={r.logo_url} alt="" className="max-h-full max-w-full object-contain" /> : <Globe className="h-6 w-6 text-gray-300" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{r.naam}</p>
                    <p className="text-xs text-gray-500 line-clamp-2">{r.korte_uitleg || 'Nog geen uitleg'}</p>
                  </div>
                </div>
                <p className="text-[11px] text-gray-500">{LINKS.filter((l) => r[l.key]).map((l) => l.label).join(' · ') || 'Nog geen links'}</p>
                {magAanpassen && (
                  <div className="flex flex-wrap gap-1.5 mt-auto">
                    <button type="button" onClick={() => setBewerk({ id: r.id, c: { naam: r.naam, korte_uitleg: r.korte_uitleg ?? '', logo_pad: r.logo_pad, logo_url: r.logo_url, ...Object.fromEntries(LINKS.map((l) => [l.key, r[l.key] ?? ''])) as Record<LinkSleutel, string> } })} className="btn-secondary !py-1.5 text-xs"><Pencil className="h-3.5 w-3.5" />Bewerken</button>
                    <button type="button" onClick={() => wissel(r, { zichtbaar: !r.zichtbaar })} className="btn-secondary !py-1.5 text-xs">{r.zichtbaar ? <><EyeOff className="h-3.5 w-3.5" />Verbergen</> : <><Eye className="h-3.5 w-3.5" />Tonen</>}</button>
                    <button type="button" onClick={() => schuif(i, -1)} disabled={i === 0} className="btn-secondary !py-1.5 !px-2 text-xs" aria-label="Naar voren"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => schuif(i, 1)} disabled={i === rijen.length - 1} className="btn-secondary !py-1.5 !px-2 text-xs" aria-label="Naar achter"><ArrowDown className="h-3.5 w-3.5" /></button>
                    <button type="button" onClick={() => setWeg(r)} className="btn-secondary !py-1.5 !px-2 text-xs text-red-600 ml-auto" aria-label="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      {bewerk && <PartnerDialoog start={bewerk} onSluit={() => setBewerk(null)} onKlaar={() => { setBewerk(null); laad() }} />}
      {weg && <Bevestig titel="Partner verwijderen" tekst={`${weg.naam} verdwijnt uit de klantapp. Dit kan niet ongedaan gemaakt worden.`} bevestigLabel="Verwijderen" gevaarlijk
        onAnnuleer={() => setWeg(null)} onBevestig={async () => { try { await api(`/api/admin/onze-partners/${weg.id}`, { method: 'DELETE' }); toast.success('Partner verwijderd.'); setWeg(null); laad() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } }} />}
    </div>
  )
}

function PartnerDialoog({ start, onSluit, onKlaar }: { start: { id: string | null; c: Concept }; onSluit: () => void; onKlaar: () => void }) {
  const [c, setC] = useState<Concept>(start.c)
  const [bezig, setBezig] = useState(false)
  const [upload, setUpload] = useState(false)
  const bestand = useRef<HTMLInputElement>(null)
  const zet = (k: keyof Concept, w: string | null) => setC((x) => ({ ...x, [k]: w }))
  const bewaar = async () => {
    setBezig(true)
    try {
      const body = JSON.stringify({ ...c, logo_url: undefined })
      await api(start.id ? `/api/admin/onze-partners/${start.id}` : '/api/admin/onze-partners', { method: start.id ? 'PATCH' : 'POST', body })
      toast.success(start.id ? 'Partner bijgewerkt.' : 'Partner toegevoegd. Klanten zien hem meteen.')
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  return (
    <Dialoog titel={start.id ? 'Partner bewerken' : 'Partner toevoegen'} onSluit={onSluit} breed>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="h-20 w-20 rounded-2xl border border-gray-200 bg-white flex items-center justify-center overflow-hidden shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {c.logo_url ? <img src={c.logo_url} alt="" className="max-h-full max-w-full object-contain" /> : <ImagePlus className="h-7 w-7 text-gray-300" />}
          </div>
          <div className="space-y-1">
            <button type="button" onClick={() => bestand.current?.click()} disabled={upload} className="btn-secondary !py-1.5 text-xs">{upload ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}{c.logo_pad ? 'Ander logo' : 'Logo opladen'}</button>
            {c.logo_pad && <button type="button" onClick={() => setC((x) => ({ ...x, logo_pad: null, logo_url: null }))} className="block text-xs text-gray-500 underline">Logo weghalen</button>}
            <p className="text-[11px] text-gray-500">PNG met transparante achtergrond werkt het mooist.</p>
            <input ref={bestand} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = ''
              if (!f) return
              setUpload(true)
              try { const r = await laadAfbeeldingOp('/api/admin/onze-partners/upload', f); setC((x) => ({ ...x, logo_pad: r.pad, logo_url: r.url })) } catch (err) { toast.error(err instanceof Error ? err.message : 'Opladen mislukt') } finally { setUpload(false) }
            }} />
          </div>
        </div>
        <div><label className={LBL} htmlFor="p-naam">Naam *</label><input id="p-naam" className={INP} value={c.naam} onChange={(e) => zet('naam', e.target.value)} placeholder="Bv. NextGen Solutions" /></div>
        <div><label className={LBL} htmlFor="p-uitleg">Korte uitleg</label><textarea id="p-uitleg" rows={3} maxLength={600} className={INP} value={c.korte_uitleg} onChange={(e) => zet('korte_uitleg', e.target.value)} placeholder="Wat doet dit bedrijf, in één of twee zinnen?" /></div>
        <div className="grid sm:grid-cols-2 gap-3">
          {LINKS.map((l) => (
            <div key={l.key}><label className={LBL} htmlFor={`p-${l.key}`}>{l.label}</label><input id={`p-${l.key}`} className={INP} value={c[l.key]} onChange={(e) => zet(l.key, e.target.value)} placeholder={l.voorbeeld} /></div>
          ))}
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button>
          <button type="button" onClick={bewaar} disabled={bezig || upload} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
        </div>
      </div>
    </Dialoog>
  )
}
