import { redirect } from 'next/navigation'

// De aparte "Financiën"-overzichtspagina is vervangen: Prognose is nu het enige
// financiële dashboard. Oude links blijven werken via deze redirect.
export default function RevenueIndexRedirect() {
  redirect('/admin/revenue/omzet')
}
