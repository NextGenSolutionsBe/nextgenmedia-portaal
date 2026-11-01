'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Building2, FileSignature, MessageSquare, Plus, User, ArrowRightLeft, Send, CheckCircle2, Ban, Clock, Check, AlertCircle,
} from 'lucide-react'
import {
  KOLOMMEN, kolomInfo, kolomVan, stapLabel, kaartKleur, dienstInfo, bronLabel, offerteViaLabel, dagenSinds,
  type KolomKey, type DienstInfo,
} from '@/lib/opdrachten-kanban'
import { formatEuro } from '@/lib/utils'
import { datumKort, hoeLangGeleden, type KaartOpdracht } from './types'

const PER_KOLOM = 25

/**
 * Het bord: zeven kolommen naast elkaar, op de gsm één kolom per scherm met
 * snappen. Slepen met de muis; op een touchscherm via de knop "Verplaats" op
 * de kaart (slepen werkt daar niet betrouwbaar).
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
    <div className="-mx-4 sm:mx-0 px-4 sm:px-0 flex gap-3 overflow-x-auto pb-4 snap-x snap-mandatory sm:snap-none overscroll-x-contain">
      {KOLOMMEN.map((kol) => {
        const lijst = kaarten.filter((o) => kolomVan(o.status) === kol.key)
        const waarde = lijst.reduce((t, o) => t + (o.waarde ?? 0), 0)
        const max = zichtbaar[kol.key] ?? PER_KOLOM
        const isDoel = doel === kol.key && sleepId !== null
        return (
          <section key={kol.key}
            className={`shrink-0 w-[88vw] max-w-[23rem] sm:w-[22rem] snap-start rounded-2xl border flex flex-col max-h-[calc(100dvh-13rem)] min-h-[16rem] overflow-hidden transition-colors ${isDoel ? 'border-gray-900/40 bg-gray-100' : 'border-gray-200 bg-gray-50'}`}
            onDragOver={(e) => { if (!sleepId) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (doel !== kol.key) setDoel(kol.key) }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDoel((d) => (d === kol.key ? null : d)) }}
            onDrop={(e) => drop(e, kol.key)}>
            <div className={`h-1.5 ${kol.balk}`} />
            <header className="px-3 pt-2.5 pb-2 border-b border-gray-200">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full truncate ${kol.label_kleur}`}>{kol.label}</span>
                  <span className="text-xs text-gray-500 tabular-nums">{lijst.length}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`text-xs font-semibold tabular-nums ${waarde ? 'text-gray-800' : 'text-gray-300'}`} title="Waarde excl. btw van de kaarten in deze kolom">{formatEuro(waarde)}</span>
                  {(kol.key === 'potentieel' || kol.key === 'offerte') && (
                    <button type="button" onClick={() => onNieuw(kol.key)} title={`Nieuwe kaart in ${kol.label}`} aria-label={`Nieuwe kaart in ${kol.label}`}
                      className="h-7 w-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-black">
                      <Plus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
              <p className="text-[11px] text-gray-500 mt-1 leading-snug">{kol.uitleg}</p>
            </header>
            <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
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
                  className="w-full text-xs text-gray-600 hover:text-black py-2">Meer tonen ({lijst.length - max})</button>
              )}
              {lijst.length === 0 && !laden && (
                <p className={`text-xs text-center py-8 rounded-xl border border-dashed ${isDoel ? 'border-gray-500 text-gray-700' : 'border-gray-200 text-gray-400'}`}>
                  {isDoel ? 'Loslaten om hierheen te verplaatsen' : 'Sleep een kaart hierheen'}
                </p>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Klein label op de kaart; leesbaar op elke kaartkleur. */
function Chip({ kleur, children, titel, stip }: { kleur: DienstInfo; children: React.ReactNode; titel?: string; stip?: string }) {
  return (
    <span title={titel}
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full max-w-full ${kleur.donker ? 'bg-white/15 text-white border border-white/25' : 'bg-white/75 text-gray-800 border border-black/5'}`}>
      {stip && <span className="h-2 w-2 rounded-full shrink-0 border border-black/10" style={{ background: stip }} />}
      <span className="truncate">{children}</span>
    </span>
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
  const kol = kolomInfo(kolom)
  const stap = stapLabel(o.status)
  // De fijnere stap tonen we enkel als de kolom er meerdere heeft (en niet voor "Nieuw").
  const toonStap = kol.stappen.length > 1 && o.status !== kol.stappen[0] && kolom !== 'stopgezet' && kolom !== 'afgerond'
  const dagen = dagenSinds(o.status_gewijzigd_op ?? o.created_at)
  const f = o.facturatie
  const pct = f?.totaal ? Math.min(100, Math.round((f.gefactureerd / f.totaal) * 100)) : null
  const blok = kleur.donker ? 'bg-white/10 border-white/20' : 'bg-white/60 border-black/5'
  const zacht = kleur.donker ? 'text-white/75' : 'text-gray-600'
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <article
      data-kaart={o.id}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}
      tabIndex={0}
      style={{ background: kleur.achtergrond, borderColor: kleur.rand, color: kleur.tekst }}
      className={`relative rounded-2xl border-2 p-3.5 shadow-sm hover:shadow-md cursor-pointer select-none transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-black ${sleept ? 'opacity-40' : ''}`}>
      {/* Fase bovenaan, als label in de kleur van de kolom. */}
      <div className="flex items-center justify-between gap-2">
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${kol.label_kleur}`}>{kol.label}</span>
        <div className="relative" onClick={stop}>
          <button type="button" onClick={onMenu} aria-label="Verplaatsen naar een andere fase" title="Verplaatsen"
            className={`h-8 px-2 rounded-lg flex items-center gap-1 text-[11px] font-medium ${kleur.donker ? 'hover:bg-white/15' : 'hover:bg-black/5'}`}>
            <ArrowRightLeft className="h-3.5 w-3.5" /><span className="sm:hidden">Verplaats</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-9 z-30 w-56 rounded-xl border border-gray-200 bg-white text-gray-900 shadow-lg p-1">
              <p className="px-2.5 pt-1.5 pb-1 text-[11px] text-gray-500">Verplaats naar</p>
              {KOLOMMEN.map((k) => (
                <button key={k.key} type="button" onClick={() => onKolom(k.key)} disabled={k.key === kolom}
                  className="w-full text-left text-sm px-2.5 py-2 rounded-lg hover:bg-gray-100 disabled:opacity-50 flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${k.balk}`} />{k.label}
                  {k.key === kolom && <Check className="h-3.5 w-3.5 ml-auto" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <h3 className="mt-2 text-[15px] font-semibold leading-snug break-words">{o.titel}</h3>
      <p className={`mt-0.5 text-[13px] flex items-center gap-1.5 ${zacht}`}>
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate font-medium">{o.klant_naam || 'Geen klant'}</span>
        <span className="shrink-0 opacity-80">· {o.client_id ? 'klant' : 'prospect'}</span>
      </p>

      {/* Labels: bron en diensten. */}
      {(o.bron || o.diensten.length > 0 || toonStap) && (
        <div className="mt-2 flex items-center gap-1 flex-wrap">
          {o.bron && <Chip kleur={kleur}>{bronLabel(o.bron)}</Chip>}
          {o.diensten.map((d) => {
            const i = dienstInfo(d)
            return <Chip key={d} kleur={kleur} stip={i.key ? i.achtergrond : undefined}>{i.label}</Chip>
          })}
          {toonStap && <Chip kleur={kleur} titel="Stap binnen deze fase">{stap}</Chip>}
        </div>
      )}

      <div className="mt-2.5 flex items-end justify-between gap-2">
        <div>
          <p className={`text-[11px] ${zacht}`}>Waarde excl. btw</p>
          <p className="text-lg font-bold tabular-nums leading-tight">{o.waarde !== null && o.waarde !== undefined ? formatEuro(o.waarde) : <span className="opacity-50 text-sm font-medium">nog in te vullen</span>}</p>
        </div>
        {o.verantwoordelijke && (
          <span className={`text-xs font-medium flex items-center gap-1 ${zacht}`}><User className="h-3.5 w-3.5" />{o.verantwoordelijke}</span>
        )}
      </div>

      {/* Wat er in deze fase telt. */}
      {kolom === 'offerte' && (
        o.offerte_via ? (
          <p className={`mt-2.5 text-xs rounded-xl border px-2.5 py-2 flex items-center gap-1.5 ${blok}`}>
            <Send className="h-3.5 w-3.5 shrink-0" />Offerte {offerteViaLabel(o.offerte_via)?.toLowerCase()}{o.offerte_op && <> · {datumKort(o.offerte_op)}</>}
          </p>
        ) : (
          <p className="mt-2.5 text-xs rounded-xl border px-2.5 py-2 flex items-center gap-1.5 bg-amber-50 border-amber-200 text-amber-900">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />Hoe is de offerte gedeeld? Nog invullen.
          </p>
        )
      )}
      {o.contract && (kolom === 'contract' || kolom === 'getekend' || kolom === 'uitvoering') && (
        <Link href={`/admin/contracts/${o.contract.id}`} onClick={stop} draggable={false}
          className={`mt-2.5 text-xs rounded-xl border px-2.5 py-2 flex items-center gap-1.5 hover:underline ${blok}`}>
          <FileSignature className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{o.contract.title ?? 'Contract'}</span>
          <span className="shrink-0 opacity-80">· {o.contract.label ?? o.contract.status}</span>
        </Link>
      )}
      {kolom === 'contract' && !o.contract && (
        <p className="mt-2.5 text-xs rounded-xl border px-2.5 py-2 flex items-center gap-1.5 bg-amber-50 border-amber-200 text-amber-900">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />Nog geen contract gekoppeld.
        </p>
      )}
      {f && f.bron && (kolom === 'getekend' || kolom === 'uitvoering' || kolom === 'afgerond') && (f.gefactureerd > 0 || f.totaal) && (
        <div className={`mt-2.5 text-xs rounded-xl border px-2.5 py-2 ${blok}`}>
          <div className="flex items-center justify-between gap-2">
            <span>{f.volledig ? 'Volledig gefactureerd' : 'Gefactureerd'}</span>
            <span className="font-semibold tabular-nums">{formatEuro(f.gefactureerd)}{f.totaal ? ` / ${formatEuro(f.totaal)}` : ''}</span>
          </div>
          {pct !== null && (
            <div className={`mt-1.5 h-1.5 rounded-full overflow-hidden ${kleur.donker ? 'bg-white/20' : 'bg-black/10'}`}>
              <div className={`h-full rounded-full ${f.volledig ? 'bg-green-600' : kleur.donker ? 'bg-white' : 'bg-gray-900'}`} style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}
      {kolom === 'afgerond' && !f?.bron && (
        <p className={`mt-2.5 text-xs rounded-xl border px-2.5 py-2 flex items-center gap-1.5 ${blok}`}><CheckCircle2 className="h-3.5 w-3.5" />{stap}</p>
      )}
      {kolom === 'stopgezet' && (
        <p className={`mt-2.5 text-xs rounded-xl border px-2.5 py-2 flex items-start gap-1.5 ${blok}`}>
          <Ban className="h-3.5 w-3.5 shrink-0 mt-px" /><span>{stap}{o.stop_reden ? `: ${o.stop_reden}` : ''}</span>
        </p>
      )}

      {/* De laatste interne notitie. */}
      {o.laatste_notitie && (
        <div className={`mt-2.5 text-xs rounded-xl border px-2.5 py-2 ${blok}`}>
          <p className="line-clamp-3 whitespace-pre-line leading-snug">{o.laatste_notitie.tekst}</p>
          <p className={`mt-1 text-[11px] ${zacht}`}>{o.laatste_notitie.auteur_naam || o.laatste_notitie.auteur_email?.split('@')[0] || 'Team'} · {hoeLangGeleden(o.laatste_notitie.created_at)}</p>
        </div>
      )}

      <div className={`mt-2.5 pt-2 border-t flex items-center justify-between text-[11px] ${kleur.donker ? 'border-white/20 text-white/80' : 'border-black/10 text-gray-600'}`}>
        <span className="flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" />{o.notities_aantal ? `${o.notities_aantal} notitie${o.notities_aantal === 1 ? '' : 's'}` : 'Notitie toevoegen'}</span>
        {dagen !== null && (
          <span className="flex items-center gap-1" title="Zo lang staat de kaart al in deze fase">
            <Clock className="h-3.5 w-3.5" />{dagen === 0 ? 'vandaag' : `${dagen} d`} in deze fase{o.status_bron === 'automatisch' ? ' · auto' : ''}
          </span>
        )}
      </div>
    </article>
  )
}
