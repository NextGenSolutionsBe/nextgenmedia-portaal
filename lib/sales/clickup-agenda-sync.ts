import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { haalSyncTaken, clickupConfigured, type SyncTaak } from '@/lib/clickup'
import { maakSubAgenda, schrijfTaakEvent, verwijderTaakEvent, lijstTaakEvents, type TaakEvent } from '@/lib/sales/google-calendar'
import { sendEmail } from '@/lib/email'

/**
 * ClickUp → Google Calendar, elke tien minuten.
 *
 * Waarom zelfgebouwd: het team plant alles in ClickUp, maar de setters boeken
 * op basis van de Google-agenda's. ClickUp's eigen synchronisatie kan niet
 * "taken van Bram → de agenda van Bram" — en zonder die koppeling ziet een
 * setter niet dat Bram bezet is, en ontstaat er een dubbele afspraak. Dat is
 * precies het scenario dat hier onmogelijk gemaakt wordt.
 *
 * De opzet:
 *  · per persoon (target) één eigen Google-agenda, bv. "Bram — ClickUp",
 *    die de sync bij de eerste run zelf aanmaakt en meteen als BLOKKEREND
 *    aanvinkt op alle boekagenda's van die persoon;
 *  · taken mét een uur worden een blok dat de agenda dichtzet; taken zonder
 *    uur (ClickUp zet die op 04:00) worden een dagvak dat NIET blokkeert;
 *  · taken die de app zelf aanmaakte bij het boeken slaan we over — die
 *    afspraak stáát al in de agenda, anders blokkeert alles dubbel;
 *  · elke run wordt gelogd (clickup_agenda_runs): de meldingen in de app en
 *    de waarschuwing in het boekscherm lezen daaruit, en bij een verse fout
 *    vertrekt er één mail — niet elke tien minuten opnieuw.
 */

const VENSTER_TERUG_MS = 24 * 3600 * 1000
const VENSTER_VOORUIT_MS = 60 * 24 * 3600 * 1000

/** Na zoveel minuten zonder geslaagde run is de sync "verouderd". */
export const SYNC_VEROUDERD_MIN = 30

/** Hoe vaak de (dure) wezenopruiming minstens moet draaien. */
const OPRUIM_INTERVAL_MIN = 10

type Target = {
  id: string
  clickup_assignee_id: number
  naam: string
  google_calendar_id: string | null
  bron_connection_id: string | null
  active: boolean
}

type Item = {
  id: string
  target_id: string
  clickup_task_id: string
  google_event_id: string
  vingerafdruk: string
}

const uurBrussel = new Intl.DateTimeFormat('nl-BE', {
  timeZone: 'Europe/Brussels', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
})
const datumBrussel = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
})

/**
 * Taak zonder uur? ClickUp heeft daar geen veld voor, maar zet zo'n taak
 * altijd op 04:00 lokale tijd (empirisch geverifieerd). Niemand plant echte
 * afspraken om 4 uur 's nachts, dus dit is een veilige herkenning.
 */
function zonderUur(t: SyncTaak): boolean {
  return t.startMs === null && uurBrussel.format(new Date(t.dueMs)) === '04:00:00'
}

function bouwEvent(t: SyncTaak, timezone: string): TaakEvent {
  const basis = {
    summary: t.naam,
    description: `ClickUp-taak${t.lijstNaam ? ` (${t.lijstNaam})` : ''}\n${t.url}`,
    timezone,
  }
  if (zonderUur(t)) {
    return { ...basis, heleDag: true, datum: datumBrussel.format(new Date(t.dueMs)) }
  }
  // Met uur: van start tot deadline. Geen starttijd = een half uur vóór de
  // deadline, zodat het blok zichtbaar én kort is.
  let start = t.startMs ?? t.dueMs - 30 * 60000
  if (start >= t.dueMs) start = t.dueMs - 30 * 60000
  return { ...basis, heleDag: false, startMs: start, endMs: t.dueMs }
}

const vingerafdruk = (t: SyncTaak): string =>
  `${t.naam}|${t.startMs ?? ''}|${t.dueMs}|${zonderUur(t)}`

export type SyncResultaat = {
  ok: boolean
  fout: string | null
  /** Er liep al een run; deze aanroep heeft niets gedaan. */
  alBezig?: boolean
  aangemaakt: number
  bijgewerkt: number
  verwijderd: number
  overgeslagen: number
  /** Heeft deze run ook de wezenopruiming gedaan? */
  opruiming?: boolean
}

export async function draaiClickupAgendaSync(): Promise<SyncResultaat> {
  const admin = createAdminSupabaseClient()

  // ── Runlock ────────────────────────────────────────────────────────────────
  // Er mag maar één run tegelijk lopen: twee overlappende runs zagen elkaars
  // administratie niet en zetten dezelfde taken dubbel in Google. Een partial
  // unique index (één open run) maakt de insert hieronder atomisch: wie de
  // rij niet krijgt, doet niets. Een run die ooit crashte zonder af te ronden
  // wordt eerst afgesloten, anders zou het slot eeuwig dicht blijven.
  await admin.from('clickup_agenda_runs')
    .update({ klaar: new Date().toISOString(), ok: false, fout: 'Afgebroken (niet afgerond binnen 5 minuten)' })
    .is('klaar', null)
    .lt('gestart', new Date(Date.now() - 5 * 60000).toISOString())

  const { data: runRij, error: runErr } = await admin.from('clickup_agenda_runs')
    .insert({}).select('id').single()
  if (runErr) {
    if (/duplicate|unique|23505/i.test(runErr.message)) {
      return { ok: true, fout: null, alBezig: true, aangemaakt: 0, bijgewerkt: 0, verwijderd: 0, overgeslagen: 0 }
    }
    return { ok: false, fout: runErr.message, aangemaakt: 0, bijgewerkt: 0, verwijderd: 0, overgeslagen: 0 }
  }
  const runId = (runRij as { id: string } | null)?.id

  const r: SyncResultaat = { ok: false, fout: null, aangemaakt: 0, bijgewerkt: 0, verwijderd: 0, overgeslagen: 0 }

  try {
    if (!clickupConfigured()) throw new Error('CLICKUP_API_KEY is niet ingesteld')

    const { data: targetData } = await admin.from('clickup_agenda_targets')
      .select('*').eq('active', true)
    const targets = ((targetData ?? []) as Target[]).filter((t) => t.bron_connection_id)
    if (targets.length === 0) throw new Error('Geen actieve synchronisatiedoelen (clickup_agenda_targets)')

    // Bootstrap: doelen zonder Google-agenda krijgen er één, en die agenda
    // gaat meteen als blokkerend op alle boekagenda's van die persoon.
    for (const t of targets) {
      if (t.google_calendar_id) continue
      const calId = await maakSubAgenda(t.bron_connection_id as string, t.naam)
      await admin.from('clickup_agenda_targets')
        .update({ google_calendar_id: calId, updated_at: new Date().toISOString() }).eq('id', t.id)
      t.google_calendar_id = calId

      const { data: conns } = await admin.from('sales_calendar_connections')
        .select('id, busy_calendar_ids')
        .eq('clickup_assignee_id', t.clickup_assignee_id).eq('active', true)
      for (const c of (conns ?? []) as { id: string; busy_calendar_ids: string[] | null }[]) {
        const huidige = Array.isArray(c.busy_calendar_ids) ? c.busy_calendar_ids : []
        if (!huidige.includes(calId)) {
          await admin.from('sales_calendar_connections')
            .update({ busy_calendar_ids: [...huidige, calId] }).eq('id', c.id)
        }
      }
    }

    const nu = Date.now()
    const taken = await haalSyncTaken(
      targets.map((t) => t.clickup_assignee_id), nu - VENSTER_TERUG_MS, nu + VENSTER_VOORUIT_MS,
    )

    // De afspraaktaken die de app zelf aanmaakte: overslaan, anders staat elke
    // geboekte afspraak dubbel (één keer echt, één keer als taakblok).
    const { data: eigenTaken } = await admin.from('sales_appointments')
      .select('clickup_task_id').not('clickup_task_id', 'is', null)
    const eigen = new Set(((eigenTaken ?? []) as { clickup_task_id: string }[]).map((x) => x.clickup_task_id))

    const { data: itemData } = await admin.from('clickup_agenda_items').select('*')
    const items = (itemData ?? []) as Item[]

    /**
     * Ruimt deze run ook wezen op?
     *
     * De opruiming doorloopt de volledige doelagenda's bij Google en is
     * daarmee het duurste deel van een run. Ze is een vangnet — voor events
     * van een run die halverwege afbrak — en geen dagelijkse noodzaak. Bij
     * een sync die elke minuut draait zou ze de kosten vertienvoudigen zonder
     * dat er iets mee opgelost wordt.
     *
     * Vandaar op tempo: minstens elke OPRUIM_INTERVAL_MIN minuten. Bewust
     * afgeleid uit de laatste geslaagde opruiming en niet uit de klok, zodat
     * een gemiste of trage run zichzelf inhaalt.
     */
    const { data: laatsteOpruiming } = await admin.from('clickup_agenda_runs')
      .select('gestart').eq('opruiming', true).eq('ok', true)
      .order('gestart', { ascending: false }).limit(1).maybeSingle()
    const opruimenNodig = !laatsteOpruiming
      || (Date.now() - new Date((laatsteOpruiming as { gestart: string }).gestart).getTime())
         > OPRUIM_INTERVAL_MIN * 60_000
    if (opruimenNodig) r.opruiming = true

    for (const target of targets) {
      const gewenst = new Map<string, SyncTaak>()
      for (const taak of taken) {
        if (!taak.assigneeIds.includes(target.clickup_assignee_id)) continue
        if (eigen.has(taak.id)) { r.overgeslagen++; continue }
        gewenst.set(taak.id, taak)
      }
      const bestaand = new Map(items.filter((i) => i.target_id === target.id).map((i) => [i.clickup_task_id, i]))

      // Nieuw of gewijzigd → schrijven.
      for (const [taskId, taak] of gewenst) {
        const item = bestaand.get(taskId)
        const vinger = vingerafdruk(taak)
        if (item && item.vingerafdruk === vinger) continue

        const eventId = await schrijfTaakEvent(
          target.bron_connection_id as string, target.google_calendar_id as string,
          item?.google_event_id ?? null, bouwEvent(taak, 'Europe/Brussels'), taskId,
        )
        if (item) {
          await admin.from('clickup_agenda_items').update({
            google_event_id: eventId, vingerafdruk: vinger, due_ms: taak.dueMs,
            updated_at: new Date().toISOString(),
          }).eq('id', item.id)
          r.bijgewerkt++
        } else {
          const { error: insErr } = await admin.from('clickup_agenda_items').insert({
            target_id: target.id, clickup_task_id: taskId,
            google_event_id: eventId, vingerafdruk: vinger, due_ms: taak.dueMs,
          })
          if (insErr) {
            // Toch een botsing (zou met het runlock niet meer mogen): dan is
            // het zonet gemaakte Google-event een wees — meteen opruimen.
            await verwijderTaakEvent(
              target.bron_connection_id as string, target.google_calendar_id as string, eventId,
            ).catch(() => { /* de opruimronde hieronder vangt hem anders */ })
          } else {
            r.aangemaakt++
          }
        }
      }

      // Verdwenen (afgewerkt, verwijderd, deadline weg of verschoven) → event
      // opruimen. Wat af is mag niemands agenda meer blokkeren.
      for (const [taskId, item] of bestaand) {
        if (gewenst.has(taskId)) continue
        await verwijderTaakEvent(
          target.bron_connection_id as string, target.google_calendar_id as string, item.google_event_id,
        )
        await admin.from('clickup_agenda_items').delete().eq('id', item.id)
        r.verwijderd++
      }

      /**
       * Wezenopruiming: de administratie (clickup_agenda_items) is de bron van
       * waarheid. Elk sync-event in de doelagenda dat daar niet in staat is
       * een wees — bv. van een run die halverwege afbrak. Zonder deze ronde
       * blijft zo'n dubbel blok eeuwig staan en lijkt de agenda voller dan
       * hij is. Enkel events mét ons waarmerk; handmatige items blijven staan.
       */
      if (!opruimenNodig) continue

      const geldig = new Set<string>()
      for (const [taskId2, taak2] of gewenst) {
        const rij = bestaand.get(taskId2)
        if (rij) geldig.add(rij.google_event_id)
        void taak2
      }
      // Vers aangemaakte events van déze run ook meerekenen.
      const { data: verseItems } = await admin.from('clickup_agenda_items')
        .select('google_event_id').eq('target_id', target.id)
      for (const v of (verseItems ?? []) as { google_event_id: string }[]) geldig.add(v.google_event_id)

      const inAgenda = await lijstTaakEvents(
        target.bron_connection_id as string, target.google_calendar_id as string, nu - VENSTER_TERUG_MS,
      )
      for (const ev of inAgenda) {
        if (geldig.has(ev.eventId)) continue
        await verwijderTaakEvent(
          target.bron_connection_id as string, target.google_calendar_id as string, ev.eventId,
        )
        r.verwijderd++
      }
    }

    r.ok = true
  } catch (e) {
    r.fout = e instanceof Error ? e.message : 'Onbekende fout'
  }

  if (runId) {
    await admin.from('clickup_agenda_runs').update({
      klaar: new Date().toISOString(), ok: r.ok, fout: r.fout,
      aangemaakt: r.aangemaakt, bijgewerkt: r.bijgewerkt,
      verwijderd: r.verwijderd, overgeslagen: r.overgeslagen,
      opruiming: !!r.opruiming,
    }).eq('id', runId)
  }

  // Eén alarmmail bij de OVERGANG goed → stuk, niet elke tien minuten opnieuw.
  if (!r.ok) {
    const { data: vorige } = await admin.from('clickup_agenda_runs')
      .select('ok').not('id', 'eq', runId ?? '').not('klaar', 'is', null)
      .order('gestart', { ascending: false }).limit(1).maybeSingle()
    const vorigeOk = (vorige as { ok: boolean | null } | null)?.ok
    if (vorigeOk !== false) {
      await sendEmail({
        to: 'info@nextgenmedia.be',
        subject: 'Let op: de ClickUp-agendasync is gestopt',
        text: [
          'De synchronisatie van ClickUp-taken naar Google Calendar is zonet MISLUKT.',
          '',
          `Fout: ${r.fout}`,
          '',
          'Zolang dit stuk is, zien de appointment setters niet wat er in ClickUp',
          'gepland staat — en kan er dubbel geboekt worden. Het boekscherm toont',
          'nu een waarschuwing.',
        ].join('\n'),
      }).catch(() => { /* het alarm mag zelf nooit een run laten klappen */ })
    }
  }

  return r
}

export type SyncGezondheid = {
  /** Is er überhaupt iets om te bewaken (actieve doelen)? */
  actief: boolean
  laatsteOkOp: string | null
  minutenSindsOk: number | null
  laatsteFout: string | null
  verouderd: boolean
}

/** Voor de meldingen en de waarschuwing in het boekscherm. */
export async function syncGezondheid(): Promise<SyncGezondheid> {
  const admin = createAdminSupabaseClient()
  const geen: SyncGezondheid = { actief: false, laatsteOkOp: null, minutenSindsOk: null, laatsteFout: null, verouderd: false }
  try {
    const { data: t } = await admin.from('clickup_agenda_targets').select('id').eq('active', true).limit(1)
    if (!t || t.length === 0) return geen

    const [{ data: ok }, { data: laatste }] = await Promise.all([
      admin.from('clickup_agenda_runs').select('gestart').eq('ok', true)
        .order('gestart', { ascending: false }).limit(1).maybeSingle(),
      admin.from('clickup_agenda_runs').select('ok, fout').not('klaar', 'is', null)
        .order('gestart', { ascending: false }).limit(1).maybeSingle(),
    ])
    const laatsteOkOp = (ok as { gestart: string } | null)?.gestart ?? null
    const minuten = laatsteOkOp ? Math.round((Date.now() - new Date(laatsteOkOp).getTime()) / 60000) : null
    return {
      actief: true,
      laatsteOkOp,
      minutenSindsOk: minuten,
      laatsteFout: (laatste as { ok: boolean; fout: string | null } | null)?.ok === false
        ? ((laatste as { fout: string | null }).fout ?? 'onbekende fout') : null,
      verouderd: minuten === null || minuten > SYNC_VEROUDERD_MIN,
    }
  } catch {
    // Tabellen nog niet gemigreerd → niets bewaken, niets tonen.
    return geen
  }
}
