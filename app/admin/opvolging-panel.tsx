import Link from 'next/link'
import { buildOpvolging, type OpvolgGroep } from '@/lib/notifications'
import { Inbox, FileText, CalendarClock, PhoneCall, MessageSquare, ArrowRight } from 'lucide-react'

// "Op te volgen" — bovenaan het Command Center: per soort wat er nu ligt, met
// namen, zodat je meteen ziet bij wie je moet zijn. Elke kaart hangt aan een
// module; wie die niet heeft, ziet de kaart niet.
const ICOON: Record<OpvolgGroep['key'], React.ElementType> = {
  aanvragen: Inbox, contracten: FileText, meetings: CalendarClock, leads: PhoneCall, content: MessageSquare,
}

export async function OpvolgingPanel({ modules = null }: { modules?: string[] | null }) {
  const groepen = await buildOpvolging(modules)
  if (!groepen.length) return null
  return <OpvolgingKaarten groepen={groepen} />
}

export function OpvolgingKaarten({ groepen }: { groepen: OpvolgGroep[] }) {
  return (
    <section aria-labelledby="op-te-volgen" className="space-y-3">
      <h2 id="op-te-volgen" className="font-semibold text-gray-900">Op te volgen</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {groepen.map((g) => {
          const Icoon = ICOON[g.key]
          return (
            <div key={g.key} className="card-base !p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Icoon className="h-4 w-4 text-gray-500 shrink-0" />
                <h3 className="text-sm font-semibold text-gray-900 flex-1">{g.titel}</h3>
                <span className={`min-w-[1.75rem] text-center rounded-full px-2 py-0.5 text-xs font-bold ${g.totaal > 0 ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-400'}`}>{g.totaal}</span>
              </div>
              {g.items.length === 0 ? (
                <p className="text-sm text-gray-400 py-1">{g.leeg}</p>
              ) : (
                <ul className="-mx-2 flex-1">
                  {g.items.map((i) => (
                    <li key={i.id}>
                      <Link href={i.href} className="flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 group">
                        <span className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${i.dringend ? 'bg-amber-500' : 'bg-gray-300'}`} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-gray-900 truncate">{i.titel}</span>
                          {i.sub && <span className="block text-xs text-gray-500 truncate">{i.sub}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <Link href={g.alles} className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black w-fit">
                {g.totaal > g.items.length ? `Alle ${g.totaal} bekijken` : 'Openen'}<ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )
        })}
      </div>
    </section>
  )
}
