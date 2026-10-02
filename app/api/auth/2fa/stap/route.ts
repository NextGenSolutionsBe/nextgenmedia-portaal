import { NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { appActief, huidigeSessie, interneRol } from '@/lib/twofa/server'

export const dynamic = 'force-dynamic'

/**
 * GET — welke tweede stap moet dit account nu doen?
 *  { stap: 'code' }      een code uit de authenticator-app (of een herstelcode)
 *  { stap: 'koppelen' }  nog geen app: eerst een app koppelen
 * Geeft niets gevoeligs terug; enkel voor de ingelogde (wachtwoord-)sessie.
 */
export async function GET() {
  try {
    const sessie = await huidigeSessie()
    if (!sessie) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    if (!(await interneRol(sessie.user.id))) return NextResponse.json({ error: 'Niet van toepassing' }, { status: 403 })
    return NextResponse.json({ stap: (await appActief(sessie.user.id)) ? 'code' : 'koppelen', email: sessie.user.email ?? null })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
