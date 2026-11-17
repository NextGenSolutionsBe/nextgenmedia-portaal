// Algemene contracten: regels, stempelen op de PDF, tekenen door ons en door de andere partij, taken.
// Uitvoeren: npx tsx tests/algemene-contracten.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict'
import Module from 'module'
import { PDFDocument } from 'pdf-lib'

const mails: any[] = []
const M = Module as unknown as { _load: (req: string, parent: unknown, isMain: boolean) => unknown }
const origineel = M._load
M._load = function (req: string, parent: unknown, isMain: boolean) {
  if (req === 'server-only') return {}
  if (req === '@/lib/email') {
    return {
      baseUrl: () => 'https://app.test',
      EMAIL_FROM: 'NextGenMedia <noreply@test>',
      resendKeyFor: () => undefined,
      sendEmail: async (o: any) => { mails.push(o); return { ok: true, id: 'm1' } },
      sendEmailMetAfzenderTerugval: async (o: any) => { mails.push(o); return { ok: true, id: 'm2' } },
    }
  }
  return origineel.call(this, req, parent, isMain)
}

/* eslint-disable @typescript-eslint/no-require-imports */
const model = require('../lib/algemene-contracten/model') as typeof import('../lib/algemene-contracten/model')
const { stempelBlok, pdfInfo } = require('../lib/algemene-contracten/pdf') as typeof import('../lib/algemene-contracten/pdf')
const server = require('../lib/algemene-contracten/server') as typeof import('../lib/algemene-contracten/server')
const { algemeneTaken } = require('../lib/te-tekenen') as typeof import('../lib/te-tekenen')
/* eslint-enable @typescript-eslint/no-require-imports */

let ok = 0
async function test(naam: string, f: () => void | Promise<void>) {
  try { await f(); ok++; console.log(`  ✓ ${naam}`) } catch (e) { console.error(`  ✗ ${naam}`); throw e }
}

// Een geldige PNG-handtekening (groot genoeg voor leesHandtekening).
async function pngDataUrl(): Promise<string> {
  const { deflateSync } = await import('zlib')
  const w = 200, h = 60
  const rij = Buffer.alloc(1 + w * 4)
  const rauw = Buffer.concat(Array.from({ length: h }, (_, y) => { const r = Buffer.from(rij); for (let x = 0; x < w; x++) { const v = (x * 7 + y * 13) % 256; r[1 + x * 4] = v; r[2 + x * 4] = 255 - v; r[3 + x * 4] = (x * y) % 256; r[4 + x * 4] = 255 } return r }))
  const crcTabel = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTabel[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const blok = (type: string, data: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), blok('IHDR', ihdr), blok('IDAT', deflateSync(rauw)), blok('IEND', Buffer.alloc(0))])
  return `data:image/png;base64,${png.toString('base64')}`
}

async function voorbeeldPdf(paginas = 2): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (let i = 0; i < paginas; i++) pdf.addPage([595.28, 841.89]).drawText(`Pagina ${i + 1}`, { x: 50, y: 780 })
  return pdf.save()
}

/** Nepdatabank + opslag: genoeg voor de tekenstroom. */
function nepAdmin(start: { contracten?: any[]; links?: any[] } = {}) {
  const t: Record<string, any[]> = { algemene_contracten: start.contracten ?? [], algemene_contract_links: start.links ?? [], algemene_contract_events: [], algemene_contract_mappen: [], email_messages: [] }
  const opslag = new Map<string, Uint8Array>()
  const from = (tabel: string) => {
    const filters: ((r: any) => boolean)[] = []
    let upd: any = null, ins: any = null, del = false
    const q: any = {
      select: () => q, order: () => q, limit: () => q,
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q },
      is: (k: string, v: unknown) => { filters.push((r) => (r[k] ?? null) === v); return q },
      in: (k: string, v: unknown[]) => { filters.push((r) => v.includes(r[k])); return q },
      update: (u: any) => { upd = u; return q },
      insert: (r: any) => { ins = r; return q },
      delete: () => { del = true; return q },
      maybeSingle: async () => ({ data: t[tabel].find((r) => filters.every((f) => f(r))) ?? null, error: null }),
      single: async () => { const r = { id: `id-${t[tabel].length + 1}`, ...ins }; t[tabel].push(r); return { data: r, error: null } },
      then: (okf: any, nok: any) => {
        let res: any
        if (ins) { const r = { id: `id-${t[tabel].length + 1}`, created_at: new Date().toISOString(), ...ins }; t[tabel].push(r); res = { data: [r], error: null } }
        else if (upd) { const hits = t[tabel].filter((r) => filters.every((f) => f(r))); hits.forEach((r) => Object.assign(r, upd)); res = { data: hits.map((r) => ({ id: r.id })), error: null } }
        else if (del) { t[tabel] = t[tabel].filter((r) => !filters.every((f) => f(r))); res = { data: null, error: null } }
        else res = { data: t[tabel].filter((r) => filters.every((f) => f(r))), error: null }
        return Promise.resolve(res).then(okf, nok)
      },
    }
    return q
  }
  return {
    t, opslag, from,
    storage: {
      from: () => ({
        download: async (p: string) => (opslag.has(p) ? { data: new Blob([opslag.get(p)! as BlobPart]), error: null } : { data: null, error: { message: 'niet gevonden' } }),
        upload: async (p: string, b: Uint8Array) => { opslag.set(p, new Uint8Array(b)); return { error: null } },
        createSignedUrl: async (p: string) => ({ data: { signedUrl: `https://opslag/${p}` } }),
        remove: async () => ({ error: null }),
      }),
    },
  }
}

const contract = (extra: Record<string, unknown> = {}) => ({
  id: 'c1', map_id: null, titel: 'Huurovereenkomst kantoor', tegenpartij: 'Corda Campus', tegenpartij_email: 'verhuur@voorbeeld.be', labels: ['kantoor'],
  notitie: null, begin_datum: null, eind_datum: null, bestand_naam: 'huur.pdf', bestand_grootte: 100, bestand_pad: 'origineel/x/huur.pdf', huidig_pad: null,
  ons_nodig: true, ondertekenaar: 'Bram', ons_zone: null, ons_getekend_op: null, ons_getekend_door: null,
  partij_nodig: true, partij_zone: { page: 2, x: 55, y: 78, w: 200, h: 70 }, partij_getekend_op: null, partij_naam: null, partij_geopend_op: null,
  laatst_verstuurd_op: null, gearchiveerd_op: null, created_at: '2026-11-10T09:00:00Z', created_by: null, versie: 1, paginas: 2, ...extra,
})

async function main() {
  console.log('\nAlgemene contracten\n')

  await test('status: eerst wij, dan de andere partij, anders getekend of bewaard', () => {
    const s = (o: any) => model.statusVan({ ons_nodig: false, ons_getekend_op: null, partij_nodig: false, partij_getekend_op: null, ...o })
    assert.equal(s({ ons_nodig: true }), 'wacht_op_ons')
    assert.equal(s({ ons_nodig: true, partij_nodig: true, partij_getekend_op: 'x' }), 'wacht_op_ons', 'de andere partij tekende eerst')
    assert.equal(s({ ons_nodig: true, ons_getekend_op: 'x', partij_nodig: true }), 'wacht_op_partij')
    assert.equal(s({ ons_nodig: true, ons_getekend_op: 'x', partij_nodig: true, partij_getekend_op: 'y' }), 'getekend')
    assert.equal(s({}), 'bewaard')
    assert.equal(model.statusLabel({ ons_nodig: false, ons_getekend_op: null, partij_nodig: true, partij_getekend_op: null, tegenpartij: 'AG Insurance' }), 'Wacht op AG Insurance')
  })

  await test('gegevens nakijken: titel verplicht, e-mail, datums, labels, ondertekenaar', () => {
    assert.ok('fout' in model.controleerVelden({ titel: '  ' }))
    assert.ok('fout' in model.controleerVelden({ titel: 'NDA', tegenpartij_email: 'geen-mail' }))
    assert.ok('fout' in model.controleerVelden({ titel: 'NDA', begin_datum: '2026-05-01', eind_datum: '2026-04-01' }))
    assert.ok('fout' in model.controleerVelden({ titel: 'NDA', ondertekenaar: 'Chiara' }))
    const v = model.controleerVelden({ titel: ' NDA   Partner ', tegenpartij_email: 'Jan@Voorbeeld.be', labels: ['Auto', 'auto', ' leasing ', ''], partij_nodig: true }) as { velden: any }
    assert.equal(v.velden.titel, 'NDA Partner')
    assert.equal(v.velden.tegenpartij_email, 'jan@voorbeeld.be')
    assert.deepEqual(v.velden.labels, ['Auto', 'leasing'])
    assert.equal(v.velden.ons_nodig, true, 'standaard tekenen wij')
    assert.equal(v.velden.partij_nodig, true)
    // Aanpassen: enkel wat meekomt.
    assert.deepEqual((model.controleerVelden({ labels: 'a, b' }, true) as { velden: any }).velden, { labels: ['a', 'b'] })
  })

  await test('filteren en zoeken: map, label, status, loopt af, archief', () => {
    const l = [
      { ...contract(), id: 'a', map_id: 'm1', labels: ['kantoor'], titel: 'Huur kantoor', eind_datum: '2026-12-31' },
      { ...contract(), id: 'b', map_id: 'm2', labels: ['auto'], titel: 'Leasing bestelwagen', ons_getekend_op: 'x', tegenpartij: 'Arval' },
      { ...contract(), id: 'c', map_id: null, labels: [], titel: 'Oude polis', gearchiveerd_op: 'x' },
    ] as any[]
    const ids = (f: any) => model.filter(l, f, '2026-11-17').map((c) => c.id)
    assert.deepEqual(ids({}), ['a', 'b'])
    assert.deepEqual(ids({ map: 'm1' }), ['a'])
    assert.deepEqual(ids({ map: 'zonder' }), [])
    assert.deepEqual(ids({ label: 'AUTO' }), ['b'])
    assert.deepEqual(ids({ status: 'wacht_op_partij' }), ['b'])
    assert.deepEqual(ids({ status: 'loopt_af' }), ['a'])
    assert.deepEqual(ids({ zoek: 'arval wagen' }), ['b'])
    assert.deepEqual(ids({ archief: true }), ['c'])
    assert.deepEqual(model.labelsInGebruik(l).map((x) => x.label), ['auto', 'kantoor'])
  })

  await test('mail: ter ondertekening of het getekende document', () => {
    assert.equal(model.mailVoorstel({ titel: 'NDA', tegenpartij: 'Jan', partij_nodig: true, partij_getekend_op: null, ons_getekend_op: 'x' }).knop, 'Bekijken en ondertekenen')
    const m = model.mailVoorstel({ titel: 'NDA', tegenpartij: null, partij_nodig: false, partij_getekend_op: null, ons_getekend_op: 'x' })
    assert.equal(m.onderwerp, 'Ondertekend: NDA')
    assert.match(m.tekst, /^Beste,/)
    assert.equal(model.downloadNaam({ titel: 'Huur: kantoor Hasselt', ons_getekend_op: 'x', partij_getekend_op: null }), 'Huur-kantoor-Hasselt-getekend.pdf')
  })

  await test('stempelen: handtekening met naam en datum op de gekozen pagina, origineel ongewijzigd', async () => {
    const bron = await voorbeeldPdf(2)
    const kopie = new Uint8Array(bron)
    const png = Buffer.from((await pngDataUrl()).split(',')[1], 'base64')
    const r = await stempelBlok(bron, png, { page: 9, x: 120, y: 80, w: 999, h: 5 }, ['Bram Reinquin · NextGenMedia', '17 november 2026, 14:32'])
    assert.deepEqual(r.zone, { page: 2, x: 98, y: 80, w: 400, h: 24 }, 'de zone blijft binnen de pagina')
    assert.equal((await pdfInfo(r.bytes)).paginas, 2)
    assert.ok(r.bytes.length > bron.length)
    assert.deepEqual(bron, kopie)
  })

  await test('wij tekenen: nieuwe kopie, versie omhoog, nooit twee keer', async () => {
    const a = nepAdmin({ contracten: [contract()] })
    a.opslag.set('origineel/x/huur.pdf', await voorbeeldPdf(2))
    const hand = await pngDataUrl()
    await assert.rejects(server.tekenOns(a, 'c1', { handtekening: 'data:image/png;base64,AAAA' }, { userId: 'u', email: 'b@test', naam: 'Bram Reinquin' }), /Teken eerst/)
    await server.tekenOns(a, 'c1', { handtekening: hand, zone: { page: 2, x: 8, y: 78, w: 200, h: 70 }, partij_zone: { page: 2, x: 60, y: 78, w: 200, h: 70 } }, { userId: 'u', email: 'b@test', naam: 'Bram Reinquin' })
    const c = a.t.algemene_contracten[0]
    assert.equal(c.ons_getekend_door, 'Bram Reinquin')
    assert.equal(c.versie, 2)
    assert.match(c.huidig_pad, /^getekend\/c1-\d+-ons\.pdf$/)
    assert.equal(c.partij_zone.x, 60, 'de plek voor de andere partij is mee bewaard')
    assert.ok(a.opslag.has('origineel/x/huur.pdf'), 'origineel blijft')
    assert.ok(a.t.algemene_contract_events.some((e) => e.actie === 'ons_getekend'))
    await assert.rejects(server.tekenOns(a, 'c1', { handtekening: hand }, { userId: 'u', email: 'b@test', naam: 'Bram Reinquin' }), /al door ons ondertekend/)
  })

  await test('versturen: persoonlijke link, PDF als bijlage, link niet in het logboek', async () => {
    const a = nepAdmin({ contracten: [contract({ ons_getekend_op: '2026-11-17T10:00:00Z', huidig_pad: 'getekend/c1.pdf' })] })
    a.opslag.set('getekend/c1.pdf', await voorbeeldPdf(2))
    mails.length = 0
    await assert.rejects(server.verstuurMail(a, 'c1', { to_email: 'a@b.be, c@d.be', subject: 'x' }, { userId: 'u', email: null }), /één geldig/)
    await server.verstuurMail(a, 'c1', { to_email: 'Verhuur@Voorbeeld.be', subject: 'Ter ondertekening', body: 'Beste', cta_text: 'Bekijken en ondertekenen' }, { userId: 'u', email: 'b@test' })
    assert.equal(mails.length, 1)
    assert.equal(mails[0].to, 'verhuur@voorbeeld.be')
    assert.equal(mails[0].attachments?.[0]?.filename, 'Huurovereenkomst-kantoor-getekend.pdf')
    assert.match(mails[0].html, /https:\/\/app\.test\/document\/[A-Za-z0-9_-]{40,}/)
    const log = a.t.email_messages[0]
    assert.doesNotMatch(log.html, /document\/[A-Za-z0-9_-]{40,}/, 'het logboek bewaart de link niet')
    assert.equal(a.t.algemene_contract_links.length, 1)
    assert.equal(a.t.algemene_contract_links[0].email, 'verhuur@voorbeeld.be')
    assert.ok(a.t.algemene_contracten[0].laatst_verstuurd_op)
  })

  await test('de andere partij tekent via de link; verlopen link of dubbel tekenen kan niet', async () => {
    const a = nepAdmin({ contracten: [contract({ ons_getekend_op: '2026-11-17T10:00:00Z', huidig_pad: 'getekend/c1.pdf', versie: 2 })] })
    a.opslag.set('getekend/c1.pdf', await voorbeeldPdf(2))
    mails.length = 0
    await server.verstuurMail(a, 'c1', { to_email: 'jan@voorbeeld.be', subject: 'x', body: 'y' }, { userId: 'u', email: null })
    const token = String(mails[0].html.match(/document\/([A-Za-z0-9_-]{40,})/)[1])
    const hand = await pngDataUrl()
    assert.equal(await server.vindLink(a, 'kort'), null)
    await assert.rejects(server.tekenPartij(a, token, { naam: 'Jan Peeters', handtekening: hand, akkoord: false }, { ip: null, ua: null }), /Bevestig/)
    await assert.rejects(server.tekenPartij(a, token, { naam: 'J', handtekening: hand, akkoord: true }, { ip: null, ua: null }), /volledige naam/)
    mails.length = 0
    await server.tekenPartij(a, token, { naam: 'Jan Peeters', handtekening: hand, akkoord: true }, { ip: '1.2.3.4', ua: 'Safari' })
    const c = a.t.algemene_contracten[0]
    assert.equal(c.partij_naam, 'Jan Peeters')
    assert.equal(c.partij_email, 'jan@voorbeeld.be')
    assert.equal(c.versie, 3)
    assert.match(c.huidig_pad, /-partij\.pdf$/)
    assert.equal(model.statusVan(c), 'getekend')
    assert.equal(mails.length, 1, 'interne melding')
    await assert.rejects(server.tekenPartij(a, token, { naam: 'Jan Peeters', handtekening: hand, akkoord: true }, { ip: null, ua: null }), /al ondertekend/)
    // Verlopen link.
    a.t.algemene_contract_links[0].verloopt_op = '2020-01-01T00:00:00Z'
    assert.equal(await server.vindLink(a, token), null)
  })

  await test('taken: per persoon bij wie tekent (gezamenlijk of niemand = Marco en Bram)', () => {
    const t = algemeneTaken([
      { id: 'a', titel: 'Huur', tegenpartij: 'Corda', created_at: '2026-11-01T10:00:00Z', ondertekenaar: 'Bram' },
      { id: 'b', titel: 'NDA', tegenpartij: null, created_at: '2026-11-16T10:00:00Z', ondertekenaar: null },
    ], new Date('2026-11-17T10:00:00Z'))
    const per = (id: string) => t.find((x) => x.id === id)
    assert.deepEqual(per('algemeen:Bram')?.lijst?.map((x) => x.id), ['a', 'b'], 'oudste eerst')
    assert.deepEqual(per('algemeen:Marco')?.lijst?.map((x) => x.id), ['b'])
    assert.equal(per('algemeen:Bram')?.wat, '2 algemene contracten tekenen')
    assert.equal(per('algemeen:Bram')?.dringend, true)
    assert.equal(per('algemeen:Bram')?.href, '/admin/algemene-contracten/a/tekenen')
  })

  console.log(`\n${ok} tests geslaagd\n`)
}
main().catch((e) => { console.error(e); process.exit(1) })
