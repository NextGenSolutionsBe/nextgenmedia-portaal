'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCircle2, Download, Loader2, Paperclip, Trash2, Undo2, X, FileText } from 'lucide-react'
import { fileTooBig, readJson, MAX_UPLOAD_MB } from '@/lib/upload'

export type ContractBijlage = { id: string; naam: string; grootte: number | null; created_by: string | null; created_at: string }

const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const datumTekst = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric' }) : null)
const grootteTekst = (b: number | null) => (b == null ? '' : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} kB` : `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB`)

/** Eén bestand opladen als bijlage bij het contract. Gooit met een leesbare fout. */
async function laadOp(contractId: string, file: File) {
  if (fileTooBig(file)) throw new Error(`"${file.name}" is te groot (max ${MAX_UPLOAD_MB} MB).`)
  const fd = new FormData()
  fd.append('file', file)
  await readJson(await fetch(`/api/admin/contracts/${contractId}/bijlagen`, { method: 'POST', body: fd }))
}

/**
 * Knop "Op getekend zetten": voor een contract dat buiten de app ondertekend
 * werd (bv. per mail bevestigd). Datum, notitie en bijlagen zijn optioneel.
 */
export function OpGetekendZetten({ contractId }: { contractId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [datum, setDatum] = useState(vandaag())
  const [notitie, setNotitie] = useState('')
  const [bestanden, setBestanden] = useState<File[]>([])
  const [bezig, setBezig] = useState(false)
  const teGroot = bestanden.filter((f) => fileTooBig(f))

  const bevestig = async () => {
    if (bezig || teGroot.length) return
    setBezig(true)
    try {
      await readJson(await fetch(`/api/admin/contracts/${contractId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'manueel_getekend', datum, notitie }),
      }))
      const mislukt: string[] = []
      for (const f of bestanden) {
        try { await laadOp(contractId, f) } catch { mislukt.push(f.name) }
      }
      if (mislukt.length) toast.error(`Op getekend gezet, maar niet opgeladen: ${mislukt.join(', ')}. Voeg ze opnieuw toe.`)
      else toast.success('Contract staat op getekend.')
      setOpen(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Op getekend zetten mislukt')
    } finally { setBezig(false) }
  }

  return (
    <>
      <button type="button" onClick={() => { setDatum(vandaag()); setOpen(true) }} className="btn-secondary flex items-center gap-2 text-sm" title="Getekend buiten de app, bv. per mail bevestigd">
        <CheckCircle2 className="h-4 w-4" />
        Op getekend zetten
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="op-getekend-titel">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between gap-2 p-5 border-b border-gray-100">
              <h3 id="op-getekend-titel" className="font-semibold text-gray-900 flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-green-600" />Op getekend zetten</h3>
              <button type="button" onClick={() => !bezig && setOpen(false)} className="text-gray-400 hover:text-black" aria-label="Sluiten"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-600">Voor een contract dat buiten de app getekend is, bijvoorbeeld per mail bevestigd.</p>
              <label className="block text-xs text-gray-500">Getekend op
                <input type="date" max={vandaag()} className="mt-0.5 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={datum} onChange={(e) => setDatum(e.target.value)} />
              </label>
              <label className="block text-xs text-gray-500">Notitie <span className="text-gray-400">(optioneel)</span>
                <textarea rows={2} maxLength={1000} placeholder="bv. per mail bevestigd" className="mt-0.5 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={notitie} onChange={(e) => setNotitie(e.target.value)} />
              </label>
              <div className="space-y-2">
                <div className="text-xs text-gray-500">Bijlage <span className="text-gray-400">(optioneel, bv. het mailverkeer)</span></div>
                {bestanden.map((f, i) => (
                  <div key={`${f.name}-${i}`} className={`flex items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-sm ${fileTooBig(f) ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
                    <span className="truncate flex items-center gap-1.5"><Paperclip className="h-3.5 w-3.5 text-gray-400 shrink-0" />{f.name}</span>
                    <span className="flex items-center gap-2 shrink-0 text-xs text-gray-400">{grootteTekst(f.size)}
                      <button type="button" onClick={() => setBestanden(bestanden.filter((_, j) => j !== i))} className="hover:text-black" aria-label={`${f.name} weghalen`}><X className="h-3.5 w-3.5" /></button>
                    </span>
                  </div>
                ))}
                {teGroot.length > 0 && <div className="text-xs text-red-600">Max {MAX_UPLOAD_MB} MB per bestand.</div>}
                <label className="btn-secondary text-sm cursor-pointer w-fit"><Paperclip className="h-4 w-4" />Bestand kiezen
                  <input type="file" className="hidden" multiple onChange={(e) => { setBestanden([...bestanden, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} />
                </label>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={bevestig} disabled={bezig || teGroot.length > 0} className="btn-primary flex-1 justify-center">
                  {bezig && <Loader2 className="h-4 w-4 animate-spin" />}
                  {bezig ? 'Bezig…' : 'Op getekend zetten'}
                </button>
                <button type="button" onClick={() => setOpen(false)} disabled={bezig} className="btn-secondary">Annuleer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Kaart bij een contract dat buiten de app getekend werd: wanneer, door wie,
 * de notitie en de bijlagen. Staat het contract (na "ongedaan maken") niet
 * meer op getekend, dan blijven enkel de bijlagen zichtbaar.
 */
export function GetekendBuitenApp(p: {
  contractId: string
  getekend: boolean
  signedAt: string | null
  door: string | null
  notitie: string | null
  bijlagen: ContractBijlage[]
  heeftOrigineel: boolean
}) {
  const router = useRouter()
  const [bezig, setBezig] = useState<string | null>(null)
  const basis = `/api/admin/contracts/${p.contractId}`

  const voegToe = async (files: File[]) => {
    if (!files.length) return
    setBezig('upload')
    try {
      for (const f of files) await laadOp(p.contractId, f)
      toast.success(files.length === 1 ? 'Bijlage toegevoegd.' : `${files.length} bijlagen toegevoegd.`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opladen mislukt')
      router.refresh()
    } finally { setBezig(null) }
  }

  const verwijder = async (b: ContractBijlage) => {
    if (!confirm(`Bijlage "${b.naam}" verwijderen?`)) return
    setBezig(b.id)
    try {
      await readJson(await fetch(`${basis}/bijlagen?bijlage=${b.id}`, { method: 'DELETE' }))
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt')
    } finally { setBezig(null) }
  }

  const ongedaan = async () => {
    if (!confirm('Dit contract niet langer op getekend zetten? De bijlagen blijven bewaard.')) return
    setBezig('ongedaan')
    try {
      await readJson(await fetch(basis, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'manueel_getekend_ongedaan' }) }))
      toast.success('Contract staat niet langer op getekend.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ongedaan maken mislukt')
    } finally { setBezig(null) }
  }

  return (
    <div className="card-base space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          {p.getekend ? <><CheckCircle2 className="h-4 w-4 text-green-500" />Getekend buiten de app</> : <><Paperclip className="h-4 w-4 text-gray-500" />Bijlagen</>}
        </h2>
        {p.getekend && (
          <button type="button" onClick={ongedaan} disabled={!!bezig} className="text-xs text-gray-400 hover:text-black inline-flex items-center gap-1" title="Per ongeluk op getekend gezet? Zet het contract terug.">
            {bezig === 'ongedaan' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}Ongedaan maken
          </button>
        )}
      </div>

      {p.getekend && (
        <div className="space-y-2 text-sm">
          <div className="text-gray-600">
            {p.signedAt ? `Getekend op ${datumTekst(p.signedAt)}` : 'Getekend'}{p.door ? ` · op getekend gezet door ${p.door}` : ''}
          </div>
          {p.notitie && <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-gray-800 whitespace-pre-wrap">{p.notitie}</div>}
        </div>
      )}

      <div className="space-y-1.5">
        {p.bijlagen.length === 0 && <div className="text-xs text-gray-400">Nog geen bijlage.</div>}
        {p.bijlagen.map((b) => (
          <div key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm">
            <a href={`${basis}/bijlagen?bijlage=${b.id}`} className="truncate flex items-center gap-1.5 hover:underline" title="Openen">
              <Paperclip className="h-3.5 w-3.5 text-gray-400 shrink-0" />{b.naam}
            </a>
            <span className="flex items-center gap-2 shrink-0 text-xs text-gray-400">
              {grootteTekst(b.grootte)}
              <button type="button" onClick={() => verwijder(b)} disabled={!!bezig} className="hover:text-red-600" aria-label={`${b.naam} verwijderen`}>
                {bezig === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </span>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap">
        <label className={`btn-secondary text-sm cursor-pointer ${bezig ? 'opacity-50 pointer-events-none' : ''}`}>
          {bezig === 'upload' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}Bijlage toevoegen
          <input type="file" className="hidden" multiple onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; voegToe(f) }} />
        </label>
        {p.getekend && p.heeftOrigineel && (
          <a href={`${basis}/download?type=original`} className="btn-secondary text-sm"><Download className="h-4 w-4" />Contract downloaden</a>
        )}
      </div>
      {p.getekend && (
        <p className="text-xs text-gray-400 flex items-start gap-1.5"><FileText className="h-3.5 w-3.5 shrink-0 mt-px" />Geen handtekening in de app, dus ook geen ondertekeningscertificaat. Het bewijs zit in de bijlagen.</p>
      )}
    </div>
  )
}
