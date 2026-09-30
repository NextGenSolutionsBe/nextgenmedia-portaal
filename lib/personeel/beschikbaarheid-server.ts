import 'server-only'
import { controleerBlokken } from './planning'
import { dagBrussel, minutenVanUur } from './tijd'
import type { Admin } from './server'

/**
 * Beschikbaarheid toevoegen, wijzigen en verwijderen — één set regels voor de
 * medewerker zelf (/team) en voor een admin (algemene kalender).
 *
 * Beschikbaarheid is gewoon "ik ben vrij": geen goedkeuring meer nodig. Een
 * admin boekt iemand in binnen die uren; de medewerker bevestigt het werkblok.
 * Wijzigen of wissen kan altijd, behalve waar al een (niet geannuleerd,
 * niet geweigerd) werkblok in valt — anders zou een inboeking buiten iemands
 * beschikbaarheid komen te liggen.
 */

export type Uitkomst = { ok: true; id?: string } | { ok: false; fout: string; status: number }

const ACTIEF = ['ingediend', 'goedgekeurd', 'gedeeltelijk']
const fout = (f: string, status = 400): Uitkomst => ({ ok: false, fout: f, status })

async function andereBlokken(admin: Admin, personeelId: string, datum: string, zonderId?: string) {
  let q = admin.from('personeel_beschikbaarheid').select('id, start_tijd, eind_tijd').eq('personeel_id', personeelId).eq('datum', datum).in('status', ACTIEF)
  if (zonderId) q = q.neq('id', zonderId)
  const { data } = await q
  return (data ?? []) as { id: string; start_tijd: string; eind_tijd: string }[]
}

/** Actieve werkblokken van die dag (niet geannuleerd, niet geweigerd). */
async function werkblokken(admin: Admin, personeelId: string, datum: string) {
  const { data } = await admin.from('personeel_planning').select('id, start_tijd, eind_tijd, status, bevestiging, taak')
    .eq('personeel_id', personeelId).eq('datum', datum).neq('status', 'geannuleerd')
  return ((data ?? []) as { id: string; start_tijd: string; eind_tijd: string; bevestiging: string | null; taak: string | null }[])
    .filter((w) => w.bevestiging !== 'geweigerd')
}

const overlapt = (a: { s: number; e: number }, b: { start_tijd: string; eind_tijd: string }) => a.s < minutenVanUur(b.eind_tijd) && minutenVanUur(b.start_tijd) < a.e

export async function voegBeschikbaarheidToe(admin: Admin, p: { personeelId: string; datum: string; start: string; eind: string; opmerking?: string | null }): Promise<Uitkomst> {
  const f = controleerBlokken(p.datum, [{ start: p.start, eind: p.eind }]); if (f) return fout(f)
  if (p.datum < dagBrussel(new Date())) return fout('Een dag in het verleden kan je niet meer doorgeven.')
  const blok = { s: minutenVanUur(p.start), e: minutenVanUur(p.eind) }
  if ((await andereBlokken(admin, p.personeelId, p.datum)).some((x) => overlapt(blok, x))) return fout('Op dat moment staat al beschikbaarheid. Pas die aan in plaats van een nieuwe toe te voegen.', 409)
  const { data, error } = await admin.from('personeel_beschikbaarheid')
    .insert({ personeel_id: p.personeelId, datum: p.datum, start_tijd: p.start.slice(0, 5), eind_tijd: p.eind.slice(0, 5), opmerking: p.opmerking ?? null, status: 'ingediend' })
    .select('id').single()
  if (error) throw new Error(error.message)
  return { ok: true, id: (data as { id: string }).id }
}

export async function wijzigBeschikbaarheid(admin: Admin, p: { id: string; personeelId?: string; start: string; eind: string }): Promise<Uitkomst> {
  let q = admin.from('personeel_beschikbaarheid').select('id, personeel_id, datum, start_tijd, eind_tijd, status').eq('id', p.id)
  if (p.personeelId) q = q.eq('personeel_id', p.personeelId)
  const { data: a } = await q.maybeSingle()
  const rij = a as { id: string; personeel_id: string; datum: string; start_tijd: string; eind_tijd: string; status: string } | null
  if (!rij || !ACTIEF.includes(rij.status)) return fout('Niet gevonden', 404)
  const f = controleerBlokken(rij.datum, [{ start: p.start, eind: p.eind }]); if (f) return fout(f)
  const blok = { s: minutenVanUur(p.start), e: minutenVanUur(p.eind) }
  if ((await andereBlokken(admin, rij.personeel_id, rij.datum, rij.id)).some((x) => overlapt(blok, x))) return fout('Dat overlapt met andere beschikbaarheid op die dag.', 409)
  // Werkblokken die in het oude blok vielen, moeten er ook in het nieuwe in blijven vallen.
  const oud = { s: minutenVanUur(rij.start_tijd), e: minutenVanUur(rij.eind_tijd) }
  const buiten = (await werkblokken(admin, rij.personeel_id, rij.datum))
    .filter((w) => overlapt(oud, w))
    .find((w) => minutenVanUur(w.start_tijd) < blok.s || minutenVanUur(w.eind_tijd) > blok.e)
  if (buiten) return fout(`Er is al ingeboekt van ${buiten.start_tijd.slice(0, 5)} tot ${buiten.eind_tijd.slice(0, 5)}${buiten.taak ? ` (${buiten.taak})` : ''}. Dat moet binnen je beschikbaarheid blijven.`, 409)
  const { error } = await admin.from('personeel_beschikbaarheid').update({ start_tijd: p.start.slice(0, 5), eind_tijd: p.eind.slice(0, 5), updated_at: new Date().toISOString() }).eq('id', rij.id)
  if (error) throw new Error(error.message)
  return { ok: true, id: rij.id }
}

export async function verwijderBeschikbaarheid(admin: Admin, p: { id: string; personeelId?: string }): Promise<Uitkomst> {
  let q = admin.from('personeel_beschikbaarheid').select('id, personeel_id, datum, start_tijd, eind_tijd, status').eq('id', p.id)
  if (p.personeelId) q = q.eq('personeel_id', p.personeelId)
  const { data: a } = await q.maybeSingle()
  const rij = a as { id: string; personeel_id: string; datum: string; start_tijd: string; eind_tijd: string; status: string } | null
  if (!rij || !ACTIEF.includes(rij.status)) return fout('Niet gevonden', 404)
  const oud = { s: minutenVanUur(rij.start_tijd), e: minutenVanUur(rij.eind_tijd) }
  const ingeboekt = (await werkblokken(admin, rij.personeel_id, rij.datum)).find((w) => overlapt(oud, w))
  if (ingeboekt) return fout(`Hier is al ingeboekt (${ingeboekt.start_tijd.slice(0, 5)}–${ingeboekt.eind_tijd.slice(0, 5)}${ingeboekt.taak ? `, ${ingeboekt.taak}` : ''}). Laat dat werkblok eerst annuleren.`, 409)
  const { error } = await admin.from('personeel_beschikbaarheid').update({ status: 'ingetrokken', updated_at: new Date().toISOString() }).eq('id', rij.id)
  if (error) throw new Error(error.message)
  return { ok: true, id: rij.id }
}
