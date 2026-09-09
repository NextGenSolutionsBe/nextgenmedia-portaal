/**
 * Laadscherm voor het partnerportaal. Zie app/admin/loading.tsx voor waarom dit
 * bestand er staat: het geeft niet alleen visuele terugkoppeling, het zorgt er
 * vooral voor dat een vooruit opgehaalde link niet de héle pagina op de server
 * rendert. Weghalen laat de prefetch-storm terugkomen.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Bezig met laden">
      <div className="space-y-2">
        <div className="h-7 w-56 rounded-lg bg-gray-200" />
        <div className="h-4 w-80 max-w-full rounded bg-gray-100" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-28 rounded-xl border border-gray-100 bg-white" />
        ))}
      </div>
    </div>
  )
}
