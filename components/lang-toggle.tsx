'use client'

import { useRouter } from 'next/navigation'
import { Languages } from 'lucide-react'
import { LANGS, type Lang } from '@/lib/i18n'

/** NL/EN-taalwissel. Zet de cookie `ngm_lang` en ververst zodat ook de
 *  servercomponenten meevertalen. */
export function LangToggle({ current, className }: { current: Lang; className?: string }) {
  const router = useRouter()
  const set = (l: Lang) => {
    if (l === current) return
    document.cookie = `ngm_lang=${l};path=/;max-age=31536000;samesite=lax`
    router.refresh()
  }
  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      <Languages className="h-3.5 w-3.5 text-gray-400 mr-0.5 shrink-0" />
      {LANGS.map((l) => (
        <button
          key={l}
          onClick={() => set(l)}
          aria-pressed={current === l}
          className={`text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors ${
            current === l ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  )
}
