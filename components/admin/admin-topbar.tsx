import { GlobalSearch } from './global-search'
import { QuickActions } from './quick-actions'
import { NotificationBell } from './notification-bell'

// Globale topbalk: notificatiecentrum + Quick Actions. Sticky boven de
// paginainhoud. De zoekbalk is weg (31 okt 2026); zoeken kan nog met Cmd/Ctrl+K.
export function AdminTopBar() {
  return (
    // Geen balk: enkel de knoppen zweven rechtsboven (glas), zoals in het design.
    // De strook zelf laat klikken door naar de inhoud eronder.
    <div className="sticky top-0 z-30 -mx-4 md:-mx-6 lg:-mx-8 mb-3 pl-16 pr-4 md:px-6 lg:px-8 py-3 flex items-center gap-2 md:gap-3 pointer-events-none">
      <div className="flex-1 min-w-0" />
      <div data-zwevende-knoppen className="pointer-events-auto flex items-center gap-2 md:gap-3 rounded-full glas shadow-md p-1">
        <GlobalSearch verborgen />
        <NotificationBell />
        <QuickActions />
      </div>
    </div>
  )
}
