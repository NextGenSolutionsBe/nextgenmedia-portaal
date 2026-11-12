// Pure kopieën van maskeer/schoonMetadata uit lib/instellingen/api.ts (die module
// is server-only en kan niet buiten Next geladen worden). Houd ze gelijk.
const GEVOELIG = /(token|secret|password|wachtwoord|api[_-]?key|sleutel|authorization|cookie|bearer|service_role)/i

export function maskeerPuur(geheim: string | null | undefined): string | null {
  const s = (geheim ?? '').trim()
  if (!s) return null
  return s.length <= 4 ? '••••' : `••••••••${s.slice(-4)}`
}

export function schoonMetadataPuur(v: unknown, diepte = 0): unknown {
  if (diepte > 6) return '…'
  if (Array.isArray(v)) return v.map((x) => schoonMetadataPuur(x, diepte + 1))
  if (v && typeof v === 'object') {
    const uit: Record<string, unknown> = {}
    for (const [k, w] of Object.entries(v as Record<string, unknown>)) uit[k] = GEVOELIG.test(k) ? '[verborgen]' : schoonMetadataPuur(w, diepte + 1)
    return uit
  }
  if (typeof v === 'string' && /^(sk-ant-|re_|pk_|eyJ)[A-Za-z0-9._-]{12,}/.test(v)) return '[verborgen]'
  return v
}
