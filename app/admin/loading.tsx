/**
 * Laadscherm voor de hele adminshell.
 *
 * Dit bestand doet twee dingen, en het tweede is het belangrijkste.
 *
 * 1. Je ziet meteen dát er iets gebeurt na een klik, in plaats van een pagina
 *    die stilstaat tot alle data binnen is.
 *
 * 2. HET REMT DE PREFETCH-STORM. Next haalt links in beeld vooruit op. Bij een
 *    DYNAMISCHE route (en dat is hier alles, force-dynamic) gaat dat vooruit
 *    ophalen tot aan de dichtstbijzijnde loading-grens. Zonder dit bestand was
 *    er geen grens en werd dus de VOLLEDIGE pagina op de server gerenderd —
 *    inclusief al haar databasequery's. Met 34 menu-items betekende één keer
 *    inloggen ~25 volledige paginarenders tegelijk. Op het gratis Supabase-plan
 *    liep de middleware daarop vast, en dan is de hele app onbereikbaar
 *    (504 MIDDLEWARE_INVOCATION_TIMEOUT).
 *
 * Kortom: weghalen betekent dat de app weer kan gaan hangen.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Bezig met laden">
      <div className="space-y-2">
        <div className="h-7 w-64 rounded-lg bg-gray-200" />
        <div className="h-4 w-96 max-w-full rounded bg-gray-100" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-gray-100 bg-white" />
        ))}
      </div>

      <div className="rounded-xl border border-gray-100 bg-white p-4 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-gray-100" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-1/3 rounded bg-gray-200" />
              <div className="h-3 w-1/2 rounded bg-gray-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
