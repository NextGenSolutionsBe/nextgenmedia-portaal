import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { BdaClient, bdaConfigured } from '@/lib/aanbestedingen/bda'
import { bewaarOpdrachten } from '@/lib/aanbestedingen/store'
import { scoreWorkspace } from '@/lib/aanbestedingen/score'
import { analyseerWorkspace } from '@/lib/aanbestedingen/analyse'
import { mailWorkspace } from '@/lib/aanbestedingen/mail'
import { startRun, updateRun, isGeannuleerd, rondAf } from '@/lib/aanbestedingen/runs'
import type { Workspace } from '@/lib/aanbestedingen/workspaces'

/**
 * De automatische ronde: ophalen → beoordelen → uitwerken → mailen.
 *
 * Dit is de enige plek waar geld wordt uitgegeven zonder dat iemand op een knop
 * duwt, dus de remmen staan strak:
 *  • enkel workspaces met auto_enabled aan, op een gekozen dag, na het gekozen uur;
 *  • hoogstens één keer per dag per workspace (auto_laatste_run);
 *  • het uitwerken blijft binnen ai_top_x en de mail-drempel van de workspace;
 *  • een wandkloklimiet, zodat de serverfunctie niet halverwege afgekapt wordt.
 *
 * OVER HET UUR — Vercel laat op dit plan alleen dagelijkse schema's toe. Er
 * draaien daarom twee vaste momenten (zie vercel.json) en `auto_uur` betekent
 * "niet vóór dit uur". Een workspace ingesteld op 14u draait dus in de
 * namiddagronde, niet om klokslag twee.
 */

/** Tijdbudget per aanroep. De serverfunctie stopt na vijf minuten; we ronden
 *  ruim daarvoor af zodat de laatste stap nog netjes wordt weggeschreven. */
const BUDGET_MS = 4 * 60 * 1000

export type AutoResultaat = {
  bekeken: number
  gedraaid: { naam: string; resultaat: string }[]
  overgeslagen: { naam: string; reden: string }[]
}

/** Dag (1=ma…7=zo) en uur in Belgische tijd, ongeacht waar de server staat. */
export function belgischeDagEnUur(nu = new Date()): { dag: number; uur: number; datum: string } {
  const fmt = new Intl.DateTimeFormat('nl-BE', {
    timeZone: 'Europe/Brussels',
    weekday: 'short', hour: '2-digit', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const delen = Object.fromEntries(fmt.formatToParts(nu).map((p) => [p.type, p.value]))
  const kort = String(delen.weekday ?? '').toLowerCase().slice(0, 2)
  const dagen: Record<string, number> = { ma: 1, di: 2, wo: 3, do: 4, vr: 5, za: 6, zo: 7 }
  return {
    dag: dagen[kort] ?? 0,
    uur: Number(delen.hour ?? 0),
    datum: `${delen.year}-${delen.month}-${delen.day}`,
  }
}

/** Moet deze workspace nu draaien? Geeft de reden terug als het antwoord nee is. */
export function moetDraaien(
  ws: { auto_enabled: boolean; auto_dagen: number[]; auto_uur: number; auto_laatste_run?: string | null },
  nu = new Date(),
): { ja: true } | { ja: false; reden: string } {
  if (!ws.auto_enabled) return { ja: false, reden: 'automatisch staat uit' }
  const { dag, uur, datum } = belgischeDagEnUur(nu)
  if (!(ws.auto_dagen ?? []).includes(dag)) return { ja: false, reden: 'niet op deze dag ingesteld' }
  if (uur < ws.auto_uur) return { ja: false, reden: `pas vanaf ${ws.auto_uur}u` }
  if (ws.auto_laatste_run === datum) return { ja: false, reden: 'vandaag al gedraaid' }
  return { ja: true }
}

/** Eén workspace door de hele keten. */
async function draaiWorkspace(ws: Workspace, deadline: number): Promise<string> {
  const admin = createAdminSupabaseClient()
  const runId = await startRun(ws.id, 'ophalen', 'Automatische ronde…', 'automatisch')
  const stoppen = async () => Date.now() > deadline || await isGeannuleerd(runId)
  const delen: string[] = []

  try {
    // 1. Ophalen. Kost niets, dus dit gebeurt altijd.
    if (bdaConfigured()) {
      const client = new BdaClient()
      const { records } = await client.alleOpdrachten(ws.short_link, {
        includeClosed: ws.include_closed,
        stoppen,
        onPage: async (n, t) => updateRun(runId, {
          stap_nu: n, stap_totaal: t, omschrijving: `${n} van ${t} opgehaald…`,
        }),
      })
      const res = await bewaarOpdrachten(ws.id, records)
      delen.push(`${res.nieuw} nieuw van ${res.totaal}`)
    } else {
      delen.push('niet opgehaald (geen BDA-sleutel)')
    }

    // 2. Beoordelen.
    if (!await stoppen()) {
      await updateRun(runId, { fase: 'scoren', omschrijving: 'Beoordelen…' })
      const s = await scoreWorkspace(ws.id, {
        stoppen,
        onVoortgang: async (n, t) => updateRun(runId, {
          stap_nu: n, stap_totaal: t, omschrijving: `${n} van ${t} beoordeeld…`,
        }),
      })
      delen.push(`${s.gescoord} beoordeeld`)
    }

    // 3. Uitwerken.
    if (!await stoppen()) {
      await updateRun(runId, { fase: 'analyseren', omschrijving: 'Dossiers uitwerken…' })
      const a = await analyseerWorkspace(ws, {
        stoppen,
        onVoortgang: async (n, t, wat) => updateRun(runId, {
          stap_nu: n, stap_totaal: t, omschrijving: wat ? `${n + 1}/${t}: ${wat.slice(0, 100)}` : '',
        }),
      })
      delen.push(`${a.geanalyseerd} uitgewerkt · $${a.kost_usd.toFixed(2)}`)
    }

    // 4. Mailen. Ook als het budget op is: wat er wél uitgewerkt is mag niet
    // een dag blijven liggen omdat de rest niet meer paste.
    await updateRun(runId, { fase: 'mailen', omschrijving: 'Mail versturen…' })
    const m = await mailWorkspace(ws)
    delen.push(m.fout
      ? `MAIL MISLUKT: ${m.fout}`
      : m.verstuurd ? `gemaild over ${m.kandidaten} naar ${m.ontvangers.join(', ')}` : 'niets te melden')

    // Pas nu de dag noteren. Klapt er iets vóór dit punt, dan mag de volgende
    // ronde het vandaag nog eens proberen.
    const { datum } = belgischeDagEnUur()
    await admin.from('aanbestedingen_filters').update({ auto_laatste_run: datum }).eq('id', ws.id)

    const resultaat = delen.join(' · ')
    await rondAf(runId, 'klaar', resultaat)
    return resultaat
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'onbekende fout'
    await rondAf(runId, 'mislukt', msg)
    return `MISLUKT: ${msg}`
  }
}

/** Alle workspaces die nu aan de beurt zijn. */
export async function automatischeRonde(nu = new Date()): Promise<AutoResultaat> {
  const admin = createAdminSupabaseClient()
  const uit: AutoResultaat = { bekeken: 0, gedraaid: [], overgeslagen: [] }
  const deadline = Date.now() + BUDGET_MS

  const { data } = await admin.from('aanbestedingen_filters').select('*').order('naam')
  const workspaces = (data ?? []) as (Workspace & { auto_laatste_run: string | null })[]
  uit.bekeken = workspaces.length

  for (const ws of workspaces) {
    const beslissing = moetDraaien(ws, nu)
    if (!beslissing.ja) {
      uit.overgeslagen.push({ naam: ws.naam, reden: beslissing.reden })
      continue
    }
    if (Date.now() > deadline) {
      // Niet stilzwijgend laten vallen: dan lijkt het alsof er niets te doen was.
      uit.overgeslagen.push({ naam: ws.naam, reden: 'geen tijd meer deze ronde' })
      continue
    }
    uit.gedraaid.push({ naam: ws.naam, resultaat: await draaiWorkspace(ws, deadline) })
  }

  return uit
}
