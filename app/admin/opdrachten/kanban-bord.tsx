'use client'

import { useEffect, useState } from 'react'
import { MessageSquare, Plus, MoreHorizontal, Check, FileSignature, AlertCircle, UserRound, Send } from 'lucide-react'
import {
  KOLOMMEN, kolomVan, dienstInfo, kaartKleur, offerteViaLabel, dagenSinds, BEDRIJVEN, projectVerantwoordelijke,
  type KolomKey,
} from '@/lib/opdrachten-kanban'
import { formatEuro } from '@/lib/utils'
import { geopendTekst } from '@/lib/klant-geopend'
import { datumKort, type KaartOpdracht } from './types'

const PER_KOLOM = 30

/** Een rustige stip per fase in plaats van volle kleurvlakken. */
const FASE_STIP: Record<KolomKey, string> = {
  potentieel: 'bg-slate-400', offerte: 'bg-violet-500', contract: 'bg-blue-500', getekend: 'bg-teal-500',
  uitvoering: 'bg-amber-500', afgerond: 'bg-emerald-500', stopgezet: 'bg-rose-400',
}

/**
 * Het bord: zeven smalle kolommen met compacte witte kaarten. Slepen met de
 * muis; op een touchscherm (en voor wie liever klikt) via het menu "…" op de
 * kaart. De kleur van de dienst is een stip, het bedrag staat rechts.
 */
export function KanbanBord({ kaarten, laden, onOpen, onVerplaats, onNieuw }: {
  kaarten: KaartOpdracht[]
  laden: boolean
  onOpen: (o: KaartOpdracht) => void
  onVerplaats: (o: KaartOpdracht, doel: KolomKey) => void
  onNieuw: (kolom: KolomKey) => void
}) {
  const [sleepId, setSleepId] = useState<string | null>(null)
  const [doel, setDoel] = useState<KolomKey | null>(null)
  const [zichtbaar, setZichtbaar] = useState<Partial<Record<KolomKey, number>>>({})
  const [menuId, setMenuId] = useState<string | null>(null)

  useEffect(() => {
    if (!menuId) return
    const sluit = () => setMenuId(null)
    window.addEventListener('click', sluit)
    return () => window.removeEventListener('click', sluit)
  }, [menuId])

  const drop = (e: React.DragEvent, k: KolomKey) => {
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain') || sleepId
    setDoel(null); setSleepId(null)
    const o = kaarten.find((x) => x.id === id)
    if (o && kolomVan(o.status) !== k) onVerplaats(o, k)
  }

  return (
    <div className="-mx-4 sm:mx-0 px-4 sm:px-0 flex gap-2.5 overflow-x-auto pb-3 snap-x snap-mandatory sm:snap-none overscroll-x-contain">
      {KOLOMMEN.map((kol) => {
        const lijst = kaarten.filter((o) => kolomVan(o.status) === kol.key)
        const waarde = lijst.reduce((t, o) => t + (o.waarde ?? 0), 0)
        const max = zichtbaar[kol.key] ?? PER_KOLOM
        const isDoel = doel === kol.key && sleepId !== null
        return (
          <section key={kol.key}
            className={`shrink-0 w-[85vw] max-w-[19rem] sm:w-[17.5rem] snap-start rounded-xl flex flex-col max-h-[calc(100dvh-14rem)] min-h-[14rem] transition-colors ${isDoel ? 'bg-gray-200/70 ring-1 ring-gray-300' : 'bg-gray-100/70'}`}
            onDragOver={(e) => { if (!sleepId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (doel !== kol.key) setDoel(kol.key) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDoel((d) => (d === kol.key ? null : d)) }}
            onDrop={(e) => drop(e, kol.key)}>
            <header className="px-3 pt-2.5 pb-2 flex items-center justify-between gap-2" title={kol.uitleg}>
              <div className="flex items-center gap-2 min-w-0">
                <span className={`h-2 w-2 rounded-full shrink-0 ${FASE_STIP[kol.key]}`} />
                <span className="text-[13px] font-semibold text-gray-900 truncate">{kol.label}</span>
                <span className="text-xs text-gray-500 tabular-nums">{lijst.length}</span>
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <span className={`text-xs tabular-nums ${waarde ? 'text-gray-600' : 'text-gray-300'}`} title="Waarde excl. btw">{formatEuro(waarde)}</span>
                {(kol.key === 'potentieel' || kol.key === 'offerte') && (
                  <button type="button" onClick={() => onNieuw(kol.key)} title={`Nieuwe kaart in ${kol.label}`} aria-label={`Nieuwe kaart in ${kol.label}`}
                    className="h-6 w-6 rounded-md flex items-center justify-center text-gray-500 hover:bg-white hover:text-black">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </header>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
              {lijst.slice(0, max).map((o) => (
                <Kaart key={o.id} o={o} sleept={sleepId === o.id} menuOpen={menuId === o.id}
                  onOpen={() => onOpen(o)}
                  onMenu={() => setMenuId(menuId === o.id ? null : o.id)}
                  onKolom={(k) => { setMenuId(null); if (k !== kolomVan(o.status)) onVerplaats(o, k) }}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', o.id); e.dataTransfer.effectAllowed = 'move'; setSleepId(o.id); setMenuId(null) }}
                  onDragEnd={() => { setSleepId(null); setDoel(null) }} />
              ))}
              {lijst.length > max && (
                <button type="button" onClick={() => setZichtbaar((z) => ({ ...z, [kol.key]: max + PER_KOLOM }))}
                  className="w-full text-xs text-gray-500 hover:text-black py-1.5">Meer tonen ({lijst.length - max})</button>
              )}
              {lijst.length === 0 && !laden && (
                <p className={`text-xs text-center py-6 rounded-lg border border-dashed ${isDoel ? 'border-gray-400 text-gray-700' : 'border-gray-300/70 text-gray-400'}`}>
                  {isDoel ? 'Loslaten om hierheen te verplaatsen' : 'Leeg'}
                </p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function Kaart({ o, sleept, menuOpen, onOpen, onMenu, onKolom, onDragStart, onDragEnd }: {
  o: KaartOpdracht
  sleept: boolean
  menuOpen: boolean
  onOpen: () => void
  onMenu: () => void
  onKolom: (k: KolomKey) => void
  onDragStart: (e: React.DragEvent<HTMLElement>) => void
  onDragEnd: () => void
}) {
  const kleur = kaartKleur(o.diensten)
  const kolom = kolomVan(o.status)
  const dagen = dagenSinds(o.status_gewijzigd_op ?? o.created_at)
  const f = o.facturatie
  // Contractwaarde en wat er al gefactureerd is. Afgerond = de volledige waarde
  // is gefactureerd (dat is net waarom de kaart vanzelf naar Afgerond ging).
  const contractwaarde = f?.totaal ?? (o.waarde ?? null)
  const gefactureerd = f?.gefactureerd ?? 0
  const balk = contractwaarde ? Math.min(100, Math.round((gefactureerd / contractwaarde) * 100)) : (kolom === 'afgerond' && f?.volledig ? 100 : null)
  const facturatieZichtbaar = (kolom === 'getekend' || kolom === 'uitvoering' || kolom === 'afgerond') && (gefactureerd > 0 || contractwaarde !== null)
  const wie = projectVerantwoordelijke(o.verantwoordelijke)
  const notitie = o.laatste_notitie?.tekst?.replace(/\s+/g, ' ').trim() ?? ''
  const diensten = o.diensten.map((d) => dienstInfo(d).label).join(', ')
  const bedrijf = o.merk && o.merk !== 'nextgenmedia' ? BEDRIJVEN.find((b) => b.key === o.merk)?.kort : null
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const waarschuwing = kolom === 'offerte' && !o.offerte_via ? 'Hoe is de offerte gedeeld?' : kolom === 'contract' && !o.contract ? 'Nog geen contract gekoppeld' : null

  return (
    <article
      data-kaart={o.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
      tabIndex={0}
      className={`group relative rounded-lg border border-gray-200 bg-white px-2.5 py-2 cursor-pointer select-none hover:border-gray-300 hover:shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900 ${sleept ? 'opacity-40' : ''}`}>
      <div className="flex items-start gap-2">
        <span className="mt-[5px] h-2 w-2 rounded-full shrink-0 ring-1 ring-black/10" style={{ background: kleur.key ? kleur.rand : '#E5E7EB' }} title={kleur.label} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-medium text-gray-900 leading-snug truncate">{o.klant_naam || 'Geen klant'}</p>
            <span className="text-xs tabular-nums text-gray-700 shrink-0">{o.waarde !== null && o.waarde !== undefined ? formatEuro(o.waarde) : ''}</span>
          </div>
          <p className="text-xs text-gray-500 leading-snug line-clamp-2">
            {diensten && <span className="text-gray-700">{diensten}</span>}
            {diensten && o.titel ? ' · ' : ''}{o.titel}
          </p>
          {waarschuwing && (
            <p className="mt-1 text-[11px] text-amber-700 flex items-center gap-1"><AlertCircle className="h-3 w-3 shrink-0" />{waarschuwing}</p>
          )}
          {o.offerte && (kolom === 'potentieel' || kolom === 'offerte') ? (
            <p className={`mt-1 text-[11px] flex items-center gap-1 min-w-0 ${o.offerte.status === 'geaccepteerd' ? 'text-emerald-700 font-medium' : o.offerte.klant_geopend_op ? 'text-gray-700' : 'text-gray-400'}`}>
              <Send className="h-3 w-3 shrink-0" />
              <span className="truncate">{o.offerte.status === 'geaccepteerd' ? `Offerte geaccepteerd${o.offerte.geaccepteerd_op ? ` op ${datumKort(o.offerte.geaccepteerd_op)}` : ''}` : geopendTekst(o.offerte.klant_geopend_op) ?? 'Offerte nog niet geopend door de klant'}</span>
            </p>
          ) : kolom === 'offerte' && o.offerte_via && (
            <p className="mt-1 text-[11px] text-gray-500">Offerte {offerteViaLabel(o.offerte_via)?.toLowerCase()}{o.offerte_op ? ` · ${datumKort(o.offerte_op)}` : ''}</p>
          )}
          {o.contract && (kolom === 'contract' || kolom === 'getekend') && (
            <p className="mt-1 text-[11px] text-gray-500 flex items-center gap-1 min-w-0"><FileSignature className="h-3 w-3 shrink-0" /><span className="truncate">{o.contract.label ?? o.contract.status}</span></p>
          )}
          {o.contract && kolom === 'contract' && (
            <p className={`text-[11px] ${o.contract.klant_geopend_op ? 'text-gray-600' : 'text-gray-400'}`}>{geopendTekst(o.contract.klant_geopend_op) ?? 'Nog niet geopend door de klant'}</p>
          )}
          {facturatieZichtbaar && (
            <div className="mt-1.5" title={f?.totaal ? `${formatEuro(f.gefactureerd)} van ${formatEuro(f.totaal)} gefactureerd` : undefined}>
              <div className="flex items-center justify-between gap-2 text-[10px] tabular-nums text-gray-500">
                <span>Gefactureerd <b className="font-semibold text-gray-800">{formatEuro(gefactureerd)}</b></span>
                {contractwaarde !== null && <span>van {formatEuro(contractwaarde)}</span>}
              </div>
              {balk !== null && (
                <div className="mt-0.5 h-1 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${balk >= 100 ? 'bg-emerald-500' : 'bg-gray-800'}`} style={{ width: `${balk}%` }} /></div>
              )}
            </div>
          )}
          {kolom === 'stopgezet' && o.stop_reden && <p className="mt-1 text-[11px] text-gray-500 line-clamp-1">{o.stop_reden}</p>}
          {notitie && (
            <p className="mt-1 text-[11px] text-gray-500 truncate" title={notitie}><MessageSquare className="inline h-3 w-3 -mt-px mr-1 text-gray-400" />{notitie}</p>
          )}
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-gray-400 min-w-0">
            {bedrijf && <span className="rounded bg-gray-100 px-1 py-px text-gray-600 font-medium">{bedrijf}</span>}
            {wie
              ? <span className="truncate flex items-center gap-0.5 text-gray-600"><UserRound className="h-3 w-3 shrink-0" />{wie}</span>
              : <span className="truncate text-amber-700">Geen verantwoordelijke</span>}
            <span className="ml-auto flex items-center gap-2 shrink-0">
              {!!o.notities_aantal && <span className="flex items-center gap-0.5"><MessageSquare className="h-3 w-3" />{o.notities_aantal}</span>}
              {dagen !== null && <span title="Zo lang in deze fase">{dagen === 0 ? 'vandaag' : `${dagen} d`}</span>}
            </span>
          </div>
        </div>
      </div>
      <div className="absolute right-1 bottom-1 sm:top-1 sm:bottom-auto" onClick={stop}>
        <button type="button" onClick={onMenu} aria-label="Verplaatsen naar een andere fase" title="Verplaatsen"
          className={`h-6 w-6 rounded-md flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-900 ${menuOpen ? 'bg-gray-100 text-gray-900' : 'sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100'}`}>
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-7 z-30 w-52 rounded-lg border border-gray-200 bg-white text-gray-900 shadow-lg p-1">
            <p className="px-2 pt-1 pb-1 text-[11px] text-gray-500">Verplaats naar</p>
            {KOLOMMEN.map((k) => (
              <button key={k.key} type="button" onClick={() => onKolom(k.key)} disabled={k.key === kolom}
                className="w-full text-left text-[13px] px-2 py-1.5 rounded-md hover:bg-gray-100 disabled:opacity-50 flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${FASE_STIP[k.key]}`} />{k.label}
                {k.key === kolom && <Check className="h-3.5 w-3.5 ml-auto" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  )
}
