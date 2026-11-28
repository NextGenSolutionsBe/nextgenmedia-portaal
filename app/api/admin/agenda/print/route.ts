import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { vandaag, plusDagen, zoneNaarIso, plaatsVan, isUuid, type Item } from '@/lib/agenda/model'
import { kijkerVan, laadZicht, metToegewezen, meetingsInBereik, itemsInBereik, alleRijen, ITEM_VELDEN, type RuwItem } from '@/lib/agenda/server'
import { maakTakenlijstPdf, type PdfRegel } from '@/lib/agenda/pdf'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * De takenlijst van een dag als pdf (?dag=JJJJ-MM-DD, standaard vandaag;
 * ?personen=<id>,<id> enkel hun taken; ?klaar=1 ook wat al afgevinkt is).
 * Zelfde zichtbaarheid als de agenda.
 */
export async function GET(req: NextRequest) {
  const persoon = await magIk('agenda', 'bekijken')
  if (!persoon) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const admin = createAdminSupabaseClient()
  const k = await kijkerVan(admin, persoon)
  if (!k) return NextResponse.json({ error: 'Je account is nog niet gekend in de agenda.' }, { status: 403 })
  const q = req.nextUrl.searchParams
  const d = /^\d{4}-\d{2}-\d{2}$/.test(q.get('dag') ?? '') ? q.get('dag')! : vandaag()
  const wie = (q.get('personen') ?? '').split(',').filter(isUuid).slice(0, 20)
  const metKlaar = q.get('klaar') === '1'
  const van = zoneNaarIso(d, '00:00'), tot = zoneNaarIso(plusDagen(d, 1), '00:00')
  const vroeger = zoneNaarIso(plusDagen(d, -60), '00:00')

  const magMeetings = !!(await magIk('meetings', 'bekijken')) || !!(await magIk('sales', 'bekijken'))
  const V = `"${vroeger}"`, D = `"${van}"`
  const [z, ruw, laat, dl, pers, lab] = await Promise.all([
    laadZicht(admin, k),
    itemsInBereik(admin, van, tot),
    // Wat nog open staat van de voorbije 60 dagen (einde of, zonder einde, de deadline).
    alleRijen<RuwItem>((a, b) => admin.from('ag_items').select(ITEM_VELDEN).is('verwijderd_op', null).eq('status', 'open').eq('soort', 'taak')
      .or(`and(eind_op.gte.${V},eind_op.lt.${D}),and(eind_op.is.null,deadline_op.gte.${V},deadline_op.lt.${D})`).order('id').range(a, b), 3000),
    // Deadlines van die dag, ook van taken die op een andere dag gepland staan.
    alleRijen<RuwItem>((a, b) => admin.from('ag_items').select(ITEM_VELDEN).is('verwijderd_op', null).eq('status', 'open')
      .gte('deadline_op', van).lt('deadline_op', tot).order('id').range(a, b), 1000),
    admin.from('ag_personen').select('id, naam, email'),
    admin.from('ag_labels').select('id, naam'),
  ])
  const personen = new Map(((pers.data ?? []) as { id: string; naam: string; email: string | null }[]).map((p) => [p.id, p]))
  const labels = new Map(((lab.data ?? []) as { id: string; naam: string }[]).map((l) => [l.id, l.naam]))
  const mt = magMeetings
    ? await meetingsInBereik(admin, van, tot, new Map([...personen.values()].filter((p) => p.email).map((p) => [p.email!.toLowerCase(), p.id])))
    : { items: [] as Item[], clickupIds: new Set<string>() }
  const metDeadline = [...ruw, ...dl.filter((r) => !ruw.some((x) => x.id === r.id))]
  const vandaagItems = [...await metToegewezen(admin, metDeadline.filter((r) => !r.clickup_id || !mt.clickupIds.has(r.clickup_id)), z), ...mt.items]
  const teLaatItems = await metToegewezen(admin, laat, z)
  const voorWie = (i: Item) => !wie.length || i.toegewezen.some((p) => wie.includes(p))

  const [{ data: lijsten }, { data: mappen }] = await Promise.all([
    admin.from('ag_lijsten').select('id, naam, map_id'),
    admin.from('ag_mappen').select('id, naam'),
  ])
  const lijstPer = new Map(((lijsten ?? []) as { id: string; naam: string; map_id: string | null }[]).map((l) => [l.id, l]))
  const mapPer = new Map(((mappen ?? []) as { id: string; naam: string }[]).map((m) => [m.id, m.naam]))
  const regel = (i: Item): PdfRegel => {
    const l = i.lijst_id ? lijstPer.get(i.lijst_id) : null
    return {
      item: i,
      pad: l ? [l.map_id ? mapPer.get(l.map_id) : null, l.naam].filter(Boolean).join(' › ') : '',
      wie: i.toegewezen.map((p) => personen.get(p)?.naam.split(' ')[0] ?? '').filter(Boolean),
      labels: i.labels.map((x) => labels.get(x) ?? '').filter(Boolean),
    }
  }
  const sorteer = (a: Item, b: Item) => Number(b.urgent) - Number(a.urgent) || (a.start_op ?? a.eind_op ?? '').localeCompare(b.start_op ?? b.eind_op ?? '') || a.titel.localeCompare(b.titel)
  const dezeDag = vandaagItems.filter(voorWie)
  // Deadlines bovenaan, op uur. Wat daar staat, staat niet nog eens bij de afspraken of taken.
  const deadlines = dezeDag.filter((i) => i.status === 'open' && i.deadline_op && Date.parse(i.deadline_op) >= Date.parse(van) && Date.parse(i.deadline_op) < Date.parse(tot))
    .sort((a, b) => a.deadline_op!.localeCompare(b.deadline_op!) || a.titel.localeCompare(b.titel))
  const isDeadline = new Set(deadlines.map((i) => i.id))
  const afspraken = dezeDag.filter((i) => !isDeadline.has(i.id) && plaatsVan(i)?.soort === 'rooster' && (i.status === 'open' || i.soort === 'meeting')).sort((a, b) => (a.start_op ?? a.eind_op ?? '').localeCompare(b.start_op ?? b.eind_op ?? ''))
  const taken = dezeDag.filter((i) => !isDeadline.has(i.id) && plaatsVan(i)?.soort === 'dag' && i.status === 'open').sort(sorteer)
  const klaar = metKlaar ? dezeDag.filter((i) => i.status === 'klaar' && i.soort !== 'meeting').sort(sorteer) : []
  const teLaat = teLaatItems.filter(voorWie).sort((a, b) => (a.eind_op ?? a.deadline_op ?? '').localeCompare(b.eind_op ?? b.deadline_op ?? '')).slice(0, 60)

  const namen = wie.map((p) => personen.get(p)?.naam).filter(Boolean)
  const bytes = await maakTakenlijstPdf({
    dag: d, voor: namen.length ? `Voor ${namen.join(', ')}` : 'Voor iedereen',
    deadlines: deadlines.map(regel), afspraken: afspraken.map(regel), taken: taken.map(regel), teLaat: teLaat.map(regel), klaar: klaar.map(regel),
  })
  return new NextResponse(Buffer.from(bytes), {
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="takenlijst-${d}.pdf"`, 'Cache-Control': 'no-store' },
  })
}
