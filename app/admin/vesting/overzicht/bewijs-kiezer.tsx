'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { FileText, Loader2, Paperclip, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { api } from './delen'

export type BewijsWaarde = { pad: string; naam: string } | null

const MAX = 25 * 1024 * 1024
const TOEGELATEN = /\.(pdf|jpe?g|png)$/i

/** Een bestand rechtstreeks in de privéopslag zetten (ondertekende link); de server leest het pas bij het bewaren. */
async function laadOp(f: File): Promise<{ pad: string; naam: string }> {
  if (!TOEGELATEN.test(f.name)) throw new Error('Enkel pdf, jpg of png.')
  if (f.size > MAX) throw new Error('Het bestand is groter dan 25 MB.')
  const j = await api('/api/admin/vesting/bewijs', { method: 'POST', body: JSON.stringify({ naam: f.name, grootte: f.size }) }) as { pad: string; token: string; bucket: string; contentType: string }
  const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: j.contentType, upsert: false })
  if (error) throw new Error(error.message)
  return { pad: j.pad, naam: f.name }
}

/**
 * Het bewijsstuk bij een inkomst of kost: het contract of de factuur. Bij een
 * nieuwe registratie verplicht; bij aanpassen kan je het bestaande vervangen.
 */
export function BewijsKiezer({ waarde, onChange, bestaand, label = 'Contract of factuur' }: {
  waarde: BewijsWaarde
  onChange: (v: BewijsWaarde) => void
  /** Het document dat er al hangt (bij aanpassen). */
  bestaand?: { pad: string; naam: string } | null
  label?: string
}) {
  const kiezer = useRef<HTMLInputElement>(null)
  const [bezig, setBezig] = useState(false)

  const kies = async (f: File | undefined) => {
    if (!f) return
    setBezig(true)
    try { onChange(await laadOp(f)) }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') }
    finally { setBezig(false); if (kiezer.current) kiezer.current.value = '' }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label} <span className="font-normal text-gray-400">(pdf, jpg of png, max 25 MB)</span></label>
      <input ref={kiezer} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => kies(e.target.files?.[0])} />
      {waarde ? (
        <div className="flex items-center gap-2 rounded-md border border-gray-900 bg-white px-3 py-2 text-sm">
          <FileText className="h-4 w-4 shrink-0" />
          <span className="truncate flex-1">{waarde.naam}</span>
          <button type="button" onClick={() => onChange(null)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100" aria-label="Document weghalen"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : (
        <button type="button" onClick={() => kiezer.current?.click()} disabled={bezig}
          className="w-full flex items-center justify-center gap-2 rounded-md border border-dashed border-gray-300 px-3 py-3 text-sm text-gray-600 hover:border-gray-500 hover:text-gray-900">
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
          {bezig ? 'Bezig met opladen…' : bestaand ? `Vervangen (nu: ${bestaand.naam})` : 'Document opladen'}
        </button>
      )}
    </div>
  )
}

/** Link om een opgeladen bewijsstuk te bekijken. */
export function BewijsLink({ bewijs, klein }: { bewijs: { pad: string; naam: string }; klein?: boolean }) {
  return (
    <a href={`/api/admin/vesting/bewijs?pad=${encodeURIComponent(bewijs.pad)}`} target="_blank" rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 text-gray-600 hover:text-black underline-offset-2 hover:underline ${klein ? 'text-[11px]' : 'text-xs'}`}>
      <FileText className={klein ? 'h-3 w-3' : 'h-3.5 w-3.5'} /><span className="truncate max-w-[220px]">{bewijs.naam}</span>
    </a>
  )
}
