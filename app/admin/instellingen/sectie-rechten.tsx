'use client'

import { KaartTabel } from '@/components/ui/kaart-tabel'

import { useEffect, useState } from 'react'
import { Lock } from 'lucide-react'
import { ACTIES, ROLLEN, MODULE_DASHBOARD_KEY, type RechtenInstellingen, type Rol, type Actie } from '@/lib/instellingen/model'
import type { Ctx } from './instellingen-client'
import { Kop, OpslaanBalk } from './ui'

export function SectieRechten({ ctx }: { ctx: Ctx }) {
  const bron = ctx.inst.rechten
  const [v, setV] = useState<RechtenInstellingen>(bron)
  useEffect(() => { setV(bron) }, [bron])
  const vuil = JSON.stringify(v) !== JSON.stringify(bron)
  const { zetVuil } = ctx
  useEffect(() => { zetVuil(vuil) }, [vuil, zetVuil])
  const [rol, setRol] = useState<Rol>('beheerder')
  const rijen = ctx.modules.filter((m) => !m.uitgeschakeld && m.key !== MODULE_DASHBOARD_KEY)
  const alleenLezen = rol === 'hoofdbeheerder'

  const heeft = (key: string, a: Actie) => alleenLezen ? true : !!v[rol]?.[key]?.includes(a)
  const wissel = (key: string, a: Actie) => setV((p) => {
    const huidig = p[rol]?.[key] ?? []
    let nieuw: Actie[]
    if (a === 'bekijken') nieuw = huidig.includes('bekijken') ? [] : ['bekijken']     // zonder bekijken geen enkele actie
    else nieuw = huidig.includes(a) ? huidig.filter((x) => x !== a) : [...new Set<Actie>(['bekijken', ...huidig, a])]
    return { ...p, [rol]: { ...p[rol], [key]: ACTIES.map((x) => x.key).filter((x) => nieuw.includes(x)) } }
  })
  const zetRij = (key: string, alles: boolean) => setV((p) => ({ ...p, [rol]: { ...p[rol], [key]: alles ? ACTIES.map((a) => a.key) : [] } }))

  return (
    <div className="card-base">
      <Kop titel="Gebruikersrechten" tekst="Per rol en per module: wat mag iemand doen? Dit wordt op de server afgedwongen — ook een rechtstreekse API-aanvraag zonder recht wordt geweigerd. Hoofdbeheerders hebben altijd alle rechten." />
      <div className="flex gap-1 mb-4 flex-wrap">
        {ROLLEN.map((r) => (
          <button key={r.key} type="button" onClick={() => setRol(r.key)} title={r.uitleg}
            className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${rol === r.key ? 'bg-black text-white border-black' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
            {r.label}{r.key === 'hoofdbeheerder' && <Lock className="h-3 w-3 inline ml-1 -mt-0.5" />}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-500 mb-3">{ROLLEN.find((r) => r.key === rol)?.uitleg}</p>
      <div className="overflow-x-auto -mx-1">
        <KaartTabel><table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide">
              <th className="px-2 py-2 font-medium">Module</th>
              {ACTIES.map((a) => <th key={a.key} className="px-2 py-2 font-medium text-center">{a.label.replace('Mag ', '')}</th>)}
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rijen.map((m) => {
              const geblokkeerd = alleenLezen || !!m.adminOnly || (m.key === 'instellingen' && rol !== 'beheerder')
              return (
                <tr key={m.key} className={geblokkeerd && !alleenLezen ? 'opacity-50' : ''}>
                  <td className="px-2 py-2">
                    <div className="font-medium">{m.label}</div>
                    <div className="text-[11px] text-gray-400">{m.sectie}{m.adminOnly ? ' · enkel hoofdbeheerders' : ''}</div>
                  </td>
                  {ACTIES.map((a) => (
                    <td key={a.key} className="px-2 py-2 text-center">
                      <input type="checkbox" checked={heeft(m.key, a.key)} disabled={geblokkeerd} onChange={() => wissel(m.key, a.key)} aria-label={`${m.label}: ${a.label}`} />
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right whitespace-nowrap text-[11px]">
                    {!geblokkeerd && <><button type="button" className="text-gray-500 hover:underline" onClick={() => zetRij(m.key, true)}>alles</button> · <button type="button" className="text-gray-500 hover:underline" onClick={() => zetRij(m.key, false)}>niets</button></>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table></KaartTabel>
      </div>
      <p className="text-[11px] text-gray-500 mt-3">"Bekijken" is de basis: zonder dat recht vervallen de andere acties voor die module. Een werknemer ziet daarnaast enkel de modules die op zijn account aangevinkt staan (Medewerkers).</p>
      <OpslaanBalk vuil={vuil} bezig={ctx.bezig} onOpslaan={() => ctx.opslaan('rechten', v)} onAnnuleer={() => setV(bron)} bijgewerkt={ctx.bijgewerkt.rechten} />
    </div>
  )
}
