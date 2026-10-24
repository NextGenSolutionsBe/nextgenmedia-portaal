import { NextRequest, NextResponse } from 'next/server'
import { runAndSendAdminReport } from '@/lib/admin-report'

export const dynamic = 'force-dynamic'

// Dagelijkse INTERNE samenvatting naar admins (nooit naar klanten).
// Beveiligd met CRON_SECRET (Vercel Cron stuurt Authorization: Bearer <secret>).
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.nextUrl.searchParams.get('key') === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const res = await runAndSendAdminReport('auto')
  return NextResponse.json({ ok: true, ...res })
}
