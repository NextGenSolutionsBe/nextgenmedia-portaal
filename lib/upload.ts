// Client-side helpers voor uploads. Vercel weigert request-bodies boven ~4,5 MB
// (HTTP 413) met een platte-tekstpagina; dan faalt res.json(). Deze helpers geven
// een nette melding en checken de bestandsgrootte vooraf.

export const MAX_UPLOAD_MB = 4

export function fileTooBig(file: File | null | undefined): boolean {
  return !!file && file.size > MAX_UPLOAD_MB * 1024 * 1024
}

/** Eén of meer bestanden te groot? */
export function anyFileTooBig(files: (File | null | undefined)[]): boolean {
  return files.some((f) => fileTooBig(f))
}

/** Leest een fetch-response veilig: JSON indien mogelijk, anders een nette fout.
 *  Gooit ook bij !res.ok (met de server-foutmelding indien beschikbaar). */
export async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  let data: Record<string, unknown> = {}
  if (text) {
    try { data = JSON.parse(text) } catch {
      if (res.status === 413) throw new Error(`Bestand te groot — max ${MAX_UPLOAD_MB} MB per upload.`)
      throw new Error(`Onverwachte serverfout (${res.status}).`)
    }
  }
  if (!res.ok) throw new Error((data.error as string) || `Fout (${res.status})`)
  return data
}
