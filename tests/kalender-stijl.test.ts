import assert from 'node:assert/strict'
import { controleerFaseKleuren, controleerLabel, geldigeLabelIds, isKleur, meng, tekstOp, tinten } from '../lib/content/kalender-stijl'
import { magPersonaliseren, type KalenderRechten } from '../lib/content/kalender-rol'

let ok = 0
const t = (naam: string, f: () => void) => { f(); ok++; void naam }

t('label: naam verplicht, spaties opgekuist, max 40', () => {
  assert.deepEqual(controleerLabel({ naam: '  Nieuwbouw   project ', kleur: '#22C55E' }), { label: { naam: 'Nieuwbouw project', kleur: '#22c55e' } })
  assert.ok('fout' in controleerLabel({ naam: '   ' }))
  assert.ok('fout' in controleerLabel({ naam: 'x'.repeat(41) }))
  assert.equal((controleerLabel({ naam: 'Renovatiepand', kleur: 'rood' }) as { label: { kleur: string } }).label.kleur, '#6b7280')
  assert.equal((controleerLabel({ naam: 'x', kleur: 'url(javascript:1)' }) as { label: { kleur: string } }).label.kleur, '#6b7280')
})

t('fasekleuren: enkel gekende fases met een geldige kleur', () => {
  assert.deepEqual(controleerFaseKleuren({ approved: '#14B8A6', onbekend: '#ffffff', draft: 'blauw', scheduled: '#3b82f6' }), { approved: '#14b8a6', scheduled: '#3b82f6' })
  assert.deepEqual(controleerFaseKleuren(null), {})
  assert.deepEqual(controleerFaseKleuren('x'), {})
})

t('labels op een post: enkel van deze klant, geen dubbels, max 10', () => {
  const eigen = new Set(['a', 'b', 'c'])
  assert.deepEqual(geldigeLabelIds(['a', 'x', 'a', 'c', 3], eigen), ['a', 'c'])
  assert.deepEqual(geldigeLabelIds('a', eigen), [])
  const veel = new Set(Array.from({ length: 15 }, (_, i) => `l${i}`))
  assert.equal(geldigeLabelIds(Array.from(veel), veel).length, 10)
})

t('kleuren mengen en leesbare tekst', () => {
  assert.equal(meng('#000000', 1), '#ffffff')
  assert.equal(meng('#ffffff', -1), '#000000')
  assert.equal(meng('#3b82f6', 0), '#3b82f6')
  const k = tinten('#ef4444')
  assert.ok(isKleur(k.achtergrond) && isKleur(k.rand) && isKleur(k.tekst))
  assert.equal(tinten('ongeldig').stip, '#6b7280')
  assert.equal(tekstOp('#eab308'), '#111827') // geel: donkere tekst
  assert.equal(tekstOp('#fff848'), '#111827')
  assert.equal(tekstOp('#111827'), '#ffffff')
  assert.equal(tekstOp('#3b82f6'), '#ffffff')
})

t('personaliseren: wie items mag aanmaken of aanpassen', () => {
  const basis: KalenderRechten = { rol: 'bekijken', bekijken: true, opmerkingen: false, aanmaken: false, bewerkbaar: [], verwijderen: 'nooit', goedkeuren: [], afkeuren: [], overgangen: {}, startStatussen: [] }
  assert.equal(magPersonaliseren(basis), false)
  assert.equal(magPersonaliseren({ ...basis, goedkeuren: ['ready_for_review'] }), false)
  assert.equal(magPersonaliseren({ ...basis, bewerkbaar: ['draft'] }), true)
  assert.equal(magPersonaliseren({ ...basis, aanmaken: true }), true)
})

console.log(`kalender-stijl: ${ok} tests geslaagd`)
