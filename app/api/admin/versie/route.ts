import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Welke code draait hier op dit moment?
 *
 * Bestaat omdat "het is toch gepusht?" anders niet te beantwoorden is zonder in
 * drie schermen te gaan kijken. Met de commit hier kan je in één blik zien of
 * een wijziging effectief live staat, of dat de deploy is blijven hangen.
 *
 * Alles komt uit variabelen die Vercel zelf zet; er staat niets gevoeligs in.
 */
export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? null

  return NextResponse.json({
    commit: sha ? sha.slice(0, 7) : '(onbekend — draait niet op Vercel)',
    commitVolledig: sha,
    bericht: process.env.VERCEL_GIT_COMMIT_MESSAGE?.split('\n')[0] ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    repo: process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG
      ? `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`
      : null,
    omgeving: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? null,
    // Handig bij precies dit soort twijfel: staat de site op de URL die je
    // verwacht, of op een deployment-URL?
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || '(niet gezet)',
  })
}
