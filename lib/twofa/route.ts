import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import { logAudit, requestMeta } from '@/lib/audit'
import type { Kern } from './kern'
import { appActief, huidigeSessie, interneRol, maakKern, tweedeStapVoltooid, type Sessie } from './server'

/**
 * Gemeenschappelijke ingang voor de 2FA-beheerroutes (instellen, uitschakelen,
 * herstelcodes, status): enkel een INTERN account, in een sessie die de tweede
 * stap al voltooide (of, bij het koppelen tijdens het inloggen, nog geen app heeft). Alles gebeurt voor de eigen gebruiker — er is geen enkele
 * parameter waarmee je een ander account kunt aanspreken.
 */
export async function eigenAccount(opts: { kernNodig?: boolean; koppelenBijInloggen?: boolean } = {}): Promise<
  | { ok: true; sessie: Sessie; rol: 'admin' | 'employee'; kern: Kern | null }
  | { ok: false; res: NextResponse }
> {
  const sessie = await huidigeSessie()
  if (!sessie) return { ok: false, res: NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 }) }
  const rol = await interneRol(sessie.user.id)
  if (!rol) return { ok: false, res: NextResponse.json({ error: 'Niet van toepassing' }, { status: 403 }) }
  if (!(await tweedeStapVoltooid(sessie.user.id))) {
    // Enige uitzondering: wie nog GEEN app heeft, moet er bij het inloggen een
    // koppelen (setup + bevestigen). Wie al een app heeft, moet eerst een code geven.
    const magKoppelen = opts.koppelenBijInloggen && !(await appActief(sessie.user.id))
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
