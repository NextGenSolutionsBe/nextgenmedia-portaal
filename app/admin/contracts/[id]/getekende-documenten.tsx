'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Download, FileText, Printer, Archive, Loader2, Mail, ShieldCheck, ExternalLink } from 'lucide-react'

type Props = {
  contractId: string
  accessToken: string
  heeftGetekendePdf: boolean
  heeftOrigineel: boolean
  certificaatNr: string | null
  gearchiveerdOp: string | null
  archiefVersie: number | null
  signedAt: string | null
  /** Toon de knop "Melding naar Legal opnieuw versturen" (laatste melding mislukt, of nog geen). */
  meldingOpnieuw: boolean
  laatsteMelding: 'verstuurd' | 'mislukt' | null
}

const fmt = (iso: string | null) => {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/**
 * "Getekende documenten": het getekende contract en het ondertekenings-
 * certificaat uit het beschermde archief, met vier acties. Zonder getekende
 * PDF (oudere contracten) valt het terug op origineel + ontvangstbewijs.
 */
export function GetekendeDocumenten(p: Props) {
  const router = useRouter()
  const [bezig, setBezig] = useState(false)
  const basis = `/api/admin/contracts/${p.contractId}`

  const hermeld = async () => {
    setBezig(true)
    try {
      const res = await fetch(`${basis}/melding`, { method: 'POST' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Melding versturen mislukt')
      if (j.alVerstuurd) toast.info(`De melding voor deze versie was al verstuurd naar ${(j.naar ?? []).join(', ')}.`)
      else toast.success(`Melding naar Legal verstuurd (${(j.naar ?? []).join(', ')}).`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Melding versturen mislukt')
    } finally { setBezig(false) }
  }

  return (
    <div className="card-base space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          Getekende documenten
        </h2>
        <span className="inline-flex items-center gap-1 text-[11px] text-green-700 bg-green-50 border border-green-100 rounded-full px-2 py-0.5">
          <ShieldCheck className="h-3 w-3" /> Beschermd contractarchief
        </span>
      </div>

      {p.heeftGetekendePdf ? (
        <>
          <div className="grid sm:grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl border border-gray-200 p-3 space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <FileText className="h-4 w-4 text-gray-500" /> Getekend contract
              </div>
              <div className="text-xs text-gray-500">
                {p.signedAt ? `Ondertekend op ${fmt(p.signedAt)}` : 'Ondertekend'}
                {p.archiefVersie ? ` · archiefversie v${p.archiefVersie}` : ''}
              </div>
            </div>
            <div className="rounded-xl border border-gray-200 p-3 space-y-1">
              <div className="flex items-center gap-2 font-medium">
                <ShieldCheck className="h-4 w-4 text-gray-500" /> Ondertekeningscertificaat
              </div>
              <div className="text-xs text-gray-500">
                {p.certificaatNr ? <span className="font-mono">{p.certificaatNr}</span> : 'Wordt aangemaakt bij de eerste download'}
                {p.gearchiveerdOp ? ` · ${fmt(p.gearchiveerdOp)}` : ''}
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-2">
            <a href={`${basis}/download?type=signed`} className="btn-primary justify-center text-sm">
              <Download className="h-4 w-4" /> Getekend contract downloaden
            </a>
            <a href={`${basis}/certificaat`} className="btn-secondary justify-center text-sm">
              <Download className="h-4 w-4" /> Certificaat downloaden
            </a>
            <a href={`${basis}/documenten?formaat=zip`} className="btn-secondary justify-center text-sm" title="Beide PDF's in één ZIP">
              <Archive className="h-4 w-4" /> Beide documenten downloaden
            </a>
            <a href={`${basis}/documenten?formaat=pdf`} target="_blank" rel="noreferrer" className="btn-secondary justify-center text-sm" title="Contract en certificaat als één PDF in een nieuw tabblad — klaar om af te drukken">
              <Printer className="h-4 w-4" /> Beide documenten afdrukken
            </a>
          </div>
          <p className="text-xs text-gray-400">
            De handtekening staat rechtstreeks op het contract. Het certificaat legt vast wie tekende, wanneer, hoe en met welke SHA-256-vingerafdruk.
          </p>
        </>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-500">
            De ingebedde getekende PDF is niet beschikbaar — gebruik het origineel met het ondertekeningsbewijs en het certificaat als bewijs.
          </p>
          <div className="grid sm:grid-cols-3 gap-2">
            {p.heeftOrigineel && (
              <a href={`${basis}/download?type=original`} className="btn-secondary justify-center text-sm">
                <Download className="h-4 w-4" /> Origineel contract
              </a>
            )}
            <a href={`/sign/${p.accessToken}/receipt`} target="_blank" rel="noreferrer" className="btn-secondary justify-center text-sm">
              <ExternalLink className="h-4 w-4" /> Ondertekeningsbewijs
            </a>
            <a href={`${basis}/certificaat`} className="btn-secondary justify-center text-sm">
              <Download className="h-4 w-4" /> Certificaat downloaden
            </a>
          </div>
        </div>
      )}

      {(p.meldingOpnieuw || p.laatsteMelding) && (
        <div className={`flex items-center justify-between gap-3 flex-wrap rounded-xl border px-3 py-2 text-xs ${p.laatsteMelding === 'mislukt' ? 'border-red-100 bg-red-50 text-red-700' : 'border-gray-100 bg-gray-50 text-gray-600'}`}>
          <span className="flex items-center gap-2">
            <Mail className="h-3.5 w-3.5" />
            {p.laatsteMelding === 'verstuurd' && 'Melding naar Legal verstuurd.'}
            {p.laatsteMelding === 'mislukt' && 'De melding naar Legal is mislukt.'}
            {p.laatsteMelding === null && 'Er is nog geen melding naar Legal verstuurd voor dit contract.'}
          </span>
          {p.meldingOpnieuw && (
            <button type="button" onClick={hermeld} disabled={bezig} className="btn-secondary text-xs py-1">
              {bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
              Melding naar Legal opnieuw versturen
            </button>
          )}
        </div>
      )}
    </div>
  )
}
