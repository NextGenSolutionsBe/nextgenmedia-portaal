// Een foto (van een bonnetje of factuur) in de browser omzetten naar JPEG van
// max. 2000 px: sneller op te laden en leesbaar voor de AI (een iPhone-foto in
// HEIC wordt zo ook JPEG). Lukt het niet, dan gaat het origineel. Enkel in de browser.

const MAX_PX = 2000

export async function alsJpeg(f: File): Promise<File> {
  if (!f.type.startsWith('image/') || f.type === 'image/gif') return f
  if ((f.type === 'image/jpeg' || f.type === 'image/png') && f.size < 900 * 1024) return f
  try {
    const beeld = await createImageBitmap(f)
    const schaal = Math.min(1, MAX_PX / Math.max(beeld.width, beeld.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(beeld.width * schaal); canvas.height = Math.round(beeld.height * schaal)
    canvas.getContext('2d')?.drawImage(beeld, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', 0.85))
    if (!blob) return f
    return new File([blob], (f.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch { return f }
}

/** Een bestandsnaam met extensie (een foto van de camera heeft soms geen naam). */
export const naamMetExtensie = (f: File, standaard: string) =>
  f.name && /\.[a-z0-9]+$/i.test(f.name) ? f.name : `${standaard}.${(f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`
