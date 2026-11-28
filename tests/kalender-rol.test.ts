// Rol in de contentplanning per klant — wat elke rol wel en niet kan.
//
//   npx tsx tests/kalender-rol.test.ts
//
// De portaalroutes beslissen met exact deze functies (kalenderPoort → kalenderRechten,
// magBewerken, magOvergang, magBeoordelen, magVerwijderen, startStatussen), dus wat
// hier geweigerd wordt, weigert de server ook — ook bij een zelfgemaakte API-aanroep.

import assert from 'node:assert/strict'
import {
  kalenderRechten, magBewerken, magOvergang, magBeoordelen, magVerwijderen, statusOvergangen, kanGoedkeuren,
  opmerkingTekst, isKalenderRol, leesKalenderRol, ROL_INFO, ROL_VOLGORDE, type KalenderRechten, type KalenderRol,
} from '../lib/content/kalender-rol'
import { presetPermissions } from '../lib/portal-permissions'

let n = 0
const test = (naam: string, fn: () => void | Promise<void>) => Promise.resolve(fn()).then(() => { n++; console.log(`  ✓ ${naam}`) })
console.log('\nRol in de contentplanning\n')

const EIGENAAR = { isOwner: true, perms: {} }
const UIT = { kalender_beheer: false, kalender_beheer_wie: 'alle', kalender_beheer_eigenaar: true }
const STATUSSEN = ['draft', 'ready_for_review', 'approved', 'changes_requested', 'scheduled', 'published'] as const
const rechten = (rol: KalenderRol | null) => kalenderRechten(rol, UIT, EIGENAAR)
const item = (status: string, eigen = false) => ({ status, klant_aangemaakt_op: eigen ? '2026-10-13T08:00:00Z' : null })

/** Kan deze gebruiker ook maar iets veranderen aan inhoud of status? */
function wijzigtIets(r: KalenderRechten) {
  return r.aanmaken || r.bewerkbaar.length > 0 || r.verwijderen !== 'nooit' || r.goedkeuren.length > 0 || r.afkeuren.length > 0
    || STATUSSEN.some((s) => statusOvergangen(r, s).length > 0) || r.startStatussen.length > 0
}

async function main() {
  await test('Standaard (leeg) = precies de werking van vóór de rollen: bekijken + goedkeuren/aanpassing vragen', () => {
    const r = rechten(null)
    assert.equal(r.rol, 'standaard'); assert.equal(r.bekijken, true)
    assert.deepEqual(r.goedkeuren, ['ready_for_review', 'changes_requested'])
    assert.deepEqual(r.afkeuren, ['ready_for_review', 'changes_requested'])
    assert.equal(r.opmerkingen, false); assert.equal(r.aanmaken, false); assert.deepEqual(r.bewerkbaar, []); assert.equal(r.verwijderen, 'nooit')
    for (const s of STATUSSEN) assert.deepEqual(statusOvergangen(r, s), [])
    assert.equal(magBeoordelen(r, 'draft', 'approved'), false, 'een concept kan je niet goedkeuren via de review')
    assert.equal(magBeoordelen(r, 'published', 'approved'), false)
    // Een onbekende waarde in de databank valt ook terug op Standaard, nooit op meer.
    assert.equal(kalenderRechten('alles' as unknown as KalenderRol, UIT, EIGENAAR).rol, 'standaard')
  })

  await test('Standaard met het vroegere kalenderbeheer aan: dat blijft gelden (niets verandert vóór er een rol gekozen wordt)', () => {
    const r = kalenderRechten(null, { ...UIT, kalender_beheer: true }, EIGENAAR)
    assert.equal(r.aanmaken, true); assert.equal(r.verwijderen, 'altijd')
    assert.deepEqual(statusOvergangen(r, 'draft'), ['approved', 'scheduled'])
    assert.deepEqual(statusOvergangen(r, 'ready_for_review'), [])
    // Een gekozen rol vervangt het oude beheer.
    assert.equal(kalenderRechten('bekijken', { ...UIT, kalender_beheer: true }, EIGENAAR).aanmaken, false)
  })

  await test('Geen toegang: de kalender gaat niet open en niets mag', () => {
    const r = rechten('geen')
    assert.equal(r.bekijken, false); assert.equal(r.opmerkingen, false); assert.equal(wijzigtIets(r), false)
  })

  await test('Alleen bekijken: alles zien, niets aanpassen, toevoegen, goedkeuren of becommentariëren', () => {
    const r = rechten('bekijken')
    assert.equal(r.bekijken, true); assert.equal(r.opmerkingen, false); assert.equal(wijzigtIets(r), false)
    for (const s of STATUSSEN) {
      assert.equal(magBewerken(r, item(s)), false)
      assert.equal(magBeoordelen(r, s, 'approved'), false); assert.equal(magBeoordelen(r, s, 'changes_requested'), false)
      assert.equal(magVerwijderen(r, item(s, true)), false)
      for (const naar of STATUSSEN) assert.equal(magOvergang(r, s, naar), false)
    }
    assert.equal(kanGoedkeuren(r), false)
  })

  await test('Feedback geven: opmerkingen plaatsen, maar geen content, datum of status wijzigen', () => {
    const r = rechten('feedback')
    assert.equal(r.bekijken, true); assert.equal(r.opmerkingen, true); assert.equal(wijzigtIets(r), false)
    assert.equal(magBeoordelen(r, 'ready_for_review', 'changes_requested'), false, 'een aanpassing vragen is een statuswijziging')
    assert.equal(magBeoordelen(r, 'ready_for_review', 'approved'), false)
  })

  await test('Meewerken: aanmaken, aanpassen tot de goedkeuring en ter goedkeuring voorleggen — geen definitieve status', () => {
    const r = rechten('meewerken')
    assert.equal(r.opmerkingen, true); assert.equal(r.aanmaken, true)
    assert.deepEqual(r.startStatussen, ['draft', 'ready_for_review'], 'een nieuw item kan niet meteen ingepland worden')
    for (const s of ['draft', 'ready_for_review', 'changes_requested']) assert.equal(magBewerken(r, item(s)), true, s)
    for (const s of ['approved', 'scheduled', 'published']) assert.equal(magBewerken(r, item(s)), false, s)
    assert.equal(magOvergang(r, 'draft', 'ready_for_review'), true)
    assert.equal(magOvergang(r, 'changes_requested', 'ready_for_review'), true)
    for (const van of STATUSSEN) for (const naar of ['approved', 'scheduled', 'published', 'changes_requested']) assert.equal(magOvergang(r, van, naar), false, `${van}→${naar}`)
    for (const s of STATUSSEN) { assert.equal(magBeoordelen(r, s, 'approved'), false); assert.equal(magBeoordelen(r, s, 'changes_requested'), false) }
    assert.equal(kanGoedkeuren(r), false)
    // Verwijderen: enkel een eigen concept, nooit content van NextGenMedia of een voorgelegd item.
    assert.equal(magVerwijderen(r, item('draft', true)), true)
    assert.equal(magVerwijderen(r, item('draft', false)), false)
    assert.equal(magVerwijderen(r, item('ready_for_review', true)), false)
  })

  await test('Contentplanning beheren: aanmaken, aanpassen, goedkeuren/afkeuren, inplannen en als gepubliceerd markeren', () => {
    const r = rechten('beheren')
    assert.equal(r.opmerkingen, true); assert.equal(r.aanmaken, true)
    assert.deepEqual(r.startStatussen, ['draft', 'ready_for_review', 'scheduled'])
    for (const s of STATUSSEN) assert.equal(magBewerken(r, item(s)), true)
    assert.equal(magBeoordelen(r, 'ready_for_review', 'approved'), true)
    assert.equal(magBeoordelen(r, 'ready_for_review', 'changes_requested'), true)
    assert.equal(magOvergang(r, 'draft', 'approved'), true)
    assert.equal(magOvergang(r, 'approved', 'scheduled'), true)
    assert.equal(magOvergang(r, 'scheduled', 'published'), true)
    assert.equal(magOvergang(r, 'approved', 'published'), true)
    assert.equal(magOvergang(r, 'published', 'scheduled'), true, 'een vergissing terugdraaien')
    assert.equal(magOvergang(r, 'draft', 'published'), false, 'niet publiceren zonder goedkeuring of planning')
    assert.equal(magVerwijderen(r, item('approved')), true)
    assert.equal(kanGoedkeuren(r), true)
  })

  await test('Eigen rechten van subaccounts blijven gelden binnen de rol', () => {
    const sub = (preset: Parameters<typeof presetPermissions>[0]) => ({ isOwner: false, perms: presetPermissions(preset).social_media ?? {} })
    // Alleen-lezen subaccount bij een beherende klant: enkel kijken.
    const ro = kalenderRechten('beheren', UIT, sub('readonly'))
    assert.equal(ro.bekijken, true); assert.equal(ro.opmerkingen, false); assert.equal(wijzigtIets(ro), false)
    // Marketing-subaccount (alle social-rechten) = de volle rol.
    assert.deepEqual(kalenderRechten('beheren', UIT, sub('marketing')), rechten('beheren'))
    // Zonder social media in de rechten (bv. Financieel): ook bij Beheren geen kalender.
    assert.equal(kalenderRechten('beheren', UIT, sub('financieel')).bekijken, false)
    // Enkel goedkeuren uitgezet: wel inplannen, niet goedkeuren (ook niet concept → goedgekeurd).
    const geenGoedkeuring = kalenderRechten('beheren', UIT, { isOwner: false, perms: { view: true, edit: true, feedback: true } })
    assert.equal(magBeoordelen(geenGoedkeuring, 'ready_for_review', 'approved'), false)
    assert.equal(magOvergang(geenGoedkeuring, 'draft', 'approved'), false)
    assert.equal(magOvergang(geenGoedkeuring, 'approved', 'scheduled'), true)
    // Een ruimere rol geeft nooit méér dan de eigen rechten: zonder bewerkrecht geen aanmaken bij Meewerken.
    assert.equal(kalenderRechten('meewerken', UIT, { isOwner: false, perms: { view: true, feedback: true } }).aanmaken, false)
  })

  await test('De rol van één klant wijzigen verandert niets bij een andere klant', async () => {
    // Nagebootste databank; de server leest de rol altijd op de geresolveerde clientId.
    const db = maakDb({ a: 'beheren', b: 'bekijken' })
    const bVoor = kalenderRechten(await leesKalenderRol(db, 'b'), UIT, EIGENAAR)
    db.zet('a', 'geen')   // enkel klant a wijzigen, zoals de beheerroute doet (.eq('id', a))
    assert.equal(await leesKalenderRol(db, 'a'), 'geen')
    assert.equal(kalenderRechten(await leesKalenderRol(db, 'a'), UIT, EIGENAAR).bekijken, false)
    assert.deepEqual(kalenderRechten(await leesKalenderRol(db, 'b'), UIT, EIGENAAR), bVoor)
    assert.deepEqual(db.gefilterd, ['b', 'a', 'a', 'b'], 'elke lezing filtert op precies één klant')
    // Kolom nog niet gemigreerd → Standaard, geen fout.
    assert.equal(await leesKalenderRol(maakDb({}, true), 'a'), null)
  })

  await test('Opmerkingen: niet leeg, maximaal 2000 tekens', () => {
    assert.equal(opmerkingTekst('  Mag de hook korter?  '), 'Mag de hook korter?')
    assert.throws(() => opmerkingTekst('   '), /opmerking/)
    assert.throws(() => opmerkingTekst('x'.repeat(2001)), /2000/)
  })

  await test('Elke rol heeft een duidelijke naam en uitleg; enkel geldige waarden worden bewaard', () => {
    for (const r of ROL_VOLGORDE) { assert.ok(ROL_INFO[r].label.length > 3); assert.ok(ROL_INFO[r].uitleg.length > 20) }
    assert.equal(isKalenderRol('beheren'), true); assert.equal(isKalenderRol('admin'), false); assert.equal(isKalenderRol('standaard'), false)
  })

  console.log(`\n${n} tests geslaagd\n`)
}

/** Minimale Supabase-vorm: from('clients').select(...).eq('id', x).maybeSingle(). */
function maakDb(rollen: Record<string, string | null>, kolomOntbreekt = false) {
  const gefilterd: string[] = []
  return {
    gefilterd,
    zet: (id: string, rol: string | null) => { rollen[id] = rol },
    from: (tabel: string) => ({
      select: () => ({
        eq: (kolom: string, id: string) => ({
          maybeSingle: async () => {
            assert.equal(tabel, 'clients'); assert.equal(kolom, 'id'); gefilterd.push(id)
            if (kolomOntbreekt) return { data: null, error: { message: 'column clients.kalender_rol does not exist' } }
            return { data: id in rollen ? { kalender_rol: rollen[id] } : null, error: null }
          },
        }),
      }),
    }),
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
