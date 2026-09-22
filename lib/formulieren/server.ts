import 'server-only'
import { randomBytes } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import type { Actie } from '@/lib/instellingen/model'
import { linkStatusVan, normaliseerVelden, normaliseerInstellingen, type LinkStatus, type Veld, type FormulierInstellingen } from './model'

/**
 * Serverlaag van Formulieren: de module-guard voor admin-routes, tokens, en
 * het oplossen van een publieke link (één functie voor pagina, upload en
 * inzending, zodat de drie nooit verschillend beslissen).
 */

export const BUCKET = 'formulier-bestanden'
export const MODULE = 'formulieren'

export const TABEL_MIST = /formulier[a-z_]* .*does not exist|relation .*formulier|schema cache/i
export const MIGRATIE_HINT = 'De tabellen voor Formulieren bestaan nog niet. Draai supabase/migrations/99999999_SYNC_ALL.sql.'

/** Fout naar een antwoord: ontbrekende tabel → duidelijke hint, anders null (aanroeper beslist). */
export function migratieAntwoord(message: string | undefined | null): NextResponse | null {
  return message && TABEL_MIST.test(message) ? NextResponse.json({ error: MIGRATIE_HINT, code: 'migratie' }, { status: 503 }) : null
}

export type Actor = { userId: string; email: string | null }

/**
 * Guard voor admin-routes: ingelogde admin/werknemer (identiteit) én het recht
 * voor deze actie in de module (rechtenmatrix). De middleware gate't de module
 * al per pad; dit is de tweede laag op de route zelf.
 */
export async function formulierGuard(actie: Actie): Promise<{ ok: true; actor: Actor } | { ok: false; response: NextResponse }> {
  const user = await requireStaff()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Geen toegang' }, { status: 403 }) }
  const persoon = await magIk(MODULE, actie)
  if (!persoon) return { ok: false, response: NextResponse.json({ error: 'Jouw rol mag dit niet in Formulieren.' }, { status: 403 }) }
  return { ok: true, actor: { userId: user.id, email: user.email ?? null } }
}

/** 43 url-veilige tekens (32 willekeurige bytes). */
export const nieuwToken = (): string => randomBytes(32).toString('base64url')
export const isTokenVorm = (t: unknown): t is string => typeof t === 'string' && /^[A-Za-z0-9_-]{32,100}$/.test(t)
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export type PubliekeLink = {
  status: LinkStatus
  link?: { id: string; formulier_id: string; client_id: string | null; eenmalig: boolean; verloopt_op: string | null }
  formulier?: { id: string; titel: string; beschrijving: string | null; velden: Veld[]; instellingen: FormulierInstellingen }
  klantNaam?: string | null
}

/** Link + formulier voor een token, met de beslissing of er ingevuld mag worden. */
export async function laadPubliekeLink(token: unknown): Promise<PubliekeLink> {
  if (!isTokenVorm(token)) return { status: 'onbekend' }
  const admin = createAdminSupabaseClient()
  const { data: link } = await admin.from('formulier_links')
    .select('id, formulier_id, client_id, eenmalig, verloopt_op, ingetrokken_op')
    .eq('token', token).maybeSingle()
  if (!link) return { status: 'onbekend' }
  const { data: formulier } = await admin.from('formulieren')
    .select('id, titel, beschrijving, velden, instellingen, status, gearchiveerd_op')
    .eq('id', link.formulier_id).maybeSingle()
  if (!formulier) return { status: 'onbekend' }

  const instellingen = normaliseerInstellingen(formulier.instellingen)
  let aantal = 0
  if (link.eenmalig || !instellingen.meerdere_inzendingen) {
    const { count } = await admin.from('formulier_inzendingen').select('id', { count: 'exact', head: true }).eq('link_id', link.id)
    aantal = count ?? 0
  }
  const status = linkStatusVan(link, formulier, aantal)

  let klantNaam: string | null = null
  if (status === 'ok' && link.client_id) {
    const { data: c } = await admin.from('clients').select('company_name').eq('id', link.client_id).maybeSingle()
    klantNaam = (c?.company_name as string | undefined) ?? null
  }

  return {
    status,
    link: { id: link.id, formulier_id: link.formulier_id, client_id: link.client_id ?? null, eenmalig: !!link.eenmalig, verloopt_op: link.verloopt_op ?? null },
    formulier: { id: formulier.id, titel: formulier.titel, beschrijving: formulier.beschrijving ?? null, velden: normaliseerVelden(formulier.velden), instellingen },
    klantNaam,
  }
}
