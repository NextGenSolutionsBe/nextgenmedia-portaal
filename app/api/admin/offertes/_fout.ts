import { NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { OfferteFout } from '@/lib/offertes-server'

export function fout(e: unknown, plek: string) {
  if (e instanceof OfferteFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
  const msg = e instanceof Error ? e.message : ''
  if (/offerte|relation|does not exist|schema cache/i.test(msg) && /does not exist|schema cache/i.test(msg)) {
    return NextResponse.json({ error: 'De offertemodule is nog niet klaar in de databank (migratie ontbreekt).' }, { status: 503 })
  }
  return NextResponse.json({ error: safeMessage(e, plek) }, { status: 500 })
}
