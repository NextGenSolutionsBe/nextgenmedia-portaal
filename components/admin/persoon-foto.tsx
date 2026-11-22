'use client'

import { useEffect, useState } from 'react'

/**
 * Profielfoto's van het team (uit Personeel) bij het kiezen of tonen van een
 * persoon: Bram, Marco, Chiara … Eén keer geladen per pagina
 * (/api/admin/team-fotos), gezocht op voornaam of volledige naam. Zonder foto
 * de initialen. "Gezamenlijke lead" (of "samen") = Marco en Bram over elkaar.
 */

type Lid = { voornaam: string; achternaam: string | null; foto: string | null }

let klaar: Lid[] | null = null
let laden: Promise<Lid[]> | null = null

function haal(): Promise<Lid[]> {
  if (!laden) {
    laden = fetch('/api/admin/team-fotos')
      .then((r) => (r.ok ? r.json() : { leden: [] }))
      .then((j: { leden?: Lid[] }) => { klaar = j.leden ?? []; return klaar })
      .catch(() => { laden = null; return [] })
  }
  return laden
}

export function useTeamFotos(): Lid[] | null {
  const [leden, setLeden] = useState<Lid[] | null>(klaar)
  useEffect(() => {
    if (klaar) { setLeden(klaar); return }
    let weg = false
    haal().then((l) => { if (!weg) setLeden(l) })
    return () => { weg = true }
  }, [])
  return leden
}

const SAMEN = /^(gezamenlijk|gezamenlijke lead|samen|marco of bram|marco en bram|iedereen)$/i

/** "Bram", "Bram Reinquin", "bram@nextgenmedia.be" → de foto van Bram (enkel als de voornaam niet dubbel is). */
export function fotoVoor(leden: Lid[] | null, naam: string): string | null {
  if (!leden?.length) return null
  const s = naam.trim().toLowerCase()
  if (!s) return null
  const vol = leden.find((l) => `${l.voornaam} ${l.achternaam ?? ''}`.trim().toLowerCase() === s)
  if (vol) return vol.foto
  const voornaam = s.split(/[\s@.]+/)[0]
  const zelfde = leden.filter((l) => l.voornaam.toLowerCase() === voornaam)
  return zelfde.length === 1 ? zelfde[0].foto : null
}

const initialen = (naam: string) => naam.trim().split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'

function Bol({ naam, foto, maat, rand }: { naam: string; foto: string | null; maat: number; rand?: boolean }) {
  const stijl = { width: maat, height: maat }
  const ring = rand ? 'ring-2 ring-white' : ''
  if (foto) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={foto} alt="" aria-hidden width={maat} height={maat} loading="lazy" style={stijl} className={`shrink-0 rounded-full object-cover bg-gray-100 ${ring}`} />
  }
  return (
    <span aria-hidden style={{ ...stijl, fontSize: Math.max(9, Math.round(maat * 0.4)) }}
      className={`shrink-0 rounded-full bg-gray-200 text-gray-600 font-semibold inline-flex items-center justify-center ${ring}`}>{initialen(naam)}</span>
  )
}

/** Ronde profielfoto bij een naam. Bij een gezamenlijke keuze Marco en Bram over elkaar. */
export function PersoonFoto({ naam, maat = 24 }: { naam: string; maat?: number }) {
  const leden = useTeamFotos()
  if (SAMEN.test(naam.trim())) {
    return (
      <span className="inline-flex shrink-0 -space-x-2" aria-hidden>
        <Bol naam="Marco" foto={fotoVoor(leden, 'Marco')} maat={maat} rand />
        <Bol naam="Bram" foto={fotoVoor(leden, 'Bram')} maat={maat} rand />
      </span>
    )
  }
  return <Bol naam={naam} foto={fotoVoor(leden, naam)} maat={maat} />
}

/** Een persoon kiezen: foto + naam als pil. `label` = andere tekst dan de naam (bv. "Marco of Bram"). */
export function PersoonKnop({ naam, label, aan, onClick, disabled, klein = false, rol = 'radio', titel }: {
  naam: string; label?: string; aan: boolean; onClick: () => void; disabled?: boolean; klein?: boolean
  rol?: 'radio' | 'checkbox' | 'button'; titel?: string
}) {
  return (
    <button type="button" role={rol === 'button' ? undefined : rol} aria-checked={rol === 'button' ? undefined : aan} aria-pressed={rol === 'button' ? aan : undefined}
      disabled={disabled} onClick={onClick} title={titel}
      className={`inline-flex items-center gap-1.5 rounded-full border transition-colors disabled:opacity-60 ${klein ? 'pl-0.5 pr-2.5 py-0.5 text-xs' : 'pl-1 pr-3 py-1 text-sm'} ${aan ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'}`}>
      <PersoonFoto naam={naam} maat={klein ? 20 : 26} />
      <span>{label ?? naam}</span>
    </button>
  )
}
