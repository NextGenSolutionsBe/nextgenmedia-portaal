// Voorbeeldtemplates die de admin met één klik kan toevoegen. Puur (client-safe).

export const DEFAULT_TEMPLATES: { name: string; subject: string; body: string; kind: string; cta_text: string; cta_link: string }[] = [
  {
    name: 'Nieuwe scripts klaar',
    kind: 'scripts',
    subject: 'Nieuwe scripts klaar om te bekijken',
    body: `Hallo {{klantnaam}},

Er werden nieuwe scripts toegevoegd aan jouw dashboard.

Bekijk ze en keur ze goed of geef feedback.`,
    cta_text: 'Scripts bekijken',
    cta_link: '{{scripts_link}}',
  },
  {
    name: 'Nieuw contract beschikbaar',
    kind: 'contract',
    subject: 'Nieuw contract beschikbaar',
    body: `Hallo {{klantnaam}},

Er werd een nieuw contract toegevoegd aan jouw portaal.

Bekijk en onderteken het contract via onderstaande knop.`,
    cta_text: 'Contract bekijken',
    cta_link: '{{contract_link}}',
  },
  {
    name: 'Contentshoot ingepland',
    kind: 'shoot',
    subject: 'Contentshoot ingepland',
    body: `Hallo {{klantnaam}},

Er werd een contentshoot ingepland.

Bekijk alle informatie in jouw dashboard.`,
    cta_text: 'Naar mijn dashboard',
    cta_link: '{{contentshoot_link}}',
  },
  {
    name: 'Nieuwe taak toegevoegd',
    kind: 'task',
    subject: 'Nieuwe taak in jouw NextGenMedia portaal',
    body: `Hallo {{klantnaam}},

Er werd een nieuwe taak toegevoegd aan jouw NextGenMedia portaal.

Taak:
{{taak_titel}}

Deadline:
{{taak_deadline}}

Beschrijving:
{{taak_beschrijving}}

Bekijk de taak via onderstaande knop:`,
    cta_text: 'Bekijk de taak',
    cta_link: '{{taak_link}}',
  },
]
