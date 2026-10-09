'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Lock, Eye, EyeOff, ChevronUp, ChevronDown, Ban } from 'lucide-react'
import { STAFF_ROLLEN, ROL_LABEL, MODULE_INSTELLINGEN_KEY, type ModulesInstellingen, type ModuleInfo, type Rol } from '@/lib/instellingen/model'
import { bevestigingstekstVerbergen } from '@/lib/instellingen/valideer'
import type { Ctx } from './instellingen-client'
import { Kop, OpslaanBalk, Schakelaar, Bevestig, Badge } from './ui'

export function SectieModules({ ctx }: { ctx: Ctx }) {
  const bron = ctx.inst.modules
  const [v, setV] = useState<ModulesInstellingen>(bron)
  useEffect(() => { setV(bron) }, [bron])
  const vuil = JSON.stringify(v) !== JSON.stringify(bron)
  const { zetVuil } = ctx
  useEffect(() => { zetVuil(vuil) }, [vuil, zetVuil])

  const [bevestigingen, setBevestigingen] = useState<string[]>([])
  const [vraag, setVraag] = useState<ModuleInfo | null>(null)

  // Persoonlijke zichtbaarheid (enkel voor mezelf) — los van de globale instellingen, meteen opgeslagen.
  const [persoonlijk, setPersoonlijk] = useState<string[]>([])
  const [persoonlijkBezig, setPersoonlijkBezig] = useState<string | null>(null)
  useEffect(() => {
    fetch('/api/admin/instellingen/voorkeuren', { cache: 'no-store' }).then((r) => r.json()).then((j) => setPersoonlijk(j.verborgen ?? [])).catch(() => {})
  }, [])
  const wisselPersoonlijk = useCallback(async (key: string) => {
    const nieuw = persoonlijk.includes(key) ? persoonlijk.filter((k) => k !== key) : [...persoonlijk, key]
    setPersoonlijkBezig(key)
    try {
      const r = await fetch('/api/admin/instellingen/voorkeuren', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verborgen: nieuw }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setPersoonlijk(j.verborgen ?? nieuw)
      toast.success(nieuw.includes(key) ? 'Tabblad voor jou verborgen. Anderen zien het nog gewoon.' : 'Tabblad staat weer in je zijbalk.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setPersoonlijkBezig(null) }
  }, [persoonlijk])

  const secties = useMemo(() => {
    const per = new Map<string, ModuleInfo[]>()
    for (const m of ctx.modules) { const l = per.get(m.sectie) ?? []; l.push(m); per.set(m.sectie, l) }
    for (const l of per.values()) l.sort((a, b) => (v[a.key]?.volgorde ?? 0) - (v[b.key]?.volgorde ?? 0))
    return [...per.entries()]
  }, [ctx.modules, v])

  const zetZichtbaar = (m: ModuleInfo, aan: boolean) => {
    if (!aan && m.essentieel && bron[m.key]?.zichtbaar && !bevestigingen.includes(m.key)) { setVraag(m); return }
    setV((p) => ({ ...p, [m.key]: { ...p[m.key], zichtbaar: aan } }))
  }
  const wisselRol = (key: string, rol: Rol) => setV((p) => {
    const rollen = p[key].rollen.includes(rol) ? p[key].rollen.filter((r) => r !== rol) : [...p[key].rollen, rol]
    return { ...p, [key]: { ...p[key], rollen } }
  })
  const verplaats = (lijst: ModuleInfo[], i: number, richting: -1 | 1) => {
    const j = i + richting; if (j < 0 || j >= lijst.length) return
    const a = lijst[i].key, b = lijst[j].key
    setV((p) => ({ ...p, [a]: { ...p[a], volgorde: p[b].volgorde ?? j }, [b]: { ...p[b], volgorde: p[a].volgorde ?? i } }))
  }

  const opslaan = async () => {
    const vorige = bron
    const ok = await ctx.opslaan('modules', v, bevestigingen)
    if (!ok) return
    setBevestigingen([])
    const alleEssentieel = ctx.modules.filter((m) => m.essentieel).map((m) => m.key)
    toast('Tabbladen aangepast', {
      description: 'Vergist? Zet ze met één klik terug zoals ze stonden.',
      duration: 12000,
      action: { label: 'Ongedaan maken', onClick: () => { ctx.opslaan('modules', vorige, alleEssentieel) } },
    })
  }

  return (
    <div className="card-base">
      <Kop titel="Tabbladen en modules" tekst="Bepaal per tabblad of het voor iedereen zichtbaar is, voor welke rollen, en in welke volgorde het in de zijbalk staat. Verbergen verwijdert nooit gegevens; een verborgen tabblad is ook niet via de URL of de API bereikbaar." />
      <div className="space-y-5">
        {secties.map(([sectie, lijst]) => (
          <div key={sectie}>
            <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wide mb-1.5">{sectie}</div>
            <div className="divide-y divide-gray-50 rounded-xl border border-gray-100">
              {lijst.map((m, i) => {
                const inst = v[m.key]
                const uit = !!m.uitgeschakeld
                const slot = !!m.vergrendeld
                return (
                  <div key={m.key} className={`flex items-center gap-3 px-3 py-2.5 flex-wrap ${uit ? 'opacity-50' : ''}`}>
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button type="button" onClick={() => verplaats(lijst, i, -1)} disabled={i === 0 || uit} className="h-4 w-5 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-20" aria-label="Omhoog"><ChevronUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => verplaats(lijst, i, 1)} disabled={i === lijst.length - 1 || uit} className="h-4 w-5 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-20" aria-label="Omlaag"><ChevronDown className="h-3.5 w-3.5" /></button>
                    </div>
                    <Schakelaar aan={!!inst?.zichtbaar} onChange={(aan) => zetZichtbaar(m, aan)} disabled={slot || uit} label={`${m.label} zichtbaar`} />
                    <div className="min-w-[160px] flex-1">
                      <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
                        {m.label}
                        {slot && <span title="Kan niet verborgen worden"><Lock className="h-3 w-3 text-gray-400" /></span>}
                        {m.essentieel && !slot && <Badge kleur="amber">essentieel</Badge>}
                        {m.adminOnly && <Badge kleur="grijs">enkel hoofdbeheerders</Badge>}
                        {uit && <Badge kleur="grijs"><Ban className="h-3 w-3 inline mr-1" />uitgeschakeld in code</Badge>}
                        {!inst?.zichtbaar && !uit && <Badge kleur="rood">verborgen voor iedereen</Badge>}
                      </div>
                      <div className="text-[11px] text-gray-400">{m.href}</div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                      <span className="text-gray-400">Rollen:</span>
                      <label className="flex items-center gap-1 opacity-60"><input type="checkbox" checked readOnly disabled />{ROL_LABEL.hoofdbeheerder}</label>
                      {STAFF_ROLLEN.map((rol) => {
                        const geblokkeerd = uit || slot && m.key !== MODULE_INSTELLINGEN_KEY || !!m.adminOnly || (m.key === MODULE_INSTELLINGEN_KEY && rol !== 'beheerder')
                        return (
                          <label key={rol} className={`flex items-center gap-1 ${geblokkeerd ? 'opacity-40' : ''}`}>
                            <input type="checkbox" disabled={geblokkeerd} checked={!!inst?.rollen.includes(rol)} onChange={() => wisselRol(m.key, rol)} />{ROL_LABEL[rol]}
                          </label>
                        )
                      })}
                    </div>
                    <button type="button" onClick={() => wisselPersoonlijk(m.key)} disabled={slot || uit || persoonlijkBezig === m.key}
                      title={persoonlijk.includes(m.key) ? 'Voor jou verborgen — klik om weer te tonen' : 'Enkel voor mezelf verbergen'}
                      className={`h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 disabled:opacity-30 ${persoonlijk.includes(m.key) ? 'text-amber-700' : 'text-gray-400'}`}>
                      {persoonlijk.includes(m.key) ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        <p className="text-[11px] text-gray-500">Het oog-icoon verbergt een tabblad enkel voor jezelf en wordt meteen bewaard. De schakelaars en rollen gelden voor iedereen en worden pas actief na <b>Wijzigingen opslaan</b>. Command Center en Instellingen kunnen nooit verborgen worden.</p>
      </div>
      <OpslaanBalk vuil={vuil} bezig={ctx.bezig} onOpslaan={opslaan} onAnnuleer={() => { setV(bron); setBevestigingen([]) }} bijgewerkt={ctx.bijgewerkt.modules} />

      {vraag && (
        <Bevestig titel={`Tabblad ${vraag.label} verbergen`} tekst={bevestigingstekstVerbergen(vraag.label)} bevestigLabel="Ja, verbergen" gevaarlijk
          onBevestig={() => { const m = vraag; setVraag(null); setBevestigingen((b) => [...b, m.key]); setV((p) => ({ ...p, [m.key]: { ...p[m.key], zichtbaar: false } })) }}
          onAnnuleer={() => setVraag(null)} />
      )}
    </div>
  )
}
