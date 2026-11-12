import 'server-only'
import { cookies } from 'next/headers'
import { normalizeLang, type Lang } from '@/lib/i18n'

/** Huidige portaaltaal uit de cookie `ngm_lang` (server-side). Default NL. */
export async function getLang(): Promise<Lang> {
  try {
    const c = await cookies()
    return normalizeLang(c.get('ngm_lang')?.value)
  } catch {
    return 'nl'
  }
}
