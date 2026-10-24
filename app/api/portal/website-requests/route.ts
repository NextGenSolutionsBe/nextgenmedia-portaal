import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'
import { checkUpload } from '@/lib/upload-guard'
import { revalidatePath } from 'next/cache'
import { notifyMaintenanceRequest } from '@/lib/admin-alerts'
import { requirePortalPermission, logPortalAction, type PortalSession } from '@/lib/portal-auth'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// Store images in the 'contracts' bucket (always exists, admin service role bypasses RLS)
// under a webdesign/ prefix so they stay separate from contract PDFs.
const STORAGE_BUCKET = 'contracts'
const IMAGE_PATH_PREFIX = 'webdesign'
// 24 uur: een signed URL is een sleutel zonder slot — wie hem heeft, kan erbij.
// De admin-weergave genereert bij elke paginalading een verse URL, dus een korte
// levensduur kost niets en beperkt de schade als een link uitlekt.
const SIGNED_URL_TTL = 60 * 60 * 24 // 24 uur

// All portal-submitted requests are minor by definition; the schema-level kind
// has a CHECK ('minor','major') constraint, so we always store 'minor' and
// surface the user-facing kind via `categories[0]` / description prefix.
const SCHEMA_KIND = 'minor'

// PostgREST error codes for missing column / check-constraint violation.
const RETRIABLE_ERR_CODES = new Set(['PGRST204', '42703', '23514'])

// Insert payload keys ordered most→least preferred — when the schema rejects
// the request we drop them one at a time until it sticks.
const DROPPABLE_KEYS = ['categories', 'image_paths'] as const

export async function POST(req: NextRequest) {
  try {
    const g = await requirePortalPermission('website', 'request_maintenance')
    if (!g.ok) return g.response
    const { session } = g

    const formData = await req.formData()
    const title = formData.get('title') as string
    const description = formData.get('description') as string | null
    const friendlyKind = (formData.get('kind') as string) || 'other'
    const imageFiles = formData.getAll('images') as File[]

    if (!title) {
      return NextResponse.json({ error: 'Titel is verplicht' }, { status: 400 })
    }

    // Aanvraag hoort altijd bij de klant van de ingelogde gebruiker.
    const client_id = session.clientId

    const admin = createAdminSupabaseClient()

    // Aanpassingen aanvragen is onderhoudswerk: zonder lopend onderhoudspakket
    // mag er geen aanvraag binnenkomen (de UI verbergt het al; dit is de gate).
    const { data: cRow } = await admin.from('clients').select('*').eq('id', client_id).maybeSingle()
    if (!(cRow as { maintenance_included?: boolean | null } | null)?.maintenance_included) {
      return NextResponse.json({ error: 'Onderhoud is niet inbegrepen voor dit account.' }, { status: 403 })
    }

    // Upload all images in parallel; preserve order in the returned arrays.
    const uploadResults = await Promise.all(
      imageFiles
        .filter((img) => img && img.size > 0)
        .map(async (img) => {
          // Werkelijk type uit de bytes bepalen; bestandsnaam en Content-Type
          // komen van de client en zijn niet te vertrouwen.
          const checked = await checkUpload(img, { maxBytes: 10 * 1024 * 1024, allow: ['image'] })
          if (!checked.ok) {
            console.error('[website-requests] geweigerde upload:', checked.error)
            return null
          }
          const storagePath = `${IMAGE_PATH_PREFIX}/${client_id}/${randomUUID()}.${checked.ext}`
          const { error: uploadErr } = await admin.storage
            .from(STORAGE_BUCKET)
            .upload(storagePath, checked.buffer, {
              contentType: checked.mime,
              upsert: false,
            })
          if (uploadErr) {
            console.error('[website-requests] image upload error:', uploadErr.message)
            return null
          }
          const { data: urlData } = await admin.storage
            .from(STORAGE_BUCKET)
            .createSignedUrl(storagePath, SIGNED_URL_TTL)
          return { path: storagePath, url: urlData?.signedUrl ?? null }
        })
    )

    const imagePaths: string[] = []
    const imageUrls: string[] = []
    for (const r of uploadResults) {
      if (!r) continue
      imagePaths.push(r.path)
      if (r.url) imageUrls.push(r.url)
    }

    // Build the insert payload. The schema may be missing optional columns
    // (categories, image_paths) — when we hit a known retriable error we drop
    // the next droppable key and retry. The friendly kind is also embedded in
    // description as `[kind] ...` so it survives even when categories is gone.
    const descriptionWithKind = description?.trim()
      ? `[${friendlyKind}] ${description.trim()}`
      : `[${friendlyKind}]`

    const payload: Record<string, unknown> = {
      client_id,
      title,
      description: descriptionWithKind,
      kind: SCHEMA_KIND,
      status: 'new',
      image_urls: imageUrls,
      image_paths: imagePaths,
      categories: [friendlyKind],
    }

    let inserted: { id: string } | null = null
    let lastErr: { message?: string; code?: string } | null = null
    for (let attempt = 0; attempt <= DROPPABLE_KEYS.length; attempt++) {
      const { data, error } = await admin
        .from('webdesign_change_requests')
        .insert(payload)
        .select('id')
        .single()
      if (!error) { inserted = data; lastErr = null; break }
      lastErr = error
      if (!RETRIABLE_ERR_CODES.has(error.code ?? '')) break
      // Drop the next problematic key and retry
      if (attempt < DROPPABLE_KEYS.length) delete payload[DROPPABLE_KEYS[attempt]]
    }

    if (!inserted) {
      console.error('[website-requests] insert failed:', lastErr?.message)
      throw new Error(lastErr?.message ?? 'Insert mislukt')
    }

    try {
      revalidatePath('/admin/services/website')
      revalidatePath('/portal/website')
      revalidatePath('/admin')
    } catch { }

    await logPortalAction(session, 'portal.website_request.created', { type: 'webdesign_change_request', id: inserted.id }, { req })

    // Directe interne adminmail (best-effort, breekt de flow nooit).
    await notifyMaintenanceRequest(inserted.id)

    return NextResponse.json({ id: inserted.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// Verify the session's client owns the request AND it's still editable (status 'new').
async function loadEditableRequest(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any, session: PortalSession, id: string,
): Promise<{ ok: true; request: { id: string; status: string; image_paths?: string[] | null } } | { ok: false; status: number; error: string }> {
  const { data: request } = await admin
    .from('webdesign_change_requests')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!request) return { ok: false, status: 404, error: 'Aanvraag niet gevonden' }
  if (request.client_id !== session.clientId) return { ok: false, status: 403, error: 'Geen toegang' }
  if (request.status !== 'new') {
    return { ok: false, status: 409, error: 'Deze aanvraag is al in behandeling genomen en kan niet meer gewijzigd worden.' }
  }
  return { ok: true, request }
}

// PATCH — client edits their own request while it's still 'new'
export async function PATCH(req: NextRequest) {
  try {
    const g = await requirePortalPermission('website', 'request_maintenance')
    if (!g.ok) return g.response
    const { session } = g

    const { id, title, description, kind } = await req.json()
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    if (title !== undefined && !String(title).trim()) {
      return NextResponse.json({ error: 'Titel is verplicht' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    const check = await loadEditableRequest(admin, session, id)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })

    // Keep the friendly kind in description prefix + categories (same as POST).
    const friendlyKind = kind || 'other'
    const descriptionWithKind = description?.trim()
      ? `[${friendlyKind}] ${description.trim()}`
      : `[${friendlyKind}]`

    const patch: Record<string, unknown> = {}
    if (title !== undefined) patch.title = String(title).trim()
    if (description !== undefined || kind !== undefined) {
      patch.description = descriptionWithKind
      patch.categories = [friendlyKind]
    }

    // Resilient update: drop categories if the column doesn't exist.
    let { error } = await admin.from('webdesign_change_requests').update(patch).eq('id', id)
    if (error && RETRIABLE_ERR_CODES.has((error as { code?: string }).code ?? '')) {
      delete patch.categories
      ;({ error } = await admin.from('webdesign_change_requests').update(patch).eq('id', id))
    }
    if (error) throw new Error(error.message)

    try {
      revalidatePath('/portal/website')
      revalidatePath('/admin/services/website')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — client removes their own request while it's still 'new'
export async function DELETE(req: NextRequest) {
  try {
    const g = await requirePortalPermission('website', 'request_maintenance')
    if (!g.ok) return g.response
    const { session } = g

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const check = await loadEditableRequest(admin, session, id)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status })

    // Clean up any uploaded images (best effort)
    const paths: string[] = Array.isArray(check.request.image_paths) ? check.request.image_paths : []
    if (paths.length > 0) {
      try { await admin.storage.from(STORAGE_BUCKET).remove(paths) } catch { }
    }

    const { error } = await admin.from('webdesign_change_requests').delete().eq('id', id)
    if (error) throw new Error(error.message)

    try {
      revalidatePath('/portal/website')
      revalidatePath('/admin/services/website')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
