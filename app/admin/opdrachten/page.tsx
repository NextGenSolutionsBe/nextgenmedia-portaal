import { redirect } from 'next/navigation'

/**
 * De Opdrachten-pagina is opgegaan in de pipeline (22 sep 2026): een opdracht
 * is nu een titel + bedrag op een lead, en de waarde per fase staat op het bord.
 * Oude links en bladwijzers komen zo gewoon op de pipeline uit.
 */
export default function OpdrachtenPage() {
  redirect('/admin/sales/pipeline')
}
