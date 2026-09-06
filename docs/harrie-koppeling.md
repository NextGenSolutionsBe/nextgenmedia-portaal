# Koppeling NextGenMedia Operations ↔ Harrie

Hoe het acquisitiesysteem (Harrie) en de pipeline van de operations-app samen
één lijst bijhouden. Dit document beschrijft wat de operations-app aanbiedt en
is bedoeld voor wie Harrie bouwt.

**Basisadres:** `https://app.nextgenmedia.be/api`
**Sleutel:** aanmaken bij *Verkoop → Koppeling* in de operations-app.

Elk verzoek draagt:

```
Authorization: Bearer <token>
Accept: application/json
```

Fout of ontbrekend token → `401`. De sleutel wordt bij ons enkel als hash
bewaard; hij is één keer zichtbaar, bij het aanmaken. Intrekken werkt
onmiddellijk.

---

## 1. Het idee in één alinea

De operations-app is de **enige waarheid** over de pipeline. Harrie haalt die
op, werkt erin, en meldt elke stap terug. Wat Marco in de app doet (bellen,
afspraak boeken, "geen interesse") ziet Harrie bij zijn volgende ophaling; wat
Harrie doet (mailen, opvolgen, boeken) staat meteen in de pipeline. Zo belt
niemand iemand die net gemaild is, en mailt Harrie nooit een klant.

---

## 2. De fases

| Sleutel | Label | Wat het betekent | Wie werkt eraan |
|---|---|---|---|
| `to_contact` | Nog te contacteren | Opgeladen, nog niets mee gedaan | Harrie **en** Marco |
| `contacted` | Gecontacteerd | Eerste mail of LinkedIn-bericht uit | Harrie (opvolgreeks) |
| `te_bellen` | **Opbellen** | Reeks op, geen antwoord → nu bellen | Marco |
| `interested` | Interesse | Prospect reageerde positief | Marco |
| `not_interested` | Geen interesse | Zei nee | — |
| `email_todo` / `email_sent` | E-mail versturen / verstuurd | Wij sturen zelf iets | Marco |
| `appointment` | Afspraak ingepland | Afspraak staat vast | Marco |
| `max_pogingen` | Max. belpogingen | 6× vergeefs gebeld | — |
| `won` / `lost` | Closed Won / Lost | Afgerond | — |

`stage` in de API is het **label** (vrije tekst, mag veranderen); `stageKey` is
de **sleutel** (stabiel). Match op `stageKey`.

### De normale gang van zaken

```
  imported        →  to_contact    Harrie laadt een KBO-prospect op
  sent            →  contacted     eerste koude mail          ← Marco belt niet meer
  followup_sent   →  (blijft)      opvolgmail 2, 3, 4
  needs_call      →  te_bellen     geen antwoord → Marco belt ← vooraan in Focus Mode
  called          →  contacted     gebeld, uitkomst volgt apart
  replied         →  interested    prospect reageerde         ← Harrie stopt met mailen
  booked          →  appointment   afspraak vast
```

---

## 3. `GET /harrie/ping`

Verbindingstest.

```json
{ "ok": true, "app": "NextGenMedia Operations", "version": "f04bb85" }
```

---

## 4. `GET /harrie/contacts`

Alles wat in onze pipeline staat, plus onze klanten en partners.

| Parameter | Betekenis |
|---|---|
| `updated_since` | ISO-8601. Enkel wat daarna wijzigde. Ontbreekt → alles. |
| `cursor` | Uit `nextCursor` van het vorige antwoord. |
| `limit` | Max. per blad (standaard 200, hoogstens 500). |

```json
{
  "items": [
    {
      "id": "lead_8f3a…",
      "company": "Bakkerij Verdonck BV",
      "kbo": "0437476235",
      "emails": ["lotte@verdonck.be", "info@verdonck.be"],
      "domains": ["verdonck.be"],
      "phones": ["+32 9 123 45 67"],
      "website": "https://www.verdonck.be",
      "stage": "Nog te contacteren",
      "stageKey": "to_contact",
      "doNotContact": false,
      "doNotContactReason": null,
      "owner": "Marco",
      "contactName": "Lotte Verdonck",
      "city": "GENT",
      "sector": "Bakkerij",
      "callbackAt": null,
      "labels": ["Harrie"],
      "updatedAt": "2026-09-06T14:02:11Z"
    }
  ],
  "nextCursor": null
}
```

**`doNotContact` is beslissend.** `true` = niet benaderen, en wat klaarstond
annuleren. `false` = vrij. De rest is informatie.

**`id`** is stabiel en draagt een voorvoegsel per bron: `lead_…` (pipeline),
`client_…` (onze klanten), `kantoor_…` (eigen bedrijven en partners).

**`updatedAt`** is de tijd waarop *iets* aan die lead veranderde — ook een
gewijzigd telefoonnummer bij het bedrijf of een nieuw e-mailadres bij de
contactpersoon. Neem de hoogste waarde uit het antwoord en gebruik die als
`updated_since` voor de volgende ophaling.

**Verwijderd of gearchiveerd** komt mee met `"deleted": true` en
`doNotContact: false` — die partij is weer vrij.

### Wie altijd geblokkeerd is

Ongeacht de instellingen:

- **onze klanten** (`client_…`), ook oud-klanten. Zij staan lang niet allemaal
  in de pipeline; dit is de belangrijkste blokkade van de drie.
- **onze eigen bedrijven en partners** (`kantoor_…`).
- **elke lead met bel-me-niet.**

Welke *fases* blokkeren, staat in het scherm *Verkoop → Koppeling*. Standaard:
`interested`, `not_interested`, `email_todo`, `email_sent`, `appointment`,
`max_pogingen`, `won`, `lost`.

`to_contact`, `contacted` en `te_bellen` blokkeren **niet** — dat zijn de fases
waarin Harrie werkt.

### Eén uitzondering, en waarom

Zou `contacted` ooit toch blokkeren, dan zag Harrie na zijn eigen eerste mail
zijn eigen prospect als verboden en annuleerde hij zijn eigen opvolgreeks: één
mail en dan stilte. De app bewaakt dat — een lead met het label `Harrie` blijft
vrij zolang hij niet verder staat dan `contacted`. Vanaf `interested` klapt de
blokkade wél dicht: dan nemen wij over.

---

## 5. `POST /harrie/events`

Eén gebeurtenis per verzoek.

```json
{
  "idempotencyKey": "harrie-412-replied-1757080931000",
  "type": "replied",
  "at": "2026-09-06T14:02:11Z",
  "prospect": {
    "harrieId": 412,
    "company": "Kinepraktijk Noor",
    "name": "Bram Maes",
    "role": "Praktijkhouder",
    "email": "bram@noor.be",
    "phone": "+3232222222",
    "kbo": "0222222222",
    "city": "ANTWERPEN",
    "sector": "Kinesitherapie",
    "linkedinUrl": null,
    "source": "kbo-csv"
  },
  "detail": "Klinkt interessant, bel me gerust na 14u."
}
```

### De types

| Type | Fase wordt | Extra |
|---|---|---|
| `imported` | `to_contact` | Alleen bij een **nieuwe** lead; een bestaande valt nooit terug. |
| `sent` | `contacted` | |
| `linkedin_request` / `linkedin_message` | `contacted` | |
| `followup_sent` | *ongewijzigd* | Komt op de tijdlijn, zodat de setter ziet hoeveel mails er al uit zijn. |
| `needs_call` | `te_bellen` | Zet een terugbelmoment op **nu** → vooraan in Focus Mode. |
| `called` | `contacted` | Haalt het terugbelmoment weg. Zet géén uitkomst — die komt met een eigen gebeurtenis. |
| `replied` | `interested` | Terugbelmoment op nu, met de tekst van de prospect erbij. |
| `booked` / `booking_moved` | `appointment` | Moment in `detail`. |
| `booking_cancelled` | `interested` | |
| `declined` / `lost` | `not_interested` | Reden uit `detail`. |
| `unsubscribed` | *ongewijzigd* | Zet bel-me-niet — blijvend geblokkeerd. |
| `bounced` | *ongewijzigd* | Label "e-mail ongeldig". Het adres blijft staan. |
| `manual_reply` | *ongewijzigd* | Enkel een notitie. |

### Antwoorden

| Code | Betekenis |
|---|---|
| `200` | Verwerkt, gekoppeld aan een bestaande lead. |
| `201` | Verwerkt, nieuwe lead aangemaakt. |
| `409` | Deze `idempotencyKey` was al gekend — beschouw als geslaagd. |
| `400` | Onbekend type, of geen bedrijfsnaam bij een nieuwe prospect. |
| `401` | Token fout of ontbrekend. |
| `5xx` | Bij ons stuk. Later opnieuw proberen. |

Bij succes:

```json
{ "ok": true, "leadId": "83894f15-…", "resultaat": "nieuwe lead aangemaakt, fase → contacted" }
```

### Hoe wij koppelen

In deze volgorde van zekerheid: **e-mailadres van de contactpersoon** →
**ondernemingsnummer** (elke notatie mag, wij normaliseren) → **algemeen
e-mailadres van het bedrijf** → **bedrijfsnaam** (via dezelfde ontdubbelsleutel
als de rest van de app, dus "Acme BV" en "acme bvba" komen op hetzelfde dossier
uit).

Vindt hij niets, dan maken we een nieuwe lead met dezelfde functie als het
scherm "Nieuwe lead", inclusief ontdubbeling op bedrijf. Hoe meer velden je
meestuurt, hoe zekerder de koppeling. Een telefoonnummer dat wij nog niet
hadden, nemen we over.

---

## 6. Ritme

- **Elk kwartier** wijzigingen ophalen met `updated_since`.
- **Eén keer per dag** alles, zonder `updated_since`. Dan valt weg wat niet meer
  meekomt.
- Gebeurtenissen per stuk, enkele tientallen per dag.
- Geen webhooks: Harrie draait niet altijd, dus hij vraagt zelf.

---

## 7. Wat je in de app ziet

*Verkoop → Koppeling*: de sleutels (met laatste gebruik en aantal verzoeken),
welke fases blokkeren met het aantal leads per fase, in welke pipeline nieuwe
prospects landen, en de laatste dertig gebeurtenissen die Harrie meldde.

Elke gebeurtenis komt ook op de **tijdlijn van de lead zelf**, zichtbaar in het
detailpaneel van de pipeline. Een setter ziet dus vóór hij belt hoeveel mails er
al uit zijn en wat de prospect antwoordde.
