import { GlobalSearch } from './global-search'
import { QuickActions } from './quick-actions'
import { NotificationBell } from './notification-bell'

// Globale topbalk: zoeken + notificatiecentrum + Quick Actions. Sticky boven de
// paginainhoud. NextGen AI komt in een volgende fase rechtsonder.
export function AdminTopBar() {
  return (
    <div className="sticky top-0 z-40 -mx-4 md:-mx-6 lg:-mx-8 mb-4 px-4 md:px-6 lg:px-8 py-2.5 bg-gray-50/90 backdrop-blur-sm border-b border-gray-100 flex items-center gap-3">
      <div className="flex-1 min-w-0 flex items-center">
        <GlobalSearch />
      </div>
      <NotificationBell />
      <QuickActions />
    </div>
  )
}
