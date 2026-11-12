// Client-side fetch-helpers die NOOIT een cryptische "Unexpected token … is not
// valid JSON" gooien. Bij een time-out/crash geeft de server soms een platte-
// tekst foutpagina terug (bv. Vercel "An error occurred …"); we vangen dat op en
// geven een leesbare melding.

async function request(method: string, url: string, body?: unknown) {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Geen verbinding met de server (netwerkfout of time-out). Probeer opnieuw, of genereer 1 blog tegelijk.')
  }

  const text = await res.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { /* geen JSON → platte-tekst foutpagina */ }

  if (data === null && text) {
    // Niet-JSON antwoord = meestal een time-out of serverfout.
    if (res.status === 504 || res.status === 408 || /timeout|time-?out|FUNCTION_INVOCATION_TIMEOUT/i.test(text)) {
      throw new Error('De server deed er te lang over (time-out). Genereer 1 blog tegelijk en probeer opnieuw.')
    }
    throw new Error(`Serverfout (${res.status}). Probeer het opnieuw.`)
  }

  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error || `Serverfout (${res.status}).`
    throw new Error(msg)
  }
  return (data ?? {}) as Record<string, unknown>
}

export const postJson = (url: string, body?: unknown) => request('POST', url, body)
export const patchJson = (url: string, body?: unknown) => request('PATCH', url, body)
