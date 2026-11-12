'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, FileText, Eye, Copy, Send, Ban, Trash2, Upload, Plus, Pencil, Check, X, Search, FilePlus2, CopyPlus, PenLine } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { formatEuro } from '@/lib/utils'
import { zoekVeld } from '@/lib/zoekveld'
import { MERK_STIJL, type MailMerk } from '@/lib/merk-mail'
import { verwijderVraag, offerteWeergave, moetOpvolgen, MAX_PDF, type Offerte, type Sjabloon } from '@/lib/offertes'
import { MailDialog } from '@/components/admin/mail-composer'
import { OfferteVersturen } from '@/components/admin/offerte-versturen'
import { KlantKiezer, type KlantOptie } from '@/components/admin/klant-kiezer'

type Rij = Offerte & { link: string }
type Filter = 'alles' | 'opvolgen' | 'open' | 'geaccepteerd' | 'concept' | 'gesloten'

const KLEUR: Record<string, string> = {
  grijs: 'bg-gray-100 text-gray-700', blauw: 'bg-blue-50 text-blue-800', amber: 'bg-amber-50 text-amber-900', groen: 'bg-green-50 text-green-800', rood: 'bg-red-50 text-red-700',
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j as T
}

export function OffertesClient({ tabStart, focus }: { tabStart: 'offertes' | 'sjablonen' | 'instellingen'; focus: string | null }) {
  const [tab, setTab] = useState(tabStart)
  const LABEL = { offertes: 'Offertes', sjablonen: 'Sjablonen (pdf)', instellingen: 'Instellingen' } as const
  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
        {(['offertes', 'sjablonen', 'instellingen'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={`text-sm font-medium px-3 py-1.5 rounded-md ${tab === t ? 'bg-gray-900 text-white' : 'text-gray-600'}`}>{LABEL[t]}</button>
        ))}
      </div>
      {tab === 'offertes' ? <OffertesLijst focus={focus} /> : tab === 'sjablonen' ? <Sjablonen /> : <OfferteInstellingenTab />}
    </div>
  )
}

function OffertesLijst({ focus }: { focus: string | null }) {
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [filter, setFilter] = useState<Filter>('alles')
  const [zoek, setZoek] = useState('')
  const [mail, setMail] = useState<Rij | null>(null)
  const [aanvaard, setAanvaard] = useState<Rij | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [klanten, setKlanten] = useState<KlantOptie[] | null>(null)
  const [klant, setKlant] = useState<KlantOptie | null>(null)

  const laad = useCallback(async () => {
    try { setRijen((await api<{ offertes: Rij[] }>('/api/admin/offertes')).offertes) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setRijen([]) }
  }, [])
  useEffect(() => { void laad() }, [laad])
  useEffect(() => {
    if (focus && rijen?.length) document.getElementById(`offerte-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focus, rijen])
  useEffect(() => { fetch('/api/admin/clients-list').then((r) => r.json()).then((j) => setKlanten(j.clients ?? [])).catch(() => setKlanten([])) }, [])

  const nu = new Date()
  const vandaag = nu.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  const telt = (f: Filter, o: Rij) =>
    f === 'alles' ? true
      : f === 'opvolgen' ? moetOpvolgen(o, nu)
      : f === 'open' ? o.status === 'verstuurd' && !(o.geldig_tot && o.geldig_tot < vandaag)
      : f === 'geaccepteerd' ? o.status === 'geaccepteerd'
      : f === 'concept' ? o.status === 'concept'
      : o.status === 'ingetrokken' || (o.status === 'verstuurd' && !!o.geldig_tot && o.geldig_tot < vandaag)
  const zichtbaar = useMemo(() => {
    const q = zoek.trim().toLowerCase()
    return (rijen ?? []).filter((o) => telt(filter, o)).filter((o) => !q || `${o.titel} ${o.klant_naam ?? ''}`.toLowerCase().includes(q))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rijen, filter, zoek])
  const aantal = (f: Filter) => (rijen ?? []).filter((o) => telt(f, o)).length
  const FILTERS: { k: Filter; l: string }[] = [
    { k: 'alles', l: 'Alles' }, { k: 'opvolgen', l: 'Opvolgen' }, { k: 'open', l: 'Wacht op klant' }, { k: 'geaccepteerd', l: 'Geaccepteerd' }, { k: 'concept', l: 'Concept' }, { k: 'gesloten', l: 'Verlopen of ingetrokken' },
  ]
  const actie = async (o: Rij, soort: 'intrekken' | 'verwijderen') => {
    if (!confirm(soort === 'intrekken' ? `"${o.titel}" intrekken? De klant kan ze dan niet meer accepteren.` : verwijderVraag(o))) return
    setBezig(o.id)
    try {
      if (soort === 'intrekken') await api(`/api/admin/offertes/${o.id}`, { method: 'PATCH', body: JSON.stringify({ actie: 'intrekken' }) })
      else await api(`/api/admin/offertes/${o.id}`, { method: 'DELETE' })
      toast.success(soort === 'intrekken' ? 'Ingetrokken.' : 'Verwijderd.'); void laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }
  const kopie = async (o: Rij) => {
    setBezig(o.id)
    try {
      const j = await api<{ offerte: Rij }>(`/api/admin/offertes/${o.id}/opmaken`, { method: 'POST', body: JSON.stringify({ actie: 'kopie' }) })
      toast.success(`Kopie ${j.offerte.offertenummer ?? ''} gemaakt. Pas ze aan en verstuur.`)
      window.location.href = `/admin/offertes/opmaken?id=${j.offerte.id}`
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Kopiëren mislukt'); setBezig(null) }
  }
  const chip = (aan: boolean) => `text-xs font-medium px-3 py-1.5 rounded-full border whitespace-nowrap ${aan ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-gray-400'}`

  return (
    <div className="space-y-3">
      <div className="card-base !p-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1 max-w-sm">
          <label className="block text-[11px] text-gray-500 mb-1">Nieuwe offerte voor</label>
          <KlantKiezer klanten={klanten} waarde={klant?.id ?? ''} onKies={setKlant} onNieuw={(k) => { setKlanten((l) => [...(l ?? []), k]); setKlant(k) }} bron="offerte" id="offerte-klant" />
        </div>
        <Link href={`/admin/offertes/opmaken${klant ? `?client=${klant.id}` : ''}`} className="btn-primary text-sm"><FilePlus2 className="h-4 w-4" />Offerte opmaken</Link>
        <OfferteVersturen key={klant?.id ?? 'geen'} clientId={klant?.id ?? null} klantNaam={klant?.company_name ?? null} label="Pdf versturen" className="btn-secondary text-sm" onVerstuurd={() => void laad()} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => <button key={f.k} type="button" onClick={() => setFilter(f.k)} className={chip(filter === f.k)}>{f.l} ({aantal(f.k)})</button>)}
        <div className="relative w-full sm:w-auto sm:ml-auto">
          <Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input {...zoekVeld('offertes')} value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek klant of titel" className="h-8 w-full sm:w-48 pl-8 pr-2 text-xs border border-gray-200 rounded-lg bg-white" />
        </div>
      </div>

      {rijen === null ? <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        : zichtbaar.length === 0 ? <div className="card-base text-center py-10 text-sm text-gray-500">{rijen.length ? 'Niets met deze filter.' : 'Nog geen offertes. Kies hierboven een klant en klik op "Offerte opmaken".'}</div>
        : (
          <ul className="space-y-2">
            {zichtbaar.map((o) => {
              const w = offerteWeergave(o, nu)
              return (
                <li key={o.id} id={`offerte-${o.id}`} className={`card-base !p-3 !pl-6 relative flex flex-wrap items-center gap-x-3 gap-y-2 ${focus === o.id ? 'ring-2 ring-gray-900' : ''}`}>
                  <span className="absolute left-2.5 top-3 bottom-3 w-1.5 rounded-full" style={{ background: MERK_STIJL[o.merk].accent }} title={MERK_STIJL[o.merk].naam} />
                  <div className="min-w-0 w-full sm:w-auto sm:flex-1">
                    <p className="text-sm font-semibold text-gray-900 truncate">{o.klant_naam ?? '—'} <span className="font-normal text-gray-500">· {o.offertenummer ? `${o.offertenummer} · ` : ''}{o.titel}</span>{o.getekend_op && <PenLine className="inline h-3.5 w-3.5 ml-1 text-green-700" aria-label="Getekend" />}</p>
                    <p className="text-xs text-gray-500 truncate">{w.sub}{o.bestelbon_nummer && <span className="ml-1.5 rounded-full bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10.5px] font-semibold">Bestelbon {o.bestelbon_nummer}</span>}</p>
                  </div>
                  {o.bedrag_excl !== null && o.bedrag_excl !== undefined && <span className="text-sm tabular-nums text-gray-800">{formatEuro(Number(o.bedrag_excl))}</span>}
                  <span className={`status-badge ${KLEUR[w.kleur]}`}>{w.label}</span>
                  <div className="flex items-center gap-1">
                    <a href={`/api/admin/offertes/${o.id}/pdf`} target="_blank" rel="noreferrer" className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Pdf bekijken"><Eye className="h-4 w-4" /></a>
                    {o.status !== 'concept' && o.status !== 'ingetrokken' && (
                      <button type="button" onClick={() => navigator.clipboard.writeText(o.link).then(() => toast.success('Link gekopieerd. Openen als team telt niet als geopend.'))} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Link naar de offerte kopiëren"><Copy className="h-4 w-4" /></button>
                    )}
                    {(o.status === 'concept' || o.status === 'verstuurd') && (
                      <button type="button" onClick={() => setMail(o)} className="btn-secondary text-xs h-8"><Send className="h-3.5 w-3.5" />{o.status === 'concept' ? 'Versturen' : 'Opnieuw'}</button>
                    )}
                    {o.bron === 'opgemaakt' && o.status === 'concept' && <Link href={`/admin/offertes/opmaken?id=${o.id}`} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Aanpassen"><Pencil className="h-4 w-4" /></Link>}
                    {o.bron === 'opgemaakt' && <button type="button" onClick={() => kopie(o)} disabled={bezig === o.id} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Kopie maken (nieuw nummer)"><CopyPlus className="h-4 w-4" /></button>}
                    {(o.status === 'verstuurd' || o.status === 'concept') && <button type="button" onClick={() => setAanvaard(o)} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 hover:text-green-700" title="Op aanvaard zetten (per mail, op papier of met een bestelbon)"><Check className="h-4 w-4" /></button>}
                    {o.status === 'verstuurd' && <button type="button" onClick={() => actie(o, 'intrekken')} disabled={bezig === o.id} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-red-600" title="Intrekken"><Ban className="h-4 w-4" /></button>}
                    <button type="button" onClick={() => actie(o, 'verwijderen')} disabled={bezig === o.id} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-red-600" title="Volledig verwijderen"><Trash2 className="h-4 w-4" /></button>
                    {o.opdracht_id && <Link href={`/admin/opdrachten?opdracht=${o.opdracht_id}`} className="text-xs text-gray-500 hover:text-black underline px-1">Project</Link>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}

      {aanvaard && <AanvaardDialoog offerte={aanvaard} onSluit={() => setAanvaard(null)} onKlaar={() => { setAanvaard(null); toast.success('Offerte staat op aanvaard. De kaart schuift naar Offerte geaccepteerd.'); void laad() }} />}

      {mail && (
        <MailDialog
          context={{ type: 'offerte', offerteId: mail.id, titel: mail.titel, link: mail.link, klant: mail.klant_naam, contact: mail.ontvanger_naam, email: mail.ontvanger_email, geldigTot: mail.geldig_tot, merk: mail.merk }}
          onClose={() => setMail(null)}
          onSent={() => { toast.success('Verstuurd.'); setMail(null); void laad() }}
        />
      )}
    </div>
  )
}

/** De klant aanvaardde buiten de app: per mail, op papier of met een bestelbon (dan het nummer erbij). */
function AanvaardDialoog({ offerte, onSluit, onKlaar }: { offerte: Rij; onSluit: () => void; onKlaar: () => void }) {
  const [via, setVia] = useState<'mail' | 'papier' | 'bestelbon'>('mail')
  const [bestelbon, setBestelbon] = useState('')
  const [notitie, setNotitie] = useState('')
  const [bezig, setBezig] = useState(false)
  const bewaar = async () => {
    if (via === 'bestelbon' && !bestelbon.trim()) { toast.error('Vul het bestelbonnummer in.'); return }
    setBezig(true)
    try {
      await api(`/api/admin/offertes/${offerte.id}`, { method: 'PATCH', body: JSON.stringify({ actie: 'aanvaard', via, bestelbon: via === 'bestelbon' ? bestelbon : null, notitie }) })
      onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const OPTIES = [{ k: 'mail', l: 'Per mail bevestigd' }, { k: 'papier', l: 'Op papier getekend' }, { k: 'bestelbon', l: 'Via een bestelbon' }] as const
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between gap-2 p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Check className="h-5 w-5 text-green-600" />Op aanvaard zetten</h3>
          <button type="button" onClick={() => !bezig && onSluit()} className="text-gray-400 hover:text-black" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-600">{offerte.klant_naam ?? 'De klant'} aanvaardde <b>{offerte.titel}</b> buiten de app.</p>
          <fieldset className="space-y-1.5">
            <legend className="text-xs text-gray-500 mb-1">Hoe?</legend>
            {OPTIES.map((o) => (
              <label key={o.k} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer ${via === o.k ? 'border-gray-900 bg-gray-50' : 'border-gray-200'}`}>
                <input type="radio" name="aanvaard-via" checked={via === o.k} onChange={() => setVia(o.k)} className="accent-gray-900" />{o.l}
              </label>
            ))}
          </fieldset>
          {via === 'bestelbon' && (
            <label className="block text-xs text-gray-500">Bestelbonnummer <span className="text-red-600">*</span>
              <input autoFocus maxLength={60} placeholder="bv. PO-2026-0815" className="mt-0.5 w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg" value={bestelbon} onChange={(e) => setBestelbon(e.target.value)} />
              <span className="block mt-1 text-[11px] text-gray-400">Gaat mee naar het contract van dit project en zo naar elke factuur.</span>
            </label>
          )}
          <label className="block text-xs text-gray-500">Notitie <span className="text-gray-400">(optioneel)</span>
            <textarea rows={2} maxLength={1000} className="mt-0.5 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={notitie} onChange={(e) => setNotitie(e.target.value)} placeholder="bv. bestelbon ontvangen van de aankoopdienst" />
          </label>
          <div className="flex gap-2">
            <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary flex-1 justify-center">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Op aanvaard zetten</button>
            <button type="button" onClick={onSluit} disabled={bezig} className="btn-secondary">Annuleer</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Sjablonen() {
  const [lijst, setLijst] = useState<Sjabloon[] | null>(null)
  const [nieuw, setNieuw] = useState(false)
  const laad = useCallback(async () => {
    try { setLijst((await api<{ sjablonen: Sjabloon[] }>('/api/admin/offertes/sjablonen')).sjablonen) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setLijst([]) }
  }, [])
  useEffect(() => { void laad() }, [laad])

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-gray-600 max-w-2xl">Elk sjabloon is een pdf (bv. offerte reel of website). Veranderen de prijzen, vervang dan gewoon de pdf: al verstuurde offertes houden hun eigen versie.</p>
        <button type="button" onClick={() => setNieuw(true)} className="btn-primary text-sm"><Plus className="h-4 w-4" />Nieuw sjabloon</button>
      </div>
      {nieuw && <SjabloonForm onKlaar={() => { setNieuw(false); void laad() }} onAnnuleer={() => setNieuw(false)} />}
      {lijst === null ? <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        : lijst.length === 0 ? <div className="card-base text-center py-10 text-sm text-gray-500">Nog geen sjablonen.</div>
        : <ul className="space-y-2">{lijst.map((s) => <SjabloonRij key={s.id} s={s} onGewijzigd={() => void laad()} />)}</ul>}
    </div>
  )
}

async function laadPdfOp(f: File): Promise<{ pad: string; naam: string }> {
  if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) throw new Error('Kies een pdf.')
  if (f.size > MAX_PDF) throw new Error('De pdf is groter dan 25 MB.')
  const j = await api<{ pad: string; token: string; bucket: string }>('/api/admin/offertes/upload', { method: 'POST', body: JSON.stringify({ soort: 'sjabloon', naam: f.name, grootte: f.size }) })
  const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: 'application/pdf', upsert: false })
  if (error) throw new Error(error.message)
  return { pad: j.pad, naam: f.name }
}

function SjabloonForm({ s, onKlaar, onAnnuleer }: { s?: Sjabloon; onKlaar: () => void; onAnnuleer: () => void }) {
  const [naam, setNaam] = useState(s?.naam ?? '')
  const [merk, setMerk] = useState<MailMerk>(s?.merk ?? 'nextgenmedia')
  const [dienst, setDienst] = useState(s?.dienst ?? '')
  const [pdf, setPdf] = useState<{ pad: string; naam: string } | null>(null)
  const [bezig, setBezig] = useState<'pdf' | 'bewaar' | null>(null)
  const kiezer = useRef<HTMLInputElement>(null)
  const kies = async (f?: File) => {
    if (!f) return
    setBezig('pdf')
    try { setPdf(await laadPdfOp(f)); if (!naam) setNaam(f.name.replace(/\.pdf$/i, '')) } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally { setBezig(null); if (kiezer.current) kiezer.current.value = '' }
  }
  const bewaar = async () => {
    setBezig('bewaar')
    try {
      await api('/api/admin/offertes/sjablonen', { method: 'POST', body: JSON.stringify({ id: s?.id, naam, merk, dienst, ...(pdf ? { pdf_pad: pdf.pad, pdf_naam: pdf.naam } : {}) }) })
      toast.success('Sjabloon bewaard.'); onKlaar()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(null) }
  }
  return (
    <div className="card-base space-y-3">
      <div className="grid sm:grid-cols-3 gap-3">
        <div><label className="block text-xs text-gray-500 mb-1">Naam</label><input className="input-base" value={naam} onChange={(e) => setNaam(e.target.value)} placeholder="Offerte reel" maxLength={120} /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Dienst <span className="text-gray-400">(optioneel)</span></label><input className="input-base" value={dienst} onChange={(e) => setDienst(e.target.value)} placeholder="Foto & videografie" maxLength={80} /></div>
        <div>
          <span className="block text-xs text-gray-500 mb-1">Van</span>
          <div className="grid grid-cols-2 gap-1.5">
            {(['nextgenmedia', 'nextgensolutions'] as MailMerk[]).map((m) => (
              <button key={m} type="button" onClick={() => setMerk(m)} className={`rounded-lg border-2 px-2 py-1.5 text-xs font-semibold ${merk === m ? '' : 'border-gray-200 text-gray-600'}`}
                style={merk === m ? { background: MERK_STIJL[m].accent, borderColor: MERK_STIJL[m].accent, color: MERK_STIJL[m].opAccent } : undefined}>{m === 'nextgenmedia' ? 'Media' : 'Solutions'}</button>
            ))}
          </div>
        </div>
      </div>
      <input ref={kiezer} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => kies(e.target.files?.[0])} />
      <button type="button" onClick={() => kiezer.current?.click()} disabled={!!bezig} className={`w-full rounded-xl border-2 border-dashed px-3 py-3 text-sm flex items-center justify-center gap-2 ${pdf ? 'border-gray-900 text-gray-900' : 'border-gray-300 text-gray-600'}`}>
        {bezig === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : pdf ? <Check className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
        {pdf ? pdf.naam : s ? 'Nieuwe pdf kiezen (vervangt de huidige)' : 'Pdf kiezen'}
      </button>
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onAnnuleer} className="btn-secondary">Annuleren</button>
        <button type="button" onClick={bewaar} disabled={!!bezig || naam.trim().length < 2 || (!s && !pdf)} className="btn-primary">{bezig === 'bewaar' && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
      </div>
    </div>
  )
}

function SjabloonRij({ s, onGewijzigd }: { s: Sjabloon; onGewijzigd: () => void }) {
  const [bewerk, setBewerk] = useState(false)
  const [bezig, setBezig] = useState(false)
  if (bewerk) return <li><SjabloonForm s={s} onKlaar={() => { setBewerk(false); onGewijzigd() }} onAnnuleer={() => setBewerk(false)} /></li>
  const wissel = async () => {
    setBezig(true)
    try { await api('/api/admin/offertes/sjablonen', { method: 'POST', body: JSON.stringify({ id: s.id, naam: s.naam, merk: s.merk, dienst: s.dienst, actief: !s.actief }) }); onGewijzigd() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  const weg = async () => {
    if (!confirm(`Sjabloon "${s.naam}" verwijderen? Al verstuurde offertes blijven gewoon bestaan.`)) return
    setBezig(true)
    try { await api(`/api/admin/offertes/sjablonen?id=${s.id}`, { method: 'DELETE' }); toast.success('Verwijderd.'); onGewijzigd() } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(false) }
  }
  return (
    <li className={`card-base !p-3 !pl-6 relative flex flex-wrap items-center gap-x-3 gap-y-2 ${s.actief ? '' : 'opacity-60'}`}>
      <span className="absolute left-2.5 top-3 bottom-3 w-1.5 rounded-full" style={{ background: MERK_STIJL[s.merk].accent }} />
      <div className="min-w-0 w-full sm:w-auto sm:flex-1 flex items-start gap-2">
        <FileText className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
        <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{s.naam}{!s.actief && <span className="ml-2 text-xs font-normal text-gray-500">(uitgezet)</span>}</p>
        <p className="text-xs text-gray-500 truncate">{[MERK_STIJL[s.merk].naam, s.dienst, s.pdf_naam, `bijgewerkt ${new Date(s.updated_at).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })}`].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <button type="button" onClick={() => setBewerk(true)} className="btn-secondary text-xs h-8"><Pencil className="h-3.5 w-3.5" />Wijzigen of pdf vervangen</button>
      <button type="button" onClick={wissel} disabled={bezig} className="btn-secondary text-xs h-8">{s.actief ? <><X className="h-3.5 w-3.5" />Uitzetten</> : <><Check className="h-3.5 w-3.5" />Aanzetten</>}</button>
      <button type="button" onClick={weg} disabled={bezig} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-red-600" title="Verwijderen"><Trash2 className="h-4 w-4" /></button>
    </li>
  )
}

/** De betalingstermijn op de offerte; de contactpersonen komen uit Personeel en de bedrijfsgegevens liggen vast. */
function OfferteInstellingenTab() {
  type C = { naam: string; functie: string; telefoon: string; email: string; heeftFoto?: boolean }
  const [termijn, setTermijn] = useState<number | null>(null)
  const [contacten, setContacten] = useState<{ marco: C; bram: C } | null>(null)
  const [mag, setMag] = useState(false)
  const [bezig, setBezig] = useState(false)
  useEffect(() => {
    api<{ instellingen: { betalingstermijn: number }; contacten: { marco: C; bram: C }; mag_aanpassen: boolean }>('/api/admin/offertes/instellingen')
      .then((j) => { setTermijn(j.instellingen.betalingstermijn); setContacten(j.contacten); setMag(j.mag_aanpassen) })
      .catch((e) => toast.error(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [])
  if (termijn === null || !contacten) return <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const bewaar = async () => {
    setBezig(true)
    try { await api('/api/admin/offertes/instellingen', { method: 'PUT', body: JSON.stringify({ betalingstermijn: termijn }) }); toast.success('Bewaard. Nieuwe offertes gebruiken deze termijn.') }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="space-y-3 max-w-3xl">
      <div className="card-base space-y-3">
        <div>
          <h2 className="font-semibold">Contactpersoon op de offerte</h2>
          <p className="text-xs text-gray-500 mt-0.5">Bij elke offerte kies je Marco of Bram. Naam, functie, telefoon, e-mail en profielfoto komen uit <Link href="/admin/personeel" className="underline">Personeel</Link>; pas ze daar aan en elke nieuwe offerte volgt.</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {(['marco', 'bram'] as const).map((k) => {
            const c = contacten[k]
            const mist = [!c.telefoon && 'telefoon', c.email === 'info@nextgenmedia.be' && 'eigen e-mailadres', !c.heeftFoto && 'foto'].filter(Boolean) as string[]
            return (
              <div key={k} className="rounded-xl border border-gray-200 p-3 text-sm">
                <p className="font-semibold">{c.naam}</p>
                <p className="text-gray-600">{c.functie}</p>
                <p className="text-gray-600">{c.telefoon || '—'} · {c.email}</p>
                {mist.length > 0 && <p className="text-xs text-amber-700 mt-1">Nog aan te vullen in Personeel: {mist.join(', ')}.</p>}
              </div>
            )
          })}
        </div>
      </div>
      <div className="card-base space-y-2">
        <label className="block max-w-[260px]">
          <span className="block text-xs font-medium text-gray-600 mb-1">Betalingstermijn op de offerte (dagen)</span>
          <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg disabled:bg-gray-50" disabled={!mag} inputMode="numeric" value={String(termijn)} onChange={(e) => setTermijn(Number(e.target.value.replace(/\D/g, '')) || 0)} />
        </label>
        {mag ? <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
          : <p className="text-xs text-gray-500">Enkel wie de instellingen van Offertes mag beheren, past dit aan.</p>}
      </div>
      <div className="card-base text-sm text-gray-600">
        Op elke offerte staat als dienstverlener: NextGen Agency BV, handelsnaam NextGenMedia, ondernemingsnummer 1044.961.303, Corda Campus, Kempische Steenweg 293/16 B, 3500 Hasselt, vertegenwoordigd door Bram Reinquin (zaakvoerder), legal@nextgenmedia.be.
      </div>
    </div>
  )
}
