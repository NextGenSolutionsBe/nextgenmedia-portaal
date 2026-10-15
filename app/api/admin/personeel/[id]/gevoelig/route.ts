import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { encryptSecret } from '@/lib/crypto'
import { eisPersoneel, magGevoelig, audit } from '@/lib/personeel/server'
import { tekst, dagOf, isUuid } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/**
 * PUT — gevoelige persoonsgegevens (adres, geboortedatum, rijksregisternummer,
 * noodcontact, bankrekening). Enkel voor bevoegde admins. Rijksregisternummer
 * en IBAN worden versleuteld bewaard. In het logboek komt enkel wélk veld
 * wijzigde, nooit de waarde zelf.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    if (!(await magGevoelig(g.persoon))) return NextResponse.json({ error: 'Gevoelige persoonsgegevens zijn enkel voor bevoegde admins.' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const { data: bestaat } = await g.admin.from('personeel').select('id').eq('id', id).maybeSingle()
    if (!bestaat) return NextResponse.json({ error: 'Medewerker niet gevonden' }, { status: 404 })
    const { data: oud } = await g.admin.from('personeel_gevoelig').select('*').eq('personeel_id', id).maybeSingle()

    const rrn = tekst(b.rijksregisternummer, 30)
    if (rrn && rrn.replace(/\D/g, '').length !== 11) return NextResponse.json({ error: 'Een rijksregisternummer telt 11 cijfers.' }, { status: 400 })
    const iban = tekst(b.iban, 40)?.replace(/\s+/g, '').toUpperCase() ?? null
    if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(iban)) return NextResponse.json({ error: 'Dat lijkt geen geldig rekeningnummer (IBAN).' }, { status: 400 })

    const rij = {
      personeel_id: id,
      adres: tekst(b.adres, 500), geboortedatum: dagOf(b.geboortedatum), noodcontact: tekst(b.noodcontact, 500),
      rijksregisternummer_enc: rrn ? encryptSecret(rrn) : null, iban_enc: iban ? encryptSecret(iban) : null,
      updated_by: g.persoon.email, updated_at: new Date().toISOString(),
    }
    const { error } = await g.admin.from('personeel_gevoelig').upsert(rij, { onConflict: 'personeel_id' })
    if (error) throw new Error(error.message)
    const velden = ['adres', 'geboortedatum', 'noodcontact'].filter((k) => (oud?.[k] ?? null) !== (rij as Record<string, unknown>)[k])
    if (!!oud?.rijksregisternummer_enc !== !!rrn || (rrn && oud?.rijksregisternummer_enc)) velden.push('rijksregisternummer')
    if (!!oud?.iban_enc !== !!iban || (iban && oud?.iban_enc)) velden.push('bankrekening')
    await audit(g.admin, { personeel_id: id, entiteit: 'gevoelig', entiteit_id: id, actie: 'gevoelige_gegevens_bijgewerkt', nieuw: { velden }, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
