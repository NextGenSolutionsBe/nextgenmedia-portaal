'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { zoekVeld } from '@/lib/zoekveld'
import { VENNOTEN, kostSoortLabel, type Akkoord, type Vennoot } from '@/lib/vesting-akkoord'
import { api, eur, tijdstip } from './delen'

type Rij = {
  id: string; onderwerp: 'contract' | 'kost' | 'inkomst'; onderwerp_id: string; vennoot: Vennoot
  naam: string | null; email: string | null; getekend_op: string; inhoud: Akkoord; beschrijving: string
}
const ONDERWERP: Record<Rij['onderwerp'], string> = { contract: 'Contract', inkomst: 'Inkomst', kost: 'Kost' }

/**
 * Het register van alle handtekeningen: wie, wanneer, waarvoor (de cijfers van
 * dat moment) en de handtekening zelf. Niets wordt hier ooit gewijzigd of
 * verwijderd. Te downloaden als CSV voor het archief.
 */
export function Register({ vennoten }: { vennoten: Record<Vennoot, string> }) {
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [wie, setWie] = useState<Vennoot | ''>('')
  const [zoek, setZoek] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    api('/api/admin/vesting/akkoord?register=1')
      .then((j) => setRijen((j.handtekeningen as Rij[]) ?? []))
      .catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'))
  }, [])

  const zichtbaar = useMemo(() => (rijen ?? []).filter((r) =>
    (!wie || r.vennoot === wie) && (!zoek.trim() || r.beschrijving.toLowerCase().includes(zoek.trim().toLowerCase()))), [rijen, wie, zoek])

  const download = () => {
    const kop = ['Getekend op', 'Vennoot', 'Account', 'Soort', 'Waarvoor']
    const lijnen = zichtbaar.map((r) => [tijdstip(r.getekend_op), vennoten[r.vennoot], r.email ?? '', ONDERWERP[r.onderwerp], r.beschrijving])
    const csv = [kop, ...lijnen].map((l) => l.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = `vesting-handtekeningen-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="pt-4 space-y-3">
      <p className="text-sm text-gray-500 max-w-2xl">Elke handtekening, met de cijfers waarvoor ze gezet werd. Getekend is getekend: hier verandert of verdwijnt niets.</p>
      <div className="flex flex-wrap items-center gap-2">
        <input {...zoekVeld()} className="input-base max-w-xs" placeholder="Zoek op klant of omschrijving" value={zoek} onChange={(e) => setZoek(e.target.value)} />
        <select className="input-base w-auto" value={wie} onChange={(e) => setWie(e.target.value as Vennoot | '')} aria-label="Vennoot">
          <option value="">Iedereen</option>
          {VENNOTEN.map((v) => <option key={v} value={v}>{vennoten[v]}</option>)}
        </select>
        {zichtbaar.length > 0 && <button type="button" onClick={download} className="btn-secondary text-sm ml-auto"><Download className="h-4 w-4" />CSV</button>}
      </div>
      {fout && <p className="text-sm text-red-700">{fout}</p>}
      {rijen === null && !fout && <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {rijen !== null && zichtbaar.length === 0 && <p className="text-sm text-gray-500 py-6 text-center">Nog geen handtekeningen.</p>}
      {zichtbaar.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {zichtbaar.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="w-full text-left px-3.5 py-3 hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-gray-900">{r.beschrijving}</div>
                    <div className="text-xs text-gray-500">{ONDERWERP[r.onderwerp]} · getekend door {vennoten[r.vennoot]}</div>
                  </div>
                  <div className="text-xs text-gray-500 shrink-0 text-right">{tijdstip(r.getekend_op)}</div>
                </div>
              </button>
              {open === r.id && <Detail r={r} naam={vennoten[r.vennoot]} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Detail({ r, naam }: { r: Rij; naam: string }) {
  const [beeld, setBeeld] = useState<string | null>(null)
  useEffect(() => {
    api(`/api/admin/vesting/akkoord?handtekening=${r.id}`)
      .then((j) => setBeeld(((j.handtekening as { handtekening?: string }) ?? {}).handtekening ?? null))
      .catch(() => setBeeld(null))
  }, [r.id])
  const a = r.inhoud
  return (
    <div className="px-3.5 pb-4 grid sm:grid-cols-[1fr_200px] gap-4">
      <dl className="text-xs text-gray-700 space-y-1">
        {a.soort === 'contract' ? (
          <>
            <Veld k="Klant">{a.klant}{a.contract ? ` · ${a.contract}` : ''} ({a.nr})</Veld>
            <Veld k="Contractwaarde">{eur(a.contractwaarde, true)}</Veld>
            <Veld k="Kosten">{a.kosten.length ? a.kosten.map((k) => `${kostSoortLabel(k.soort)}${k.omschrijving ? ` (${k.omschrijving})` : ''} ${eur(k.bedrag, true)}${k.verantwoording ? `: ${k.verantwoording}` : ''}`).join(' · ') : 'geen'}{a.kosten_totaal ? ` · in totaal ${eur(a.kosten_totaal, true)}` : ''}</Veld>
            <Veld k="Netto">{eur(a.netto, true)}</Veld>
            <Veld k="Marco">{[a.afspraak && 'afspraak gezet', a.closing && 'geclosed'].filter(Boolean).join(' en ') || 'geen rol'} · {a.deel_pct}%</Veld>
            {a.verloop !== 'loopt' && <Veld k="Verloop">{a.verloop === 'stopgezet' ? `vroegtijdig stopgezet, ${eur(a.betaald_bij_stop, true)} betaald` : 'niet-betaler'}</Veld>}
            <Veld k="Telt mee"><b>{eur(a.telt_mee, true)}</b></Veld>
          </>
        ) : (
          <>
            <Veld k={a.soort === 'inkomst' ? 'Inkomst' : 'Kost'}>{a.omschrijving}{a.geschrapt ? ' (geschrapt)' : ''}</Veld>
            <Veld k="Bedrag"><b>{eur(a.bedrag, true)}</b></Veld>
            <Veld k="Datum">{a.datum}</Veld>
            {a.referentie && <Veld k="Referentie">{a.referentie}</Veld>}
            <Veld k="Verantwoording">{a.verantwoording}</Veld>
          </>
        )}
        <Veld k="Account">{r.email ?? '—'}</Veld>
      </dl>
      <div className="rounded-lg border border-gray-200 bg-white p-2 flex flex-col items-center justify-center min-h-[90px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {beeld ? <img src={beeld} alt={`Handtekening ${naam}`} className="max-h-24 w-full object-contain" /> : <Loader2 className="h-4 w-4 animate-spin text-gray-300" />}
        <div className="mt-1 text-[11px] text-gray-500">{naam} · {tijdstip(r.getekend_op)}</div>
      </div>
    </div>
  )
}

function Veld({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="grid grid-cols-[110px_1fr] gap-2"><dt className="text-gray-500">{k}</dt><dd className="whitespace-pre-wrap break-words">{children}</dd></div>
}
