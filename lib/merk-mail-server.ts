import 'server-only'
import { zetMerkGegevens, MAIL_MERKEN, type MailMerk, type MerkGegevens } from './merk-mail'

/**
 * Laadt de merkgegevens (contactadres, website, voettekst) uit `bedrijven` in de
 * mailopmaak (verbeterplan C18). Hoogstens één keer per minuut per serverinstantie;
 * lukt het niet, dan blijven de vaste waarden of wat er al geladen was.
 * Roep dit op vlak voor een mail gebouwd wordt (buildEmailHtml leest het meteen).
 */
let geladenOp = 0
export async function laadMerkGegevens(): Promise<void> {
  if (Date.now() - geladenOp < 60_000) return
  try {
    // Pas hier laden: wie dit bestand importeert (ook tests zonder Next) trekt de Supabase-client niet mee.
    const { createAdminSupabaseClient } = await import('@/lib/supabase/server')
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('bedrijven').select('slug, email, website, voettekst').in('slug', MAIL_MERKEN)
    if (error) return
    const g: Partial<Record<MailMerk, MerkGegevens>> = {}
    for (const r of (data ?? []) as { slug: MailMerk; email: string | null; website: string | null; voettekst: string | null }[]) {
      g[r.slug] = { adres: r.email, website: r.website, voettekst: r.voettekst }
    }
    zetMerkGegevens(g)
    geladenOp = Date.now()
  } catch { /* vaste waarden blijven */ }
}
