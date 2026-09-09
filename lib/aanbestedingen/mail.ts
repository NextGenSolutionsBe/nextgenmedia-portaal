import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail, baseUrl, EMAIL_FROM } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { ontvangersVoor, type Workspace } from '@/lib/aanbestedingen/workspaces'

/**
 * Het signaal: "hier is iets waar we op moeten inschrijven."
 *
 * Eén mail per workspace met alles wat nieuw en interessant is, niet één mail
 * per opdracht. Bij vijftien treffers op een ochtend wil niemand vijftien
 * mails; dan wordt het ruis en kijkt niemand er nog naar.
 *
 * Wie hem krijgt bepaalt lib/aanbestedingen/workspaces.ts: de gekoppelde
 * werknemer, of anders de beheerders. Afzender is altijd info@nextgenmedia.be.
 *
 * Er wordt NOOIT twee keer over dezelfde opdracht gemaild: `gemaild_op` wordt
 * gezet zodra de mail vertrokken is. Mislukt het verzenden, dan blijft dat veld
 * leeg en probeert de volgende run het opnieuw.
 */

export type MailKandidaat = {
  referentienummer: string
  titel: string | null
  organisatie: string | null
  uiterste_indieningsdatum: string | null
  uiterste_indieningsdatum_raw: string | null
  score: number
  volledig: boolean
  kwalificatie_reden: string | null
  prijs_bedrag: number | null
}

export type MailResultaat = {
  kandidaten: number
  verstuurd: boolean
  ontvangers: string[]
  fout?: string
}

/** Wat is nieuw, interessant genoeg, en nog niet gemeld? */
export async function mailKandidaten(ws: Workspace): Promise<MailKandidaat[]> {
  const admin = createAdminSupabaseClient()

  const { data: analyses } = await admin
    .from('aanbesteding_analyse')
    .select('referentienummer, score, volledig, kwalificatie_reden, prijs_bedrag')
    .eq('filter_id', ws.id)
    .gte('score', ws.mail_drempel)
    .is('gemaild_op', null)
    .order('score', { ascending: false })
    .limit(50)

  const rijen = (analyses ?? []) as {
    referentienummer: string; score: number; volledig: boolean
    kwalificatie_reden: string | null; prijs_bedrag: number | null
  }[]
  if (rijen.length === 0) return []

  const { data: opdrachten } = await admin
    .from('aanbestedingen')
    .select('referentienummer, titel, organisatie, uiterste_indieningsdatum, uiterste_indieningsdatum_raw')
    .eq('filter_id', ws.id)
    .eq('ingediend', false)
    .eq('genegeerd', false)
    .neq('record_status', 'verdwenen')
    .in('referentienummer', rijen.map((r) => r.referentienummer))

  const perRef = new Map(
    ((opdrachten ?? []) as { referentienummer: string }[]).map((o) => [o.referentienummer, o]),
  )

  const nu = Date.now()
  return rijen
    .filter((r) => perRef.has(r.referentienummer))
    .map((r) => ({ ...r, ...perRef.get(r.referentienummer) } as MailKandidaat))
    // Een opdracht waarvan de deadline al voorbij is heeft geen zin meer.
    .filter((k) => !k.uiterste_indieningsdatum || new Date(k.uiterste_indieningsdatum).getTime() >= nu)
}

const dagenTot = (iso: string | null) =>
  iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000) : null

function tekstVoor(ws: Workspace, lijst: MailKandidaat[]): string {
  const regels = lijst.map((k) => {
    const d = dagenTot(k.uiterste_indieningsdatum)
    const deel = [
      `${k.score}/100 — ${k.titel ?? k.referentienummer}`,
      k.organisatie ? `  ${k.organisatie}` : '',
      k.uiterste_indieningsdatum_raw
        ? `  Indienen vóór ${k.uiterste_indieningsdatum_raw}${d != null ? ` (nog ${d} dag${d === 1 ? '' : 'en'})` : ''}`
        : '',
      k.kwalificatie_reden ? `  ${k.kwalificatie_reden}` : '',
      // Geen prijs is óók informatie, en verklaart meteen waarom er geen staat.
      k.volledig
        ? (k.prijs_bedrag != null
          ? `  Voorstel: € ${Number(k.prijs_bedrag).toLocaleString('nl-BE')}`
          : '  Dossier uitgewerkt, nog geen prijs (vul de tarieven aan in de kennisbank)')
        : '  Enkel voorgeselecteerd — het bestek is hier nog niet voor gelezen',
    ].filter(Boolean)
    return deel.join('\n')
  })

  const kop = lijst.length === 1
    ? 'Er is één overheidsopdracht die bij ons past.'
    : `Er zijn ${lijst.length} overheidsopdrachten die bij ons passen.`

  return [
    kop,
    '',
    regels.join('\n\n'),
    '',
    'Alles staat klaar in het portaal, met de criteria, de gevraagde documenten en een checklist per dossier.',
    '',
    'Dit is een voorstel, geen offerte. Reken de prijs na en lees het bestek zelf vóór je indient.',
  ].join('\n')
}

/**
 * De mail versturen voor één workspace. Geeft terug wat er gebeurd is; er wordt
 * niets stilzwijgend overgeslagen.
 */
export async function mailWorkspace(ws: Workspace): Promise<MailResultaat> {
  const lijst = await mailKandidaten(ws)
  if (lijst.length === 0) return { kandidaten: 0, verstuurd: false, ontvangers: [] }

  const ontvangers = await ontvangersVoor(ws)
  if (ontvangers.length === 0) {
    // Kan in principe niet — getAdminEmails valt terug op info@nextgenmedia.be —
    // maar stil niets doen zou hier het ergste zijn wat er kan gebeuren.
    return { kandidaten: lijst.length, verstuurd: false, ontvangers: [], fout: 'Geen ontvangers gevonden.' }
  }

  const bodyText = tekstVoor(ws, lijst)
  const link = `${baseUrl()}/admin/aanbestedingen/${ws.id}`
  const onderwerp = lijst.length === 1
    ? `Aanbesteding: ${lijst[0].titel ?? lijst[0].referentienummer}`
    : `${lijst.length} aanbestedingen — ${ws.naam}`

  const res = await sendEmail({
    to: ontvangers,
    subject: onderwerp,
    text: buildEmailText({ bodyText, ctaText: 'Bekijk de dossiers', ctaLink: link }),
    html: buildEmailHtml({ bodyText, ctaText: 'Bekijk de dossiers', ctaLink: link }),
    // Altijd vanaf ons eigen adres; dit gaat naar onszelf, niet naar een klant.
    from: EMAIL_FROM,
  })

  if (!res.ok) return { kandidaten: lijst.length, verstuurd: false, ontvangers, fout: res.error }

  // Pas markeren ná een geslaagde verzending. Andersom zou één mislukte mail
  // betekenen dat je die opdrachten nooit meer te zien krijgt.
  const admin = createAdminSupabaseClient()
  const { error } = await admin
    .from('aanbesteding_analyse')
    .update({ gemaild_op: new Date().toISOString() })
    .eq('filter_id', ws.id)
    .in('referentienummer', lijst.map((k) => k.referentienummer))
  if (error) {
    // De mail is weg maar we konden het niet noteren: dan mailt de volgende run
    // hier opnieuw over. Vervelend, maar beter dan het verzwijgen.
    console.error('[aanbestedingen] gemaild_op bijwerken mislukt:', error.message)
    return { kandidaten: lijst.length, verstuurd: true, ontvangers, fout: `Verzonden, maar niet genoteerd: ${error.message}` }
  }

  return { kandidaten: lijst.length, verstuurd: true, ontvangers }
}
