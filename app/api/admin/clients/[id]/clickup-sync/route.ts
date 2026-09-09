import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'
import {
  clickupConfigured,
  findOrCreateClientList,
  fetchListTasks,
  findTaskByNameAndDate,
  createTask,
  updateTask,
  deleteTask,
  buildTaskTitle,
  channelOptionId,
  captionOptionId,
  statusFor,
  plannedDateMs,
  syncHash,
  isTaskGone,
  isNotFound,
  type CuTask,
} from '@/lib/clickup'

// Sync kan even duren (gethrottelde ClickUp-calls) — ruimere limiet.
export const maxDuration = 60

type ContentItem = {
  id: string
  title: string
  content_type: string
  platform: string | null
  platforms: string[] | null
  caption: string | null
  status: string
  planned_date: string
  clickup_task_id: string | null
  clickup_sync_hash: string | null
}

// GET — status van de sync voor deze klant
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()

    const { data: client } = await admin
      .from('clients')
      .select('id, clickup_sync_enabled, clickup_list_id')
      .eq('id', id)
      .maybeSingle()
    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })

    let syncedCount = 0
    try {
      const { count } = await admin
        .from('social_content_items')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', id)
        .not('clickup_task_id', 'is', null)
      syncedCount = count ?? 0
    } catch { /* kolom mogelijk nog niet gemigreerd */ }

    return NextResponse.json({
      configured: clickupConfigured(),
      enabled: Boolean(client.clickup_sync_enabled),
      linked: Boolean(client.clickup_list_id),
      syncedCount,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — sync aan/uit zetten voor deze klant
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const { enabled } = await req.json()
    const admin = createAdminSupabaseClient()

    const { data: client } = await admin.from('clients').select('id, company_name').eq('id', id).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })

    const { error } = await admin
      .from('clients')
      .update({ clickup_sync_enabled: Boolean(enabled) })
      .eq('id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'client.clickup_sync.toggle',
      entityType: 'client',
      entityId: id,
      summary: `ClickUp-sync ${enabled ? 'ingeschakeld' : 'uitgeschakeld'} voor ${client.company_name}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { enabled: Boolean(enabled) }, ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true, enabled: Boolean(enabled) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — voer de sync uit (app → ClickUp) voor alle contentitems van deze klant
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!clickupConfigured()) {
      return NextResponse.json({ error: 'CLICKUP_API_KEY is niet ingesteld op de server' }, { status: 400 })
    }

    const { id } = await params
    const admin = createAdminSupabaseClient()

    const { data: client } = await admin
      .from('clients')
      .select('id, company_name, clickup_sync_enabled, clickup_folder_id, clickup_list_id')
      .eq('id', id)
      .maybeSingle()
    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
    if (!client.clickup_sync_enabled) {
      return NextResponse.json({ error: 'ClickUp-sync staat uit voor deze klant' }, { status: 400 })
    }

    // Resolve (of maak) de klant-lijst in ClickUp; sla id's op zodat we niet
    // telkens opnieuw zoeken.
    let listId = client.clickup_list_id as string | null
    if (!listId) {
      const ref = await findOrCreateClientList(client.company_name)
      listId = ref.listId
      try {
        await admin.from('clients')
          .update({ clickup_folder_id: ref.folderId, clickup_list_id: ref.listId })
          .eq('id', id)
      } catch { /* niet fataal */ }
    }

    // Bestaande taken één keer ophalen → index voor adoptie (duplicate prevention)
    let existingTasks: CuTask[] = []
    try { existingTasks = await fetchListTasks(listId) } catch { existingTasks = [] }

    const { data: itemsRaw } = await admin
      .from('social_content_items')
      .select('id, title, content_type, platform, platforms, caption, status, planned_date, clickup_task_id, clickup_sync_hash')
      .eq('client_id', id)
      .order('planned_date', { ascending: true })
    const items = (itemsRaw ?? []) as ContentItem[]

    const summary = { total: items.length, created: 0, updated: 0, skipped: 0, failed: 0, fieldLimited: 0, deleted: 0 }
    const errors: Array<{ id: string; title: string; error: string }> = []

    // Tijdsbudget per call zodat de serverless-functie nooit time-out: items die
    // API-werk vergen (create/update) kosten tijd; bereiken we het budget, dan
    // stoppen we en geeft de client aan dat er nog werk is ('done: false'). Reeds
    // verwerkte items zijn gecommit en worden bij de volgende call instant
    // overgeslagen → de sync is hervatbaar en volledig veilig.
    const startedAt = Date.now()
    const TIME_BUDGET_MS = 8000
    let done = true

    // Eén ClickUp-taak mag nooit door twee items gedeeld worden. We houden bij
    // welke task-id's deze run al 'geclaimd' zijn; botst een opgeslagen of
    // geadopteerd id daarmee, dan maken we een NIEUWE taak. Dit heelt ook
    // bestaande dubbele koppelingen (terugkerende content met dezelfde titel).
    const claimed = new Set<string>()

    // Per item: veilig falen, de rest stopt niet.
    for (const item of items) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) { done = false; break }
      try {
        const platforms = Array.isArray(item.platforms) && item.platforms.length > 0
          ? item.platforms
          : item.platform ? [item.platform] : []

        const name = buildTaskTitle({ content_type: item.content_type, title: item.title, platforms })
        const captionOpt = captionOptionId(item.caption)
        const channelOpt = channelOptionId(platforms)
        const dateMs = plannedDateMs(item.planned_date)
        const status = statusFor(item.status)
        const hash = syncHash({ name, captionOpt, channelOpt, dateMs, status })
        const fields = { name, status, dateMs, captionOpt, channelOpt }

        // (Her)adopteren op naam + datum, nooit een al door een ander item
        // geclaimde taak.
        const tryAdopt = (): string | null => {
          const a = findTaskByNameAndDate(existingTasks, name, dateMs)
          return a && !claimed.has(a.id) ? a.id : null
        }

        let taskId: string | null = item.clickup_task_id
        // Reparatie: gedeeld task-id met een eerder verwerkt item → loskoppelen.
        if (taskId && claimed.has(taskId)) taskId = null
        if (!taskId) taskId = tryAdopt()

        // Niets gewijzigd én reeds bekend → skip (geen onnodige API-calls)
        if (taskId && item.clickup_task_id === taskId && item.clickup_sync_hash === hash) {
          claimed.add(taskId)
          summary.skipped++
          continue
        }

        let created = false
        if (taskId) {
          try {
            const res = await updateTask(taskId, fields)
            if (res.fieldsBlocked > 0) summary.fieldLimited++
          } catch (e) {
            if (!isTaskGone(e)) throw e
            // Taak is in ClickUp verwijderd → opnieuw adopteren of aanmaken.
            const re = tryAdopt()
            if (re) {
              taskId = re
              const res = await updateTask(taskId, fields)
              if (res.fieldsBlocked > 0) summary.fieldLimited++
            } else {
              taskId = null
            }
          }
        }

        if (!taskId) {
          try {
            const res = await createTask(listId, fields)
            taskId = res.id
            if (res.fieldsBlocked > 0) summary.fieldLimited++
          } catch (e) {
            if (!isNotFound(e)) throw e
            // Lijst lijkt verwijderd → structuur opnieuw opbouwen en hermaken.
            const ref = await findOrCreateClientList(client.company_name)
            listId = ref.listId
            try { await admin.from('clients').update({ clickup_folder_id: ref.folderId, clickup_list_id: ref.listId }).eq('id', id) } catch { }
            const res = await createTask(listId, fields)
            taskId = res.id
            if (res.fieldsBlocked > 0) summary.fieldLimited++
          }
          created = true
        }

        if (created) summary.created++
        else summary.updated++
        claimed.add(taskId)

        // Per item committen → sync is hervatbaar als hij halverwege stopt
        await admin
          .from('social_content_items')
          .update({
            clickup_task_id: taskId,
            clickup_sync_hash: hash,
            clickup_synced_at: new Date().toISOString(),
          })
          .eq('id', item.id)
      } catch (e) {
        summary.failed++
        errors.push({ id: item.id, title: item.title, error: e instanceof Error ? e.message : 'Fout' })
      }
    }

    // ── Reconciliatie: spiegel de verwijderingen ─────────────────────────────
    // Enkel wanneer ALLE items in deze run verwerkt zijn (done): dan bevat
    // `claimed` élk task-id dat nog een app-item heeft. Taken in de lijst die
    // daar niet in zitten, horen bij content die in de app verwijderd is →
    // verwijderen. Taken met dezelfde naam+datum zijn eerder al geadopteerd,
    // dus enkel echte wezen sneuvelen. Loopt cleanup uit het tijdsbudget, dan
    // done=false → de client roept opnieuw en we maken het af (convergeert).
    if (done && items.length > 0) {
      const orphans = existingTasks.filter((t) => !claimed.has(t.id))
      const CLEANUP_BUDGET_MS = 14000
      for (const t of orphans) {
        if (Date.now() - startedAt > CLEANUP_BUDGET_MS) { done = false; break }
        try {
          const ok = await deleteTask(t.id)
          if (ok) summary.deleted++
          else summary.failed++
        } catch { summary.failed++ }
      }
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'client.clickup_sync.run',
      entityType: 'client',
      entityId: id,
      summary: `ClickUp-sync ${client.company_name}: ${summary.created} nieuw, ${summary.updated} bijgewerkt, ${summary.skipped} ongewijzigd, ${summary.deleted} verwijderd, ${summary.failed} mislukt`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { ...summary }, ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true, done, summary, errors: errors.slice(0, 25) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
