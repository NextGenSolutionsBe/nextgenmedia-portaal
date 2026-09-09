import 'server-only'

// Versiegeschiedenis per blog. Vóór elke wijziging bewaren we de HUIDIGE inhoud
// als versie, zodat de admin altijd kan terugkeren naar een vorige versie.

type BlogSnapshot = {
  titel: string | null; slug: string | null; content: string | null
  meta_title: string | null; meta_description: string | null; thumbnail_url: string | null
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = { from: (t: string) => any }

/** Bewaart de huidige blogtoestand als versie. Best-effort — breekt nooit de flow. */
export async function snapshotBlogVersion(
  admin: AdminClient,
  blogId: string,
  current: BlogSnapshot,
  editedBy: string,
  changeSummary: string,
): Promise<void> {
  try {
    await admin.from('blog_versions').insert({
      blog_id: blogId,
      titel: current.titel ?? null, slug: current.slug ?? null, content: current.content ?? null,
      meta_title: current.meta_title ?? null, meta_description: current.meta_description ?? null, thumbnail_url: current.thumbnail_url ?? null,
      edited_by: editedBy, change_summary: changeSummary,
    })
  } catch { /* versiegeschiedenis mag nooit een opslag breken */ }
}

/** Bepaalt een korte omschrijving van wat er gewijzigd is tussen oud en nieuw. */
export function describeChanges(before: Record<string, unknown>, patch: Record<string, unknown>): string {
  const labels: Record<string, string> = {
    titel: 'titel', slug: 'slug', content: 'inhoud', meta_title: 'meta titel', meta_description: 'meta beschrijving', thumbnail_url: 'afbeelding',
  }
  const changed: string[] = []
  for (const k of Object.keys(labels)) {
    if (k in patch && String(patch[k] ?? '') !== String(before[k] ?? '')) changed.push(labels[k])
  }
  return changed.length ? changed.join(', ') + ' gewijzigd' : 'opgeslagen'
}
