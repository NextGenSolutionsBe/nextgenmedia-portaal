import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { loadCore, readPeriodParams } from '@/lib/finance-data'
import { berekenVesting, leesInstellingen } from '@/lib/vesting'
import { statsFor, payoutsFor, monthPeriod } from '@/lib/sales/setters'
import { laadStatistieken } from '@/lib/sales/statistieken-data'
import { financienWerkmap } from '@/lib/excel/rapporten/financien'
import { vestingWerkmap } from '@/lib/excel/rapporten/vesting'
import { resultatenWerkmap } from '@/lib/excel/rapporten/resultaten'
import { statistiekenWerkmap } from '@/lib/excel/rapporten/statistieken'
import { naarContract, naarWam, naarKost, naarTermijn } from '@/lib/vesting-rijen'
import { directeKostenVoorContracten, directeKostenPerJaar } from '@/lib/facturen/kosten-data'
import { schrijfWerkmap } from '@/lib/excel/xlsx-schrijf'
import { xlsxAntwoord } from '@/lib/excel/antwoord'
import type { Werkmap, Blad } from '@/lib/excel/spec'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * De algemene export: alle financiële dashboards in één werkmap, elk als
 * eigen (groep) werkblad(en), plus één samenvattend blad. Zelfde rekenkernen
 * als de schermen: loadCore (Financiën), berekenVesting (Vesting), statsFor /
 * payoutsFor (Resultaten), laadStatistieken (Statistieken). Admin-only, want
 * Vesting en Financiën zijn dat ook.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sp = Object.fromEntries(req.nextUrl.searchParams.entries())
    const { year, period, quarter, month } = readPeriodParams(sp)
    const admin = createAdminSupabaseClient()
    const nu = new Date()

    const [core, inst, contracten, wam, kosten, termijnen, stats, payouts, statistieken] = await Promise.all([
      loadCore(year),
      admin.from('vesting_instellingen').select('*').eq('id', 1).maybeSingle(),
      admin.from('vesting_contracten').select('*').order('ondertekend_op').order('nr'),
      admin.from('vesting_wam').select('*').order('nr'),
      admin.from('vesting_wam_kosten').select('*').order('datum'),
      admin.from('vesting_wam_termijnen').select('*').order('factuurdatum').order('volgnr'),
      statsFor(monthPeriod(nu)).catch(() => []),
      payoutsFor(nu).catch(() => []),
      laadStatistieken({ periode: { van: new Date(year, 0, 1), tot: new Date(year, 11, 31, 23, 59, 59) } }).catch(() => null),
    ])

    let kostenlaag = null
    try { kostenlaag = await directeKostenPerJaar(admin, year) } catch { kostenlaag = null }
    const delen: Werkmap[] = [financienWerkmap({ core, year, period, quarter, month, kosten: kostenlaag })]

    const instellingen = leesInstellingen((inst.data ?? null) as Record<string, unknown> | null)
    const wamKosten = ((kosten.data ?? []) as Record<string, unknown>[]).map(naarKost)
    let contractRijen = (contracten.data ?? []) as Record<string, unknown>[]
    try {
      const ids = Array.from(new Set(contractRijen.map((r) => r.contract_id).filter(Boolean))) as string[]
      const kosten = await directeKostenVoorContracten(admin, ids)
      contractRijen = contractRijen.map((r) => { const k = r.contract_id ? kosten.get(String(r.contract_id)) : undefined; return k ? { ...r, directe_kosten_facturen: k.directeKosten, kostenstatus_facturen: k.status, facturen_gekoppeld: k.aantalFacturen } : r })
    } catch { }
    const v = berekenVesting(
      contractRijen.map(naarContract),
      ((wam.data ?? []) as Record<string, unknown>[]).map(naarWam),
      wamKosten, instellingen,
      ((termijnen.data ?? []) as Record<string, unknown>[]).map(naarTermijn),
    )
    delen.push(vestingWerkmap({ v, inst: instellingen, kosten: wamKosten }))

    const maandParam = `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-01`
    delen.push(resultatenWerkmap({ monthParam: maandParam, stats, payouts, isAdmin: true }))
    if (statistieken) {
      delen.push(statistiekenWerkmap({ stats: statistieken.stats, bereik: { van: `${year}-01-01`, tot: `${year}-12-31` }, isAdmin: true }))
    }

    // Eén werkmap: bladen krijgen een voorvoegsel per dashboard zodat de namen uniek en herkenbaar blijven.
    const voorvoegsel = ['Fin', 'Vest', 'Res', 'Stat']
    const bladen: Blad[] = delen.flatMap((d, i) => d.bladen.map((b) => ({ ...b, naam: `${voorvoegsel[i]} · ${b.naam}`, titel: `${d.titel} — ${b.titel}` })))
    const inhoud: Blad = {
      naam: 'Inhoud', titel: `NextGenMedia — algemene export ${year}`,
      toelichting: ['Elk dashboard staat in zijn eigen werkbladen. Formules verwijzen binnen hun eigen dashboard.'],
      blokken: [{
        soort: 'tabel', titel: 'Werkbladen', filter: false,
        kolommen: [{ kop: 'Dashboard' }, { kop: 'Werkblad' }, { kop: 'Inhoud' }],
        rijen: delen.flatMap((d, i) => d.bladen.map((b) => [d.titel, `${voorvoegsel[i]} · ${b.naam}`, b.titel])),
      }, {
        soort: 'kpis', titel: 'Kerncijfers',
        items: [
          { label: `Omzet boekjaar ${year}`, waarde: { v: core.omzetFY, stijl: 'euro' } },
          { label: `Kosten boekjaar ${year}`, waarde: { v: core.kostenManualFY + core.socialAsCostFY + core.setterCostFY, stijl: 'euro' } },
          { label: 'Marco voorlopig (vesting)', waarde: { v: v.marcoVoorlopig, stijl: 'pct' } },
          { label: 'WAM effectief ontvangen', waarde: { v: v.wam.nettoOntvangen, stijl: 'euro' } },
          { label: 'Gesprekken dit jaar', waarde: { v: statistieken?.stats.team.telefoongesprekken ?? 0, stijl: 'aantal' } },
          { label: 'Afspraken dit jaar', waarde: { v: statistieken?.stats.team.afspraken ?? 0, stijl: 'aantal' } },
        ],
      }],
    }

    // Verwijzingen tussen bladen in de deelrapporten gebruiken de OORSPRONKELIJKE
    // bladnamen; die bladen zijn hernoemd. Herschrijf de formules mee.
    const hernoem = new Map<string, string>()
    delen.forEach((d, i) => d.bladen.forEach((b) => hernoem.set(b.naam, `${voorvoegsel[i]} · ${b.naam}`)))
    const herschrijf = (f: string) => f.replace(/'([^']+)'!/g, (m, naam: string) => (hernoem.has(naam) ? `'${hernoem.get(naam)!.replace(/'/g, "''")}'!` : m))
    for (const b of bladen) {
      for (const blok of b.blokken) {
        if (blok.soort === 'tabel') {
          for (const r of blok.rijen) r.forEach((c, i) => { if (c && typeof c === 'object' && 'f' in c) r[i] = { ...c, f: herschrijf(c.f) } })
          blok.totaal?.forEach((c, i) => { if (c && typeof c === 'object' && 'f' in c) blok.totaal![i] = { ...c, f: herschrijf(c.f) } })
        } else if (blok.soort === 'kpis') {
          for (const it of blok.items) if (it.waarde && typeof it.waarde === 'object' && 'f' in it.waarde) it.waarde = { ...it.waarde, f: herschrijf(it.waarde.f) }
        }
      }
    }

    const werkmap: Werkmap = {
      bestandsnaam: 'NextGenMedia_Dashboard_Export', titel: `Algemene export ${year}`,
      filters: [{ label: 'Boekjaar', waarde: String(year) }, { label: 'Resultaten', waarde: `maand ${maandParam.slice(0, 7)}` }, { label: 'Statistieken', waarde: `${year}-01-01 t.e.m. ${year}-12-31` }],
      bladen: [inhoud, ...bladen],
    }
    const uit = schrijfWerkmap(werkmap)

    const meta = requestMeta(req)
    await logAudit({
      action: 'export.xlsx', entityType: 'export', entityId: null,
      summary: `Excel-export: ${uit.bestandsnaam} (algemeen, ${werkmap.bladen.length} bladen)`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    return xlsxAntwoord(uit.buffer, uit.bestandsnaam, uit.mime)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
