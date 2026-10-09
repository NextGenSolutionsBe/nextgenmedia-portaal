'use client'

import { KaartTabel } from '@/components/ui/kaart-tabel'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Loader2, Mail, RefreshCw, ShieldCheck, ShieldAlert, CheckCircle2, AlertTriangle, Send } from 'lucide-react'
import { statusInfo } from '@/lib/contract-status'
import { datumNl, LEGAL_VERZENDING_STANDAARD, type Samenvatting, type VerzendRij } from '@/lib/contracten/legal-verzending'

type Item = {
  id: string; klantNaam: string | null; titel: string | null; contracttype: string | null; status: string | null
  signedAt: string | null; startDatum: string | null; eindDatum: string | null
  heeftPdf: boolean; certificaatBeschikbaar: boolean; verzending: VerzendRij | null
}
type Antwoord = { ontvanger: string; items: Item[]; samenvatting: Samenvatting }

/**
 * Eenmalige archiefverzending: elk contract apart, met pdf en (indien
 * aanwezig) ondertekeningscertificaat. De mens drukt zelf af — er draait geen
 * cron en niets vertrekt vanzelf. Wat al verstuurd is, gaat nooit opnieuw weg;
 * enkel een mislukte mail kan opnieuw geprobeerd worden.
 */
export function VerzendingClient() {
  const [data, setData] = useState<Antwoord | null>(null)
  const [ontvanger, setOntvanger] = useState(LEGAL_VERZENDING_STANDAARD)
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState<string | null>(null)
  const [vraag, setVraag] = useState(false)
  const [voortgang, setVoortgang] = useState<{ klaar: number; totaal: number } | null>(null)

  const laad = useCallback(async (adres: string) => {
    setLaden(true)
    try {
      const r = await fetch(`/api/admin/contracts/legal-verzending?ontvanger=${encodeURIComponent(adres)}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setData(j)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [])
  useEffect(() => { laad(LEGAL_VERZENDING_STANDAARD) }, [laad])

  const nogTeDoen = data ? data.samenvatting.nogTeDoen + data.samenvatting.mislukt : 0

  /** De hele lijst in kleine rondes; de server stuurt er per aanroep enkele. */
  const verstuurAlles = async () => {
    setVraag(false)
    setBezig('versturen')
    const totaal = data ? data.samenvatting.nogTeDoen : 0
    setVoortgang({ klaar: 0, totaal })
    let gedaan = 0
    try {
      for (let ronde = 0; ronde < 200; ronde++) {
        const r = await fetch('/api/admin/contracts/legal-verzending', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verstuur', ontvanger }),
        })
        const j = await r.json(); if (!r.ok) throw new Error(j.error)
        const res = (j.resultaten ?? []) as { ok: boolean; fout?: string }[]
        gedaan += res.length
        setVoortgang({ klaar: gedaan, totaal: Math.max(totaal, gedaan) })
        setData((d) => (d ? { ...d, samenvatting: j.samenvatting } : d))
        if (res.length === 0 || j.nogTeDoen === 0) break
      }
      await laad(ontvanger)
      toast.success('De verzending is afgerond. Bekijk het overzicht hieronder.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Versturen mislukt')
      await laad(ontvanger)
    } finally { setBezig(null); setVoortgang(null) }
  }

  const opnieuw = async (id: string) => {
    setBezig(id)
    try {
      const r = await fetch('/api/admin/contracts/legal-verzending', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'opnieuw', id, ontvanger }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      const res = (j.resultaten ?? [])[0]
      if (j.overgeslagen) toast.info(j.melding ?? 'Al verstuurd.')
      else if (res?.ok) toast.success('Opnieuw verstuurd.')
      else toast.error(res?.fout ?? 'Verzenden mislukt')
      await laad(ontvanger)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig(null) }
  }

  const s = data?.samenvatting

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link href="/admin/contracts" className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1"><ArrowLeft className="h-3 w-3" />Contracten</Link>
          <h1 className="text-xl font-bold mt-1">Contracten naar het archiefadres sturen</h1>
          <p className="text-sm text-gray-600 mt-1 max-w-3xl">
            Eén mail per contract, met het contract als pdf en — als die bestaat — het ondertekeningscertificaat als aparte pdf.
            Er wordt niets aan de contracten gewijzigd. Wat al met succes verstuurd is, gaat nooit een tweede keer weg; enkel een mislukte mail kun je opnieuw proberen.
            Dit is een <b>eenmalige</b> actie: er draait geen cron en er vertrekt niets vanzelf.
          </p>
        </div>
        <button onClick={() => laad(ontvanger)} disabled={!!bezig} className="btn-secondary text-sm"><RefreshCw className="h-4 w-4" />Vernieuwen</button>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-end gap-3 flex-wrap">
          <label className="text-xs text-gray-600">
            Ontvanger
            <input
              className="block w-72 px-3 py-2 text-sm border border-gray-200 rounded-lg mt-1"
              value={ontvanger}
              onChange={(e) => setOntvanger(e.target.value)}
              onBlur={() => laad(ontvanger)}
            />
          </label>
          <button
            onClick={() => setVraag(true)}
            disabled={!!bezig || laden || !s || s.nogTeDoen === 0}
            className="btn-primary text-sm"
          >
            {bezig === 'versturen' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {s && s.nogTeDoen > 0 ? `${s.nogTeDoen} contract${s.nogTeDoen === 1 ? '' : 'en'} versturen` : 'Alles is verstuurd'}
          </button>
          {voortgang && <span className="text-xs text-gray-500">{voortgang.klaar} van {voortgang.totaal} verstuurd…</span>}
        </div>

        {s && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Vak label="Contracten" waarde={String(s.totaal)} />
            <Vak label="Succesvol verstuurd" waarde={String(s.verstuurd)} kleur="text-green-700" />
            <Vak label="Mislukt" waarde={String(s.mislukt)} kleur={s.mislukt ? 'text-red-600' : undefined} />
            <Vak label="Nog te versturen" waarde={String(s.nogTeDoen)} />
          </div>
        )}

        {s && s.zonderCertificaat.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <div className="font-medium flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5" />Verstuurd zonder ondertekeningscertificaat ({s.zonderCertificaat.length})</div>
            <ul className="mt-1 space-y-0.5">{s.zonderCertificaat.map((n) => <li key={n}>· {n}</li>)}</ul>
          </div>
        )}

        {s && s.mislukteContracten.length > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-900">
            <div className="font-medium flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" />Mislukte verzendingen ({s.mislukteContracten.length})</div>
            <ul className="mt-1 space-y-1">
              {s.mislukteContracten.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 flex-wrap">
                  <span>· {m.naam}{m.fout ? ` — ${m.fout}` : ''}</span>
                  <button onClick={() => opnieuw(m.id)} disabled={!!bezig} className="btn-secondary text-[11px] py-0.5">
                    {bezig === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}Opnieuw versturen
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="table-wrap"><KaartTabel><table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50/60">
            <th className="table-th">Klant</th><th className="table-th">Contract</th><th className="table-th">Type</th><th className="table-th">Status</th>
            <th className="table-th">Getekend</th><th className="table-th">Certificaat</th><th className="table-th">Verzending</th><th className="table-th"></th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {laden && <tr><td colSpan={8} className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></td></tr>}
            {!laden && (data?.items ?? []).map((c) => {
              const v = c.verzending
              return (
                <tr key={c.id}>
                  <td className="table-td">{c.klantNaam ?? <span className="text-gray-400">Zonder klant</span>}</td>
                  <td className="table-td"><Link href={`/admin/contracts/${c.id}`} className="hover:underline">{c.titel ?? 'Contract'}</Link></td>
                  <td className="table-td text-gray-600">{c.contracttype ?? 'Niet toegewezen'}</td>
                  <td className="table-td"><span className={`status-badge ${statusInfo(c.status).cls}`}>{statusInfo(c.status).label}</span></td>
                  <td className="table-td whitespace-nowrap text-gray-600">{datumNl(c.signedAt)}</td>
                  <td className="table-td">
                    {c.certificaatBeschikbaar
                      ? <span className="inline-flex items-center gap-1 text-green-700 text-xs"><ShieldCheck className="h-3.5 w-3.5" />Ja</span>
                      : <span className="inline-flex items-center gap-1 text-amber-700 text-xs" title="Geen ondertekeningscertificaat beschikbaar."><ShieldAlert className="h-3.5 w-3.5" />Nee</span>}
                  </td>
                  <td className="table-td text-xs">
                    {!v && <span className="text-gray-400">Nog niet verstuurd</span>}
                    {v?.status === 'verstuurd' && <span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="h-3.5 w-3.5" />Verstuurd{v.verstuurd_op ? ` · ${datumNl(v.verstuurd_op)}` : ''}</span>}
                    {v?.status === 'mislukt' && <span className="text-red-600">Mislukt{v.fout ? ` — ${v.fout}` : ''}</span>}
                  </td>
                  <td className="table-td text-right">
                    {v?.status === 'mislukt' && (
                      <button onClick={() => opnieuw(c.id)} disabled={!!bezig} className="btn-secondary text-[11px] py-0.5">
                        {bezig === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Mail className="h-3 w-3" />}Opnieuw
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></KaartTabel></div>
      </div>

      {vraag && s && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
            <h3 className="font-semibold">Eenmalige verzending starten</h3>
            <p className="text-sm text-gray-600">
              Er vertrekken <b>{s.nogTeDoen} aparte e-mails</b> naar <b>{ontvanger}</b> — één per contract, met pdf en waar mogelijk het certificaat.
              Contracten die al verstuurd zijn, blijven buiten beschouwing.
            </p>
            <p className="text-xs text-gray-500">Dit verandert niets aan de contracten zelf. Je kunt dit niet terugdraaien: verstuurde mail blijft verstuurd.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setVraag(false)} className="btn-secondary text-sm">Annuleren</button>
              <button onClick={verstuurAlles} className="btn-primary text-sm"><Send className="h-4 w-4" />Versturen</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Vak({ label, waarde, kleur }: { label: string; waarde: string; kleur?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-lg font-bold ${kleur ?? ''}`}>{waarde}</div>
    </div>
  )
}
