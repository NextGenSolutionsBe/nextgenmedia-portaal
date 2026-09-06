# Koppeling NextGenMedia Operations ↔ Harrie

Eén pipeline, drie kanalen: cold calling gebeurt in deze app, cold e-mail en
LinkedIn door Harrie. Dit document beschrijft hoe Harrie die pipeline leest en
bijwerkt.

**Harrie praat rechtstreeks met Supabase** — geen tussenliggende API meer. Hij
leest de view `harrie_pipeline` en schrijft één rij in `harrie_events`; een
trigger bepaalt daarna wat dat voor de pipeline betekent. Zo staat de faselogica
op één plek en hoeft Harrie geen enkele regel te kennen.

```
  SUPABASE_URL      https://ibxumffitfdygguofaxd.supabase.co
  Authorization     Bearer <service_role key>
  apikey            <service_role key>
```

De sleutel staat in Supabase onder *Project Settings → API*. Behandel hem als
een wachtwoord: hij geeft volledige toegang tot de databank.

---

## 1. De fases

| `stageKey` | Label | Betekenis |
|---|---|---|
| `to_contact` | Nog te contacteren | Verzamelbak. Alles komt hier binnen, ongeacht de bron. |
| `contacted_call` | Gecontacteerd · Bellen | Gebeld; opvolging via de belworkflow. |
| `contacted_linkedin` | Gecontacteerd · LinkedIn | Verzoek of bericht verstuurd; Harrie volgt op. |
| `contacted_mail` | Gecontacteerd · Mail | Mail verstuurd; Harrie volgt op. |
| `email_after_call` | E-mail versturen na bellen | Gebeld, mail beloofd. Actie voor de beller. |
| `email_sent` | E-mail verstuurd | Die beloofde mail is de deur uit. |
| `not_interested` | Geen interesse | Reden verplicht. |
| `appointment` | Afspraak ingepland | |
| `max_pogingen` | Max. belpogingen | Onbereikbaar na zes pogingen. |
| `won` | Closed Won | Klant. |
| `lost` | Closed Lost | |

`stageKey` is **stabiel**; `stage` is het label en mag veranderen. Match altijd
op `stageKey`.

**De fase zegt waar de volgende stap ligt, niet wat er allemaal gebeurd is.** Een
lead kan via drie kanalen benaderd zijn; de volledige geschiedenis staat op de
tijdlijn (`sales_lead_events`).

### Warm

Er is géén fase "Interesse". Wie zelf reageert — op een mail, een
LinkedIn-bericht of aan de telefoon — krijgt het veld **`warm = true`**. Zo
blijft zichtbaar via welk kanaal het gesprek loopt, en dat gaat verloren zodra
je er een eigen fase van maakt. In de lijst staat er een oranje badge; er is een
filter *Alleen warme*.

---

## 2. Lezen: `harrie_pipeline`

```
GET /rest/v1/harrie_pipeline?select=*&order=updatedAt.asc&limit=500
GET /rest/v1/harrie_pipeline?updatedAt=gt.2026-09-06T14:02:11Z
```

Eén rij per partij, uit drie bronnen:

| `id` | Bron |
|---|---|
| `lead_…` | de pipeline |
| `client_…` | onze klanten (ook oud-klanten) |
| `kantoor_…` | onze eigen bedrijven en partners |

```json
{
  "id": "lead_8f3a…",
  "company": "Bakkerij Verdonck BV",
  "kbo": "0437476235",
  "emails": ["lotte@verdonck.be", "info@verdonck.be"],
  "domains": ["verdonck.be"],
  "phones": ["+32 9 123 45 67"],
  "website": "https://www.verdonck.be",
  "stage": "Gecontacteerd · Mail",
  "stageKey": "contacted_mail",
  "doNotContact": false,
  "doNotContactReason": null,
  "contactName": "Lotte Verdonck",
  "city": "GENT", "sector": "Bakkerij",
  "callbackAt": null,
  "labels": ["Harrie"],
  "warm": true,
  "redenCode": null,
  "redenTekst": null,
  "harrie": { "kanaal": "E-mail", "berichtenVerstuurd": 2, "belAdvies": "…" },
  "deleted": false,
  "updatedAt": "2026-09-06T14:02:11Z"
}
```

**`updatedAt`** is de hoogste van lead, bedrijf en contactpersoon — een gewijzigd
telefoonnummer telt dus mee. Neem de hoogste waarde uit je antwoord en gebruik
die de volgende keer als `updatedAt=gt.…`.

**`doNotContact`** staat enkel op `true` bij bel-me-niet en bij onze klanten en
partners: de twee gevallen waar niets te beslissen valt. Voor de rest lees je
`stageKey` en beslis je zelf.

### Wat de fase betekent voor Harrie

| `stageKey` | Wat Harrie doet |
|---|---|
| `won`, `lost`, `not_interested`, `max_pogingen` | blijft eraf |
| `appointment`, `email_after_call` | begint er niet aan, stopt een lopende reeks |
| `contacted_call` | begint er niet aan — een collega is bezig |
| `contacted_mail`, `contacted_linkedin`, `email_sent` | meestal zijn eigen spoor; gaat door |
| `to_contact` | vrij |

---

## 3. Schrijven: één rij in `harrie_events`

```
POST /rest/v1/harrie_events
Prefer: return=representation
```

```json
{
  "idempotency_key": "harrie-412-replied-1757080931000",
  "type": "replied",
  "gebeurd_op": "2026-09-06T14:02:11Z",
  "prospect": {
    "company": "Kinepraktijk Noor",
    "name": "Bram Maes",
    "role": "Praktijkhouder",
    "email": "bram@noor.be",
    "phone": "+3232222222",
    "kbo": "0222222222",
    "city": "ANTWERPEN",
    "sector": "Kinesitherapie",
    "website": "https://noor.be",
    "linkedinUrl": null
  },
  "detail": "Klinkt interessant, bel me na 14u",
  "harrie": {
    "kanaal": "E-mail",
    "stap": 2,
    "berichtenVerstuurd": 2,
    "laatsteContact": "2026-09-06T13:39:21Z",
    "dagenSindsContact": 0,
    "reageerde": true,
    "laatsteReactie": "Klinkt interessant, bel me na 14u",
    "afspraak": null,
    "nogBezig": false,
    "uitgeschreven": false,
    "belAdvies": "Warm — reageerde op Harrie. Marco volgt dit zelf op; bel enkel na overleg."
  }
}
```

Het antwoord bevat `lead_id` en `resultaat`, bijvoorbeeld
`"gekoppeld aan bestaande lead, gemarkeerd als warm"`.

**Idempotentie:** `idempotency_key` is uniek. Een tweede poging geeft
`409` (unieke sleutel geschonden) — beschouw dat als geslaagd.

### De types

| Type | Fase wordt |
|---|---|
| `imported` | `to_contact` — alleen bij een **nieuwe** lead |
| `sent` | `contacted_mail` |
| `linkedin_request`, `linkedin_message` | `contacted_linkedin` |
| `replied` | **blijft staan**, `warm = true` |
| `booked`, `booking_moved` | `appointment` |
| `booking_cancelled` | terug naar `contacted_mail` of `contacted_linkedin` (naar `harrie.kanaal`) |
| `declined`, `lost` | `not_interested`, met de reden uit `detail` |
| `unsubscribed` | fase blijft, zet bel-me-niet |
| `bounced` | fase blijft, label "e-mail ongeldig" |
| `manual_reply` | fase blijft, notitie op de tijdlijn |

**Een lead valt nooit terug naar een vroegere fase.** Staat hij al op
`appointment` en komt er nog een `sent` binnen, dan wordt dat een tijdlijnregel
zonder fasewijziging (`resultaat` zegt dan "fase blijft appointment").

### Hoe wij koppelen

In volgorde van zekerheid: **e-mail van de contactpersoon** → **ondernemings­nummer**
(elke notatie mag) → **algemeen e-mailadres** → **bedrijfsnaam** via dezelfde
ontdubbelsleutel als de app, dus "Acme BV" en "acme bvba" komen op hetzelfde
dossier uit. Vindt hij niets en is er een bedrijfsnaam, dan maken we bedrijf,
contactpersoon en lead aan.

### Het harrie-blokje

Het veld `harrie` wordt op de lead bewaard (laatste versie). In het detailpaneel
staat **`belAdvies` bovenaan, boven de tijdlijn** — de ene regel die een setter
leest vóór hij belt. In de lijst staan `berichtenVerstuurd` en `laatsteReactie`.

`nogBezig: true` of `reageerde: true` haalt de lead uit de belronde van Focus
Mode. Dat is de kern van "geen dubbel werk": zolang Harrie mailt of de prospect
zelf reageerde, belt er niemand tussendoor.

---

## 4. De reden bij "Geen interesse"

Verplicht en gestructureerd; op vrije tekst valt niet te tellen.

| `redenCode` | Label |
|---|---|
| `te_duur` | Te duur |
| `intern` | Doen we intern |
| `al_partner` | Werken al met iemand |
| `geen_behoefte` | Geen behoefte |
| `geen_budget` | Geen budget |
| `verkeerde_persoon` | Verkeerde persoon |
| `timing` | Timing — nu niet |
| `slechte_ervaring` | Slechte ervaring met bureaus |
| `anders` | Anders (met toelichting) |

Stuurt Harrie bij een `declined` vrije tekst mee in `detail`, dan leggen we die
zelf op een code: "Vinden het veel te duur" wordt `te_duur`. Herkennen we niets,
dan wordt het `anders` mét de tekst, zodat de afwijzing telbaar blijft.

---

## 5. Ritme

- **Elk kwartier** wijzigingen ophalen met `updatedAt=gt.…`.
- **Eén keer per dag** alles, zonder filter.
- Gebeurtenissen per stuk.
- Geen webhooks: Harrie draait niet altijd, dus hij vraagt zelf.

---

## 6. De oude REST-API

`/api/harrie/ping`, `/api/harrie/contacts` en `/api/harrie/events` met een eigen
Bearer-token bestaan nog in de code, maar staan **uit** via `FEATURES.harrieApi`
in `lib/features.ts`. Zet die vlag op `true` en de endpoints plus het
sleutelscherm (*Verkoop → Koppeling*) komen terug — bijvoorbeeld wanneer een
derde partij wél moet kunnen koppelen maar niet in Supabase mag.
