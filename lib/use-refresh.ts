'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Reliable "refresh this page" action for sidebar buttons.
 *
 * `router.refresh()` re-fetches server-component data, but on its own the
 * spinner can flicker off before the new data is painted, making it feel like
 * nothing happened. This hook:
 *   - keeps the spinner on for a guaranteed minimum (so it's visibly doing work)
 *   - calls router.refresh() to pull fresh server data
 *   - is safe against unmount (no state update after unmount)
 */
export function useRefresh(minSpinMs = 600) {
  const router = useRouter()
  const [spinning, setSpinning] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const refresh = useCallback(() => {
    if (spinning) return
    setSpinning(true)
    router.refresh()
    window.setTimeout(() => {
      if (mounted.current) setSpinning(false)
    }, minSpinMs)
  }, [router, spinning, minSpinMs])

  return { refresh, spinning }
}
