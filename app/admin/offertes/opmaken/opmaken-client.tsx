'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Check, Eye, Loader2, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { KlantKiezer, type KlantOptie } from '@/components/admin/klant-kiezer'
import { MailDialog } from '@/components/admin/mail-composer'
import { MERK_STIJL, type MailMerk } from '@/lib/merk-mail'
import { GELDIG_DAGEN, type Offerte } from '@/lib/offertes'
import {
  ALGEMEEN, DIENST_FICHES, PRIJS, berekenPrijs, controleerOpmaak, euro, ficheVan, leesInhoud, legeInhoud, isGeldigBedrag,
  type DienstFicheKey, type OfferteInhoud, type Veld, type Waarden, type Verantwoordelijke,
} from '@/lib/offerte-fiche'
import type { OfferteContact } from '@/lib/offerte-afzender'

const vandaag = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
const plus = (n: number) => { const d = new Date(`${vandaag()}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const INP = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/15 focus:border-gray-900'
const LBL = 'block text-xs font-medium text-gray-600 mb-1'

type Rij = Offerte & { link: string }

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Er ging iets mis')
  return j as T
}

/** Eén veld uit een fiche: tekst, getal, bedrag, datum, ja/nee (met vervolgvraag) of keuzes (met "andere"). */
function VeldInvoer({ v, w, zet, id }: { v: Veld; w: Waarden; zet: (k: string, x: string | string[] | undefined) => void; id: string }) {
  const waarde = w[v.key]
  const tekst = typeof waarde === 'string' ? waarde : ''
  const label = <label className={LBL} htmlFor={`${id}-${v.key}`}>{v.label}</label>
  if (v.soort === 'janee') {
    return (
      <div className="sm:col-span-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2">
          <span className="text-sm text-gray-800">{v.label}{v.feit ? '?' : ''}</span>
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden shrink-0" role="group" aria-label={v.label}>
            {(['ja', 'nee'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={waarde === k} onClick={() => zet(v.key, waarde === k ? undefined : k)}
                className={`text-xs font-semibold px-3 py-1.5 ${waarde === k ? (k === 'ja' ? 'bg-green-700 text-white' : 'bg-gray-900 text-white') : 'bg-white text-gray-600 hover:bg-gray-50'} ${k === 'nee' ? 'border-l border-gray-200' : ''}`}>
                {v.feit ? (k === 'ja' ? 'Ja' : 'Nee') : (k === 'ja' ? 'Inbegrepen' : 'Niet')}
              </button>
            ))}
          </div>
        </div>
        {waarde === 'ja' && v.bijJa && (
          <div className="mt-2 pl-3 border-l-2 border-green-600/40"><VeldInvoer v={v.bijJa} w={w} zet={zet} id={id} /></div>
        )}
      </div>
    )
  }
  if (v.soort === 'keuzes' || v.soort === 'keuze') {
    const lijst = v.soort === 'keuzes' ? (Array.isArray(waarde) ? waarde : []) : (tekst ? [tekst] : [])
    const wissel = (o: string) => {
      if (v.soort === 'keuze') zet(v.key, lijst.includes(o) ? undefined : o)
      else zet(v.key, lijst.includes(o) ? lijst.filter((x) => x !== o) : [...lijst, o])
    }
    return (
      <div className={v.breed ? 'sm:col-span-2' : ''}>
        <span className={LBL}>{v.label}</span>
        <div className="flex flex-wrap gap-1.5 items-center">
          {(v.opties ?? []).map((o) => (
            <button key={o} type="button" aria-pressed={lijst.includes(o)} onClick={() => wissel(o)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${lijst.includes(o) ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'}`}>
              {lijst.includes(o) && <Check className="h-3 w-3 inline -mt-0.5 mr-1" />}{o}
            </button>
          ))}
          <input className="text-xs px-3 py-1.5 rounded-full border border-dashed border-gray-300 bg-white min-w-[140px] focus:outline-none focus:border-gray-900" placeholder="Andere: …"
            value={typeof w[`${v.key}_andere`] === 'string' ? (w[`${v.key}_andere`] as string) : ''} onChange={(e) => zet(`${v.key}_andere`, e.target.value)} aria-label={`${v.label}: andere`} />
        </div>
      </div>
    )
  }
  const fout = v.soort === 'bedrag' && tekst && !isGeldigBedrag(tekst)
  return (
    <div className={v.breed || v.soort === 'lang' ? 'sm:col-span-2' : ''}>
      {label}
      {v.soort === 'lang' ? (
        <textarea id={`${id}-${v.key}`} rows={3} className={INP} value={tekst} placeholder={v.ph} onChange={(e) => zet(v.key, e.target.value)} />
      ) : (
        <div className="relative">
          {v.soort === 'bedrag' && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>}
          <input id={`${id}-${v.key}`} type={v.soort === 'datum' ? 'date' : 'text'} inputMode={v.soort === 'getal' ? 'numeric' : v.soort === 'bedrag' ? 'decimal' : undefined}
            className={`${INP} ${v.soort === 'bedrag' ? 'pl-7' : ''} ${v.eenheid ? 'pr-20' : ''} ${fout ? '!border-red-400' : ''}`} value={tekst} placeholder={v.ph} onChange={(e) => zet(v.key, e.target.value)} />
          {v.eenheid && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">{v.eenheid}</span>}
        </div>
      )}
      {fout && <p className="text-[11px] text-red-700 mt-0.5">Gebruik bv. 1250 of 1.250,50.</p>}
    </div>
  )
}

function Kaart({ titel, sub, children, rechts }: { titel: string; sub?: string; children: React.ReactNode; rechts?: React.ReactNode }) {
  return (
    <section className="card-base space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div><h2 className="font-semibold text-gray-900">{titel}</h2>{sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}</div>
        {rechts}
      </div>
      {children}
    </section>
  )
}

export function OfferteOpmaken({ beginKlant, opdrachtId, offerteId }: { beginKlant: string | null; opdrachtId: string | null; offerteId: string | null }) {
  const router = useRouter()
  const [klanten, setKlanten] = useState<KlantOptie[] | null>(null)
  const [klant, setKlant] = useState<KlantOptie | null>(null)
  const [merk, setMerk] = useState<MailMerk>('nextgenmedia')
  const [wie, setWie] = useState<Verantwoordelijke | null>(null)
  const [inhoud, setInhoud] = useState<OfferteInhoud>(() => legeInhoud(vandaag(), plus(GELDIG_DAGEN)))
  const [contacten, setContacten] = useState<Record<Verantwoordelijke, OfferteContact> | null>(null)
  const [laden, setLaden] = useState(!!offerteId)
  const [bezig, setBezig] = useState<'voorbeeld' | 'bewaar' | 'verstuur' | null>(null)
  const [mail, setMail] = useState<Rij | null>(null)
  const [toonFouten, setToonFouten] = useState(false)
  const [project, setProject] = useState<string | null>(opdrachtId)
  const [status, setStatus] = useState<string | null>(null)

  // Klanten, volgend nummer en de contacten per verantwoordelijke.
  useEffect(() => {
    fetch('/api/admin/clients-list').then((r) => r.json()).then((j) => {
      const lijst = (j.clients ?? []) as KlantOptie[]
      setKlanten(lijst)
      if (beginKlant && !offerteId) { const k = lijst.find((x) => x.id === beginKlant); if (k) kiesKlant(k) }
    }).catch(() => setKlanten([]))
    api<{ volgend_nummer: string; contacten: Record<Verantwoordelijke, OfferteContact> }>('/api/admin/offertes/opmaken').then((j) => {
      setContacten(j.contacten)
      if (!offerteId) setInhoud((i) => (i.algemeen.offertenummer ? i : { ...i, algemeen: { ...i.algemeen, offertenummer: j.volgend_nummer } }))
    }).catch(() => null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beginKlant, offerteId])

  // Een concept aanpassen: alles terugzetten zoals het bewaard werd.
  useEffect(() => {
    if (!offerteId) return
    api<{ offerte: Rij }>(`/api/admin/offertes/${offerteId}`).then(({ offerte: o }) => {
      if (o.bron !== 'opgemaakt') { toast.error('Deze offerte is een pdf en kan je hier niet aanpassen.'); router.push('/admin/offertes'); return }
      setInhoud(leesInhoud(o.inhoud)); setMerk(o.merk); setWie(o.verantwoordelijke === 'marco' || o.verantwoordelijke === 'bram' ? o.verantwoordelijke : null)
      setProject(o.opdracht_id)
      setKlant(o.client_id ? { id: o.client_id, company_name: o.klant_naam ?? 'Klant' } : null)
      if (o.status !== 'concept') toast.message('Deze offerte is al verstuurd. Bewaren maakt een kopie met een nieuw nummer.')
      setStatus(o.status)
    }).catch((e) => toast.error(e instanceof Error ? e.message : 'Laden mislukt')).finally(() => setLaden(false))
  }, [offerteId, router])

  const kiesKlant = (k: KlantOptie | null) => {
    setKlant(k)
    if (!k) return
    // Contactgegevens van de klant invullen waar nog niets staat.
    setInhoud((i) => ({ ...i, algemeen: {
      ...i.algemeen,
      contactpersoon: (i.algemeen.contactpersoon as string) || k.contact_name || '',
      email: (i.algemeen.email as string) || k.email || '',
      feedback_contact: (i.algemeen.feedback_contact as string) || k.contact_name || '',
    } }))
  }

  const zetSectie = (sectie: 'algemeen' | 'prijs') => (k: string, x: string | string[] | undefined) =>
    setInhoud((i) => { const s = { ...i[sectie] }; if (x === undefined || x === '') delete s[k]; else s[k] = x; return { ...i, [sectie]: s } })
  const zetFiche = (d: DienstFicheKey) => (k: string, x: string | string[] | undefined) =>
    setInhoud((i) => { const s = { ...(i.fiches[d] ?? {}) }; if (x === undefined || x === '' || (Array.isArray(x) && !x.length)) delete s[k]; else s[k] = x; return { ...i, fiches: { ...i.fiches, [d]: s } } })
  const wisselDienst = (d: DienstFicheKey) => setInhoud((i) => (i.diensten.includes(d) ? { ...i, diensten: i.diensten.filter((x) => x !== d) } : { ...i, diensten: [...i.diensten, d] }))

  const prijs = useMemo(() => berekenPrijs(inhoud.prijs, inhoud.extra), [inhoud.prijs, inhoud.extra])
  const fouten = controleerOpmaak(inhoud, { klant: !!klant, verantwoordelijke: wie, vandaag: vandaag() })
  // Een verstuurde offerte verandert niet meer: bewaren maakt dan een kopie met een nieuw nummer.
  const verstuurd = !!offerteId && status !== null && status !== 'concept'
  const body = () => ({ client_id: klant?.id ?? null, opdracht_id: project, merk, verantwoordelijke: wie, inhoud })

  const voorbeeld = async () => {
    const venster = window.open('', '_blank')
    setBezig('voorbeeld')
    try {
      const r = await fetch('/api/admin/offertes/voorbeeld', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body()) })
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Voorbeeld mislukt') }
      const url = URL.createObjectURL(await r.blob())
      if (venster) venster.location.href = url; else window.open(url, '_blank')
    } catch (e) { venster?.close(); toast.error(e instanceof Error ? e.message : 'Voorbeeld mislukt') } finally { setBezig(null) }
  }

  const bewaar = async (versturen: boolean) => {
    if (fouten.length) { setToonFouten(true); toast.error(fouten[0].fout); return }
    setBezig(versturen ? 'verstuur' : 'bewaar')
    try {
      const { offerte } = offerteId && !verstuurd
        ? await api<{ offerte: Rij }>(`/api/admin/offertes/${offerteId}/opmaken`, { method: 'PATCH', body: JSON.stringify(body()) })
        : await api<{ offerte: Rij }>('/api/admin/offertes/opmaken', { method: 'POST', body: JSON.stringify(offerteId && verstuurd ? { ...body(), inhoud: { ...inhoud, algemeen: { ...inhoud.algemeen, offertenummer: '' } } } : body()) })
      if (versturen) setMail(offerte)
      else { toast.success(`Offerte ${offerte.offertenummer ?? ''} bewaard als concept.`); router.push(`/admin/offertes?offerte=${offerte.id}`) }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(null) }
  }

  if (laden) return <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>

  const fout = (veld: string) => toonFouten ? fouten.find((f) => f.veld === veld)?.fout : undefined
  const contact = wie && contacten ? contacten[wie] : null

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start pb-24 lg:pb-0">
      <div className="space-y-4 min-w-0">
        <Link href="/admin/offertes" className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" />Terug naar Offertes</Link>

        <Kaart titel="Klant en afzender">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <span className={LBL}>Klant *</span>
              <KlantKiezer klanten={klanten} waarde={klant?.id ?? ''} onKies={kiesKlant} onNieuw={(k) => { setKlanten((l) => [...(l ?? []), k]); kiesKlant(k) }} bron="offerte" id="opmaak-klant" />
              {fout('klant') && <p className="text-[11px] text-red-700 mt-0.5">{fout('klant')}</p>}
            </div>
            <div>
              <span className={LBL}>Van</span>
              <div className="grid grid-cols-2 gap-1.5">
                {(['nextgenmedia', 'nextgensolutions'] as MailMerk[]).map((m) => (
                  <button key={m} type="button" onClick={() => setMerk(m)} aria-pressed={merk === m}
                    className={`rounded-lg border-2 px-2 py-2 text-xs font-semibold ${merk === m ? '' : 'border-gray-200 text-gray-600'}`}
                    style={merk === m ? { background: MERK_STIJL[m].accent, borderColor: MERK_STIJL[m].accent, color: MERK_STIJL[m].opAccent } : undefined}>{MERK_STIJL[m].naam}</button>
                ))}
              </div>
            </div>
            <div>
              <span className={LBL}>Verantwoordelijke van de offerte *</span>
              <div className="grid grid-cols-2 gap-1.5">
                {(['marco', 'bram'] as Verantwoordelijke[]).map((k) => (
                  <button key={k} type="button" onClick={() => setWie(k)} aria-pressed={wie === k}
                    className={`rounded-lg border-2 px-2 py-2 text-xs font-semibold ${wie === k ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700'}`}>{contacten?.[k].naam ?? (k === 'marco' ? 'Marco' : 'Bram')}</button>
                ))}
              </div>
              {contact && (
                <p className="text-[11px] text-gray-500 mt-1">
                  Contactpersoon op de offerte: {[contact.functie, contact.telefoon || 'nog geen telefoon', contact.email, contact.heeftFoto ? 'met foto' : 'nog geen foto'].join(' · ')}.
                  {(!contact.telefoon || contact.email === 'info@nextgenmedia.be') && <> Vul aan in <a href="/admin/personeel" target="_blank" rel="noreferrer" className="underline">Personeel</a>.</>}
                </p>
              )}
              {fout('verantwoordelijke') && <p className="text-[11px] text-red-700 mt-0.5">{fout('verantwoordelijke')}</p>}
            </div>
          </div>
        </Kaart>

        <Kaart titel="1. Algemene gegevens">
          <div className="grid sm:grid-cols-2 gap-3">
            {ALGEMEEN.map((v) => (
              <div key={v.key} className={v.breed || v.soort === 'lang' ? 'sm:col-span-2' : ''}>
                <VeldInvoer v={{ ...v, breed: false }} w={inhoud.algemeen} zet={zetSectie('algemeen')} id="alg" />
                {fout(v.key) && <p className="text-[11px] text-red-700 mt-0.5">{fout(v.key)}</p>}
              </div>
            ))}
          </div>
        </Kaart>

        <Kaart titel="2. Diensten" sub="Kies wat je aanbiedt. Enkel die fiches vul je in; de volgorde hier is de volgorde op de offerte.">
          <div className="flex flex-wrap gap-1.5">
            {DIENST_FICHES.map((d) => {
              const aan = inhoud.diensten.includes(d.key)
              return (
                <button key={d.key} type="button" onClick={() => wisselDienst(d.key)} aria-pressed={aan}
                  className={`text-sm font-medium px-3 py-1.5 rounded-full border transition ${aan ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'}`}>
                  {aan ? <Check className="h-3.5 w-3.5 inline -mt-0.5 mr-1" /> : <Plus className="h-3.5 w-3.5 inline -mt-0.5 mr-1" />}{d.titel}
                </button>
              )
            })}
          </div>
          {fout('diensten') && <p className="text-[11px] text-red-700">{fout('diensten')}</p>}
        </Kaart>

        {inhoud.diensten.map((d, i) => {
          const f = ficheVan(d)!
          return (
            <Kaart key={d} titel={`${String(i + 1).padStart(2, '0')} · ${f.titel}`}
              rechts={<button type="button" onClick={() => wisselDienst(d)} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-red-600" title="Dienst weghalen"><X className="h-4 w-4" /></button>}>
              <div className="grid sm:grid-cols-2 gap-3">
                {f.velden.map((v) => <VeldInvoer key={v.key} v={v} w={inhoud.fiches[d] ?? {}} zet={zetFiche(d)} id={d} />)}
              </div>
            </Kaart>
          )
        })}

        <Kaart titel="3. Prijs en kosten" sub="Alles excl. btw. Advertentiebudget dat de klant zelf betaalt, telt niet mee in het totaal.">
          <div className="grid sm:grid-cols-2 gap-3">
            {PRIJS.map((v) => <VeldInvoer key={v.key} v={v} w={inhoud.prijs} zet={zetSectie('prijs')} id="prijs" />)}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-600">Andere posten</p>
            {inhoud.extra.map((e, idx) => (
              <div key={idx} className="flex gap-2">
                <input className={INP} placeholder="Omschrijving, bv. extra fotoshoot" value={e.omschrijving} onChange={(x) => setInhoud((i) => ({ ...i, extra: i.extra.map((y, j) => (j === idx ? { ...y, omschrijving: x.target.value } : y)) }))} />
                <div className="relative w-36 shrink-0">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">€</span>
                  <input className={`${INP} pl-7 ${e.bedrag && !isGeldigBedrag(e.bedrag) ? '!border-red-400' : ''}`} inputMode="decimal" placeholder="0" value={e.bedrag} onChange={(x) => setInhoud((i) => ({ ...i, extra: i.extra.map((y, j) => (j === idx ? { ...y, bedrag: x.target.value } : y)) }))} />
                </div>
                <button type="button" onClick={() => setInhoud((i) => ({ ...i, extra: i.extra.filter((_, j) => j !== idx) }))} className="h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-red-600" aria-label="Post weghalen"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setInhoud((i) => ({ ...i, extra: [...i.extra, { omschrijving: '', bedrag: '' }] }))} className="btn-secondary text-xs"><Plus className="h-3.5 w-3.5" />Post toevoegen</button>
          </div>
        </Kaart>
      </div>

      {/* Samenvatting: altijd in beeld */}
      <aside className="lg:sticky lg:top-4 space-y-3">
        <div className="card-base space-y-3">
          <div>
            <p className="text-xs text-gray-500">{String(inhoud.algemeen.offertenummer ?? '') || 'Nieuw nummer'}{klant ? ` · ${klant.company_name}` : ''}</p>
            <p className="font-semibold text-gray-900 leading-snug">{String(inhoud.algemeen.projectnaam ?? '') || 'Nog geen projectnaam'}</p>
          </div>
          <div className="rounded-xl p-3" style={{ background: MERK_STIJL[merk].accent, color: MERK_STIJL[merk].opAccent }}>
            <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">Totaal excl. btw</p>
            <p className="text-2xl font-semibold tabular-nums">{euro(prijs.excl)}</p>
            <p className="text-xs opacity-80">{euro(prijs.incl)} incl. {String(prijs.btwPct).replace('.', ',')}% btw{prijs.maandelijks ? ` · ${euro(prijs.maandelijks)} per maand` : ''}</p>
          </div>
          {prijs.lijnen.length > 0 && (
            <ul className="text-xs text-gray-600 space-y-1">
              {prijs.lijnen.map((l, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{l.omschrijving}{l.detail ? <span className="text-gray-400"> · {l.detail}</span> : null}</span><span className="tabular-nums shrink-0">{euro(l.bedrag)}</span></li>)}
              {prijs.budgetApart > 0 && <li className="flex justify-between gap-2 text-gray-400"><span>Advertentiebudget (apart)</span><span className="tabular-nums">{euro(prijs.budgetApart)}</span></li>}
            </ul>
          )}
          {toonFouten && fouten.length > 0 && (
            <ul className="rounded-lg bg-red-50 border border-red-200 p-2 text-[11px] text-red-800 space-y-0.5">{fouten.map((f, i) => <li key={i}>{f.fout}</li>)}</ul>
          )}
          <div className="grid gap-2">
            <button type="button" onClick={voorbeeld} disabled={!!bezig} className="btn-secondary justify-center">{bezig === 'voorbeeld' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}Voorbeeld pdf</button>
            <button type="button" onClick={() => bewaar(false)} disabled={!!bezig} className="btn-secondary justify-center">{bezig === 'bewaar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{verstuurd ? 'Bewaren als kopie' : 'Bewaren als concept'}</button>
            <button type="button" onClick={() => bewaar(true)} disabled={!!bezig} className="btn-primary justify-center">{bezig === 'verstuur' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Bewaren en mail opstellen</button>
          </div>
          <p className="text-[11px] text-gray-500">Je ziet de mail eerst. De klant krijgt een knop naar de offerte, kan ze daar lezen, aanvaarden en tekenen, en vindt ze ook in de klantapp.</p>
        </div>
      </aside>

      {mail && (
        <MailDialog
          context={{ type: 'offerte', offerteId: mail.id, titel: mail.titel, link: mail.link, klant: mail.klant_naam, contact: mail.ontvanger_naam, email: mail.ontvanger_email, geldigTot: mail.geldig_tot, merk: mail.merk }}
          onClose={() => { toast.message('Niet verstuurd. De offerte staat als concept in Offertes.'); router.push(`/admin/offertes?offerte=${mail.id}`) }}
          onSent={() => { toast.success('Offerte verstuurd. Je ziet in Offertes wanneer de klant ze opent.'); router.push(`/admin/offertes?offerte=${mail.id}`) }}
        />
      )}
    </div>
  )
}
