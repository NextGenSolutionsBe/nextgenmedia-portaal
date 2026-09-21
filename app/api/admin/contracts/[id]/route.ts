import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { logContractEvent } from '@/lib/contract-audit'
import { logAudit, requestMeta } from '@/lib/audit'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

// PATCH — update contract status (send / cancel)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const body = await req.json()
    const { action } = body

    if (action === 'regenerate_token') {
      const newToken = randomUUID()
      const { error } = await admin
        .from('contracts')
        .update({ status: 'draft', access_token: newToken })
        .eq('id', id)
      if (error) throw new Error(error.message)
      await logContractEvent(admin, id, 'token_regenerated', { actor: user.email ?? user.id })
      try {
        revalidatePath('/admin/contracts'); revalidatePath(`/admin/contracts/${id}`)
      } catch { }
      return NextResponse.json({ ok: true, access_token: newToken })
    } else if (action === 'set_expiry') {
      // expires_at: 'YYYY-MM-DD' of null om te wissen.
      const expires_at = body.expires_at ? String(body.expires_at).slice(0, 10) : null
      // Veerkrachtig: kolom kan ontbreken vóór migratie.
      let err: { message: string } | null = null
      {
        const { error } = await admin.from('contracts').update({ expires_at }).eq('id', id)
        err = error
      }
      if (err) {
        const col = String(err.message || '').match(/Could not find the '([^']+)' column/)?.[1]
        if (col !== 'expires_at') throw new Error(err.message)
        return NextResponse.json({ error: 'Vervaldatum vereist een database-migratie (expires_at).' }, { status: 400 })
      }
      try { revalidatePath(`/admin/contracts/${id}`) } catch { }
      return NextResponse.json({ ok: true, expires_at })
    } else if (action === 'invoice_settings') {
      // Facturatie-instellingen op het contract (verwacht aantal / frequentie / bedrag).
      const patch: Record<string, unknown> = {
        expected_invoice_count: body.expected_invoice_count != null && body.expected_invoice_count !== '' ? Math.max(0, parseInt(String(body.expected_invoice_count), 10) || 0) : null,
        invoice_frequency: body.invoice_frequency || null,
        expected_invoice_amount_excl: body.expected_invoice_amount_excl != null && body.expected_invoice_amount_excl !== '' ? Number(body.expected_invoice_amount_excl) : null,
      }
      // Veerkrachtig: laat ontbrekende kolommen vallen vóór migratie.
      const p = { ...patch }
      for (let i = 0; i < 4; i++) {
        const { error } = await admin.from('contracts').update(p).eq('id', id)
        if (!error) break
        const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
        if (col && col in p) { delete p[col]; continue }
        throw new Error(error.message)
      }
      // Is de factuurplanning al bevestigd? Dan raken we bestaande facturen NIET
      // aan, maar markeren we het contract zodat het scherm de keuze voorlegt:
      // planning behouden, toekomstige facturen herberekenen, of zelf aanpassen.
      try {
        const { data: c } = await admin.from('contracts').select('facturatie_bevestigd_op').eq('id', id).maybeSingle()
        if (c?.facturatie_bevestigd_op) await admin.from('contracts').update({ facturatie_gewijzigd_na_bevestiging: true }).eq('id', id)
      } catch { /* kolommen bestaan pas na migratie */ }
      try { revalidatePath(`/admin/contracts/${id}`) } catch { }
      return NextResponse.json({ ok: true })
    } else if (action === 'send') {
      const { error } = await admin
        .from('contracts')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw new Error(error.message)
      try { await admin.from('contract_events').insert({ contract_id: id, event_type: 'sent' }) } catch { }
    } else if (action === 'cancel') {
      const { error } = await admin
        .from('contracts')
        .update({ status: 'cancelled' })
        .eq('id', id)
      if (error) throw new Error(error.message)
      try { await admin.from('contract_events').insert({ contract_id: id, event_type: 'cancelled' }) } catch { }
    } else {
      return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    }

    // Invalidate caches so admin + portal contract pages refresh
    try {
      revalidatePath('/admin/contracts')
      revalidatePath(`/admin/contracts/${id}`)
      revalidatePath('/portal/contracts')
      revalidatePath('/portal')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** Databasefout bij het verwijderen vertalen naar één leesbare Nederlandse zin. */
function verwijderFoutTekst(message: string): string {
  const m = message || ''
  const fk = m.match(/violates foreign key constraint "[^"]+" on table "([^"]+)"/i)
  if (fk) return `Verwijderen geblokkeerd door een gekoppeld record: ${fk[1]}. Koppel dat eerst los en probeer opnieuw.`
  if (/onveranderlijk/i.test(m)) return 'Het contractarchief is onveranderlijk en wordt niet mee verwijderd; het contract zelf kon niet gewist worden.'
  if (/permission denied/i.test(m)) return 'Geen rechten in de database om dit contract te verwijderen.'
  if (/(fetch failed|ECONNREFUSED|ETIMEDOUT|timeout)/i.test(m)) return 'De database was even niet bereikbaar. Probeer het opnieuw.'
  return safeMessage(new Error(m), 'contracts.DELETE')
}

/** Rijen die naar het contract verwijzen loskoppelen (contract_id → null). Tabel of kolom ontbreekt → 0. */
async function koppelLos(admin: ReturnType<typeof createAdminSupabaseClient>, tabel: string, contractId: string): Promise<number> {
  try {
    const { data, error } = await admin.from(tabel).update({ contract_id: null }).eq('contract_id', contractId).select('id')
    if (error) {
      // Kolom/tabel bestaat (nog) niet vóór migratie: niets te ontkoppelen.
      if (/does not exist|schema cache|Could not find/i.test(error.message)) return 0
      throw new Error(error.message)
    }
    return (data ?? []).length
  } catch (e) {
    if (e instanceof Error && /does not exist|schema cache|Could not find/i.test(e.message)) return 0
    throw e
  }
}

/**
 * DELETE — een contract definitief verwijderen.
 *  - Gekoppelde facturen (eenmalig + recurring), opdrachten en vestingcontracten
 *    worden NIET verwijderd maar losgekoppeld: ze blijven als losse records bestaan.
 *  - Het contractarchief (getekende PDF + certificaat) blijft onaangeroerd; het
 *    is onveranderlijk en overleeft het contract.
 *  - Gebeurtenissen, handtekeningen en factuurvoorstellen gaan mee (CASCADE),
 *    het facturatielog wordt expliciet opgeruimd.
 *  - Bestanden in de contracts-bucket: best-effort weg.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    // Body eerst lezen (de stream kan maar één keer gelezen worden).
    const { force } = await req.json().catch(() => ({ force: false })) as { force?: boolean }

    const { data: contract, error: fetchError } = await admin.from('contracts').select('*').eq('id', id).maybeSingle()
    if (fetchError) throw new Error(fetchError.message)
    if (!contract) return NextResponse.json({ error: 'Dit contract bestaat niet (meer).' }, { status: 404 })
    const getekend = contract.status === 'signed' || contract.status === 'getekend'
    if (getekend && !force) {
      return NextResponse.json({ error: 'Dit contract is ondertekend. Bevestig expliciet dat het toch verwijderd mag worden.' }, { status: 409 })
    }

    // 1. Loskoppelen — niet vertrouwen op ON DELETE SET NULL.
    const [facturen, recurring, opdrachten, vesting] = await Promise.all([
      koppelLos(admin, 'invoices', id),
      koppelLos(admin, 'recurring_invoices', id),
      koppelLos(admin, 'opdrachten', id),
      koppelLos(admin, 'vesting_contracten', id),
    ])

    // 2. Facturatielog opruimen (geen FK, dus expliciet).
    try { await admin.from('contract_facturatie_log').delete().eq('contract_id', id) } catch { /* tabel kan ontbreken */ }

    // 3. Het contract zelf (CASCADE: contract_events, contract_signatures, contract_facturatie_opdrachten).
    const { error } = await admin.from('contracts').delete().eq('id', id)
    if (error) return NextResponse.json({ error: verwijderFoutTekst(error.message) }, { status: 409 })

    // 4. Bestanden in de contracts-bucket — best-effort. Het archief blijft.
    const paths = [contract.pdf_path, contract.signed_pdf_path, `signed/${id}.pdf`].filter((p, i, a): p is string => !!p && a.indexOf(p) === i)
    if (paths.length > 0) {
      try { await admin.storage.from('contracts').remove(paths) } catch { }
    }

    // 5. Audit.
    const meta = requestMeta(req)
    await logAudit({
      action: 'contract.deleted', entityType: 'contract', entityId: id,
      summary: `Contract "${contract.title}" verwijderd${getekend ? ' (was getekend)' : ''}; losgekoppeld: ${facturen} facturen, ${recurring} recurring, ${opdrachten} opdrachten, ${vesting} vesting`,
      actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin',
      metadata: { titel: contract.title, status: contract.status, client_id: contract.client_id ?? null, losgekoppeld: { facturen, recurring, opdrachten, vesting }, archief_behouden: true },
      ip: meta.ip, userAgent: meta.userAgent,
    })

    // 6. Caches ongeldig maken zodat het contract meteen uit alle lijsten verdwijnt.
    try {
      revalidatePath('/admin/contracts')
      revalidatePath(`/admin/contracts/${id}`)
      revalidatePath('/admin/invoices')
      revalidatePath('/portal/contracts')
      revalidatePath('/portal')
      if (contract.client_id) revalidatePath(`/admin/clients/${contract.client_id}`)
    } catch { }

    return NextResponse.json({ ok: true, losgekoppeld: { facturen, recurring, opdrachten, vesting } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: verwijderFoutTekst(msg) }, { status: 400 })
  }
}
