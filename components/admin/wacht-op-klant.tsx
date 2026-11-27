'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Loader2, Hourglass, ChevronDown } from 'lucide-react'
import { wachtPerKlant, wachtTekst, WACHT_LABEL, type WachtRij } from '@/lib/klant-wacht'

/**
 * Wat zit vast bij klanten (fase 6): pas geladen bij het openklappen.
 * Per klant wat er op hen wacht en hoe lang al. Enkel een overzicht: herinneren
 * gaat zoals altijd via de MailComposer, nooit vanzelf.
 */
export function WachtOpKlant() {
  const [open, setOpen] = useState(false)
  const [rijen, setRijen] = useState<WachtRij[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const openklappen = () => {
    setOpen(!open)
    if (rijen || open) return
    fetch('/api/admin/clients/wacht', { cache: 'no-store' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setRijen(j.rijen ?? []) })
      .catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'))
  }
  const vandaag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const perKlant = rijen ? wachtPerKlant(rijen, vandaag) : []
  return (
    <div className="card-base !py-3">
      <button type="button" onClick={openklappen} className="w-full flex items-center gap-2 text-left">
        <Hourglass className="h-4 w-4 text-gray-500" />
        <span className="font-semibold text-sm flex-1">Wacht op de klant</span>
        {rijen && <span className="text-xs text-gray-500">{perKlant.length} {perKlant.length === 1 ? 'klant' : 'klanten'}</span>}
        <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3">
          {fout ? <p className="text-sm text-red-700">{fout}</p> : !rijen ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : !perKlant.length ? <p className="text-sm text-gray-500">Niets: we wachten op geen enkele klant.</p> : (
            <ul className="divide-y divide-gray-50">
              {perKlant.map((k) => (
                <li key={k.client_id} className="py-2">
                  <div className="flex items-center gap-2"><Link href={`/admin/clients/${k.client_id}`} className="text-sm font-semibold hover:underline">{k.klant}</Link><span className={`text-[11px] ${k.dagen >= 7 ? 'text-red-700' : 'text-gray-500'}`}>{wachtTekst(k.dagen)}</span></div>
                  <ul className="mt-0.5 space-y-0.5">
                    {k.rijen.map((r, i) => (
                      <li key={i} className="text-xs text-gray-600 flex gap-2">
                        <span className="w-36 shrink-0 text-gray-500">{WACHT_LABEL[r.soort]}</span>
                        <Link href={r.href} className="flex-1 min-w-0 truncate hover:underline">{r.titel}</Link>
                        <span className={`shrink-0 ${r.dagen >= 7 ? 'text-red-700' : 'text-gray-400'}`}>{wachtTekst(r.dagen)}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
