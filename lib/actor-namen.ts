import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

// Wie deed het? Zet auth-gebruikers (created_by, actor_id…) om naar een naam
// voor in lijsten en detailschermen: "Bram", "Marco", "Chiara". Het oude
// gedeelde account info@ wordt als zodanig benoemd, zodat duidelijk is dat
// daar niet te achterhalen valt wie het was.

export type ActorNaam = { id: string; naam: string; kort: string; email: string | null; gedeeld: boolean }

const GEDEELD = new Set(['info@nextgenmedia.be'])

/**
 * Verwijderde login-accounts die nog in de historiek voorkomen (activiteiten,
 * afspraken, logboek). Hun auth-gebruiker bestaat niet meer, dus zonder deze
 * lijst zouden ze als "onbekend" verschijnen. Nooit aan iemand anders
 * toeschrijven: de historiek blijft van wie ze was.
 */
const VERWIJDERD: Record<string, { naam: string; email: string }> = {
  // info@nextgenmedia.be — gedeeld account, verwijderd op 27 sep 2026.
  'd174a614-8371-48ca-93a5-f85423cc13ac': { naam: 'Gedeeld account (info@, verwijderd)', email: 'info@nextgenmedia.be' },
}

function naamVan(email: string | null, meta: Record<string, unknown> | null | undefined): { naam: string; gedeeld: boolean } {
  const e = (email ?? '').toLowerCase()
  if (GEDEELD.has(e)) return { naam: 'Gedeeld account (info@)', gedeeld: true }
  const m = (meta ?? {}) as { full_name?: string; name?: string }
  const uitMeta = (m.full_name || m.name || '').trim()
  if (uitMeta) return { naam: uitMeta, gedeeld: false }
  const lokaal = e.split('@')[0] ?? ''
  return { naam: lokaal ? lokaal.charAt(0).toUpperCase() + lokaal.slice(1) : 'Onbekend', gedeeld: false }
}

// De lijst van accounts verandert zelden, maar opvragen kost telkens een ronde
// naar de Auth-server met alle gebruikers. Vijf minuten onthouden per
// serverinstantie (enkel id, e-mail en metadata; een mislukte vraag niet).
type Gebruiker = { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }
let gebruikersCache: { tot: number; lijst: Promise<Gebruiker[]> } | null = null
function gebruikers(admin: SupabaseClient): Promise<Gebruiker[]> {
  if (gebruikersCache && gebruikersCache.tot > Date.now()) return gebruikersCache.lijst
  const lijst = admin.auth.admin.listUsers({ page: 1, perPage: 1000 }).then(({ data, error }) => {
    if (error) throw error
    return (data?.users ?? []).map((u) => ({ id: u.id, email: u.email ?? null, user_metadata: (u.user_metadata ?? null) as Record<string, unknown> | null }))
  })
  gebruikersCache = { tot: Date.now() + 5 * 60_000, lijst }
  lijst.catch(() => { gebruikersCache = null })
  return lijst
}

/** Namen voor een lijst gebruikers-id's (onbekende id's worden overgeslagen). */
export async function leesActorNamen(admin: SupabaseClient, ids: (string | null | undefined)[]): Promise<Record<string, ActorNaam>> {
  const uniek = [...new Set(ids.filter((x): x is string => !!x))]
  if (!uniek.length) return {}
  const uit: Record<string, ActorNaam> = {}
  try {
    for (const u of await gebruikers(admin)) {
      if (!uniek.includes(u.id)) continue
      const { naam, gedeeld } = naamVan(u.email ?? null, u.user_metadata as Record<string, unknown>)
      uit[u.id] = { id: u.id, naam, kort: gedeeld ? 'info@ (gedeeld)' : naam.split(' ')[0], email: u.email ?? null, gedeeld }
    }
  } catch { /* namen zijn extra — nooit een scherm laten falen */ }
  for (const id of uniek) {
    const v = VERWIJDERD[id]
    if (v && !uit[id]) uit[id] = { id, naam: v.naam, kort: 'info@ (verwijderd)', email: v.email, gedeeld: true }
  }
  return uit
}

/** Zelfde, voor tabellen die een e-mailadres bewaren i.p.v. een id. */
export async function leesActorNamenOpEmail(admin: SupabaseClient, emails: (string | null | undefined)[]): Promise<Record<string, ActorNaam>> {
  const uniek = [...new Set(emails.filter((x): x is string => !!x).map((x) => x.toLowerCase()))]
  if (!uniek.length) return {}
  const uit: Record<string, ActorNaam> = {}
  try {
    for (const u of await gebruikers(admin)) {
      const e = (u.email ?? '').toLowerCase()
      if (!uniek.includes(e)) continue
      const { naam, gedeeld } = naamVan(e, u.user_metadata as Record<string, unknown>)
      uit[e] = { id: u.id, naam, kort: gedeeld ? 'info@ (gedeeld)' : naam.split(' ')[0], email: e, gedeeld }
    }
  } catch { /* idem */ }
  return uit
}
