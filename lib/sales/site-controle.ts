// De eigen website van een lead ophalen en nagaan of het telefoonnummer (en de
// naam) erop staat. Gedeeld door de opschoning (scripts/leads-controle.ts) en
// de knop "Controleren" in de lead. Geen server-only imports: enkel fetch.

import { telefoonsInHtml, naamOpSite, contactLink } from './lead-kwaliteit'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

async function haal(url: string, ms: number): Promise<{ ok: true; html: string; eind: string } | { ok: false; fout: string }> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { redirect: 'follow', signal: ctl.signal, cache: 'no-store', headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'nl-BE,nl;q=0.9,fr;q=0.7,en;q=0.5' } })
    if (!r.ok) return { ok: false, fout: `HTTP ${r.status}` }
    const html = (await r.text()).slice(0, 1_500_000)
    return { ok: true, html, eind: r.url || url }
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string }; message?: string }
    return { ok: false, fout: err.name === 'AbortError' ? 'time-out' : err.cause?.code ?? err.message ?? 'fout' }
  } finally { clearTimeout(t) }
}

export type SiteResultaat = { bereikbaar: boolean; telefoonOpSite: boolean; naamOpSite: boolean; fout?: string | null; nummers: Set<string>; eindUrl?: string }

/**
 * Homepage (https, dan http, dan www.) en zo nodig de contactpagina.
 * `nummers` = de nationale nummers van de lead (zonder 0/+32).
 */
export async function controleerSite(url: string, naam: string, domein: string, nummers: string[], ms = 15000): Promise<SiteResultaat> {
  try {
    const host = new URL(url).hostname
    const pogingen = [url, url.replace('https://', 'http://'), host.startsWith('www.') ? null : `https://www.${host}`].filter(Boolean) as string[]
    let home: { html: string; eind: string } | null = null
    let fout = ''
    for (const p of pogingen) {
      const r = await haal(p, ms)
      if (r.ok) { home = r; break }
      fout = r.fout
    }
    if (!home) return { bereikbaar: false, telefoonOpSite: false, naamOpSite: false, fout, nummers: new Set() }
    const gevonden = telefoonsInHtml(home.html)
    let naamOk = naamOpSite(naam, home.html, domein)
    if (!nummers.some((n) => gevonden.has(n))) {
      const c = contactLink(home.html, home.eind)
      if (c) {
        const r = await haal(c, ms)
        if (r.ok) { for (const n of telefoonsInHtml(r.html)) gevonden.add(n); naamOk ||= naamOpSite(naam, r.html, domein) }
      }
    }
    return { bereikbaar: true, telefoonOpSite: nummers.some((n) => gevonden.has(n)), naamOpSite: naamOk, nummers: gevonden, eindUrl: home.eind }
  } catch (e) {
    return { bereikbaar: false, telefoonOpSite: false, naamOpSite: false, fout: `controle mislukt: ${(e as Error).message}`, nummers: new Set() }
  }
}
