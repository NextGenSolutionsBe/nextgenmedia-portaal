/**
 * Community management in de MCP-connector: comments en DM's indelen, voorstellen
 * schrijven en (enkel na bevestiging door een mens) versturen.
 *
 * ENKEL VIA DE OAUTH-ROUTE (/api/mcp). De tools bestaan alleen als de aanroeper
 * schrijven toestaat ÉN een context meegeeft met de identiteit van wie de
 * connector koppelde, de standaardregels en de verzendfunctie. De oude
 * sleutelroute en het lokale programma geven die context niet mee en zien deze
 * tools dus niet: het gaat om persoonsgegevens van mensen die reageren.
 *
 * Bewust .mjs (zoals content.mjs). De regels die ook in lib/community/model.ts
 * staan (status na indelen, open statussen, resterende tijd) zijn hier
 * overgenomen; tests/community.test.ts controleert dat ze gelijk blijven.
 *
 * Alleen klanten met community management AAN tellen mee. Staat het uit, dan
 * bestaan hun berichten voor deze tools niet (ze blijven wel in de databank).
 */

export const CATEGORIEEN = ['luchtig', 'vraag', 'kritiek', 'negatief_zonder_inhoud', 'toxisch', 'trefwoord', 'overig']
export const OPEN = ['nieuw', 'te_beantwoorden', 'bij_klant', 'klant_gekozen']
const ALLE_STATUSSEN = [...OPEN, 'verstuurd', 'genegeerd', 'verlopen', 'fout']
const STATUS_LABEL = { nieuw: 'nieuw', te_beantwoorden: 'te beantwoorden', bij_klant: 'bij klant', klant_gekozen: 'klant koos', verstuurd: 'verstuurd', genegeerd: 'genegeerd', verlopen: 'verlopen', fout: 'fout bij versturen' }
const MAX = 100

export function statusNaIndelen(categorie, klantKeurtGoed) {
  if (categorie === 'negatief_zonder_inhoud') return 'genegeerd'
  if (categorie === 'vraag' || categorie === 'kritiek') return klantKeurtGoed ? 'bij_klant' : 'te_beantwoorden'
  return 'te_beantwoorden'
}

export function resterendTekst(deadline, nu = Date.now()) {
  if (!deadline) return 'geen termijn'
  const ms = Date.parse(deadline) - nu
  if (Number.isNaN(ms)) return 'geen termijn'
  if (ms <= 0) return 'VERLOPEN'
  const u = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000)
  const t = u >= 48 ? `${Math.floor(u / 24)} d` : u >= 1 ? `${u} u ${m} min` : `${m} min`
  return ms < 4 * 3600_000 ? `nog ${t} (DRINGEND)` : `nog ${t}`
}

const schoon = (v, max = 2000) => String(v ?? '').trim().slice(0, max)
const kort = (v, max = 160) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s.length > max ? s.slice(0, max) + '…' : s }
const normaliseer = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const UUID = /^[0-9a-f-]{36}$/i

export const COMMUNITY_TOOLS = [
  {
    name: 'community_overzicht',
    description: 'Community management: per klant (enkel klanten waarvoor het aan staat) het aantal berichten per status en de eerstvolgende deadline om te antwoorden.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'community_regels',
    description: 'De afspraken voor community management van één klant: tone of voice, regels (of de standaardregels als die nog leeg zijn), cheat sheet met trefwoorden en links, voorbeeldantwoorden, en of de klant vragen en kritiek zelf goedkeurt. Lees dit vóór je berichten van die klant indeelt.',
    inputSchema: { type: 'object', properties: { klant: { type: 'string', description: 'Naam van de klant (deels mag).' } }, required: ['klant'], additionalProperties: false },
  },
  {
    name: 'community_berichten',
    description: 'Comments en DM\'s ophalen. Standaard enkel open berichten (nieuw, te beantwoorden, bij klant, klant koos), gesorteerd op deadline. Toont per bericht het id, de klant, het kanaal, het netwerk, de resterende tijd, een stuk van de post en de comment.',
    inputSchema: {
      type: 'object',
      properties: {
        klant: { type: 'string', description: 'Naam van de klant (deels mag).' },
        kanaal: { type: 'string', description: 'Naam van het kanaal (Metricool-merk), deels mag.' },
        netwerk: { type: 'string', enum: ['instagram', 'facebook', 'tiktok', 'linkedin', 'youtube', 'x'] },
        status: { type: 'array', items: { type: 'string', enum: ALLE_STATUSSEN } },
        categorie: { type: 'array', items: { type: 'string', enum: CATEGORIEEN } },
        sinds: { type: 'string', description: 'Enkel berichten ontvangen vanaf deze datum (JJJJ-MM-DD).' },
        zoek: { type: 'string', description: 'Zoek in de tekst van het bericht of de naam van de auteur.' },
        limiet: { type: 'number', description: `Maximum aantal (standaard 50, hoogstens ${MAX}).` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'community_bericht',
    description: 'Alles van één bericht: de post, de comment of DM, de draad als die bekend is, eerdere voorstellen en de regels van de klant.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Het id van het bericht (uit community_berichten).' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'community_verwerken',
    description: 'Een bericht indelen en antwoordvoorstellen bewaren, in één keer. De status volgt uit de categorie: luchtig, trefwoord, toxisch en overig → te beantwoorden; vraag en kritiek → bij klant (als de klant goedkeurt), anders te beantwoorden; negatief_zonder_inhoud → genegeerd, zonder voorstellen. Verstuurt niets. Weigert als het bericht niet meer open is.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        categorie: { type: 'string', enum: CATEGORIEEN },
        reden: { type: 'string', description: 'Korte uitleg waarom deze categorie.' },
        voorstellen: {
          type: 'array', description: 'Twee of drie antwoordvoorstellen (leeg bij negatief_zonder_inhoud).',
          items: { type: 'object', properties: { tekst: { type: 'string' }, toelichting: { type: 'string' } }, required: ['tekst'] },
        },
      },
      required: ['id', 'categorie', 'reden'],
      additionalProperties: false,
    },
  },
  {
    name: 'community_status',
    description: 'Een bericht handmatig negeren of terugzetten naar "nieuw" (bv. om het opnieuw in te delen).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, status: { type: 'string', enum: ['genegeerd', 'nieuw'] } }, required: ['id', 'status'], additionalProperties: false },
  },
  {
    name: 'community_versturen',
    description:
      'Een antwoord online zetten via Metricool. Alleen gebruiken nadat een mens in dit gesprek expliciet heeft bevestigd welke tekst verstuurd wordt. Nooit gebruiken vanuit een scheduled task. ' +
      'Weigert als de status niet "te beantwoorden" of "klant koos" is, als de termijn om te antwoorden voorbij is, of als bevestigd_door leeg is. Komt met naam in het auditlog.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        tekst: { type: 'string', description: 'De exacte tekst die de mens bevestigde.' },
        bevestigd_door: { type: 'string', description: 'Naam van de mens die deze tekst in dit gesprek bevestigde.' },
      },
      required: ['id', 'tekst', 'bevestigd_door'],
      additionalProperties: false,
    },
  },
]
export const COMMUNITY_TOOL_NAMEN = COMMUNITY_TOOLS.map((t) => t.name)

// ── Hulpjes ─────────────────────────────────────────────────────────────────

/** Klanten met community management aan: [{ id, naam, inst }]. */
async function actieveKlanten(sb) {
  const { data: inst, error } = await sb.from('community_instellingen').select('*').eq('actief', true)
  if (error) throw new Error(error.message)
  const ids = (inst ?? []).map((i) => i.client_id)
  if (!ids.length) return []
  const { data: kl } = await sb.from('clients').select('id, company_name').in('id', ids)
  const naam = new Map((kl ?? []).map((k) => [k.id, k.company_name]))
  return (inst ?? []).map((i) => ({ id: i.client_id, naam: naam.get(i.client_id) ?? '(zonder naam)', inst: i })).sort((a, b) => a.naam.localeCompare(b.naam))
}

function kiesKlant(klanten, naam) {
  const z = normaliseer(naam)
  if (!z) throw new Error('Geef een klantnaam op.')
  const exact = klanten.filter((k) => normaliseer(k.naam) === z)
  if (exact.length === 1) return exact[0]
  const bevat = klanten.filter((k) => normaliseer(k.naam).includes(z) || z.includes(normaliseer(k.naam)))
  if (bevat.length === 1) return bevat[0]
  if (bevat.length > 1) throw new Error(`"${naam}" past op meerdere klanten: ${bevat.map((k) => k.naam).join(', ')}. Wees specifieker.`)
  throw new Error(`Geen klant met community management aan voor "${naam}". Actief: ${klanten.map((k) => k.naam).join(', ') || 'geen'}.`)
}

async function berichtVan(sb, id, klanten) {
  if (!UUID.test(String(id ?? ''))) throw new Error('Geef een geldig bericht-id.')
  const { data: b, error } = await sb.from('community_berichten').select('*').eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  const klant = b ? klanten.find((k) => k.id === b.client_id) : null
  if (!b || !klant) throw new Error('Bericht niet gevonden (of community management staat uit voor deze klant).')
  return { b, klant }
}

async function noteer(sb, ctx, actie, id, samenvatting, meta) {
  try {
    const { error } = await sb.from('audit_log').insert({
      action: actie, entity_type: 'community_bericht', entity_id: id, summary: samenvatting,
      actor_user_id: ctx.actor?.userId ?? null, actor_email: ctx.actor?.email ?? 'mcp-connector', actor_role: 'admin',
      metadata: { via: 'mcp', actor_naam: ctx.actor?.naam ?? null, ...(meta ?? {}) },
    })
    return error ? `audit mislukt: ${error.message}` : null
  } catch (e) {
    return `audit mislukt: ${e instanceof Error ? e.message : 'onbekend'}`
  }
}

function regelsAlsTekst(klant, standaardregels, kanalen) {
  const i = klant.inst
  const cheat = Array.isArray(i.cheat_sheet) ? i.cheat_sheet : []
  const vb = Array.isArray(i.voorbeeldantwoorden) ? i.voorbeeldantwoorden : []
  return [
    `# Community management — ${klant.naam}`,
    '',
    `Klant keurt vragen en kritiek zelf goed: **${i.klant_keurt_goed ? 'ja' : 'nee (wij handelen alles af)'}**`,
    kanalen?.length ? `Kanalen: ${kanalen.map((k) => `${k.naam} (${(k.netwerken ?? []).join(', ') || 'geen netwerken'})${k.actief ? '' : ' — uit'}`).join('; ')}` : 'Kanalen: geen',
    '',
    '## Tone of voice',
    schoon(i.tone_of_voice, 5000) || '_(niet ingevuld)_',
    '',
    '## Regels',
    schoon(i.regels, 10000) || `_(nog geen eigen regels — dit zijn de standaardregels)_\n${standaardregels ?? ''}`,
    '',
    '## Cheat sheet',
    cheat.length ? cheat.map((c) => `- **${c.trefwoord || '?'}**: ${c.antwoord || ''}${c.link ? ` — ${c.link}` : ''}`).join('\n') : '_(leeg)_',
    '',
    '## Voorbeeldantwoorden',
    vb.length ? vb.map((v) => `- Comment: "${v.comment}"\n  Antwoord: "${v.antwoord}"`).join('\n') : '_(leeg)_',
  ].join('\n')
}

function berichtRegel(b, klantNaam, kanaalNaam) {
  return [
    `### ${b.id}`,
    `${klantNaam} · ${kanaalNaam ?? '?'} · ${b.netwerk} ${b.bron === 'dm' ? 'DM' : 'comment'} · ${STATUS_LABEL[b.status] ?? b.status}${b.categorie ? ` · ${b.categorie}` : ''} · ${resterendTekst(b.antwoord_mogelijk_tot)}`,
    b.post_tekst ? `Post: "${kort(b.post_tekst, 120)}"` : null,
    `${b.auteur_naam ?? 'Onbekend'}: "${kort(b.tekst, 400)}"`,
  ].filter(Boolean).join('\n')
}

// ── Uitvoeren ─────────────────────────────────────────────────────────────

/**
 * ctx (enkel van /api/mcp): { actor: { userId, email, naam }, standaardregels,
 *   verstuur: ({ berichtId, tekst, bevestigdDoor }) => Promise<{ ok, fout?, verstuurdOp? }> }
 */
export async function roepCommunityTool(sb, naam, args = {}, ctx) {
  if (!ctx?.verstuur || !ctx?.actor) throw new Error(`${naam} is hier niet beschikbaar.`)
  const klanten = await actieveKlanten(sb)

  if (naam === 'community_overzicht') {
    if (!klanten.length) return 'Community management staat voor geen enkele klant aan.'
    const { data, error } = await sb.from('community_berichten').select('client_id, status, antwoord_mogelijk_tot').in('client_id', klanten.map((k) => k.id)).in('status', [...OPEN, 'fout'])
    if (error) throw new Error(error.message)
    const regels = ['# Community management — overzicht', '']
    for (const k of klanten) {
      const rijen = (data ?? []).filter((r) => r.client_id === k.id)
      const per = {}
      for (const r of rijen) per[r.status] = (per[r.status] ?? 0) + 1
      const deadlines = rijen.filter((r) => OPEN.includes(r.status) && r.antwoord_mogelijk_tot).map((r) => r.antwoord_mogelijk_tot).sort()
      const telling = [...OPEN, 'fout'].filter((s) => per[s]).map((s) => `${STATUS_LABEL[s]}: ${per[s]}`).join(', ') || 'niets open'
      regels.push(`- **${k.naam}** — ${telling}${deadlines.length ? ` · eerstvolgende deadline ${resterendTekst(deadlines[0])}` : ''}`)
    }
    return regels.join('\n')
  }

  if (naam === 'community_regels') {
    const klant = kiesKlant(klanten, args?.klant)
    const { data: kanalen } = await sb.from('community_kanalen').select('naam, netwerken, actief').eq('client_id', klant.id).order('naam')
    return regelsAlsTekst(klant, ctx.standaardregels, kanalen ?? [])
  }

  if (naam === 'community_berichten') {
    let doel = klanten
    if (args?.klant) doel = [kiesKlant(klanten, args.klant)]
    if (!doel.length) return 'Community management staat voor geen enkele klant aan.'
    const { data: kanalen } = await sb.from('community_kanalen').select('id, client_id, naam').in('client_id', doel.map((k) => k.id))
    let kanaalIds = null
    if (args?.kanaal) {
      const z = normaliseer(args.kanaal)
      kanaalIds = (kanalen ?? []).filter((k) => normaliseer(k.naam).includes(z)).map((k) => k.id)
      if (!kanaalIds.length) throw new Error(`Geen kanaal gevonden voor "${args.kanaal}". Kanalen: ${(kanalen ?? []).map((k) => k.naam).join(', ') || 'geen'}.`)
    }
    const statussen = Array.isArray(args?.status) ? args.status.filter((s) => ALLE_STATUSSEN.includes(s)) : []
    const categorieen = Array.isArray(args?.categorie) ? args.categorie.filter((c) => CATEGORIEEN.includes(c)) : []
    const limiet = Math.min(Math.max(Number(args?.limiet) || 50, 1), MAX)
    let q = sb.from('community_berichten').select('id, client_id, kanaal_id, bron, netwerk, post_tekst, auteur_naam, tekst, status, categorie, antwoord_mogelijk_tot, ontvangen_op')
      .in('client_id', doel.map((k) => k.id)).in('status', statussen.length ? statussen : OPEN)
    if (kanaalIds) q = q.in('kanaal_id', kanaalIds)
    if (args?.netwerk) q = q.eq('netwerk', String(args.netwerk))
    if (categorieen.length) q = q.in('categorie', categorieen)
    if (args?.sinds) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.sinds))) throw new Error('"sinds" moet JJJJ-MM-DD zijn.')
      q = q.gte('ontvangen_op', `${args.sinds}T00:00:00Z`)
    }
    if (args?.zoek) {
      const z = String(args.zoek).replace(/[%,()]/g, ' ').trim().slice(0, 100)
      if (z) q = q.or(`tekst.ilike.%${z}%,auteur_naam.ilike.%${z}%`)
    }
    const { data, error } = await q.order('antwoord_mogelijk_tot', { ascending: true, nullsFirst: false }).order('ontvangen_op', { ascending: true }).limit(limiet + 1)
    if (error) throw new Error(error.message)
    const rijen = (data ?? []).slice(0, limiet)
    if (!rijen.length) return 'Geen berichten gevonden met deze filters.'
    const klantNaam = new Map(klanten.map((k) => [k.id, k.naam]))
    const kanaalNaam = new Map((kanalen ?? []).map((k) => [k.id, k.naam]))
    return [
      `${rijen.length} bericht(en)${(data ?? []).length > limiet ? ` (er zijn er meer; verhoog de limiet of filter)` : ''}:`,
      '',
      rijen.map((b) => berichtRegel(b, klantNaam.get(b.client_id), kanaalNaam.get(b.kanaal_id))).join('\n\n'),
    ].join('\n')
  }

  if (naam === 'community_bericht') {
    const { b, klant } = await berichtVan(sb, args?.id, klanten)
    const [{ data: kanaal }, { data: kanalen }] = await Promise.all([
      sb.from('community_kanalen').select('naam').eq('id', b.kanaal_id).maybeSingle(),
      sb.from('community_kanalen').select('naam, netwerken, actief').eq('client_id', klant.id).order('naam'),
    ])
    let draad = []
    if (b.bron === 'dm' && b.parent_extern_id) {
      const { data } = await sb.from('community_berichten').select('id, auteur_naam, tekst, ontvangen_op, status').eq('kanaal_id', b.kanaal_id).eq('bron', 'dm').eq('parent_extern_id', b.parent_extern_id).neq('id', b.id).order('ontvangen_op').limit(30)
      draad = data ?? []
    } else if (b.post_extern_id) {
      const { data } = await sb.from('community_berichten').select('id, auteur_naam, tekst, ontvangen_op, status').eq('kanaal_id', b.kanaal_id).eq('bron', 'comment').eq('post_extern_id', b.post_extern_id).neq('id', b.id).order('ontvangen_op').limit(30)
      draad = data ?? []
    }
    const voorstellen = Array.isArray(b.voorstellen) ? b.voorstellen : []
    return [
      `# Bericht ${b.id}`,
      `${klant.naam} · ${kanaal?.naam ?? '?'} · ${b.netwerk} ${b.bron === 'dm' ? 'DM' : 'comment'} · ${STATUS_LABEL[b.status] ?? b.status} · ${resterendTekst(b.antwoord_mogelijk_tot)}`,
      b.categorie ? `Categorie: ${b.categorie}${b.categorie_reden ? ` — ${b.categorie_reden}` : ''}` : 'Nog niet ingedeeld.',
      '',
      b.bron === 'comment' ? `## Post\n${schoon(b.post_tekst, 3000) || '_(geen tekst)_'}${b.post_url ? `\n${b.post_url}` : ''}` : null,
      '',
      `## ${b.bron === 'dm' ? 'DM' : 'Comment'} van ${b.auteur_naam ?? 'onbekend'}${b.ontvangen_op ? ` (${b.ontvangen_op})` : ''}`,
      schoon(b.tekst, 4000) || '_(geen tekst, bv. enkel een bijlage)_',
      draad.length ? `\n## Draad (andere berichten bij dezelfde ${b.bron === 'dm' ? 'conversatie' : 'post'})\n${draad.map((d) => `- ${d.auteur_naam ?? '?'}: "${kort(d.tekst, 300)}" (${STATUS_LABEL[d.status] ?? d.status})`).join('\n')}` : null,
      voorstellen.length ? `\n## Voorstellen\n${voorstellen.map((v, n) => `${n + 1}. ${v.tekst}${v.toelichting ? ` _(${v.toelichting})_` : ''}`).join('\n')}` : null,
      b.gekozen_tekst ? `\n## Gekozen tekst\n${b.gekozen_tekst}` : null,
      b.verstuur_fout ? `\n> Versturen mislukte: ${b.verstuur_fout}` : null,
      '',
      '---',
      regelsAlsTekst(klant, ctx.standaardregels, kanalen ?? []),
    ].filter((x) => x !== null).join('\n')
  }

  if (naam === 'community_verwerken') {
    const { b, klant } = await berichtVan(sb, args?.id, klanten)
    if (!OPEN.includes(b.status)) throw new Error(`Dit bericht staat op "${STATUS_LABEL[b.status] ?? b.status}" en is niet meer open.`)
    const categorie = String(args?.categorie ?? '')
    if (!CATEGORIEEN.includes(categorie)) throw new Error(`Onbekende categorie. Mogelijk: ${CATEGORIEEN.join(', ')}.`)
    const reden = schoon(args?.reden, 1000)
    if (!reden) throw new Error('Geef een korte reden voor de categorie.')
    const voorstellen = categorie === 'negatief_zonder_inhoud' ? [] : (Array.isArray(args?.voorstellen) ? args.voorstellen : [])
      .map((v) => ({ tekst: schoon(typeof v === 'string' ? v : v?.tekst), toelichting: typeof v === 'object' && v?.toelichting ? schoon(v.toelichting, 500) : null }))
      .filter((v) => v.tekst).slice(0, 5)
    const status = statusNaIndelen(categorie, klant.inst.klant_keurt_goed !== false)
    const { data, error } = await sb.from('community_berichten')
      .update({ categorie, categorie_reden: reden, voorstellen, status, ingedeeld_door: 'claude', bijgewerkt_op: new Date().toISOString() })
      .eq('id', b.id).in('status', OPEN).select('id')
    if (error) throw new Error(error.message)
    if (!data?.length) throw new Error('Dit bericht werd intussen gewijzigd en is niet meer open.')
    const auditFout = await noteer(sb, ctx, 'community.verwerken', b.id, `${categorie} → ${STATUS_LABEL[status]} (${voorstellen.length} voorstel(len))`, { client_id: klant.id, categorie, status, van: b.status })
    return `Bewaard: ${categorie} → **${STATUS_LABEL[status]}**, ${voorstellen.length} voorstel(len). Er werd niets verstuurd.${auditFout ? `\n> ${auditFout}` : ''}`
  }

  if (naam === 'community_status') {
    const { b, klant } = await berichtVan(sb, args?.id, klanten)
    const naar = String(args?.status ?? '')
    if (naar !== 'genegeerd' && naar !== 'nieuw') throw new Error('Status kan enkel "genegeerd" of "nieuw" zijn.')
    const mag = naar === 'genegeerd' ? [...OPEN, 'fout'] : [...OPEN, 'genegeerd', 'fout']
    if (!mag.includes(b.status)) throw new Error(`Van "${STATUS_LABEL[b.status] ?? b.status}" naar "${STATUS_LABEL[naar]}" kan niet.`)
    const { data } = await sb.from('community_berichten').update({ status: naar, bijgewerkt_op: new Date().toISOString() }).eq('id', b.id).eq('status', b.status).select('id')
    if (!data?.length) throw new Error('Dit bericht werd intussen gewijzigd.')
    const auditFout = await noteer(sb, ctx, 'community.status', b.id, `${STATUS_LABEL[b.status]} → ${STATUS_LABEL[naar]}`, { client_id: klant.id, van: b.status, naar })
    return `Status: ${STATUS_LABEL[b.status]} → **${STATUS_LABEL[naar]}**.${auditFout ? `\n> ${auditFout}` : ''}`
  }

  if (naam === 'community_versturen') {
    const { b } = await berichtVan(sb, args?.id, klanten)
    const u = await ctx.verstuur({ berichtId: b.id, tekst: String(args?.tekst ?? ''), bevestigdDoor: String(args?.bevestigd_door ?? '') })
    if (!u.ok) throw new Error(`Niet verstuurd: ${u.fout}`)
    return `Verstuurd via Metricool (${b.netwerk} ${b.bron === 'dm' ? 'DM' : 'comment'}), bevestigd door ${schoon(args?.bevestigd_door, 200)}.`
  }

  throw new Error(`Onbekend gereedschap: ${naam}`)
}
