import 'server-only'

/**
 * Een contract-pdf ophalen, met terugval op het contractarchief.
 *
 * Normaal staat de pdf in de bucket `contracts`. Is hij daar weg (bv. een klant
 * die per ongeluk verwijderd en daarna teruggezet werd), dan bestaat er vaak
 * nog een kopie in het archief (`contract-archief/<id>/vN/contract-getekend.pdf`).
 * Dan halen we die op en zetten we hem terug op het verwachte pad, zodat elke
 * andere plek (klantapp, tegentekenen, downloads) hem daarna ook vindt.
 */

const CONTRACT_BUCKET = 'contracts'
const ARCHIEF = 'contract-archief'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any; storage: any }

export async function contractPdf(admin: Admin, contractId: string, pad: string | null | undefined): Promise<Blob | null> {
  if (pad) {
    const { data, error } = await admin.storage.from(CONTRACT_BUCKET).download(pad)
    if (!error && data) return data as Blob
  }
  const { data: rij } = await admin.from('contract_archief').select('pad_contract, versie').eq('contract_id', contractId).order('versie', { ascending: false }).limit(1).maybeSingle()
  if (!rij?.pad_contract) return null
  const { data: kopie, error } = await admin.storage.from(ARCHIEF).download(rij.pad_contract)
  if (error || !kopie) return null
  if (pad) {
    // Terugzetten mag mislukken (bv. bestaat intussen): het bestand zelf hebben we.
    try { await admin.storage.from(CONTRACT_BUCKET).upload(pad, kopie, { contentType: 'application/pdf', upsert: false }) } catch { /* */ }
  }
  return kopie as Blob
}
