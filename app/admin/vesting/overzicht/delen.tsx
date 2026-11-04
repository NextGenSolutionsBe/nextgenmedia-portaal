'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Download, Loader2, Mail, PenLine, RotateCcw, X } from 'lucide-react'
import { HandtekeningVak } from '@/components/admin/handtekening-vak'
import { VENNOTEN, type Vennoot } from '@/lib/vesting-akkoord'
import type { AkkoordWeergave, CertificaatKort, ContractWeergave } from '@/lib/vesting-weergave'

export const eur = (n: number | null | undefined, cent = false) =>
  n === null || n === undefined ? '—' : new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: cent ? 2 : 0, maximumFractionDigits: cent ? 2 : 0 }).format(n)
export const pct = (f: number, cijfers = 0) => `${(f * 100).toLocaleString('nl-BE', { minimumFractionDigits: cijfers, maximumFractionDigits: cijfers })}%`
export const datumKort = (d: string | null | undefined) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
export const tijdstip = (d: string) => new Date(d).toLocaleString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })

export async function api(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>
  if (!r.ok) throw new Error(String(j.error ?? 'Er ging iets mis.'))
  return j
}

/** Drie bolletjes: wie tekende voor de huidige cijfers. */
export function TekenStand({ akkoord, vennoten }: { akkoord: AkkoordWeergave; vennoten: Record<Vennoot, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {VENNOTEN.map((v) => {
        const s = akkoord.stand.per[v].stand
        const voornaam = vennoten[v].split(' ')[0]
        return (
          <span key={v} title={s === 'getekend' ? `${voornaam} tekende` : s === 'opnieuw' ? `${voornaam} tekende voor vorige cijfers` : `${voornaam} moet nog tekenen`}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
              s === 'getekend' ? 'border-green-200 bg-green-50 text-green-800' : s === 'opnieuw' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200 text-gray-500'}`}>
            {s === 'getekend' ? <Check className="h-3 w-3" /> : s === 'opnieuw' ? <RotateCcw className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />}
            {voornaam}
          </span>
        )
      })}
    </div>
  )
}

type OpgeslagenHandtekening = { id: string; vennoot: Vennoot; naam: string | null; email: string | null; getekend_op: string; inhoud_tekst: string; handtekening: string; beschrijving: string }

/**
 * Het akkoord onderaan een contract of kost: wie tekende (met de handtekening
 * zelf), wat er veranderde sinds de vorige keer, en voor een vennoot die nog
 * niet tekende het tekenvak.
 */
export function Akkoord({ onderwerp, id, akkoord, certificaat, vennoten, ik, laatste, onLaatste, onGetekend, uitleg }: {
  onderwerp: 'contract' | 'kost' | 'inkomst'
  id: string
  akkoord: AkkoordWeergave
  certificaat?: CertificaatKort | null
  vennoten: Record<Vennoot, string>
  ik: Vennoot | null
  laatste: string | null
  onLaatste: (png: string) => void
  onGetekend: () => void
  uitleg: string
}) {
  const [lijst, setLijst] = useState<OpgeslagenHandtekening[] | null>(null)
  const [png, setPng] = useState<string | null>(null)
  const [akkoordVinkje, setAkkoordVinkje] = useState(false)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    let weg = false
    setLijst(null)
    api(`/api/admin/vesting/akkoord?onderwerp=${onderwerp}&id=${id}`)
      .then((j) => { if (!weg) setLijst((j.handtekeningen as OpgeslagenHandtekening[]) ?? []) })
      .catch(() => { if (!weg) setLijst([]) })
    return () => { weg = true }
  }, [onderwerp, id, akkoord.tekst])

  const mijnStand = ik ? akkoord.stand.per[ik].stand : null

  const teken = async () => {
    if (!png || !akkoordVinkje) return
    setBezig(true)
    try {
      const j = await api('/api/admin/vesting/akkoord', { method: 'POST', body: JSON.stringify({ onderwerp, onderwerp_id: id, inhoud_tekst: akkoord.tekst, handtekening: png }) })
      onLaatste(png)
      const cert = j.certificaat as { nummer: string; mail_status: string } | null | undefined
      if (cert) toast.success(cert.mail_status === 'verstuurd' ? `Alle drie getekend. Certificaat ${cert.nummer} is gemaild naar legal@.` : `Alle drie getekend. Certificaat ${cert.nummer} is klaar, maar de mail naar legal@ lukte niet.`)
      else toast.success('Getekend.')
      setAkkoordVinkje(false)
      onGetekend()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Tekenen mislukt')
      onGetekend()
    } finally { setBezig(false) }
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-900">Akkoord</h3>
        <span className="text-xs text-gray-500">{akkoord.stand.getekend} van 3 getekend</span>
      </div>

      {akkoord.wijzigingen.length > 0 && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <div className="font-medium mb-0.5">Gewijzigd sinds de vorige handtekening</div>
          <ul className="list-disc pl-4 space-y-0.5">{akkoord.wijzigingen.map((w) => <li key={w}>{w}</li>)}</ul>
          <div className="mt-1 text-amber-800">Wie al tekende, tekent opnieuw voor de nieuwe cijfers.</div>
        </div>
      )}

      <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
        {VENNOTEN.map((v) => {
          const s = akkoord.stand.per[v]
          const geldige = lijst?.find((h) => h.vennoot === v && h.inhoud_tekst === akkoord.tekst)
          return (
            <li key={v} className="flex items-center gap-3 px-3 py-2.5 min-h-[56px]">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-900">{vennoten[v]}{ik === v && <span className="ml-1 text-xs font-normal text-gray-500">(jij)</span>}</div>
                <div className={`text-xs ${s.stand === 'getekend' ? 'text-green-700' : s.stand === 'opnieuw' ? 'text-amber-700' : 'text-gray-500'}`}>
                  {s.stand === 'getekend' && s.op ? `Getekend op ${tijdstip(s.op)}` : s.stand === 'opnieuw' && s.op ? `Tekende op ${tijdstip(s.op)} voor de vorige cijfers` : 'Nog niet getekend'}
                </div>
              </div>
              {geldige?.handtekening
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={geldige.handtekening} alt={`Handtekening ${vennoten[v]}`} className="h-10 w-28 object-contain shrink-0" />
                : lijst === null && s.stand === 'getekend' ? <Loader2 className="h-4 w-4 animate-spin text-gray-300 shrink-0" /> : null}
            </li>
          )
        })}
      </ul>

      <CertificaatBlok onderwerp={onderwerp} id={id} certificaat={certificaat ?? null} volledig={akkoord.stand.volledig} heeftOoit={!!akkoord.stand.laatsteVolledig} onVernieuw={onGetekend} />

      <Geschiedenis lijst={lijst} huidig={akkoord.tekst} vennoten={vennoten} />

      {ik && mijnStand !== 'getekend' && (
        <div className="mt-4 rounded-lg border border-gray-900 p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold"><PenLine className="h-4 w-4" />Teken als {vennoten[ik]}</div>
          <p className="text-xs text-gray-600">{uitleg}</p>
          <HandtekeningVak key={`${id}-${akkoord.tekst.length}`} beginWaarde={laatste} onChange={setPng} />
          {laatste && <p className="text-[11px] text-gray-500 -mt-1">Je handtekening van daarnet staat er al in. Wis ze met "Opnieuw" als je opnieuw wil tekenen.</p>}
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={akkoordVinkje} onChange={(e) => setAkkoordVinkje(e.target.checked)} className="mt-0.5 h-4 w-4 accent-gray-900 shrink-0" />
            <span>Ik ga akkoord met deze cijfers.</span>
          </label>
          <button type="button" onClick={teken} disabled={!png || !akkoordVinkje || bezig} className="btn-primary w-full sm:w-auto">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}Tekenen
          </button>
        </div>
      )}
      {!ik && <p className="mt-3 text-xs text-gray-500">Enkel Marco, Bram en Chiara tekenen, elk met hun eigen account.</p>}
    </section>
  )
}

/**
 * Het certificaat van de laatste versie die alle drie tekenden: downloaden, en
 * of de archiefmail naar legal@ vertrokken is (anders opnieuw versturen).
 */
function CertificaatBlok({ onderwerp, id, certificaat, volledig, heeftOoit, onVernieuw }: {
  onderwerp: 'contract' | 'kost' | 'inkomst'; id: string; certificaat: CertificaatKort | null; volledig: boolean; heeftOoit: boolean; onVernieuw: () => void
}) {
  const [bezig, setBezig] = useState(false)
  if (!heeftOoit) return null
  const maak = async () => {
    setBezig(true)
    try { await api('/api/admin/vesting/certificaat', { method: 'POST', body: JSON.stringify({ onderwerp, id }) }); onVernieuw() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Certificaat maken mislukt') } finally { setBezig(false) }
  }
  const mail = async () => {
    if (!certificaat) return
    setBezig(true)
    try { await api('/api/admin/vesting/certificaat', { method: 'POST', body: JSON.stringify({ certificaat_id: certificaat.id, actie: 'mail' }) }); toast.success('Gemaild naar legal@.'); onVernieuw() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mailen mislukt'); onVernieuw() } finally { setBezig(false) }
  }
  if (!certificaat) {
    return (
      <div className="mt-3 rounded-lg border border-gray-200 p-3 text-sm flex items-center justify-between gap-2 flex-wrap">
        <span className="text-gray-600">Alle drie tekenden, maar het certificaat is er nog niet.</span>
        <button type="button" onClick={maak} disabled={bezig} className="btn-secondary text-xs h-8">{bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Certificaat maken</button>
      </div>
    )
  }
  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-white p-3 text-sm space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium text-gray-900">Certificaat {certificaat.nummer}</div>
          <div className="text-xs text-gray-500">{certificaat.huidig ? 'Voor de huidige cijfers' : 'Voor de vorige versie die alle drie tekenden'} · {tijdstip(certificaat.volledig_op)}</div>
        </div>
        <a href={`/api/admin/vesting/certificaat?id=${certificaat.id}`} className="btn-secondary text-xs h-8"><Download className="h-3.5 w-3.5" />Downloaden</a>
      </div>
      <div className={`text-xs flex items-center gap-1.5 ${certificaat.mail_status === 'verstuurd' ? 'text-green-700' : certificaat.mail_status === 'mislukt' ? 'text-red-700' : 'text-gray-500'}`}>
        <Mail className="h-3.5 w-3.5" />
        {certificaat.mail_status === 'verstuurd' && certificaat.mail_op ? `Gemaild naar legal@ op ${tijdstip(certificaat.mail_op)}` : certificaat.mail_status === 'mislukt' ? `Mail naar legal@ mislukt${certificaat.mail_fout ? `: ${certificaat.mail_fout}` : ''}` : 'Mail naar legal@ nog niet verstuurd'}
        {certificaat.mail_status !== 'verstuurd' && <button type="button" onClick={mail} disabled={bezig} className="ml-1 underline">{bezig ? 'Bezig…' : 'Opnieuw versturen'}</button>}
      </div>
      {!volledig && <p className="text-xs text-amber-700">De cijfers zijn sindsdien gewijzigd. Zodra alle drie opnieuw tekenen, komt er een nieuw certificaat.</p>}
    </div>
  )
}

/**
 * Vorige versies van deze kaart, elk met waarvoor getekend werd en door wie
 * (met de handtekening zelf). Getekend is getekend: niets verdwijnt hier.
 */
function Geschiedenis({ lijst, huidig, vennoten }: { lijst: OpgeslagenHandtekening[] | null; huidig: string; vennoten: Record<Vennoot, string> }) {
  const [open, setOpen] = useState(false)
  if (!lijst) return null
  const versies = new Map<string, OpgeslagenHandtekening[]>()
  for (const h of lijst) if (h.inhoud_tekst !== huidig) versies.set(h.inhoud_tekst, [...(versies.get(h.inhoud_tekst) ?? []), h])
  if (!versies.size) return null
  const rijen = Array.from(versies.values()).sort((a, b) => b[0].getekend_op.localeCompare(a[0].getekend_op))
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((x) => !x)} className="text-xs text-gray-500 hover:text-black underline-offset-2 hover:underline">
        {open ? 'Verberg' : 'Toon'} eerdere versies ({rijen.length})
      </button>
      {open && (
        <ol className="mt-2 space-y-2">
          {rijen.map((h) => (
            <li key={h[0].inhoud_tekst} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
              <div className="text-xs text-gray-700">{h[0].beschrijving}</div>
              <ul className="mt-2 space-y-1">
                {h.map((x) => (
                  <li key={x.id} className="flex items-center justify-between gap-2 text-[11px] text-gray-600">
                    <span>{vennoten[x.vennoot]} · {tijdstip(x.getekend_op)}</span>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={x.handtekening} alt={`Handtekening ${vennoten[x.vennoot]}`} className="h-7 w-20 object-contain" />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** Een paneel dat op gsm van onder schuift en op groot scherm rechts staat. */
export function Paneel({ titel, sub, onClose, children, voet }: { titel: React.ReactNode; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; voet?: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-stretch sm:justify-end bg-black/30" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-xl sm:h-full max-h-[94dvh] sm:max-h-none rounded-t-2xl sm:rounded-none shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-900 truncate">{titel}</h2>
            {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
          </div>
          <button type="button" onClick={onClose} className="h-8 w-8 shrink-0 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">{children}</div>
        {voet && <div className="px-5 py-3 border-t border-gray-100">{voet}</div>}
      </div>
    </div>
  )
}

/** Afspraak gezet / geclosed: twee knoppen van elk 50%. */
export function RolKnop({ aan, label, onClick, bezig }: { aan: boolean; label: string; onClick: () => void; bezig?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={bezig} aria-pressed={aan}
      className={`flex-1 min-w-[140px] rounded-lg border px-3 py-2.5 text-left transition-colors ${aan ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{label}</span>
        <span className={`h-4 w-4 rounded border flex items-center justify-center ${aan ? 'border-white bg-white text-gray-900' : 'border-gray-300'}`}>{aan && <Check className="h-3 w-3" />}</span>
      </div>
      <div className={`text-xs mt-0.5 ${aan ? 'text-gray-300' : 'text-gray-500'}`}>{aan ? 'Ja, 50%' : 'Nee'}</div>
    </button>
  )
}

/** De rekensom van één contract, regel per regel. */
export function Rekensom({ regels }: { regels: { label: string; waarde: string; sterk?: boolean; zacht?: boolean }[] }) {
  return (
    <dl className="rounded-lg bg-gray-50 border border-gray-200 divide-y divide-gray-200/70 text-sm tabular-nums">
      {regels.map((r) => (
        <div key={r.label} className={`flex items-center justify-between gap-3 px-3 py-2 ${r.sterk ? 'font-semibold text-gray-900' : r.zacht ? 'text-gray-500' : 'text-gray-700'}`}>
          <dt>{r.label}</dt><dd>{r.waarde}</dd>
        </div>
      ))}
    </dl>
  )
}

/** "€1.500 ÷ €5.000 per procent = 0,30%" — hoe het percentage van één contract tot stand komt. */
export function procentUitleg(c: Pick<ContractWeergave, 'teltVoorAandeel' | 'ruweVesting' | 'schijven' | 'algemeneKostenAftrek'>): string {
  const { goedkoop, jaar, regulierTarief, jaarTarief } = c.schijven
  const delen: string[] = []
  if (goedkoop > 0.005) delen.push(`${eur(goedkoop)} ÷ ${eur(regulierTarief)} per procent`)
  if (jaar > 0.005 && jaarTarief) delen.push(`${eur(jaar)} ÷ ${eur(jaarTarief)} per procent`)
  if (!delen.length) return 'Dit contract levert geen aandeel op.'
  const voor = c.algemeneKostenAftrek > 0 ? `Na ${eur(c.algemeneKostenAftrek)} algemene kosten telt ${eur(c.teltVoorAandeel)}. ` : ''
  const tarief = goedkoop > 0.005 && jaar > 0.005 ? ' (deels aan het tarief tot 10%, deels aan het jaartarief)' : jaar > 0.005 ? ' (jaartarief: de eerste 10% zijn al bereikt)' : ' (tarief tot 10% in totaal)'
  return `${voor}${delen.join(' + ')} = ${pct(c.ruweVesting, 2)}${tarief}.`
}
