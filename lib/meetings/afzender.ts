import 'server-only'
import { EMAIL_FROM } from '@/lib/email'
import { INFO_ADRES, adresUit } from '@/lib/meetings/meeting-mail'

/**
 * Mag een meetingmail vertrekken vanuit info@nextgenmedia.be? De app mailt via
 * Resend met het geverifieerde domein nextgenmedia.be (DKIM): dat is de
 * verzendmachtiging. Klopt het afzenderadres of het domein niet, dan vertrekt
 * er niets, en zeggen we precies wat er ingesteld moet worden. Nooit via een
 * ander account of een ander adres.
 */
export type AfzenderStatus = { ok: true; van: string } | { ok: false; van: string; fout: string }

let cache: { tot: number; waarde: AfzenderStatus } | null = null

export async function controleerAfzender(): Promise<AfzenderStatus> {
  if (cache && cache.tot > Date.now()) return cache.waarde
  const waarde = await bepaal()
  // Een goede uitkomst 10 minuten onthouden; een fout meteen opnieuw nagaan.
  cache = waarde.ok ? { tot: Date.now() + 10 * 60_000, waarde } : null
  return waarde
}

async function bepaal(): Promise<AfzenderStatus> {
  const van = EMAIL_FROM
  if (adresUit(van) !== INFO_ADRES) {
    return { ok: false, van, fout: `De app staat ingesteld om te mailen vanaf ${adresUit(van)}, niet vanaf ${INFO_ADRES}. Zet in Vercel de omgevingsvariabele EMAIL_FROM op "NextGenMedia <${INFO_ADRES}>" (of verwijder ze). Er is niets verstuurd.` }
  }
  const sleutel = process.env.RESEND_API_KEY
  if (!sleutel) return { ok: false, van, fout: 'Er is geen mailprovider ingesteld (RESEND_API_KEY ontbreekt in Vercel). Er is niets verstuurd.' }
  try {
    const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${sleutel}` }, cache: 'no-store' })
    const j = await res.json().catch(() => ({})) as { data?: { name?: string; status?: string }[]; name?: string }
    if (res.ok) {
      const d = (j.data ?? []).find((x) => (x.name ?? '').toLowerCase() === 'nextgenmedia.be')
      if (!d) return { ok: false, van, fout: `Het domein nextgenmedia.be staat niet bij Resend. Voeg het toe in Resend → Domains en zet de DKIM- en SPF-records bij Level27. Pas daarna kan de app vanaf ${INFO_ADRES} mailen. Er is niets verstuurd.` }
      if (d.status !== 'verified') return { ok: false, van, fout: `Het domein nextgenmedia.be is bij Resend nog niet geverifieerd (status: ${d.status ?? 'onbekend'}). Controleer de DKIM- en SPF-records bij Level27 in Resend → Domains. Er is niets verstuurd.` }
      return { ok: true, van }
    }
    // Een sleutel met enkel verzendrecht mag de domeinen niet lezen. Resend
    // weigert zelf elke mail vanaf een niet-geverifieerd domein, dus dan geldt die controle.
    if (j.name === 'restricted_api_key') return { ok: true, van }
    return { ok: false, van, fout: `Resend antwoordde niet zoals verwacht (status ${res.status}). Er is niets verstuurd; probeer het zo opnieuw.` }
  } catch {
    return { ok: false, van, fout: 'Resend is nu niet bereikbaar. Er is niets verstuurd; probeer het zo opnieuw.' }
  }
}
