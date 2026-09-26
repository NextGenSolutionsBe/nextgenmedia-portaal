import { antwoordTekst, isAntwoordVeld, dienstLabel, INZENDING_STATUS_INFO, type Veld, type InzendingStatus } from '@/lib/formulieren/model'
import { type Werkmap, type Cel, type Kolom, datum } from '../spec'

/**
 * Excel-export van de inzendingen van één formulier, opgebouwd uit wat het
 * scherm al geladen heeft (dezelfde rijen, dezelfde filter). Eén kolom per
 * vraag: eerst de huidige velden in hun volgorde, daarna vragen die enkel nog
 * in oudere inzendingen voorkomen (uit hun velden_snapshot).
 */

export type InzendingExport = {
  created_at: string
  status: string
  klant_naam: string | null
  naam: string | null
  email: string | null
  link_label: string | null
  admin_notitie: string | null
  antwoorden: Record<string, unknown>
  velden_snapshot: Veld[] | null
}

export function formulierInzendingenWerkmap({ titel, dienst, velden, inzendingen, filter }: {
  titel: string
  dienst: string
  velden: Veld[]
  inzendingen: InzendingExport[]
  filter?: string
}): Werkmap {
  // Kolommen: huidige vragen + vragen die enkel in snapshots bestaan.
  const vragen: Veld[] = velden.filter((v) => isAntwoordVeld(v.type))
  const bekend = new Set(vragen.map((v) => v.id))
  for (const i of inzendingen) {
    for (const v of i.velden_snapshot ?? []) {
      if (isAntwoordVeld(v.type) && !bekend.has(v.id)) { vragen.push(v); bekend.add(v.id) }
    }
  }

  const kolommen: Kolom[] = [
    { kop: 'Ingestuurd op', stijl: 'datum' }, { kop: 'Tijd' }, { kop: 'Status' }, { kop: 'Klant' }, { kop: 'Naam' }, { kop: 'E-mail' }, { kop: 'Link' },
    ...vragen.map((v) => ({ kop: v.label.slice(0, 80), breedte: v.type === 'lang' ? 50 : undefined })),
    { kop: 'Interne notitie', breedte: 40 },
  ]

  const rijen: Cel[][] = inzendingen.map((i) => {
    const d = new Date(i.created_at)
    const tijd = Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
    const dag = Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
    return [
      datum(dag), tijd, INZENDING_STATUS_INFO[i.status as InzendingStatus]?.label ?? i.status,
      i.klant_naam ?? '', i.naam ?? '', i.email ?? '', i.link_label ?? '',
      ...vragen.map((v) => antwoordTekst(v, i.antwoorden?.[v.id])),
      i.admin_notitie ?? '',
    ]
  })

  return {
    bestandsnaam: `NextGenMedia_Formulier_${titel.replace(/[^A-Za-z0-9À-ſ]+/g, '_').slice(0, 40)}`,
    titel: `Inzendingen — ${titel}`,
    filters: [{ label: 'Dienst', waarde: dienstLabel(dienst) }, ...(filter ? [{ label: 'Status', waarde: filter }] : [])],
    bladen: [{
      naam: 'Inzendingen',
      titel: `Inzendingen — ${titel}`,
      toelichting: ['Bestanden staan als bestandsnaam vermeld; download ze via de inzending in de app.'],
      blokken: [{ soort: 'tabel', kolommen, rijen, leeg: 'Nog geen inzendingen.' }],
    }],
  }
}
