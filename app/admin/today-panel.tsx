import Link from 'next/link'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { FEATURES } from '@/lib/features'
import { Newspaper, Globe, ListChecks, ArrowRight, Sun } from 'lucide-react'

// "Vandaag" — geen cijfers, enkel acties. De dagelijkse werkplek bovenaan het
// Command Center. Dezelfde tabellen als het notificatiecentrum, enkel geteld.
//
// `modules` = de rechten van de ingelogde werknemer (null = admin, ziet alles).
// Elke regel hangt aan de module waar hij naartoe linkt: wie de module niet
// heeft, krijgt de regel niet te zien én kan er toch niet bij.
export async function TodayPanel({ modules = null }: { modules?: string[] | null }) {
  const maySee = (key: string) => modules === null || modules.includes(key)

  // Enkel drie tellingen, tegelijk. Vroeger liep hier het hele notificatiecentrum
  // (een twintigtal lezingen plus de opslagtelling) om twee getallen te tonen.
  // Websitefeedback = nieuwe aanvragen; het onderhoud staat al bij "Op te volgen".
  const admin = createAdminSupabaseClient()
  const tel = async (aan: boolean, vraag: () => PromiseLike<{ count: number | null }>): Promise<number> => {
    if (!aan) return 0
    try { return (await vraag()).count ?? 0 } catch { return 0 }
  }
  const [blogs, feedback, openTasks] = await Promise.all([
    tel(FEATURES.blogs && maySee('blogs'), () => admin.from('blogs').select('id', { count: 'exact', head: true }).eq('status', 'goedgekeurd')),
    tel(maySee('content'), () => admin.from('webdesign_change_requests').select('id', { count: 'exact', head: true }).eq('status', 'new')),
    tel(maySee('clients'), () => admin.from('client_tasks').select('id', { count: 'exact', head: true }).neq('status', 'done')),
  ])

  // Facturen en contracten staan al bij "Op te volgen" (met namen); hier niet dubbel.
  const rows = [
    { icon: Newspaper, n: blogs, label: 'blogs klaar voor publicatie', href: '/admin/blog-calendar', accent: 'text-green-600', module: 'blogs' },
    { icon: Globe, n: feedback, label: 'websitefeedback', href: '/admin/services/website', accent: 'text-blue-600', module: 'content' },
    { icon: ListChecks, n: openTasks, label: 'taken afwerken', href: '/admin/clients', accent: 'text-gray-700', module: 'clients' },
  ].filter((r) => r.n > 0 && maySee(r.module))

  // Niets te doen = geen blok (een lege kaart is enkel ruis).
  if (rows.length === 0) return null

  return (
    <div className="card-base">
      <div className="flex items-center gap-2 mb-3">
        <Sun className="h-4 w-4 text-gray-500" />
        <h2 className="font-semibold text-gray-900">Vandaag</h2>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">Niets dringends vandaag — alles is bij.</p>
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
