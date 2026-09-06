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

| Sleutel | Label |
|---|---|
| `to_contact` | Nog te contacteren |
| `contacted` | Gecontacteerd |
| `interested` | Interesse |
| `not_interested` | Geen interesse |
| `email_todo` / `email_sent` | E-mail versturen / verstuurd |
| `appointment` | Afspraak ingepland |
| `max_pogingen` | Max. belpogingen |
| `won` / `lost` | Closed Won / Lost |

`stage` in de API is het **label** (vrije tekst, mag veranderen); `stageKey` is
de **sleutel** (stabiel). Match op `stageKey`.

Harrie krijgt **elke** fase te zien, ook Closed Won. Dat is met opzet: staat een
bedrijf bij ons op Closed Won, dan is het een klant en hoeft Harrie het niet
eens als prospect op te laden. Wij houden dus geen blokkeerlijst bij — Harrie
leest de status en beslist zelf.

### De normale gang van zaken

```
  imported   →  to_contact     Harrie laadt een KBO-prospect op
  sent       →  contacted      eerste koude mail of LinkedIn-bericht
  replied    →  interested     prospect reageerde
  booked     →  appointment    afspraak vast
  declined   →  not_interested gebeld of gemaild, geen interesse
```

Wat Harrie ZELF bijhoudt en niet naar ons stuurt: hoeveel opvolgmails er al uit
zijn, wanneer de volgende moet, en welke prospects er in zijn eigen bellijst
staan. Onze pipeline bewaart alleen wáár een lead staat.

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

**`id`** is stabiel en draagt een voorvoegsel per bron: `lead_…` (pipeline),
`client_…` (onze klanten), `kantoor_…` (eigen bedrijven en partners).

**`updatedAt`** is de tijd waarop *iets* aan die lead veranderde — ook een
gewijzigd telefoonnummer bij het bedrijf of een nieuw e-mailadres bij de
contactpersoon. Neem de hoogste waarde uit het antwoord en gebruik die als
`updated_since` voor de volgende ophaling.

**Verwijderd of gearchiveerd** komt mee met `"deleted": true` en
`doNotContact: false` — die partij is weer vrij.

### `doNotContact`

Staat enkel op `true` in de twee gevallen waar niets te beslissen valt:

- een lead met **bel-me-niet** (`do_not_call` in onze app);
- **onze klanten en partners** (`client_…` en `kantoor_…`) — die zijn geen
  prospect.

Alle andere partijen komen mee met `doNotContact: false` en hun echte
`stageKey`. Wat Harrie daarmee doet, bepaalt hij zelf.

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
| `replied` | `interested` | |
| `booked` / `booking_moved` | `appointment` | Moment in `detail`. |
| `booking_cancelled` | `interested` | |
| `declined` / `lost` | `not_interested` | Reden uit `detail`. |
| `unsubscribed` | *ongewijzigd* | Zet bel-me-niet — blijvend geblokkeerd. |
| `bounced` | *ongewijzigd* | Label "e-mail ongeldig". Het adres blijft staan. |
| `manual_reply` | *ongewijzigd* | Enkel een notitie op de tijdlijn. |

Elke gebeurtenis komt ook als regel op de tijdlijn van de lead.

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
hoeveel er via de koppeling te zien is, in welke pipeline nieuwe prospects
landen, en de laatste dertig gebeurtenissen die Harrie meldde.

Elke gebeurtenis komt ook op de **tijdlijn van de lead zelf**, zichtbaar in het
detailpaneel van de pipeline. Een setter ziet dus vóór hij belt hoeveel mails er
al uit zijn en wat de prospect antwoordde.
