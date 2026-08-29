import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'

/**
 * De twee merken waarvoor onze setters bellen: NextGenMedia en
 * NextGenSolutions. Elke lead hoort bij één merk, en de afspraak erft dat —
 * daar hangen de juiste brochure en afzender aan vast.
 *
 * De agenda's van Bram en Marco staan hier bewust BUITEN: die zijn gedeeld.
 * Zouden beide merken hun eigen agenda's hebben, dan kon dezelfde persoon voor
 * het ene merk geboekt worden op een uur dat voor het andere al bezet is.
 */

export type SalesPipeline = {
  id: string
  key: string
  name: string
  position: number
  reminder_enabled: boolean
  brochure_url: string | null
  brochure_filename: string | null
  reminder_from: string | null
  reminder_reply_to: string | null
  /** ClickUp-lijst ("agenda") van dit merk: hier komen de afspraaktaken in. */
  clickup_list_id?: string | null
  /** Intern adres dat bij elke nieuw geboekte afspraak een melding krijgt. */
  notify_email?: string | null
  /** Vaste closer van dit merk: de agenda die het boekscherm klaarzet. */
  default_calendar_id?: string | null
}

type Seed = {
  key: string; name: string; position: number; brochure_filename: string
  /** Vast afzenderadres van dit merk. Leeg = de algemene afzender (EMAIL_FROM). */
  from: string | null
  /** Waar de interne "nieuwe afspraak"-melding van dit merk heen gaat. */
  notify: string | null
}

const SEED: Seed[] = [
  {
    key: 'nextgenmedia', name: 'NextGenMedia', position: 1,
    brochure_filename: 'Kennismaking_NextGenMedia.pdf',
    // Leeg: dit merk volgt de algemene afzender uit de omgeving.
    from: null,
    notify: 'info@nextgenmedia.be',
  },
  {
    key: 'nextgensolutions', name: 'NextGenSolutions', position: 2,
    brochure_filename: 'Kennismaking_NextGenSolutions.pdf',
    from: 'NextGenSolutions <info@nextgensolutions.be>',
    notify: 'info@nextgensolutions.be',
  },
]

/**
 * Het afzenderadres dat voor dit merk geldt als er niets anders ingesteld is.
 * Hierdoor vertrekt alles van NextGenSolutions vanzelf van info@nextgensolutions.be,
 * zonder dat iemand dat veld moet invullen.
 */
export function defaultFromFor(pipelineKey: string | null | undefined): string | null {
  return SEED.find((s) => s.key === pipelineKey)?.from ?? null
}

/**
 * Beide pipelines ophalen; ontbreken ze, dan worden ze aangemaakt met de
 * brochure die in /public/brochures staat. Idempotent.
 */
export async function listPipelines(): Promise<SalesPipeline[]> {
  const admin = createAdminSupabaseClient()
  const org = await getOrCreateSalesOrg()

  const { data } = await admin.from('sales_pipelines')
    .select('*').eq('sales_client_id', org.id).order('position')
  let rows = (data ?? []) as SalesPipeline[]

  const missing = SEED.filter((s) => !rows.some((r) => r.key === s.key))
  if (missing.length > 0) {
    const zaai = (metNotify: boolean) => admin.from('sales_pipelines').upsert(
      missing.map((s) => ({
        sales_client_id: org.id,
        key: s.key, name: s.name, position: s.position,
        brochure_filename: s.brochure_filename,
        reminder_from: s.from,
        // Het meldingsadres hoort bij de AANMAAK, niet bij een backfill-lus:
        // een lus die elke lege waarde opnieuw vult, maakt "leeg = geen
        // melding" (de belofte in de instellingen) voorgoed onmogelijk.
        ...(metNotify ? { notify_email: s.notify } : {}),
        // Relatief pad: de brochure wordt bij verzenden pas tot een volledige
        // URL gemaakt, zodat een domeinwissel niets breekt.
        brochure_url: `/brochures/${s.brochure_filename}`,
      })),
      { onConflict: 'sales_client_id,key' },
    )
    // Kolom notify_email nog niet gemigreerd? Dan zonder — de pipelines zelf
    // mogen daar nooit op stuklopen.
    const { error: zaaiErr } = await zaai(true)
    if (zaaiErr && /notify_email|PGRST204|schema cache/i.test(zaaiErr.message)) await zaai(false)
    const { data: again } = await admin.from('sales_pipelines')
      .select('*').eq('sales_client_id', org.id).order('position')
    rows = (again ?? []) as SalesPipeline[]

    // Leads van vóór deze opsplitsing hebben nog geen merk. Zonder dit zouden
    // ze in geen van beide lijsten verschijnen — dus zetten we ze eenmalig in
    // de eerste pipeline. Raakt alleen rijen die nog leeg zijn.
    const first = rows[0]
    if (first) {
      await admin.from('sales_leads')
        .update({ pipeline_id: first.id })
        .eq('sales_client_id', org.id).is('pipeline_id', null)
    }
    // Bestaande AFSPRAKEN krijgen bewust géén merk: die zijn geboekt vóór de
    // herinneringsmail bestond, en zo vertrekt er met terugwerkende kracht
    // niets naar een prospect.
  }
  // Een leeg afzenderveld eenmalig aanvullen met het vaste adres van dat merk.
  // Staat BEWUST buiten het blok hierboven: bij een bestaande installatie
  // ontbreekt er niets, en dan zou deze aanvulling nooit gebeuren. Wat iemand
  // zelf ingevuld heeft blijft ongemoeid — enkel lege velden worden gevuld.
  for (const seed of SEED) {
    const row = rows.find((r) => r.key === seed.key)
    if (!row) continue
    if (seed.from && !row.reminder_from) {
      await admin.from('sales_pipelines')
        .update({ reminder_from: seed.from }).eq('id', row.id).is('reminder_from', null)
      row.reminder_from = seed.from
    }
    // Het meldingsadres wordt hier BEWUST niet aangevuld: wie het veld leegt,
    // kiest "geen melding" — en dat moet leeg blijven. De beginwaarde komt bij
    // de aanmaak mee (zie de zaai hierboven).
  }

  return rows
}

/** Eén pipeline op id — en meteen de controle dat hij van ons is. */
export async function getPipeline(id: string): Promise<SalesPipeline | null> {
  if (!id) return null
  const all = await listPipelines()
  return all.find((p) => p.id === id) ?? null
}

/**
 * De pipeline die gebruikt wordt als er geen keuze is meegegeven. Bewust de
 * eerste (NextGenMedia) i.p.v. een fout: een lead zonder merk is erger dan een
 * lead in het verkeerde merk, want dat laatste zie je meteen op het scherm.
 */
export async function defaultPipelineId(): Promise<string> {
  const all = await listPipelines()
  return all[0]?.id ?? ''
}
