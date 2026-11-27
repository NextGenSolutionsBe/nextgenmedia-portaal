'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, ArchiveRestore, ChevronLeft, Clock, Download, FileText, Loader2, MapPin, PenLine, Save, Trash2 } from 'lucide-react'
import { MailDialog } from '@/components/admin/mail-composer'
import { PdfVakken } from '@/components/esign/pdf-vakken'
import { PERSONEN, STATUS_INFO, boom, handtekeningenOns, namenLijst, padNaam, redenOnsNiet, statusLabel, statusVan, tekenaarsOns, wieMoetNog, type AlgemeenContract, type Map } from '@/lib/algemene-contracten/model'
import { LabelsVeld } from '../overzicht'
import { PersoonKnop } from '@/components/admin/persoon-foto'

const moment = (iso: string) => new Date(iso).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const ACTIE: Record<string, string> = {
  opgeladen: 'Opgeladen', ons_getekend: 'Ondertekend namens NextGen Agency BV', partij_getekend: 'Ondertekend door de andere partij',
  verstuurd: 'Verstuurd', geopend: 'Geopend door de andere partij', aangepast: 'Gegevens aangepast', gearchiveerd: 'Gearchiveerd', teruggezet: 'Uit het archief gehaald',
}

type Tijd = { actie: string; door: string | null; details: Record<string, unknown> | null; created_at: string }

export function AcDetail({ contract: c, heeftGetekendeVersie, mappen, tijdlijn, labelVoorstellen, versturenOpen, ik }: {
  contract: AlgemeenContract
  heeftGetekendeVersie: boolean
  mappen: Map[]
  tijdlijn: Tijd[]
  labelVoorstellen: string[]
  versturenOpen: boolean
  /** Wie kijkt (Marco, Bram, Chiara): of jij nog moet tekenen. */
  ik: string | null
}) {
  const router = useRouter()
  const [mail, setMail] = useState(versturenOpen && !c.gearchiveerd_op)
  const [bezig, setBezig] = useState<string | null>(null)
  const s = statusVan(c)
  const partij = c.tegenpartij || 'de andere partij'
  const pdf = `/api/admin/algemene-contracten/${c.id}/pdf`
  // Jij moet tekenen: aangeduid en nog niet getekend (of niemand aangeduid, van vroeger, en nog niemand tekende).
  const ikMoet = !!ik && !redenOnsNiet(c, ik) && (wieMoetNog(c).includes(ik) || (s === 'wacht_op_ons' && !tekenaarsOns(c).length))

  const patch = async (b: Record<string, unknown>, wat: string, melding: string) => {
    setBezig(wat)
    try {
      const r = await fetch(`/api/admin/algemene-contracten/${c.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      toast.success(melding); router.refresh(); return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); return false } finally { setBezig(null) }
  }
  const verwijder = async () => {
    if (!confirm(`“${c.titel}” verwijderen? Het bestand gaat ook uit de opslag. Dit kan niet ongedaan gemaakt worden.`)) return
    setBezig('verwijder')
    try {
      const r = await fetch(`/api/admin/algemene-contracten/${c.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Verwijderen mislukt')
      toast.success('Verwijderd.'); router.push('/admin/algemene-contracten'); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt'); setBezig(null) }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start gap-3 flex-wrap">
        <Link href={`/admin/algemene-contracten${c.map_id ? `?map=${c.map_id}` : ''}`} className="btn-secondary px-2 shrink-0" title={c.map_id ? `Terug naar ${padNaam(mappen, c.map_id) ?? 'de map'}` : 'Alle algemene contracten'}><ChevronLeft className="h-4 w-4" /></Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold break-words">{c.titel}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className={`status-badge border text-[11px] ${STATUS_INFO[s].cls}`}>{statusLabel(c)}</span>
            {c.tegenpartij && <span>{c.tegenpartij}</span>}
            {padNaam(mappen, c.map_id) && <span className="text-xs">· {padNaam(mappen, c.map_id)}</span>}
            {c.gearchiveerd_op && <span className="text-[11px] rounded-full bg-gray-100 px-2 py-0.5">Gearchiveerd</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {ikMoet && <Link href={`/admin/algemene-contracten/${c.id}/tekenen`} className="btn-primary text-sm"><PenLine className="h-4 w-4" />Tekenen</Link>}
          {c.partij_nodig && !c.partij_getekend_op && !c.gearchiveerd_op && !ikMoet && <Link href={`/admin/algemene-contracten/${c.id}/tekenen`} className="btn-secondary text-sm"><MapPin className="h-4 w-4" />Plaats voor {partij}</Link>}
          {!c.gearchiveerd_op && <button type="button" onClick={() => setMail(true)} className={s === 'wacht_op_ons' || ikMoet ? 'btn-secondary text-sm' : 'btn-primary text-sm'}>Versturen</button>}
          <a href={`${pdf}?download=1`} className="btn-secondary text-sm"><Download className="h-4 w-4" />{heeftGetekendeVersie ? 'Getekende PDF' : 'PDF'}</a>
          <button type="button" disabled={!!bezig} onClick={() => patch({ archief: !c.gearchiveerd_op }, 'archief', c.gearchiveerd_op ? 'Uit het archief gehaald.' : 'Gearchiveerd. Je vindt het terug onder Archief.')} className="btn-secondary text-sm" title={c.gearchiveerd_op ? 'Uit het archief halen' : 'Archiveren'}>
            {bezig === 'archief' ? <Loader2 className="h-4 w-4 animate-spin" /> : c.gearchiveerd_op ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}{c.gearchiveerd_op ? 'Terugzetten' : 'Archiveren'}
          </button>
        </div>
      </div>

      {c.gearchiveerd_op && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <b className="font-semibold">Gearchiveerd.</b> Dit contract staat niet meer in de mappen, enkel onder Archief. Tekenen en versturen kan pas weer na terugzetten.
        </div>
      )}

      {s === 'wacht_op_partij' && !c.gearchiveerd_op && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <b className="font-semibold">Wacht op {partij}.</b>{' '}
          {c.laatst_verstuurd_op ? `Verstuurd op ${moment(c.laatst_verstuurd_op)}` : 'Nog niet verstuurd: klik op Versturen, dan krijgt die een persoonlijke link om te tekenen'}{c.partij_geopend_op ? `, geopend op ${moment(c.partij_geopend_op)}` : c.laatst_verstuurd_op ? ', nog niet geopend' : ''}.
        </div>
      )}

      <div className="grid lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        {/* Zelfde weergave als bij het tekenen (pdf.js): werkt ook op iPhone, met de handtekeningen erop. */}
        <PdfVakken key={`${c.id}-${c.versie}`} pdfUrl={pdf} vakken={[]} />

        <div className="space-y-4">
          <Handtekeningen c={c} ik={ik} />
          <Gegevens c={c} mappen={mappen} labelVoorstellen={labelVoorstellen} bezig={bezig === 'gegevens'} onBewaar={(b) => patch(b, 'gegevens', 'Bewaard.')} />

          <div className="card-base space-y-2">
            <h2 className="text-sm font-semibold">Bestanden</h2>
            <a href={`${pdf}?download=1`} className="flex items-center gap-2 text-sm text-gray-700 hover:text-black"><Download className="h-4 w-4" />{heeftGetekendeVersie ? 'Getekende versie downloaden' : 'PDF downloaden'}</a>
            {heeftGetekendeVersie && <a href={`${pdf}?origineel=1&download=1`} className="flex items-center gap-2 text-sm text-gray-700 hover:text-black"><FileText className="h-4 w-4" />Origineel (zonder handtekeningen)</a>}
            <div className="flex flex-wrap gap-3 pt-1 text-xs">
              {!handtekeningenOns(c).length && !c.partij_getekend_op && (
                <button type="button" disabled={!!bezig} onClick={verwijder} className="inline-flex items-center gap-1 text-gray-500 hover:text-red-600">{bezig === 'verwijder' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Verwijderen</button>
              )}
            </div>
          </div>

          {tijdlijn.length > 0 && (
            <div className="card-base">
              <h2 className="text-sm font-semibold mb-2">Tijdlijn</h2>
              <ul className="space-y-2">
                {tijdlijn.map((t, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <Clock className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-gray-800">{t.actie === 'ons_getekend' && !t.details?.persoon && typeof t.details?.naam === 'string' ? 'Ondertekend' : ACTIE[t.actie] ?? t.actie}{t.actie === 'verstuurd' && typeof t.details?.aan === 'string' ? ` naar ${t.details.aan}` : ''}{(t.actie === 'ons_getekend' || t.actie === 'partij_getekend') && typeof t.details?.naam === 'string' ? ` · ${t.details.naam}` : ''}</div>
                      <div className="text-gray-500">{moment(t.created_at)}{t.door && t.actie !== 'ons_getekend' && t.actie !== 'partij_getekend' ? ` · ${t.door}` : ''}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {mail && (
        <MailDialog
          context={{ type: 'algemeen_contract', contractId: c.id, titel: c.titel, email: c.tegenpartij_email, tegenpartij: c.tegenpartij, partijNodig: c.partij_nodig, partijGetekend: !!c.partij_getekend_op, onsGetekend: !!c.ons_getekend_op }}
          onClose={() => setMail(false)}
          onSent={() => router.refresh()}
        />
      )}
    </div>
  )
}

function Handtekeningen({ c, ik }: { c: AlgemeenContract; ik: string | null }) {
  const partij = c.tegenpartij || 'De andere partij'
  const rij = (key: string, wie: string, nodig: boolean, op: string | null, door: string | null, open: string, actie?: React.ReactNode) => (
    <li key={key} className="flex items-start gap-2 text-sm">
      <span className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${!nodig ? 'bg-gray-300' : op ? 'bg-green-500' : 'bg-amber-400'}`} />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-gray-900">{wie}</div>
        <div className="text-xs text-gray-500">{!nodig ? 'Hoeft niet te tekenen' : op ? `${door ?? 'Getekend'} · ${moment(op)}` : open}</div>
      </div>
      {actie}
    </li>
  )
  const h = handtekeningenOns(c)
  const lijst = tekenaarsOns(c)
  const tekenKnop = (label: string) => <Link href={`/admin/algemene-contracten/${c.id}/tekenen`} className="btn-secondary !py-1 !px-2.5 text-xs shrink-0"><PenLine className="h-3.5 w-3.5" />{label}</Link>
  const kanIk = !!ik && !redenOnsNiet(c, ik)
  // Elke persoon van ons apart: wie aangeduid is, en wie (ook zonder aanduiding) al tekende.
  const personen = Array.from(new Set([...lijst, ...h.map((x) => x.persoon)]))
  return (
    <div className="card-base">
      <h2 className="text-sm font-semibold mb-2">Handtekeningen</h2>
      <ul className="space-y-2.5">
        {c.ons_nodig && personen.map((p) => {
          const x = h.find((y) => y.persoon.toLowerCase() === p.toLowerCase())
          const ikBen = !!ik && ik.toLowerCase() === p.toLowerCase()
          return rij(`ons-${p}`, `${p} · NextGen Agency BV`, true, x?.op ?? null, x?.naam ?? null, ikBen ? 'Jij moet nog tekenen' : 'Nog te tekenen', !x && ikBen && kanIk && !c.gearchiveerd_op ? tekenKnop('Tekenen') : undefined)
        })}
        {c.ons_nodig && !personen.length && rij('ons', 'NextGen Agency BV', true, null, null, 'Nog te tekenen door één van ons', kanIk && !c.gearchiveerd_op ? tekenKnop('Tekenen') : undefined)}
        {!c.ons_nodig && rij('ons', 'NextGen Agency BV', false, null, null, '')}
        {rij('partij', partij, c.partij_nodig, c.partij_getekend_op, c.partij_naam, c.partij_geopend_op ? `Geopend op ${moment(c.partij_geopend_op)}, nog niet getekend` : c.laatst_verstuurd_op ? 'Verstuurd, nog niet geopend' : 'Nog niet verstuurd')}
      </ul>
      {c.ons_nodig && kanIk && personen.length > 0 && !personen.some((p) => p.toLowerCase() === ik!.toLowerCase()) && !c.gearchiveerd_op && (
        <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>Moet jij ook tekenen?</span>{tekenKnop('Ook tekenen')}
        </div>
      )}
      {c.ons_nodig && wieMoetNog(c).length > 0 && personen.length > 1 && <p className="mt-2 text-[11px] text-gray-500">Getekend als {namenLijst(lijst)} allemaal tekenden.</p>}
    </div>
  )
}

function Gegevens({ c, mappen, labelVoorstellen, bezig, onBewaar }: {
  c: AlgemeenContract; mappen: Map[]; labelVoorstellen: string[]; bezig: boolean; onBewaar: (b: Record<string, unknown>) => Promise<boolean>
}) {
  const begin = () => ({
    titel: c.titel, map_id: c.map_id ?? '', tegenpartij: c.tegenpartij ?? '', tegenpartij_email: c.tegenpartij_email ?? '', labels: c.labels,
    begin_datum: c.begin_datum ?? '', eind_datum: c.eind_datum ?? '', notitie: c.notitie ?? '', ons_nodig: c.ons_nodig, ons_tekenaars: tekenaarsOns(c), partij_nodig: c.partij_nodig,
  })
  const getekend = handtekeningenOns(c).map((x) => x.persoon)
  const [v, setV] = useState(begin)
  const gewijzigd = JSON.stringify(v) !== JSON.stringify(begin())
  const LBL = 'block text-xs font-medium text-gray-600 mb-1'
  return (
    <div className="card-base space-y-3">
      <h2 className="text-sm font-semibold">Gegevens</h2>
      <div><label className={LBL}>Titel</label><input className="input-base" value={v.titel} maxLength={200} onChange={(e) => setV({ ...v, titel: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={LBL}>Map</label>
          <select className="input-base" value={v.map_id} onChange={(e) => setV({ ...v, map_id: e.target.value })}>
            <option value="">Zonder map</option>
            {boom(mappen).map(({ map: m, pad }) => <option key={m.id} value={m.id}>{pad}</option>)}
          </select>
        </div>
        <div><label className={LBL}>Andere partij</label><input className="input-base" value={v.tegenpartij} maxLength={200} onChange={(e) => setV({ ...v, tegenpartij: e.target.value })} /></div>
      </div>
      <div><label className={LBL}>E-mail andere partij</label><input type="email" className="input-base" value={v.tegenpartij_email} maxLength={200} onChange={(e) => setV({ ...v, tegenpartij_email: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label className={LBL}>Begin</label><input type="date" className="input-base" value={v.begin_datum} onChange={(e) => setV({ ...v, begin_datum: e.target.value })} /></div>
        <div><label className={LBL}>Loopt tot</label><input type="date" className="input-base" value={v.eind_datum} onChange={(e) => setV({ ...v, eind_datum: e.target.value })} /></div>
      </div>
      <div><label className={LBL}>Labels</label><LabelsVeld waarde={v.labels} onChange={(l) => setV({ ...v, labels: l })} voorstellen={labelVoorstellen} /></div>
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" disabled={getekend.length > 0} checked={v.ons_nodig} onChange={(e) => setV({ ...v, ons_nodig: e.target.checked })} className="h-4 w-4 accent-gray-900" />Wij tekenen
        </label>
        {v.ons_nodig && (
          <div className="ml-6">
            <p className="text-xs text-gray-500 mb-1">Wie tekent? Iedereen die je aanduidt, tekent.</p>
            <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Wie tekent namens ons">
              {PERSONEN.map((o) => {
                const al = getekend.some((g) => g.toLowerCase() === o.toLowerCase())
                const aan = al || v.ons_tekenaars.includes(o)
                return <PersoonKnop key={o} naam={o} label={al ? `${o} ✓` : o} klein rol="checkbox" aan={aan} onClick={() => { if (!al) setV({ ...v, ons_tekenaars: aan ? v.ons_tekenaars.filter((x) => x !== o) : [...v.ons_tekenaars, o] }) }} />
              })}
            </div>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" disabled={!!c.partij_getekend_op} checked={v.partij_nodig} onChange={(e) => setV({ ...v, partij_nodig: e.target.checked })} className="h-4 w-4 accent-gray-900" />De andere partij tekent ook
        </label>
      </div>
      <div><label className={LBL}>Notitie</label><textarea className="input-base min-h-[70px]" value={v.notitie} maxLength={4000} onChange={(e) => setV({ ...v, notitie: e.target.value })} /></div>
      {gewijzigd && (
        <div className="flex gap-2">
          <button type="button" disabled={bezig || (v.ons_nodig && !v.ons_tekenaars.length && !getekend.length)} title={v.ons_nodig && !v.ons_tekenaars.length && !getekend.length ? 'Duid aan wie van ons tekent' : undefined} onClick={async () => { await onBewaar({ ...v, map_id: v.map_id || null, begin_datum: v.begin_datum || null, eind_datum: v.eind_datum || null, ons_tekenaars: v.ons_nodig ? Array.from(new Set([...v.ons_tekenaars, ...getekend.filter((g) => (PERSONEN as readonly string[]).includes(g))])) : [] }) }} className="btn-primary text-sm">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Bewaren</button>
          <button type="button" onClick={() => setV(begin())} className="btn-secondary text-sm">Annuleren</button>
        </div>
      )}
    </div>
  )
}
