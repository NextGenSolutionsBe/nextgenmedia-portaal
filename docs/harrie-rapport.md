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
→ Content-Range: 0-999/4050        ← het totaal staat achter de schuine streep
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

| `stageKey` | Aantal | Ring |
|---|---|---|
| `to_contact` | 3864 | buitenrand |
| `klant` | 48 | kern |
| `won` | 43 | kern |
| `not_interested` | 37 | buiten beeld |
| `contacted_call` | 18 | rood |
| `contacted_mail` | 18 | rood |
| `email_sent` | 13 | rood |
| `appointment` | 4 | groen |
| `email_after_call` | 2 | rood |
| `eigen_bedrijf` | 2 | kern |
| `lost` | 1 | buiten beeld |
| **totaal** | **4050** | |

Klopt jouw totaal niet met 4050, dan pagineer je niet.

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

## 4. Eén lead per bedrijf

Er staat nog hoogstens **één actieve lead per bedrijf**. Dat was ooit één per
lijst, waardoor dezelfde firma twee keer in de pipeline stond — twee kaarten,
twee geschiedenissen, en twee keer gebeld. Die 49 dubbels zijn samengevoegd.

Wat dat voor jou betekent:

- **Kom je hetzelfde bedrijf twee keer tegen in de view, dan is er iets mis.**
  Meld het; ontdubbel het niet zelf.
- **`deleted = true` blijft "weer vrij"**, maar de samengevoegde dubbels staan
  niet meer in de view. Je krijgt dus geen gearchiveerde kaart te zien waarvan
  het gesprek in werkelijkheid gewoon doorloopt op een andere rij.

---

## 5. Het merk ligt pas vast bij de afspraak

We verkopen onder twee namen: **NextGenMedia** (social media, content) en
**NextGenSolutions** (websites, software). Er is geen aparte lijst per merk meer,
en een lead draagt vooraf géén merk. Dat is een bewuste keuze: onze setters
horen pas tijdens het gesprek of iemand een website nodig heeft of social media,
dus vooraf kiezen zou een keuze op het verkeerde moment zijn.

- **`merken`** — het vastgelegde merk. **Leeg zolang er geen afspraak staat**,
  en dat is de normale toestand voor bijna elke rij. Vanaf `appointment` (en
  daarna `won`/`lost`) staat er één merk in.
- **`pipeline` / `pipelineNaam`** — alleen de **herkomst**: uit welke lijst de
  lead ooit binnenkwam. Dit is géén merk en niemand heeft ervoor gekozen; het
  staat er nog als geschiedenis en mag `null` zijn.

**Twee regels voor jou:**

1. **Segmenteer of kleur nooit op `pipeline`.** Dat zou een merk suggereren dat
   niemand heeft toegekend. Kijk naar `merken`, en accepteer dat dat bij het
   overgrote deel leeg is — dat is geen ontbrekende data, dat is de stand van
   zaken.
2. **Een lege `merken` betekent: vrij voor allebei.** Je mag zo iemand vanuit
   elk verhaal benaderen. Staat er wél een merk, dan is dat beslist en hou je
   je daaraan.

Op dit moment hebben **47 van de 3998 leads** een merk: 43 klanten (`won`) en
4 lopende afspraken. De rest is bewust leeg.

## 6. Wat je terugschrijft

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

## 7. De reden bij "Geen interesse"

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

## 8. Ritme

- Elk kwartier de wijzigingen ophalen met `updatedAt=gt.…`.
- Eén keer per dag alles, zonder filter. Wat dan niet meer meekomt, is weg.
- Gebeurtenissen per stuk terugschrijven, meteen.
- Geen webhooks: jij vraagt, wij pushen niet.
