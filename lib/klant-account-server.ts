import 'server-only'
import { createHash, randomBytes } from 'crypto'
import { baseUrl } from '@/lib/email'
import { ACTIVATIE_DAGEN, activatieStatus, geldigEmail } from './klant-account'

/**
 * Klantaccounts aanmaken en activeren.
 *
 *  · `maakKlantAccount`: een login voor een klant zonder account (bv. een
 *    snelle klant). Met een willekeurig wachtwoord dat niemand kent: de klant
 *    kiest zelf een wachtwoord via de activatielink.
 *  · `maakActivatie`: een persoonlijke link (7 dagen). We bewaren enkel de
 *    SHA-256 van de token, nooit de token zelf.
 *  · `wisselActivatie`: de link inwisselen voor een eenmalige Supabase-token
 *    om het wachtwoord te zetten (op de pagina /welkom/<token>).
 *  · `rondActivatieAf`: na het kiezen van het wachtwoord; de link werkt daarna niet meer.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; auth: any }

export class AccountFout extends Error { constructor(m: string, public status = 400) { super(m) } }

const hash = (t: string) => createHash('sha256').update(t).digest('hex')

export type KlantAccount = { clientId: string; klant: string; contact: string | null; userId: string | null; email: string | null }

export async function klantAccount(admin: Admin, clientId: string): Promise<KlantAccount> {
  const { data: c } = await admin.from('clients').select('id, company_name, contact_name, email, owner_user_id').eq('id', clientId).maybeSingle()
  if (!c) throw new AccountFout('Klant niet gevonden.', 404)
  let email: string | null = null
  if (c.owner_user_id) {
    const { data } = await admin.auth.admin.getUserById(c.owner_user_id)
    email = data?.user?.email ?? null
  }
  return { clientId: c.id, klant: c.company_name, contact: c.contact_name ?? null, userId: c.owner_user_id ?? null, email }
}

export async function maakKlantAccount(admin: Admin, clientId: string, emailIn: unknown): Promise<KlantAccount> {
  const email = geldigEmail(emailIn)
  if (!email) throw new AccountFout('Vul een geldig e-mailadres in.')
  const nu = await klantAccount(admin, clientId)
  if (nu.userId) throw new AccountFout('Deze klant heeft al een account.', 409)
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password: randomBytes(24).toString('base64url'), email_confirm: true,
    user_metadata: { full_name: nu.contact || nu.klant },
  })
  if (error || !created?.user) {
    if (/already|registered|exists/i.test(error?.message ?? '')) throw new AccountFout('Er bestaat al een account met dit e-mailadres. Kies een ander adres of koppel de bestaande gebruiker via Gebruikers.', 409)
    throw new Error(`Account aanmaken mislukt: ${error?.message ?? 'onbekend'}`)
  }
  const userId = created.user.id as string
  await admin.from('user_roles').insert({ user_id: userId, role: 'client' })
  const { error: e2 } = await admin.from('clients').update({ owner_user_id: userId, email }).eq('id', clientId).is('owner_user_id', null)
  if (e2) {
    await admin.auth.admin.deleteUser(userId).catch(() => {})
    throw new Error(e2.message)
  }
  return { ...nu, userId, email }
}

/** Een nieuwe activatielink voor het account van de klant. Geeft de url terug (enkel voor in de mail). */
export async function maakActivatie(admin: Admin, a: { clientId: string; userId: string; email: string; door: string | null }): Promise<{ url: string; verlooptOp: string }> {
  const token = randomBytes(32).toString('base64url')
  const verlooptOp = new Date(Date.now() + ACTIVATIE_DAGEN * 86_400_000).toISOString()
  const { error } = await admin.from('klant_activaties').insert({ client_id: a.clientId, user_id: a.userId, email: a.email, token_hash: hash(token), verloopt_op: verlooptOp, created_by: a.door })
  if (error) throw new Error(/klant_activaties/.test(error.message) ? 'De activatielinks vereisen een database-migratie (klant_activaties).' : error.message)
  return { url: `${baseUrl().replace(/\/$/, '')}/welkom/${token}`, verlooptOp }
}

/** De link inwisselen: een eenmalige Supabase-token om het wachtwoord te zetten. Enkel voor een klantaccount. */
export async function wisselActivatie(admin: Admin, token: string): Promise<{ tokenHash: string; email: string }> {
  const { data: rij } = await admin.from('klant_activaties').select('id, user_id, email, verloopt_op, gebruikt_op').eq('token_hash', hash(token)).maybeSingle()
  const status = activatieStatus(rij)
  if (status === 'onbekend') throw new AccountFout('Deze link klopt niet. Vraag ons een nieuwe.', 404)
  if (status === 'gebruikt') throw new AccountFout('Je koos al een wachtwoord met deze link. Log gewoon in; wachtwoord vergeten? Laat het ons weten.', 410)
  if (status === 'verlopen') throw new AccountFout('Deze link is verlopen. Laat het ons weten en we sturen een nieuwe.', 410)
  // Enkel klantaccounts: een link kan nooit een medewerker of beheerder ontgrendelen.
  const { data: rol } = await admin.from('user_roles').select('role').eq('user_id', rij.user_id).maybeSingle()
  if (rol?.role !== 'client') throw new AccountFout('Deze link hoort niet bij een klantaccount.', 403)
  const { data: user } = await admin.auth.admin.getUserById(rij.user_id)
  const email = user?.user?.email as string | undefined
  if (!email) throw new AccountFout('Dit account bestaat niet meer. Neem contact met ons op.', 404)
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'recovery', email })
  const tokenHash = link?.properties?.hashed_token as string | undefined
  if (error || !tokenHash) throw new Error('De link kon niet verwerkt worden. Probeer het zo opnieuw.')
  await admin.from('klant_activaties').update({ geopend_op: new Date().toISOString() }).eq('id', rij.id).is('geopend_op', null)
  return { tokenHash, email }
}

/** Na het kiezen van het wachtwoord: de link werkt niet meer. Enkel voor de eigenaar van de link. */
export async function rondActivatieAf(admin: Admin, token: string, userId: string): Promise<void> {
  await admin.from('klant_activaties').update({ gebruikt_op: new Date().toISOString() }).eq('token_hash', hash(token)).eq('user_id', userId).is('gebruikt_op', null)
}
