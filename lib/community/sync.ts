import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { metricoolConfigured } from '@/lib/metricool'
import { haalComments, haalGesprekken, COMMENT_NETWERKEN, DM_NETWERKEN, type InboxBericht } from '@/lib/metricool-inbox'
import { antwoordMogelijkTot, OPEN_STATUSSEN } from './model'

/**
 * Community-sync: Metricool → community_berichten, elke tien minuten (pg_cron).
 *
 * Geen AI. Enkel ophalen en bewaren; indelen en voorstellen doet Claude via de
 * MCP (scheduled task), antwoorden doet een mens.
 *
 * Regels:
 *  · enkel klanten met community management aan, en enkel actieve kanalen;
 *  · één run tegelijk (unique index op de open run), dode runs worden afgesloten;
 *  · kanalen één na één, het langst niet gesynchroniseerde eerst; na het
 *    tijdsbudget stopt de run en gaat de volgende verder (laatst_gesynct);
 *  · bestaande berichten: NOOIT categorie, status, voorstellen of gekozen tekst
 *    overschrijven — enkel tekst (en raw) als de tekst veranderde;
 *  · antwoorden van het merk zelf bewaren we niet; ze zetten het bericht
 *    waarop geantwoord werd op "verstuurd" (extern, via Metricool);
 *  · open berichten waarvan de termijn voorbij is → "verlopen";
 *  · een fout per kanaal komt in laatste_fout en houdt de rest niet tegen.
 */

const TIJDSBUDGET_MS = 40_000
const DODE_RUN_NA_MS = 90_000
export const EXTERN_VERSTUURD = 'extern (Metricool)'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }
type Kanaal = { id: string; client_id: string; naam: string; metricool_blog_id: string; netwerken: string[] }

export type SyncResultaat = { ok: boolean; alBezig?: boolean; fout?: string | null; kanalen: number; nieuw: number; beantwoordExtern: number; verlopen: number; fouten: { kanaal: string; fout: string }[] }

export async function draaiCommunitySync(): Promise<SyncResultaat> {
  const admin = createAdminSupabaseClient() as unknown as Admin
  const r: SyncResultaat = { ok: true, kanalen: 0, nieuw: 0, beantwoordExtern: 0, verlopen: 0, fouten: [] }
  if (!metricoolConfigured()) return { ...r, ok: false, fout: 'Metricool is niet ingesteld (METRICOOL_USER_TOKEN / METRICOOL_USER_ID).' }

  await admin.from('community_sync_runs').update({ klaar: new Date().toISOString(), fouten: [{ kanaal: '-', fout: 'Afgebroken (niet afgerond)' }] })
    .is('klaar', null).lt('gestart', new Date(Date.now() - DODE_RUN_NA_MS).toISOString())
  const { data: run, error: runErr } = await admin.from('community_sync_runs').insert({}).select('id').single()
  if (runErr) {
    if (/duplicate|unique|23505/i.test(runErr.message)) return { ...r, alBezig: true }
    return { ...r, ok: false, fout: runErr.message }
  }

  const start = Date.now()
  try {
    const { data: inst } = await admin.from('community_instellingen').select('client_id').eq('actief', true)
    const klanten = ((inst ?? []) as { client_id: string }[]).map((x) => x.client_id)
    if (klanten.length) {
      const { data: kn } = await admin.from('community_kanalen').select('id, client_id, naam, metricool_blog_id, netwerken')
        .eq('actief', true).in('client_id', klanten).order('laatst_gesynct', { ascending: true, nullsFirst: true })
      for (const k of (kn ?? []) as Kanaal[]) {
        if (Date.now() - start > TIJDSBUDGET_MS) break
        const s = await syncKanaal(admin, k)
        r.kanalen++; r.nieuw += s.nieuw; r.beantwoordExtern += s.beantwoordExtern
        if (s.fout) r.fouten.push({ kanaal: k.naam, fout: s.fout })
      }
    }
    r.verlopen = await markeerVerlopen(admin)
  } catch (e) {
    r.ok = false; r.fout = e instanceof Error ? e.message : 'fout'
  } finally {
    await admin.from('community_sync_runs').update({ klaar: new Date().toISOString(), nieuw: r.nieuw, fouten: r.fout ? [...r.fouten, { kanaal: '-', fout: r.fout }] : r.fouten }).eq('id', run.id)
  }
  return r
}

/** Eén kanaal (= één Metricool-merk) over al zijn netwerken. */
async function syncKanaal(admin: Admin, k: Kanaal): Promise<{ nieuw: number; beantwoordExtern: number; fout: string | null }> {
  const berichten: InboxBericht[] = []
  const alBeantwoord: { bron: 'comment' | 'dm'; id: string }[] = []
  const fouten: string[] = []
  for (const netwerk of k.netwerken ?? []) {
    let merkIds: string[] = []
    if ((COMMENT_NETWERKEN as readonly string[]).includes(netwerk)) {
      try {
        const c = await haalComments(k.metricool_blog_id, netwerk)
        berichten.push(...c.berichten); alBeantwoord.push(...c.alBeantwoord.map((id) => ({ bron: 'comment' as const, id })))
        merkIds = c.merkIds
      } catch (e) { fouten.push(`${netwerk} comments: ${e instanceof Error ? e.message : 'fout'}`) }
    }
    if ((DM_NETWERKEN as readonly string[]).includes(netwerk)) {
      try {
        const d = await haalGesprekken(k.metricool_blog_id, netwerk, merkIds)
        berichten.push(...d.berichten); alBeantwoord.push(...d.alBeantwoord.map((id) => ({ bron: 'dm' as const, id })))
      } catch (e) { fouten.push(`${netwerk} DM's: ${e instanceof Error ? e.message : 'fout'}`) }
    }
  }

  // Ook een fout bij het bewaren blijft bij dit kanaal; de andere kanalen gaan door.
  let nieuw = 0, beantwoordExtern = 0
  try { ({ nieuw, beantwoordExtern } = await bewaar(admin, k, berichten, alBeantwoord)) }
  catch (e) { fouten.push(`bewaren: ${e instanceof Error ? e.message : 'fout'}`) }
  const fout = fouten.length ? fouten.join(' · ').slice(0, 1000) : null
  await admin.from('community_kanalen').update({ laatst_gesynct: new Date().toISOString(), laatste_fout: fout }).eq('id', k.id)
  return { nieuw, beantwoordExtern, fout }
}

/** Upsert volgens de regels bovenaan. */
async function bewaar(admin: Admin, k: Kanaal, berichten: InboxBericht[], alBeantwoord: { bron: 'comment' | 'dm'; id: string }[]) {
  let nieuw = 0, beantwoordExtern = 0
  const nu = new Date().toISOString()
  const beantwoord = new Set(alBeantwoord.map((b) => `${b.bron}:${b.id}`))

  // Dubbels binnen één ophaling (zelfde id uit twee netwerken kan niet, maar wel bij herhaling) eruit.
  const uniek = new Map<string, InboxBericht>()
  for (const b of berichten) uniek.set(`${b.bron}:${b.extern_id}`, b)
  const lijst = [...uniek.values()]

  const bestaand = new Map<string, { id: string; tekst: string | null; status: string }>()
  for (let i = 0; i < lijst.length; i += 200) {
    const stuk = lijst.slice(i, i + 200)
    const { data, error } = await admin.from('community_berichten').select('id, bron, extern_id, tekst, status')
      .eq('kanaal_id', k.id).in('extern_id', stuk.map((b) => b.extern_id))
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as { id: string; bron: string; extern_id: string; tekst: string | null; status: string }[]) bestaand.set(`${r.bron}:${r.extern_id}`, r)
  }

  const nieuweRijen: Record<string, unknown>[] = []
  for (const b of lijst) {
    const sleutel = `${b.bron}:${b.extern_id}`
    const oud = bestaand.get(sleutel)
    if (!oud) {
      const extern = beantwoord.has(sleutel)
      nieuweRijen.push({
        client_id: k.client_id, kanaal_id: k.id, bron: b.bron, netwerk: b.netwerk, extern_id: b.extern_id, parent_extern_id: b.parent_extern_id,
        post_extern_id: b.post_extern_id, post_tekst: b.post_tekst, post_url: b.post_url, auteur_naam: b.auteur_naam, auteur_handle: b.auteur_handle,
        tekst: b.tekst, ontvangen_op: b.ontvangen_op, antwoord_mogelijk_tot: antwoordMogelijkTot(b.bron, b.netwerk, b.ontvangen_op), raw: b.raw,
        // Elke rij dezelfde kolommen: bij een bulk-insert vult PostgREST ontbrekende kolommen met NULL (geen default).
        status: extern ? 'verstuurd' : 'nieuw', verstuurd_door: extern ? EXTERN_VERSTUURD : null, verstuurd_op: extern ? nu : null,
      })
      continue
    }
    // Enkel de tekst (en raw) bijwerken, en enkel als die veranderde.
    if ((oud.tekst ?? '') !== (b.tekst ?? '')) {
      await admin.from('community_berichten').update({ tekst: b.tekst, raw: b.raw, bijgewerkt_op: nu }).eq('id', oud.id)
    }
  }
  for (let i = 0; i < nieuweRijen.length; i += 200) {
    const { data, error } = await admin.from('community_berichten')
      .upsert(nieuweRijen.slice(i, i + 200), { onConflict: 'kanaal_id,bron,extern_id', ignoreDuplicates: true }).select('id')
    if (error) throw new Error(error.message)
    nieuw += (data ?? []).length
  }

  // Het merk antwoordde zelf (bv. in Metricool): open berichten → verstuurd (extern).
  for (const bron of ['comment', 'dm'] as const) {
    const ids = alBeantwoord.filter((b) => b.bron === bron).map((b) => b.id)
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await admin.from('community_berichten')
        .update({ status: 'verstuurd', verstuurd_door: EXTERN_VERSTUURD, verstuurd_op: nu, bijgewerkt_op: nu })
        .eq('kanaal_id', k.id).eq('bron', bron).in('extern_id', ids.slice(i, i + 200)).in('status', [...OPEN_STATUSSEN, 'fout']).select('id')
      beantwoordExtern += (data ?? []).length
    }
  }
  return { nieuw, beantwoordExtern }
}

/** Open berichten waarvan de antwoordtermijn voorbij is. */
async function markeerVerlopen(admin: Admin): Promise<number> {
  const nu = new Date().toISOString()
  const { data } = await admin.from('community_berichten').update({ status: 'verlopen', bijgewerkt_op: nu })
    .in('status', OPEN_STATUSSEN).not('antwoord_mogelijk_tot', 'is', null).lt('antwoord_mogelijk_tot', nu).select('id')
  return (data ?? []).length
}
