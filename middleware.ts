import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

// LET OP — deze bestandstypes moeten buiten de middleware blijven.
// Resend haalt de brochure en de handtekening zélf op via een publieke URL,
// zonder cookies. Loopt zo'n verzoek door de middleware, dan krijgt Resend een
// omleiding naar /login en plakt hij de INLOGPAGINA als bijlage in de mail —
// wat bij de ontvanger aankomt als een "beschadigde pdf". Vandaar ook .pdf.
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pdf|ico|webmanifest|txt|xml)$).*)',
  ],
}
