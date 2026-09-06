# Briefing voor Harrie — de pipeline van NextGenMedia

*Plak dit in de chat van Harrie. Het beschrijft waar de pipeline staat, wat de
statussen betekenen, en hoe het leaduniversum eruit hoort te zien.*

---

## 1. Waar je de data haalt

Je leest rechtstreeks uit onze Supabase, uit de view `harrie_pipeline`. Er is
geen API meer.

```
SUPABASE_URL   https://ibxumffitfdygguofaxd.supabase.co
Authorization  Bearer <service_role key>
apikey         <service_role key>
```

Het moet de **service_role**-sleutel zijn. De anon-sleutel is publiek en krijgt
hier bewust `401`.

### Pagineer — dit is de enige manier waarop dit stil misgaat

PostgREST geeft standaard **hoogstens 1.000 rijen** terug, zonder foutmelding.
De view telt er ruim 4.000. Zonder paginering mis je driekwart van de pipeline,
en dan denk je dat bestaande klanten vrij zijn om te mailen.

```
GET /rest/v1/harrie_pipeline?select=*&order=updatedAt.asc
Range: 0-999
Prefer: count=exact
→ Content-Range: 0-999/4088        ← het totaal staat achter de schuine streep
```

Blijf bladeren met `Range: 1000-1999`, `2000-2999`, … tot je het totaal hebt.
Onthoud de hoogste `updatedAt` en gebruik die de volgende keer als
`updatedAt=gt.…`; één keer per dag haal je alles op zonder dat filter.

---

## 2. Hoe het universum eruit hoort te zien

Het leaduniversum is één beeld van ons volledige bestand. Van buiten naar
binnen: hoe warmer, hoe dichter bij de kern.

| Ring | Kleur | Wie daar staat | `stageKey` |
|---|---|---|---|
| **Kern** | geel | Onze klanten en onszelf. Nooit benaderen. | `klant`, `oud_klant`, `won`, `eigen_bedrijf`, `partner` |
| **Groen** | groen | Afspraak ingeboekt. | `appointment` |
| **Oranje** | oranje | Reageerde zelf, nog geen afspraak. | elke fase met `warm = true` |
| **Rood** | rood | Gecontacteerd, maar nog geen reactie of nog geen beslissingnemer gesproken. | `contacted_call`, `contacted_linkedin`, `contacted_mail`, `email_after_call`, `email_sent`, `max_pogingen` |
| **Buitenrand** | grijsblauw | Nog niet gecontacteerd. | `to_contact` |
| **Buiten beeld** | gedimd | Afgehaakt. Hoort niet in de buitenrand thuis — dat zou lijken alsof ze weer vrij zijn. | `not_interested`, `lost` |

Twee dingen die vaak fout gaan:

- **`won` hoort in de kern, niet bij de afspraken.** Closed Won betekent klant.
  Samen met `klant` zijn dat er nu 91 — precies het getal dat je zelf toont.
- **`warm` is een veld, geen fase.** Wie op een mail, een LinkedIn-bericht of
  aan de telefoon zelf reageert, krijgt `warm = true` en blijft in zijn eigen
  fase staan. Zo blijft zichtbaar via welk kanaal het gesprek loopt. Kleur dus
  op `warm` vóór je op `stageKey` kleurt.

### De stand nu (om je eigen telling mee te controleren)

| `stageKey` | Aantal |
|---|---|
| `to_contact` | 3957 |
| `klant` | 48 |
| `won` | 43 |
| `not_interested` | 17 |
| `contacted_call` | 11 |
| `email_after_call` | 7 |
| `email_sent` | 2 |
| `eigen_bedrijf` | 2 |
| `appointment` | 1 |
| **totaal** | **4088** |

Klopt jouw totaal niet met 4088, dan pagineer je niet.

---

## 3. Wat elke fase betekent voor jou

| `stageKey` | Label | Wat jij doet |
|---|---|---|
| `to_contact` | Nog te contacteren | Vrij. |
| `contacted_call` | Gecontacteerd · Bellen | Niet aan beginnen — een collega is bezig. |
| `contacted_linkedin` | Gecontacteerd · LinkedIn | Jouw spoor; ga door. |
| `contacted_mail` | Gecontacteerd · Mail | Jouw spoor; ga door. |
| `email_after_call` | E-mail versturen na bellen | Afblijven: de setter heeft een mail beloofd. |
| `email_sent` | E-mail verstuurd | Die beloofde mail is weg; opvolgen mag. |
| `not_interested` | Geen interesse | Afblijven. |
| `appointment` | Afspraak ingepland | Afblijven, en stop een lopende reeks. |
| `max_pogingen` | Max. belpogingen | Onbereikbaar na zes belpogingen. Afblijven. |
| `won` | Closed Won | Klant. Afblijven. |
| `lost` | Closed Lost | Afblijven. |

`stageKey` is stabiel; `stage` is het label en mag veranderen. **Match altijd op
`stageKey`.**

`doNotContact = true` is absoluut: bel-me-niet, onze klanten, onze partners.

---

## 4. Twee merken in één lijst

We verkopen onder twee namen: **NextGenMedia** (social media, content) en
**NextGenSolutions** (websites, software). Dat is nu één pipeline
in plaats van twee gescheiden lijsten (sinds 6 september 2026).

- `pipeline` — het **hoofdmerk**: `nextgenmedia` of `nextgensolutions`. Daar
  hangen de brochure, de afzender en de agenda aan vast.
- `merken` — **alle** merken waarvoor de lead telt. Kan er twee bevatten: een
  zaak die een website nodig heeft, wil vaak ook social media.

Het hoofdmerk zit altijd in `merken`. Gebruik dit om je aanspreking en je
one-pager te kiezen. Vink zelf geen tweede merk aan — dat is een beslissing die
aan de telefoon valt.

---

## 5. Wat je terugschrijft

Eén rij in `harrie_events`. Een trigger bepaalt daarna wat dat voor de pipeline
betekent; jij hoeft geen enkele faseregel te kennen.

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
    "company": "Kinepraktijk Noor", "name": "Bram Maes",
    "role": "Praktijkhouder", "email": "bram@noor.be",
    "phone": "+3232222222", "kbo": "0222222222",
    "city": "ANTWERPEN", "sector": "Kinesitherapie",
    "website": "https://noor.be", "linkedinUrl": null
  },
  "detail": "Klinkt interessant, bel me na 14u",
  "harrie": {
    "kanaal": "E-mail", "stap": 2, "berichtenVerstuurd": 2,
    "laatsteContact": "2026-09-06T13:39:21Z", "dagenSindsContact": 0,
    "reageerde": true, "laatsteReactie": "Klinkt interessant, bel me na 14u",
    "afspraak": null, "nogBezig": false, "uitgeschreven": false,
    "belAdvies": "Warm — reageerde op de mail. Bel na 14u."
  }
}
```

`idempotency_key` is uniek; een tweede poging geeft `409` — beschouw dat als
geslaagd.

| Type | Fase wordt |
|---|---|
| `imported` | `to_contact` — alleen bij een **nieuwe** lead |
| `sent` | `contacted_mail` |
| `linkedin_request`, `linkedin_message` | `contacted_linkedin` |
| `replied` | blijft staan, `warm = true` |
| `booked`, `booking_moved` | `appointment` |
| `booking_cancelled` | terug naar het kanaal uit `harrie.kanaal` |
| `declined`, `lost` | `not_interested`, met de reden uit `detail` |
| `unsubscribed` | fase blijft, zet bel-me-niet |
| `bounced` | fase blijft, label "e-mail ongeldig" |
| `manual_reply` | fase blijft, notitie op de tijdlijn |

Een lead valt **nooit terug** naar een vroegere fase. Staat er al een afspraak
en meld je nog een verstuurde mail, dan wordt dat een tijdlijnregel zonder
fasewijziging.

`belAdvies` is de ene regel die een setter leest vóór hij belt. Die staat
bovenaan in ons detailpaneel — schrijf hem alsof je het tegen de beller zegt.

`nogBezig: true` of `reageerde: true` haalt de lead uit onze belronde. Zolang
jij mailt of de prospect zelf reageerde, belt er niemand tussendoor.

---

## 6. De reden bij "Geen interesse"

Verplicht en gestructureerd; op vrije tekst valt niet te tellen. Stuur bij een
`declined` gewoon je eigen tekst mee in `detail` — wij leggen die zelf op een
code.

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

---

## 7. Ritme

- Elk kwartier de wijzigingen ophalen met `updatedAt=gt.…`.
- Eén keer per dag alles, zonder filter. Wat dan niet meer meekomt, is weg.
- Gebeurtenissen per stuk terugschrijven, meteen.
- Geen webhooks: jij vraagt, wij pushen niet.
