// Nieuwe projecten uit de mail: voorfilter, drempel, voorstellen voor de kaart, en Ja/Nee op de server.
// Uitvoeren: npx tsx tests/mail-projecten.test.ts
import assert from 'node:assert/strict'
import Module from 'node:module'
import {
  DREMPEL, bedrijfVoor, contactRegels, isVoorstel, kaartNotitie, kaartVoorProspect, leesKoppen, lijktFormulier, massamail, naamSleutel,
  naarOordeel, onderwerpSleutel, voorstelVerantwoordelijke,
} from '../lib/mail-opvolging/projecten'

let n = 0
const test = async (naam: string, fn: () => void | Promise<void>) => { await fn(); n++; console.log(`  ✓ ${naam}`) }

async function main() {
  console.log('\nNieuwe projecten uit de mail\n')

  await test('Voorfilter: nieuwsbrieven, meldingen en automatische mails vallen af', () => {
    const geen = new Map<string, string>()
    const m = (van: string, onderwerp = 'Vraag', koppen = geen, aantal = 1) => massamail({ van, onderwerp, koppen, aantalOntvangers: aantal })
    assert.equal(m('jan@bakkerijpeeters.be'), null, 'een gewone mail van een mens')
    assert.equal(m('info@bakkerijpeeters.be'), null, 'info@ van een bedrijf kan een klant zijn')
    assert.ok(m('noreply@bakkerijpeeters.be'))
    assert.ok(m('no-reply@x.be')); assert.ok(m('notifications@x.be')); assert.ok(m('mailer-daemon@x.be')); assert.ok(m('nieuwsbrief@x.be')); assert.ok(m('facturen@x.be'))
    assert.ok(m('jan@calendar-notification.google.com'), 'platform')
    assert.ok(m('team@mail.clickup.com'), 'subdomein van een platform')
    assert.ok(m('jan@x.be', 'Vraag', leesKoppen('List-Unsubscribe: <mailto:u@x.be>\r\n')), 'afmeldlink = nieuwsbrief')
    assert.ok(m('jan@x.be', 'Vraag', leesKoppen('Precedence: bulk\r\n')))
    assert.ok(m('jan@x.be', 'Vraag', leesKoppen('Auto-Submitted: auto-replied\r\n')))
    assert.equal(m('jan@x.be', 'Vraag', leesKoppen('Auto-Submitted: no\r\n')), null)
    assert.ok(m('jan@x.be', 'Automatisch antwoord: afwezig'))
    assert.ok(m('jan@x.be', 'Vraag', geen, 30), 'naar veel ontvangers')
  })

  await test('Voorfilter: een websiteformulier gaat altijd door', () => {
    assert.ok(lijktFormulier('Nieuwe inzending van het contactformulier'))
    assert.ok(lijktFormulier('New form submission: Offerte'))
    assert.ok(!lijktFormulier('Re: planning shoot'))
    assert.equal(massamail({ van: 'noreply@framer.com', onderwerp: 'New form submission', koppen: leesKoppen('List-Unsubscribe: <x>\r\n') }), null)
  })

  await test('Koppen lezen: hoofdletters en gevouwen regels', () => {
    const k = leesKoppen('List-Id: Nieuws\r\n <nieuws.x.be>\r\nX-AutoReply: yes\r\n')
    assert.equal(k.get('list-id'), 'Nieuws <nieuws.x.be>')
    assert.equal(k.get('x-autoreply'), 'yes')
  })

  await test('AI-antwoord nakijken: enkel geldige diensten, adres en zekerheid tussen 0 en 1', () => {
    const o = naarOordeel({
      nieuw_project: true, zekerheid: 1.4, hoort_bij_lopend_project: false, reden: 'Vraagt een prijs', titel: '  Nieuwe   website ',
      samenvatting: 'Jan vraagt een prijs voor een nieuwe website.', project: 'Website met webshop, start in januari.',
      diensten: ['webdesign', 'Google ads', 'koffie'], ads: 'google',
      contact: { bedrijf: 'Bakkerij Peeters BV', naam: 'Jan', email: 'JAN@Bakkerijpeeters.be', telefoon: '0470 12 34 56', website: '', btw: '' },
    })
    assert.equal(o.zekerheid, 1)
    assert.equal(o.titel, 'Nieuwe website')
    assert.deepEqual(o.diensten, ['webdesign', 'advertising'])
    assert.equal(o.contact.email, 'jan@bakkerijpeeters.be')
    assert.equal(o.contact.telefoon, '0470 12 34 56')
    assert.equal(o.contact.website, null)
    assert.equal(naarOordeel({ contact: { email: 'geen adres', telefoon: '12' } }).contact.email, null)
    assert.equal(naarOordeel(null).nieuw, false)
  })

  await test('Drempel: enkel een duidelijk nieuw project, los van wat al loopt', () => {
    const basis = naarOordeel({ nieuw_project: true, zekerheid: 0.85, samenvatting: 'Vraagt een offerte voor sociale media.' })
    assert.ok(isVoorstel(basis))
    assert.ok(!isVoorstel({ ...basis, zekerheid: DREMPEL - 0.01 }), 'te onzeker')
    assert.ok(!isVoorstel({ ...basis, nieuw: false }))
    assert.ok(!isVoorstel({ ...basis, lopend: true }), 'hoort bij een lopend project')
    assert.ok(!isVoorstel({ ...basis, samenvatting: null }), 'zonder samenvatting niets te beslissen')
    assert.ok(!isVoorstel(null))
  })

  await test('Verantwoordelijke: Bram voor media, Marco voor IT, samen bij beide', () => {
    assert.equal(voorstelVerantwoordelijke(['social_media', 'foto_video']), 'Bram')
    assert.equal(voorstelVerantwoordelijke(['webdesign']), 'Marco')
    assert.equal(voorstelVerantwoordelijke(['ngs']), 'Marco')
    assert.equal(voorstelVerantwoordelijke(['advertising'], 'meta'), 'Bram')
    assert.equal(voorstelVerantwoordelijke(['advertising'], 'google'), 'Marco')
    assert.equal(voorstelVerantwoordelijke(['advertising']), 'Gezamenlijke lead')
    assert.equal(voorstelVerantwoordelijke(['webdesign', 'social_media']), 'Gezamenlijke lead')
    assert.equal(voorstelVerantwoordelijke([]), 'Gezamenlijke lead')
  })

  await test('Bedrijf: de mailbox gaat voor, anders de diensten', () => {
    assert.equal(bedrijfVoor('info@nextgensolutions.be', ['social_media']), 'nextgensolutions')
    assert.equal(bedrijfVoor('info@nextgenmedia.be', ['ngs']), 'nextgensolutions')
    assert.equal(bedrijfVoor('info@nextgenmedia.be', ['ngs', 'webdesign']), 'nextgenmedia')
    assert.equal(bedrijfVoor('info@nextgenmedia.be', ['founders']), 'foundersofflanders')
    assert.equal(bedrijfVoor(null, []), 'nextgenmedia')
  })

  await test('Sleutels: bedrijfsnaam zonder rechtsvorm, onderwerp zonder Re:/Fw:', () => {
    assert.equal(naamSleutel('Bakkerij Peeters BV'), naamSleutel('bakkerij peeters'))
    assert.equal(naamSleutel('Garage Vos NV.'), 'garagevos')
    assert.equal(onderwerpSleutel('Re: Fw: Antw: Prijs voor website'), 'prijs voor website')
    assert.equal(onderwerpSleutel('RE:[2] Offerte'), 'offerte')
  })

  await test('Staat de prospect al op het bord? (zelfde adres of bedrijfsnaam)', () => {
    const kaarten = [
      { id: 'a', client_id: null, klant_vrij: 'Bakkerij Peeters', omschrijving: 'Contact: Jan', titel: 'Website', status: 'open' },
      { id: 'b', client_id: null, klant_vrij: 'Garage Vos', omschrijving: 'E-mail: tom@garagevos.be', titel: 'Ads', status: 'open' },
    ]
    assert.equal(kaartVoorProspect({ email: null, bedrijf: 'Bakkerij Peeters BV' }, kaarten)?.id, 'a')
    assert.equal(kaartVoorProspect({ email: 'TOM@garagevos.be', bedrijf: null }, kaarten)?.id, 'b')
    assert.equal(kaartVoorProspect({ email: null, bedrijf: null, van: 'tom@garagevos.be' }, kaarten)?.id, 'b')
    assert.equal(kaartVoorProspect({ email: 'an@slagerij.be', bedrijf: 'Slagerij An' }, kaarten), null)
    assert.equal(kaartVoorProspect({ email: null, bedrijf: 'BV' }, kaarten), null, 'te korte naam')
  })

  await test('Tekst op de kaart: contact en eerste notitie', () => {
    assert.equal(contactRegels({ bedrijf: 'X', naam: 'Jan', email: 'jan@x.be', telefoon: null, website: 'x.be', btw: null }), 'Contact: Jan\nE-mail: jan@x.be\nWebsite: x.be')
    const t = kaartNotitie({ van: 'jan@x.be', vanNaam: 'Jan Peeters', onderwerp: 'Prijs website', ontvangen: '2026-11-18T09:00:00Z', samenvatting: 'Jan vraagt een prijs.', project: 'Nieuwe website.' })
    assert.ok(t.startsWith('Nieuw project uit de mail van Jan Peeters (jan@x.be) op 18 november 2026 ("Prijs website").'))
    assert.ok(t.includes('Jan vraagt een prijs.') && t.includes('Project: Nieuwe website.'))
  })

  // ── Server: Ja maakt één kaart, Nee en terugzetten ─────────────────────────
  const orig = (Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown })._load
  ;(Module as unknown as { _load: (r: string, ...a: unknown[]) => unknown })._load = function (req: string, ...a: unknown[]) {
    if (req === 'server-only') return {}
    if (req === 'imapflow') return { ImapFlow: class {} }
    if (req === 'mailparser') return { simpleParser: async () => ({}) }
    if (req === '@/lib/sales/google-calendar' || req.endsWith('/sales/google-calendar')) return { lijstAgendaEvents: async () => [] }
    return orig.call(this, req, ...a)
  }
  const { maakKaartUitMail, zetMailProject } = await import('../lib/mail-opvolging/projecten-server')

  type Rij = Record<string, unknown>
  const db: Record<string, Rij[]> = {
    mail_projecten: [{
      id: '11111111-1111-1111-1111-111111111111', status: 'voorstel', mailbox: 'info@nextgenmedia.be', van: 'jan@bakkerijpeeters.be', van_naam: 'Jan Peeters',
      onderwerp: 'Prijs website', ontvangen_op: '2026-11-18T09:00:00Z', client_id: null, titel: 'Nieuwe website', samenvatting: 'Jan vraagt een prijs.', project: 'Website.',
      diensten: ['webdesign'], contact: { bedrijf: 'Bakkerij Peeters', naam: 'Jan Peeters', email: 'jan@bakkerijpeeters.be', telefoon: '0470 12 34 56' },
    }],
    opdrachten: [], opdracht_notities: [], clients: [],
  }
  let id = 0
  const fake = {
    from(t: string) {
      const rijen = (db[t] ??= [])
      const filters: ((r: Rij) => boolean)[] = []
      let patch: Rij | null = null, nieuw: Rij | null = null
      const q = {
        select() { return q }, order() { return q }, limit() { return q },
        eq(k: string, v: unknown) { filters.push((r) => r[k] === v); return q },
        update(p: Rij) { patch = p; return q },
        insert(p: Rij) { nieuw = { id: `00000000-0000-0000-0000-00000000000${++id}`, ...p }; rijen.push(nieuw); return q },
        maybeSingle: async () => ({ data: rijen.find((r) => filters.every((f) => f(r))) ?? null, error: null }),
        single: async () => ({ data: nieuw, error: null }),
        then(res: (v: unknown) => void) {
          const hits = rijen.filter((r) => filters.every((f) => f(r)))
          if (patch) for (const r of hits) Object.assign(r, patch)
          res({ data: patch ? hits.map((r) => ({ id: r.id })) : nieuw ? [nieuw] : hits, error: null })
        },
      }
      return q
    },
  }
  const ID = '11111111-1111-1111-1111-111111111111'
  const door = { email: 'bram@voorbeeld.be', naam: 'Bram' }

  await test('Ja zonder verantwoordelijke of titel: geweigerd, voorstel blijft open', async () => {
    await assert.rejects(maakKaartUitMail(fake, ID, { titel: 'Website' }, door), /verantwoordelijke/)
    await assert.rejects(maakKaartUitMail(fake, ID, { titel: '  ', verantwoordelijke: 'Marco' }, { ...door }).catch((e) => { throw e }), /titel/)
    assert.equal(db.mail_projecten[0].status, 'voorstel')
    assert.equal(db.opdrachten.length, 0)
  })

  await test('Ja: één kaart in Opvolging met de gegevens uit de mail, twee keer klikken = één kaart', async () => {
    const r = await maakKaartUitMail(fake, ID, { titel: 'Nieuwe website', klant: 'Bakkerij Peeters', diensten: ['webdesign'], merk: 'nextgenmedia', verantwoordelijke: 'Marco' }, door)
    assert.equal(db.opdrachten.length, 1)
    const k = db.opdrachten[0]
    assert.equal(k.status, 'open'); assert.equal(k.bron, 'inbound'); assert.equal(k.verantwoordelijke, 'Marco')
    assert.equal(k.klant_vrij, 'Bakkerij Peeters'); assert.equal(k.client_id, null)
    assert.ok(String(k.omschrijving).includes('E-mail: jan@bakkerijpeeters.be'))
    assert.equal(db.mail_projecten[0].status, 'ja'); assert.equal(db.mail_projecten[0].opdracht_id, r.opdrachtId)
    assert.ok(String(db.opdracht_notities[0]?.tekst ?? '').includes('Nieuw project uit de mail'))
    const nog = await maakKaartUitMail(fake, ID, { titel: 'Nieuwe website', verantwoordelijke: 'Marco' }, door)
    assert.equal(nog.opdrachtId, r.opdrachtId)
    assert.equal(db.opdrachten.length, 1)
  })

  await test('Nee en terugzetten: enkel vanuit de juiste stand', async () => {
    db.mail_projecten.push({ id: '22222222-2222-2222-2222-222222222222', status: 'voorstel' })
    await zetMailProject(fake, '22222222-2222-2222-2222-222222222222', 'nee', 'Bram')
    assert.equal(db.mail_projecten[1].status, 'nee')
    await assert.rejects(zetMailProject(fake, '22222222-2222-2222-2222-222222222222', 'nee', 'Bram'), /al beslist/)
    await zetMailProject(fake, '22222222-2222-2222-2222-222222222222', 'voorstel', 'Bram')
    assert.equal(db.mail_projecten[1].status, 'voorstel')
    await assert.rejects(zetMailProject(fake, ID, 'nee', 'Bram'), /al beslist/, 'een ja wordt nooit een nee')
  })

  console.log(`\n${n} tests geslaagd\n`)
}

main().catch((e) => { console.error(e); process.exit(1) })
