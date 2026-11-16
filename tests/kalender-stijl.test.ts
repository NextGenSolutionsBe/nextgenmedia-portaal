import assert from 'node:assert/strict'
import {
  blokKleurHex, controleerFaseKleuren, controleerLabel, controleerNamen, controleerTypeKleuren, controleerWeergave, geldigeLabelIds, isKanaal, isKleur,
  kanaalChips, kanaalKleur, kanaalNaam, KANAAL_STANDAARD, leegStijl, meng, standaardBlokKleur, stijlUitRij, tekstOp, tinten, typeKleur, typeLabel, typeNaam, TYPES,
  type KalenderStijl,
} from '../lib/content/kalender-stijl'
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

t('typekleuren: enkel post, reel, story, carrousel met een geldige kleur', () => {
  assert.deepEqual(controleerTypeKleuren({ reel: '#A855F7', post: 'rood', story: '#f97316', video: '#000000' }), { reel: '#a855f7', story: '#f97316' })
  assert.deepEqual(controleerTypeKleuren(null), {})
  assert.deepEqual(controleerTypeKleuren([]), {})
  assert.deepEqual(leegStijl.typeKleuren, {})
})

t('kleur van een type: eigen kleur, anders standaard, onbekend grijs', () => {
  assert.equal(typeKleur('reel', { reel: '#22c55e' }), '#22c55e')
  assert.equal(typeKleur('reel', {}), TYPES.find((x) => x.key === 'reel')!.standaard)
  assert.equal(typeKleur('iets', { reel: '#22c55e' }), '#6b7280')
  // Elke soort een andere standaardkleur, zodat Type meteen iets zegt.
  assert.equal(new Set(TYPES.map((x) => x.standaard)).size, TYPES.length)
  assert.equal(typeLabel('carousel'), 'Carrousel')
  assert.equal(typeLabel('video'), 'Video')
})

t('eigen namen: enkel gekende sleutels, opgekuist, max 30', () => {
  assert.deepEqual(controleerNamen({ reel: '  Korte   video ', story: '', video: 'x', post: 5 }, (k) => ['post', 'reel', 'story', 'carousel'].includes(k)), { reel: 'Korte video' })
  assert.equal(controleerNamen({ meta: 'x'.repeat(50) }, isKanaal).meta!.length, 30)
  assert.deepEqual(controleerNamen(['meta'], isKanaal), {})
})

t('namen en kleuren van types en kanalen: eigen, anders standaard', () => {
  const st: KalenderStijl = { ...leegStijl, typeNamen: { reel: 'Video' }, kanaalNamen: { meta: 'Insta + FB' }, kanaalKleuren: { tiktok: '#ec4899' } }
  assert.equal(typeNaam('reel', st), 'Video')
  assert.equal(typeNaam('carousel', st), 'Carrousel')
  assert.equal(kanaalNaam('instagram', st), 'Insta + FB', 'instagram valt onder Meta')
  assert.equal(kanaalNaam('linkedin', st), 'LinkedIn')
  assert.equal(kanaalKleur('tiktok', st), '#ec4899')
  assert.equal(kanaalKleur('facebook', st), KANAAL_STANDAARD.meta)
  assert.equal(kanaalKleur('myspace', st), '#6b7280')
})

t('kanaallabels op een vakje: Meta als Instagram + Facebook, of één label met de eigen naam', () => {
  assert.deepEqual(kanaalChips(['meta', 'tiktok'], leegStijl).map((c) => c.label), ['Instagram', 'Facebook', 'TikTok'])
  const st: KalenderStijl = { ...leegStijl, kanaalNamen: { meta: 'Insta + FB' }, kanaalKleuren: { meta: '#a855f7' } }
  assert.deepEqual(kanaalChips(['meta', 'tiktok'], st), [{ slug: 'meta', label: 'Insta + FB', kleur: '#a855f7' }, { slug: 'tiktok', label: 'TikTok', kleur: null }])
  assert.deepEqual(kanaalChips(['instagram'], { ...leegStijl, kanaalKleuren: { meta: '#a855f7' } }), [{ slug: 'instagram', label: 'Instagram', kleur: '#a855f7' }])
})

t('kleur van een vakje volgens de keuze', () => {
  const st: KalenderStijl = { ...leegStijl, labels: [{ id: 'l1', naam: 'Nieuwbouw', kleur: '#22c55e' }], typeKleuren: { reel: '#a855f7' }, kanaalKleuren: { linkedin: '#111827' }, eenKleur: '#f97316' }
  const it = { content_type: 'reel', platforms: ['linkedin', 'meta'], labels: ['weg', 'l1'] }
  assert.equal(blokKleurHex(it, st, 'status'), null)
  assert.equal(blokKleurHex(it, st, 'planning'), null)
  assert.equal(blokKleurHex(it, st, 'type'), '#a855f7')
  assert.equal(blokKleurHex(it, st, 'kanaal'), '#111827', 'het eerste kanaal')
  assert.equal(blokKleurHex({ content_type: 'post', platform: 'instagram' }, st, 'kanaal'), KANAAL_STANDAARD.meta, 'oud item op instagram = Meta')
  assert.equal(blokKleurHex(it, st, 'label'), '#22c55e', 'eerste label dat nog bestaat')
  assert.equal(blokKleurHex({ content_type: 'post' }, st, 'label'), null, 'zonder label: geen kleur')
  assert.equal(blokKleurHex(it, st, 'een'), '#f97316')
  assert.equal(blokKleurHex(it, { ...st, eenKleur: null }, 'een'), '#3b82f6')
})

t('standaard kleur van de vakjes en de weergave uit de databank', () => {
  assert.equal(standaardBlokKleur(leegStijl), 'status')
  assert.equal(standaardBlokKleur({ ...leegStijl, typeKleuren: { reel: '#a855f7' } }), 'type')
  assert.equal(standaardBlokKleur({ ...leegStijl, typeKleuren: { reel: '#a855f7' }, blokKleur: 'label' }), 'label')
  const r = stijlUitRij({ fase_kleuren: { approved: '#22c55e' }, blok_kleur: 'onzin', een_kleur: 'rood', kanaal_namen: { meta: 'Meta' } })
  assert.equal(r.blokKleur, null)
  assert.equal(r.eenKleur, null)
  assert.deepEqual(r.kanaalNamen, { meta: 'Meta' })
  assert.deepEqual(stijlUitRij(null), { faseKleuren: {}, typeKleuren: {}, typeNamen: {}, kanaalKleuren: {}, kanaalNamen: {}, blokKleur: null, eenKleur: null })
})

t('weergave aanpassen: enkel wat meekomt, nagekeken', () => {
  assert.deepEqual(controleerWeergave({ blokKleur: 'kanaal' }), { kolommen: { blok_kleur: 'kanaal' } })
  assert.deepEqual(controleerWeergave({ blokKleur: null, eenKleur: '#ABCDEF' }), { kolommen: { blok_kleur: null, een_kleur: '#abcdef' } })
  assert.ok('fout' in controleerWeergave({ blokKleur: 'planning' }))
  assert.ok('fout' in controleerWeergave({ eenKleur: 'url(x)' }))
  assert.ok('fout' in controleerWeergave({ iets: 1 }))
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
