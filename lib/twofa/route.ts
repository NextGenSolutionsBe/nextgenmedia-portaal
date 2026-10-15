import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { logAudit, requestMeta } from '@/lib/audit'
import type { Kern } from './kern'
import { accountRol, appActief, huidigeSessie, klantTweedeStapOk, maakKern, tweedeStapVoltooid, type Sessie } from './server'
import { zelfdeOorsprong } from './sessie'

export type AccountRol = 'admin' | 'employee' | 'klant'

/** CSRF: wijzigende 2FA-verzoeken enkel vanaf onze eigen pagina's. null = in orde. */
export function csrfFout(req: NextRequest): NextResponse | null {
  return zelfdeOorsprong(req.headers) ? null : NextResponse.json({ error: 'Ongeldig verzoek.' }, { status: 403 })
}

/**
 * Gemeenschappelijke ingang voor de 2FA-beheerroutes (instellen, uitschakelen,
 * herstelcodes, status): enkel een INTERN account, in een sessie die de tweede
 * stap al voltooide (of, bij het koppelen tijdens het inloggen, nog geen app heeft). Alles gebeurt voor de eigen gebruiker — er is geen enkele
 * parameter waarmee je een ander account kunt aanspreken.
 */
export async function eigenAccount(opts: { kernNodig?: boolean; koppelenBijInloggen?: boolean } = {}): Promise<
  | { ok: true; sessie: Sessie; rol: AccountRol; kern: Kern | null }
  | { ok: false; res: NextResponse }
> {
  const sessie = await huidigeSessie()
  if (!sessie) return { ok: false, res: NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 }) }
  const rol = await accountRol(sessie.user.id)
  if (!rol) return { ok: false, res: NextResponse.json({ error: 'Niet van toepassing' }, { status: 403 }) }
  // Klanten: vrijwillige 2FA (zonder app is de sessie altijd in orde). Intern: verplicht.
  const stapOk = rol === 'klant' ? await klantTweedeStapOk(sessie.user.id) : await tweedeStapVoltooid(sessie.user.id)
  if (!stapOk) {
    // Enige uitzondering (enkel intern): wie nog GEEN app heeft, moet er bij het
    // inloggen een koppelen (setup + bevestigen). Wie al een app heeft, moet eerst een code geven.
    const magKoppelen = rol !== 'klant' && opts.koppelenBijInloggen && !(await appActief(sessie.user.id))
    if (!magKoppelen) return { ok: false, res: NextResponse.json({ error: 'Verificatie vereist', code: '2fa_required' }, { status: 401 }) }
  }
  const kern = maakKern()
  if (opts.kernNodig && !kern) {
    return { ok: false, res: NextResponse.json({ error: 'Tweestapsverificatie met een app is nog niet geconfigureerd op de server (TOTP_ENC_KEY ontbreekt).' }, { status: 503 }) }
  }
  return { ok: true, sessie, rol, kern }
}

/** Securityactie in het logboek. Nooit codes, geheimen of wachtwoorden meegeven. */
export function logSecurity(req: NextRequest, sessie: Sessie, rol: string, action: string, summary: string, extra?: { entityId?: string; metadata?: Record<string, unknown> }) {
  const meta = requestMeta(req)
  void logAudit({
    action, entityType: 'user', entityId: extra?.entityId ?? sessie.user.id, summary,
    actorUserId: sessie.user.id, actorEmail: sessie.user.email ?? null, actorRole: rol,
    metadata: extra?.metadata ?? {}, ip: meta.ip, userAgent: meta.userAgent,
  }).catch(() => {})
}
