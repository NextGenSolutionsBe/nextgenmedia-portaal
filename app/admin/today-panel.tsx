import Link from 'next/link'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { buildNotifications } from '@/lib/notifications'
import { Receipt, FileText, Newspaper, Globe, ListChecks, ArrowRight, Sun } from 'lucide-react'

// "Vandaag" — geen cijfers, enkel acties. De dagelijkse werkplek bovenaan het
// Command Center. Afgeleid uit dezelfde bron als het notificatiecentrum.
//
// `modules` = de rechten van de ingelogde werknemer (null = admin, ziet alles).
// Elke regel hangt aan de module waar hij naartoe linkt: wie de module niet
// heeft, krijgt de regel niet te zien én kan er toch niet bij.
export async function TodayPanel({ modules = null }: { modules?: string[] | null }) {
  const maySee = (key: string) => modules === null || modules.includes(key)

  // Heeft deze persoon geen enkele module die hier iets kan opleveren, dan
  // halen we de signalen ook niet op.
  const notifModules = ['invoices', 'contracts', 'blogs', 'content']
  const notifs = notifModules.some(maySee) ? await buildNotifications() : []
  const count = (kind: string) => notifs.filter((n) => n.kind === kind).length

  let openTasks = 0
  if (maySee('clients')) {
    try {
      const admin = createAdminSupabaseClient()
      const { count: c } = await admin.from('client_tasks').select('id', { count: 'exact', head: true }).neq('status', 'done')
      openTasks = c ?? 0
    } catch { /* */ }
  }

  const rows = [
    { icon: Receipt, n: count('invoice'), label: 'facturen versturen', href: '/admin/invoices', accent: 'text-red-600', module: 'invoices' },
    { icon: FileText, n: count('contract'), label: 'contract(en) opvolgen', href: '/admin/contracts', accent: 'text-amber-600', module: 'contracts' },
    { icon: Newspaper, n: count('blog'), label: 'blogs klaar voor publicatie', href: '/admin/blog-calendar', accent: 'text-green-600', module: 'blogs' },
    { icon: Globe, n: count('website'), label: 'websitefeedback', href: '/admin/services/website', accent: 'text-blue-600', module: 'content' },
    { icon: ListChecks, n: openTasks, label: 'taken afwerken', href: '/admin/clients', accent: 'text-gray-700', module: 'clients' },
  ].filter((r) => r.n > 0 && maySee(r.module))

  // Voor een werknemer met een smal takenpakket (bv. een appointment setter)
  // is een leeg "Vandaag" enkel ruis — dan tonen we het blok gewoon niet.
  if (rows.length === 0 && modules !== null) return null

  return (
    <div className="card-base">
      <div className="flex items-center gap-2 mb-3">
        <Sun className="h-4 w-4 text-[#caa800]" />
        <h2 className="font-semibold text-gray-900">Vandaag</h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">Niets dringends vandaag — alles is bij. 🎉</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <Link key={i} href={r.href} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 group">
              <r.icon className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-800">
                <span className={`font-bold ${r.accent}`}>{r.n}</span> {r.label}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-gray-300 ml-auto group-hover:text-gray-500" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
