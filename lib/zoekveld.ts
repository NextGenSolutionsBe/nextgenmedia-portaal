// Zoekvelden zonder suggesties van de browser of de wachtwoordbeheerder.
//
// Safari (en Chrome) negeren autocomplete="off" als een veld op een naam- of
// e-mailveld lijkt ("Zoek op naam, contactpersoon of e-mail…") en tonen dan
// adressen uit je contactkaart of bewaarde wachtwoorden over de lijst van de
// app. Een zoekveld (type search, "search" in de naam) slaan ze over; de
// data-attributen doen hetzelfde voor 1Password, LastPass en Bitwarden.

export function zoekVeld(naam = 'zoeken') {
  return {
    type: 'search' as const,
    name: `search-${naam}`,
    autoComplete: 'off',
    autoCorrect: 'off',
    autoCapitalize: 'off',
    spellCheck: false,
    enterKeyHint: 'search' as const,
    'data-1p-ignore': 'true',
    'data-lpignore': 'true',
    'data-bwignore': 'true',
    'data-form-type': 'other',
  }
}
