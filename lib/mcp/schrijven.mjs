/**
 * De schrijfkant van de MCP-connector: content inplannen en invullen.
 *
 * STAAT STANDAARD UIT. De aanroeper bepaalt of schrijven mag; de online route
 * zet het op false zolang daar alleen een sleutel in het adres staat. Wie dat
 * adres heeft zou anders content van álle klanten kunnen aanmaken en
 * overschrijven — de connector gaat met de service-role sleutel langs RLS heen.
 *
 * Drie dingen die hier bewust NIET kunnen: verwijderen, publiceren, en een klant
 * aanmaken. Dat blijft handwerk in de app.
 *
 * LET OP: op social_content_items staan GEEN check-constraints. De database
 * accepteert dus vrolijk content_type "reeel" of status "aproved". Alle
 * controle hieronder is het enige dat dat tegenhoudt.
 */

export const TYPES = ['reel', 'post', 'story', 'carousel']
export const STATUSSEN = ['draft', 'ready_for_review', 'approved', 'changes_requested']
export const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'tiktok']

const schoon = (v, max = 4000) => String(v ?? '').trim().slice(0, max)

function eisDatum(waarde) {
  const s = schoon(waarde, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`"${waarde}" is geen geldige datum. Gebruik JJJJ-MM-DD.`)
  }
  // LET OP: enkel op Invalid Date controleren is niet genoeg. JavaScript rolt
  // 30 februari stilletjes door naar 2 maart, dus een typefout als 2026-06-31
  // zou op een andere dag belanden zonder dat iemand het merkt. Daarom kijken
  // we of de datum er ná het inlezen nog hetzelfde uitziet.
  const [j, m, dag] = s.split('-').map(Number)
  const d = new Date(Date.UTC(j, m - 1, dag))
  if (
    Number.isNaN(d.getTime()) ||
    d.getUTCFullYear() !== j || d.getUTCMonth() !== m - 1 || d.getUTCDate() !== dag
  ) {
    throw new Error(`"${waarde}" bestaat niet als datum — die maand heeft geen dag ${dag}.`)
  }
  return s
}

function eisUitLijst(waarde, lijst, veld) {
  const s = schoon(waarde, 40).toLowerCase()
  if (!s) throw new Error(`Geef ${veld} op. Mogelijk: ${lijst.join(', ')}.`)
  if (!lijst.includes(s)) {
    throw new Error(`"${waarde}" kan niet als ${veld}. Mogelijk: ${lijst.join(', ')}.`)
  }
  return s
}

function eisPlatforms(waarde) {
  const ruw = Array.isArray(waarde) ? waarde : String(waarde ?? '').split(/[,\s]+/)
  const uit = []
  for (const p of ruw) {
    const s = schoon(p, 40).toLowerCase()
    if (!s) continue
    if (!PLATFORMS.includes(s)) {
      throw new Error(`"${p}" is geen bekend platform. Mogelijk: ${PLATFORMS.join(', ')}.`)
    }
    if (!uit.includes(s)) uit.push(s)
  }
  if (uit.length === 0) throw new Error(`Geef minstens één platform op: ${PLATFORMS.join(', ')}.`)
  return uit
}

/** Sporen nalaten. Mislukt dit, dan blokkeren we de actie niet — maar we
 *  vermelden het wél in het antwoord, zodat een gat in het auditspoor zichtbaar is. */
async function noteer(sb, actie, id, samenvatting, meta) {
  try {
    const { error } = await sb.from('audit_log').insert({
      action: actie,
      entity_type: 'social_content_item',
      entity_id: id,
      summary: samenvatting,
      actor_email: 'mcp-connector',
      actor_role: 'admin',
      metadata: meta ?? {},
    })
    return error ? `audit mislukt: ${error.message}` : null
  } catch (e) {
    return `audit mislukt: ${e instanceof Error ? e.message : 'onbekend'}`
  }
}

export const SCHRIJF_TOOLS = [
  {
    name: 'content_plannen',
    description:
      'Een nieuw contentitem inplannen bij een klant: reel, post, story of carousel op een datum, ' +
      'met platforms en meteen het script of de caption erbij. Maakt hetzelfde aan als het formulier ' +
      'in de app. Weigert een dubbele (zelfde klant, datum en titel) tenzij je forceer meegeeft.',
    inputSchema: {
      type: 'object',
      properties: {
        klant: { type: 'string', description: 'Naam van de klant. Deels mag ook.' },
        datum: { type: 'string', description: 'Geplande datum, JJJJ-MM-DD.' },
        type: { type: 'string', enum: TYPES, description: 'Soort content.' },
        platforms: {
          type: 'array', items: { type: 'string', enum: PLATFORMS },
          description: 'Waar het naartoe gaat. Minstens één.',
        },
        titel: { type: 'string', description: 'Korte titel. Leeg = type en datum worden gebruikt.' },
        script: { type: 'string', description: 'De gesproken of getoonde tekst.' },
        caption: { type: 'string', description: 'Het bijschrift onder de post.' },
        media_notes: { type: 'string', description: 'Aanwijzingen over beeld, of het script als dat daar hoort.' },
        status: { type: 'string', enum: STATUSSEN, description: 'Standaard draft.' },
        forceer: { type: 'boolean', description: 'Toch aanmaken terwijl er al iets op die dag met die titel staat.' },
      },
      required: ['klant', 'datum', 'type', 'platforms'],
      additionalProperties: false,
    },
  },
  {
    name: 'content_invullen',
    description:
      'Bij een BESTAAND contentitem het script, de caption, de media-notities, de titel of de status ' +
      'invullen of aanvullen. Zoekt het item op klant en datum; staan er meerdere op die dag, geef dan ' +
      'ook een stukje van de titel mee. Velden die je niet meegeeft blijven ongemoeid.',
    inputSchema: {
      type: 'object',
      properties: {
        klant: { type: 'string', description: 'Naam van de klant.' },
        datum: { type: 'string', description: 'Datum van het item, JJJJ-MM-DD.' },
        titel_bevat: { type: 'string', description: 'Stukje van de titel, als er meerdere items op die dag staan.' },
        script: { type: 'string' },
        caption: { type: 'string' },
        media_notes: { type: 'string' },
        titel: { type: 'string', description: 'Nieuwe titel.' },
        status: { type: 'string', enum: STATUSSEN },
        modus: {
          type: 'string', enum: ['vervangen', 'aanvullen'],
          description: 'vervangen (standaard) overschrijft; aanvullen plakt eronder wat er al stond.',
        },
      },
      required: ['klant', 'datum'],
      additionalProperties: false,
    },
  },
]

export async function roepSchrijfTool(sb, klant, naam, args = {}) {
  // ── Inplannen ─────────────────────────────────────────────────────────────
  if (naam === 'content_plannen') {
    const datum = eisDatum(args.datum)
    const type = eisUitLijst(args.type, TYPES, 'type')
    const platforms = eisPlatforms(args.platforms)
    const status = args.status ? eisUitLijst(args.status, STATUSSEN, 'status') : 'draft'
    const titel = schoon(args.titel, 200) || `${type[0].toUpperCase()}${type.slice(1)} — ${datum}`

    // Dubbel inplannen is de meest waarschijnlijke fout bij een herhaalde
    // aanroep. Liever tegenhouden en het zeggen dan stilletjes verdubbelen.
    if (!args.forceer) {
      const { data: bestaand } = await sb
        .from('social_content_items')
        .select('id, title')
        .eq('client_id', klant.id)
        .eq('planned_date', datum)
        .ilike('title', titel)
        .limit(1)
      if (bestaand && bestaand.length) {
        return `Er staat op ${datum} al een item met de titel "${titel}" bij ${klant.naam}. ` +
          'Niets aangemaakt. Wil je er tóch een tweede, geef dan forceer mee.'
      }
    }

    const rij = {
      client_id: klant.id,
      title: titel,
      platform: platforms[0],
      platforms,
      content_type: type,
      planned_date: datum,
      script: schoon(args.script, 20000) || null,
      caption: schoon(args.caption, 5000) || null,
      media_notes: schoon(args.media_notes, 20000) || null,
      status,
    }

    const { data, error } = await sb.from('social_content_items').insert(rij).select('id').single()
    if (error) throw new Error(`Aanmaken mislukt: ${error.message}`)

    const auditFout = await noteer(sb, 'mcp.content.plannen', data.id,
      `MCP: ${type} ingepland voor ${klant.naam} op ${datum}`,
      { klant: klant.naam, datum, type, platforms, status })

    const nu = new Date().toISOString().slice(0, 10)
    return [
      `Ingepland bij **${klant.naam}**: ${type} op ${datum}.`,
      `Titel: ${titel}`,
      `Platforms: ${platforms.join(', ')} · status: ${status}`,
      [
        schoon(args.script) ? 'script ingevuld' : null,
        schoon(args.caption) ? 'caption ingevuld' : null,
        schoon(args.media_notes) ? 'media-notities ingevuld' : null,
      ].filter(Boolean).join(', ') || 'nog geen tekst ingevuld',
      // Een datum in het verleden is meestal een typefout in het jaartal.
      datum < nu ? `\n> Let op: ${datum} ligt in het verleden. Klopt het jaartal?` : '',
      auditFout ? `\n> ${auditFout}` : '',
    ].filter(Boolean).join('\n')
  }

  // ── Invullen ──────────────────────────────────────────────────────────────
  if (naam === 'content_invullen') {
    const datum = eisDatum(args.datum)

    let q = sb.from('social_content_items')
      .select('id, title, content_type, script, caption, media_notes')
      .eq('client_id', klant.id)
      .eq('planned_date', datum)
    const stuk = schoon(args.titel_bevat, 200)
    if (stuk) q = q.ilike('title', `%${stuk}%`)

    const { data: gevonden, error: zoekFout } = await q
    if (zoekFout) throw new Error(zoekFout.message)

    if (!gevonden || gevonden.length === 0) {
      return `Geen item gevonden bij ${klant.naam} op ${datum}${stuk ? ` met "${stuk}" in de titel` : ''}. ` +
        'Wil je er een aanmaken, gebruik dan content_plannen.'
    }
    if (gevonden.length > 1) {
      // Bij twijfel niets wijzigen: het verkeerde item overschrijven is
      // moeilijker terug te draaien dan een extra vraag stellen.
      return [
        `Er staan ${gevonden.length} items bij ${klant.naam} op ${datum}. Er is niets gewijzigd.`,
        'Geef titel_bevat mee om er één te kiezen:',
        ...gevonden.map((i) => `- ${i.title} (${i.content_type ?? '?'})`),
      ].join('\n')
    }

    const item = gevonden[0]
    const modus = args.modus === 'aanvullen' ? 'aanvullen' : 'vervangen'
    const patch = {}
    const gewijzigd = []

    for (const [veld, label, max] of [
      ['script', 'script', 20000],
      ['caption', 'caption', 5000],
      ['media_notes', 'media-notities', 20000],
    ]) {
      // Alleen velden die je écht meestuurt. Zo kan je nooit per ongeluk iets
      // leegmaken door het weg te laten.
      if (args[veld] === undefined) continue
      const nieuw = schoon(args[veld], max)
      const oud = schoon(item[veld], max)
      patch[veld] = modus === 'aanvullen' && oud ? `${oud}\n\n${nieuw}` : (nieuw || null)
      gewijzigd.push(`${label} ${modus === 'aanvullen' && oud ? 'aangevuld' : 'ingevuld'}`)
    }
    if (args.titel !== undefined) {
      patch.title = schoon(args.titel, 200) || item.title
      gewijzigd.push('titel gewijzigd')
    }
    if (args.status !== undefined) {
      patch.status = eisUitLijst(args.status, STATUSSEN, 'status')
      gewijzigd.push(`status op ${patch.status}`)
    }

    if (Object.keys(patch).length === 0) {
      return 'Niets meegegeven om te wijzigen. Geef script, caption, media_notes, titel of status mee.'
    }

    const { error } = await sb.from('social_content_items').update(patch).eq('id', item.id)
    if (error) throw new Error(`Bijwerken mislukt: ${error.message}`)

    const auditFout = await noteer(sb, 'mcp.content.invullen', item.id,
      `MCP: ${item.title} bijgewerkt (${gewijzigd.join(', ')})`,
      { klant: klant.naam, datum, velden: Object.keys(patch), modus })

    return [
      `Bijgewerkt bij **${klant.naam}** op ${datum}: ${item.title}`,
      gewijzigd.join(' · '),
      auditFout ? `\n> ${auditFout}` : '',
    ].filter(Boolean).join('\n')
  }

  throw new Error(`Onbekend schrijfgereedschap: ${naam}`)
}
