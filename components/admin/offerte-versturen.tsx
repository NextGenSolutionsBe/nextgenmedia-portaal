'use client'

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Upload, Loader2, X, Send, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { MailDialog } from '@/components/admin/mail-composer'
import { MERK_STIJL, type MailMerk } from '@/lib/merk-mail'
import { GELDIG_DAGEN, MAX_PDF, type Sjabloon, type Offerte } from '@/lib/offertes'

type Props = {
  clientId?: string | null
  opdrachtId?: string | null
  klantNaam?: string | null
  merkStandaard?: MailMerk | null
  label?: string
  className?: string
  onVerstuurd?: () => void
}

const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const plus = (n: number) => { const d = new Date(`${vandaag()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }

/**
 * "Stuur offerte": een sjabloon kiezen (of een eigen pdf opladen), titel en
 * bedrag nakijken, en dan de mail in de MailComposer (voorbeeld + Versturen).
 * De klant krijgt een knop naar de offertepagina en accepteert daar.
 */
export function OfferteVersturen({ clientId = null, opdrachtId = null, klantNaam = null, merkStandaard = null, label = 'Stuur offerte', className = 'btn-primary text-sm', onVerstuurd }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}><Send className="h-4 w-4" />{label}</button>
      {open && <OfferteVenster clientId={clientId} opdrachtId={opdrachtId} klantNaam={klantNaam} merkStandaard={merkStandaard} onSluit={() => setOpen(false)} onVerstuurd={() => { setOpen(false); onVerstuurd?.() }} />}
    </>
  )
}

function OfferteVenster({ clientId, opdrachtId, klantNaam, merkStandaard, onSluit, onVerstuurd }: Omit<Props, 'label' | 'className'> & { onSluit: () => void }) {
  const [sjablonen, setSjablonen] = useState<Sjabloon[] | null>(null)
  const [keuze, setKeuze] = useState<string | null>(null)
  const [eigen, setEigen] = useState<{ pad: string; naam: string } | null>(null)
  const [uploaden, setUploaden] = useState(false)
  const [titel, setTitel] = useState('')
  const [bedrag, setBedrag] = useState('')
  const [geldig, setGeldig] = useState(plus(GELDIG_DAGEN))
  const [merk, setMerk] = useState<MailMerk>(merkStandaard ?? 'nextgenmedia')
  const [vrijeKlant, setVrijeKlant] = useState(klantNaam ?? '')
  const [bezig, setBezig] = useState(false)
  const [offerte, setOfferte] = useState<(Offerte & { link: string }) | null>(null)
  const [contact, setContact] = useState<{ naam: string | null; email: string | null }>({ naam: null, email: null })
  const kiezer = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/admin/offertes?sjablonen=1').then((r) => r.json()).then((j) => setSjablonen(j.sjablonen ?? [])).catch(() => setSjablonen([]))
  }, [])

  const kies = (s: Sjabloon) => {
    setKeuze(s.id); setEigen(null); setMerk(s.merk)
    setTitel((t) => (t && !sjablonen?.some((x) => x.naam === t) ? t : s.naam))
  }

  const laadOp = async (f: File | undefined) => {
    if (!f) return
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) { toast.error('Kies een pdf.'); return }
    if (f.size > MAX_PDF) { toast.error('De pdf is groter dan 25 MB.'); return }
    setUploaden(true)
    try {
      const r = await fetch('/api/admin/offertes/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ soort: 'offerte', naam: f.name, grootte: f.size }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Opladen mislukt')
      const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: 'application/pdf', upsert: false })
      if (error) throw new Error(error.message)
      setEigen({ pad: j.pad, naam: f.name }); setKeuze(null)
      if (!titel) setTitel(f.name.replace(/\.pdf$/i, ''))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally { setUploaden(false); if (kiezer.current) kiezer.current.value = '' }
  }

  const verder = async () => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/offertes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ titel, bedrag_excl: bedrag, geldig_tot: geldig, merk, sjabloon_id: keuze, eigen_pad: eigen?.pad ?? null, eigen_naam: eigen?.naam ?? null, client_id: clientId, opdracht_id: opdrachtId, klant_naam: clientId ? null : vrijeKlant }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Aanmaken mislukt')
      setContact({ naam: j.offerte.ontvanger_naam ?? null, email: j.offerte.ontvanger_email ?? null })
      setOfferte(j.offerte)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Aanmaken mislukt') } finally { setBezig(false) }
  }

  // Stap 2: de mail (MailComposer). Sluiten zonder versturen laat een concept achter in Offertes.
  if (offerte) {
    return (
      <MailDialog
        context={{ type: 'offerte', offerteId: offerte.id, titel: offerte.titel, link: offerte.link, klant: offerte.klant_naam, contact: contact.naam, email: contact.email, geldigTot: offerte.geldig_tot, merk: offerte.merk }}
        onClose={() => { toast.message('Niet verstuurd. De offerte staat als concept in Offertes.'); onVerstuurd?.() }}
        onSent={() => { toast.success('Offerte verstuurd. Je ziet in Offertes wanneer de klant ze opent.'); onVerstuurd?.() }}
      />
    )
  }

  const klaar = (keuze || eigen) && titel.trim().length >= 2 && (clientId || vrijeKlant.trim())
  const groepen = (['nextgenmedia', 'nextgensolutions'] as MailMerk[]).map((m) => ({ m, lijst: (sjablonen ?? []).filter((s) => s.merk === m) })).filter((g) => g.lijst.length)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onSluit}>
      <div className="bg-white w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Offerte versturen">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h3 className="font-semibold">Offerte versturen</h3>
            {klantNaam && <p className="text-xs text-gray-500">{klantNaam}</p>}
          </div>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <p className="text-xs font-medium text-gray-600 mb-2">1. Welke offerte?</p>
            {sjablonen === null ? <div className="py-4 flex justify-center"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div> : (
              <div className="space-y-3">
                {groepen.map(({ m, lijst }) => (
                  <div key={m}>
                    <p className="text-[11px] text-gray-500 mb-1 flex items-center gap-1.5"><span className="h-2 w-2 rounded-full ring-1 ring-black/10" style={{ background: MERK_STIJL[m].accent }} />{MERK_STIJL[m].naam}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {lijst.map((s) => (
                        <button key={s.id} type="button" onClick={() => kies(s)} aria-pressed={keuze === s.id}
                          className={`text-left rounded-xl border-2 px-3 py-2.5 transition ${keuze === s.id ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}>
                          <span className="flex items-start gap-2">
                            <FileText className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-gray-900 truncate">{s.naam}</span>
                              {s.dienst && <span className="block text-[11px] text-gray-500 truncate">{s.dienst}</span>}
                            </span>
                            {keuze === s.id && <Check className="h-4 w-4 ml-auto shrink-0" />}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {!groepen.length && <p className="text-xs text-gray-500">Nog geen sjablonen. Voeg ze toe in Offertes → Sjablonen, of laad hieronder een pdf op.</p>}
                <input ref={kiezer} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => laadOp(e.target.files?.[0])} />
                <button type="button" onClick={() => kiezer.current?.click()} disabled={uploaden}
                  className={`w-full rounded-xl border-2 border-dashed px-3 py-3 text-sm flex items-center justify-center gap-2 ${eigen ? 'border-gray-900 bg-gray-50 text-gray-900' : 'border-gray-300 text-gray-600 hover:border-gray-400'}`}>
                  {uploaden ? <Loader2 className="h-4 w-4 animate-spin" /> : eigen ? <Check className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
                  {eigen ? eigen.naam : 'Eigen pdf opladen'}
                </button>
              </div>
            )}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium text-gray-600">2. Gegevens</p>
            {!clientId && (
              <div>
                <label className="block text-xs text-gray-500 mb-1" htmlFor="off-klant">Klant</label>
                <input id="off-klant" className="input-base" value={vrijeKlant} onChange={(e) => setVrijeKlant(e.target.value)} placeholder="Naam van het bedrijf" maxLength={160} />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1" htmlFor="off-titel">Titel</label>
              <input id="off-titel" className="input-base" value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Bv. Offerte website" maxLength={160} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1" htmlFor="off-bedrag">Bedrag excl. btw <span className="text-gray-400">(optioneel)</span></label>
                <input id="off-bedrag" className="input-base" inputMode="decimal" value={bedrag} onChange={(e) => setBedrag(e.target.value)} placeholder="Bv. 4950" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1" htmlFor="off-geldig">Geldig tot</label>
                <input id="off-geldig" type="date" className="input-base" min={vandaag()} value={geldig} onChange={(e) => setGeldig(e.target.value)} />
              </div>
            </div>
            <div>
              <span className="block text-xs text-gray-500 mb-1">Van</span>
              <div className="grid grid-cols-2 gap-2">
                {(['nextgenmedia', 'nextgensolutions'] as MailMerk[]).map((m) => (
                  <button key={m} type="button" onClick={() => setMerk(m)} aria-pressed={merk === m}
                    className={`rounded-xl border-2 px-3 py-2 text-sm font-semibold text-left ${merk === m ? '' : 'border-gray-200 text-gray-700'}`}
                    style={merk === m ? { background: MERK_STIJL[m].accent, borderColor: MERK_STIJL[m].accent, color: MERK_STIJL[m].opAccent } : undefined}>
                    {MERK_STIJL[m].naam}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 px-5 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <span className="text-[11px] text-gray-500 mr-auto">Je ziet de mail eerst, er vertrekt nog niets.</span>
          <button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button>
          <button type="button" onClick={verder} disabled={!klaar || bezig || uploaden} className="btn-primary">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Verder naar de mail
          </button>
        </div>
      </div>
    </div>
  )
}
