/**
 * Opslagverbruik van de app in Supabase (databank + bestanden), afgezet tegen
 * de 100 GB van het Supabase-abonnement. Die 100 GB delen we met andere
 * projecten; hier tellen we enkel wat deze app gebruikt.
 * De ruwe cijfers komen uit de databankfunctie `opslag_verbruik()`.
 */

export const OPSLAG_LIMIET_GB = 100
const GB = 1024 ** 3

/** Vanaf hier verschijnt een melding (in procent van de limiet). */
export const OPSLAG_LET_OP = 70
export const OPSLAG_KRITIEK = 90

export type RuwVerbruik = {
  databank_bytes?: number | null
  buckets?: { bucket: string; bytes: number | null; bestanden: number | null }[] | null
}

export type OpslagDeel = { sleutel: string; label: string; bytes: number; bestanden: number | null }

export type Opslag = {
  totaalBytes: number
  databankBytes: number
  bestandenBytes: number
  limietBytes: number
  procent: number
  niveau: 'ok' | 'let_op' | 'kritiek'
  delen: OpslagDeel[]
}

const LABELS: Record<string, string> = {
  'fof-instagram': "Founders of Flanders: Instagram-video's",
  'fof-media': 'Founders of Flanders: media',
  'founders-media': "Founders of Flanders: voorbeeldvideo's",
  'client-uploads': 'Klantuploads',
  opleveringen: 'Video-opleveringen',
  contracts: 'Contracten',
  'contract-archief': 'Contractarchief',
  aanvragen: 'Aanvragen',
  personeel: 'Personeel',
  archief: 'Archief',
  marketing: 'Nieuwsbrieven en partners',
}

export function bucketLabel(bucket: string): string {
  return LABELS[bucket] ?? bucket
}

export function samenvatting(ruw: RuwVerbruik | null | undefined, limietGb = OPSLAG_LIMIET_GB): Opslag {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)
  const databankBytes = num(ruw?.databank_bytes)
  const buckets = (ruw?.buckets ?? []).filter((b) => b && typeof b.bucket === 'string')
  const delen: OpslagDeel[] = buckets
    .map((b) => ({ sleutel: b.bucket, label: bucketLabel(b.bucket), bytes: num(b.bytes), bestanden: typeof b.bestanden === 'number' ? b.bestanden : null }))
  delen.push({ sleutel: 'databank', label: 'Databank', bytes: databankBytes, bestanden: null })
  delen.sort((a, b) => b.bytes - a.bytes)
  const bestandenBytes = delen.filter((d) => d.sleutel !== 'databank').reduce((s, d) => s + d.bytes, 0)
  const totaalBytes = bestandenBytes + databankBytes
  const limietBytes = Math.max(1, limietGb) * GB
  const procent = Math.min(999, (totaalBytes / limietBytes) * 100)
  const niveau = procent >= OPSLAG_KRITIEK ? 'kritiek' : procent >= OPSLAG_LET_OP ? 'let_op' : 'ok'
  return { totaalBytes, databankBytes, bestandenBytes, limietBytes, procent, niveau, delen }
}

/** 2 813 000 000 → "2,6 GB"; kleine waarden in MB of kB. */
export function grootte(bytes: number): string {
  const b = Math.max(0, bytes || 0)
  const fmt = (n: number, d: number) => n.toLocaleString('nl-BE', { minimumFractionDigits: d, maximumFractionDigits: d })
  if (b >= GB) return `${fmt(b / GB, b >= 10 * GB ? 1 : 2)} GB`
  if (b >= 1024 ** 2) return `${fmt(b / 1024 ** 2, 0)} MB`
  if (b >= 1024) return `${fmt(b / 1024, 0)} kB`
  return `${b} B`
}
