import {
  FileUp, Sparkles, PencilLine, Send, Eye, CheckSquare, PenTool, FileCheck2, Download, RefreshCw, XCircle, Clock, Circle, Euro, MinusCircle, CheckCircle2, Paperclip, Undo2, BellRing,
} from 'lucide-react'
import { WIJZIGING_LABEL, type WijzigingSoort } from '@/lib/contracten/aflettering'

type Event = { id: string; event_type: string; created_at: string; actor?: string | null; actor_email?: string | null; meta?: Record<string, unknown> | null }

const LOOPTIJD_LABEL: Record<string, string> = { lopend: 'Lopend', afgerond: 'Afgerond', stopgezet: 'Stopgezet', verlopen: 'Verlopen' }

/** Extra regel onder een tijdlijnitem (bv. "Lopend → Stopgezet · reden"). */
const euroTekst = (v: unknown) => (v === null || v === undefined || v === '' ? 'leeg' : `€ ${Number(v).toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)

function detail(e: Event): string | null {
  if (!e.meta) return null
  const mm = e.meta as Record<string, unknown>
  if (e.event_type === 'contractwaarde_gewijzigd') return `${euroTekst(mm.oud)} → ${euroTekst(mm.nieuw)} excl. btw`
  if (e.event_type === 'contractwaarde_vermindering' || e.event_type === 'contractwaarde_vermindering_verwijderd') {
    const soort = WIJZIGING_LABEL[mm.soort as WijzigingSoort] ?? String(mm.soort ?? '')
    return [`${soort}: ${euroTekst(mm.bedrag_excl)}`, mm.onderdeel, mm.reden].filter(Boolean).join(' · ')
  }
  if (e.event_type === 'contractwaarde_vermindering_gewijzigd') {
    const o = (mm.oud ?? {}) as Record<string, unknown>, n = (mm.nieuw ?? {}) as Record<string, unknown>
    return `${euroTekst(o.bedrag_excl)} → ${euroTekst(n.bedrag_excl)}${n.onderdeel ? ` · ${n.onderdeel}` : ''}`
  }
  if (e.event_type === 'signed' && mm.wijze === 'manueel') return typeof mm.notitie === 'string' && mm.notitie ? mm.notitie : null
  if (e.event_type === 'bijlage_toegevoegd' || e.event_type === 'bijlage_verwijderd') return typeof mm.naam === 'string' ? mm.naam : null
  if (e.event_type === 'herinnering_verstuurd') return typeof mm.to === 'string' ? `naar ${mm.to}` : null
  if (e.event_type === 'cancelled' || e.event_type === 'niet_geaccepteerd') return typeof mm.reden === 'string' && mm.reden ? mm.reden : null
  if (e.event_type !== 'looptijd_gewijzigd') return null
  const m = e.meta as { oud?: string; nieuw?: string; stop_datum?: string | null; stop_reden?: string | null }
  const delen = [`${LOOPTIJD_LABEL[m.oud ?? ''] ?? m.oud ?? '?'} → ${LOOPTIJD_LABEL[m.nieuw ?? ''] ?? m.nieuw ?? '?'}`]
  if (m.stop_datum) delen.push(`stopdatum ${String(m.stop_datum).split('-').reverse().join('/')}`)
  if (m.stop_reden) delen.push(String(m.stop_reden))
  return delen.join(' · ')
}

const META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  uploaded:              { label: 'Aangemaakt / geüpload', icon: FileUp,      cls: 'bg-gray-100 text-gray-600' },
  created:               { label: 'Aangemaakt',            icon: FileUp,      cls: 'bg-gray-100 text-gray-600' },
  created_from_template: { label: 'Aangemaakt uit template', icon: FileUp,    cls: 'bg-gray-100 text-gray-600' },
  ai_analyzed:           { label: 'AI geanalyseerd',       icon: Sparkles,    cls: 'bg-gray-100 text-gray-600' },
  fields_edited:         { label: 'Velden aangepast',      icon: PencilLine,  cls: 'bg-gray-100 text-gray-600' },
  sent:                  { label: 'Verzonden',             icon: Send,        cls: 'bg-blue-100 text-blue-600' },
  opened:                { label: 'Geopend',               icon: Eye,         cls: 'bg-amber-100 text-amber-600' },
  viewed:                { label: 'Geopend',               icon: Eye,         cls: 'bg-amber-100 text-amber-600' },
  filled:                { label: 'Ingevuld',              icon: CheckSquare, cls: 'bg-amber-100 text-amber-600' },
  signed:                { label: 'Getekend',              icon: PenTool,     cls: 'bg-green-100 text-green-600' },
  pdf_generated:         { label: 'PDF gegenereerd',       icon: FileCheck2,  cls: 'bg-green-100 text-green-600' },
  downloaded:            { label: 'Gedownload',            icon: Download,    cls: 'bg-gray-100 text-gray-600' },
  downloaded_original:   { label: 'Origineel gedownload',  icon: Download,    cls: 'bg-gray-100 text-gray-600' },
  downloaded_signed:     { label: 'Getekend gedownload',   icon: Download,    cls: 'bg-gray-100 text-gray-600' },
  token_regenerated:     { label: 'Nieuwe tekenlink',      icon: RefreshCw,   cls: 'bg-gray-100 text-gray-600' },
  expired:               { label: 'Verlopen',              icon: Clock,       cls: 'bg-red-100 text-red-600' },
  cancelled:             { label: 'Geannuleerd',           icon: XCircle,     cls: 'bg-gray-100 text-gray-600' },
  gearchiveerd:          { label: 'Gearchiveerd (certificaat aangemaakt)', icon: FileCheck2, cls: 'bg-green-100 text-green-600' },
  melding_verstuurd:     { label: 'Melding naar Legal verstuurd', icon: Send, cls: 'bg-blue-100 text-blue-600' },
  melding_mislukt:       { label: 'Melding naar Legal mislukt',   icon: XCircle, cls: 'bg-red-100 text-red-600' },
  looptijd_gewijzigd:    { label: 'Status aangepast',      icon: RefreshCw,   cls: 'bg-blue-100 text-blue-600' },
  contractwaarde_gewijzigd: { label: 'Contractwaarde aangepast', icon: Euro, cls: 'bg-gray-100 text-gray-700' },
  contractwaarde_vermindering: { label: 'Vermindering geregistreerd', icon: MinusCircle, cls: 'bg-amber-100 text-amber-700' },
  contractwaarde_vermindering_gewijzigd: { label: 'Vermindering aangepast', icon: MinusCircle, cls: 'bg-amber-100 text-amber-700' },
  contractwaarde_vermindering_verwijderd: { label: 'Vermindering verwijderd', icon: MinusCircle, cls: 'bg-gray-100 text-gray-600' },
  manueel_getekend_ongedaan: { label: 'Niet langer op getekend', icon: Undo2, cls: 'bg-gray-100 text-gray-600' },
  bijlage_toegevoegd:    { label: 'Bijlage toegevoegd',    icon: Paperclip,   cls: 'bg-gray-100 text-gray-600' },
  bijlage_verwijderd:    { label: 'Bijlage verwijderd',    icon: Paperclip,   cls: 'bg-gray-100 text-gray-600' },
  herinnering_verstuurd: { label: 'Herinnering verstuurd', icon: BellRing,    cls: 'bg-blue-100 text-blue-600' },
  niet_geaccepteerd:     { label: 'Niet geaccepteerd door de klant', icon: XCircle, cls: 'bg-red-100 text-red-600' },
  heropend:              { label: 'Terug opengezet',       icon: Undo2,       cls: 'bg-gray-100 text-gray-600' },
}

const MANUEEL_GETEKEND = { label: 'Op getekend gezet (buiten de app)', icon: CheckCircle2, cls: 'bg-green-100 text-green-600' }

export function ContractTimeline({ events }: { events: Event[] }) {
  if (!events || events.length === 0) {
    return <div className="text-sm text-gray-400 py-2 text-center">Nog geen activiteit</div>
  }
  // Oudste eerst voor een logische tijdlijn van boven naar onder.
  const sorted = [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  return (
    <ol className="relative ml-1">
      {sorted.map((e, i) => {
        const m = (e.event_type === 'signed' && e.meta?.wijze === 'manueel' ? MANUEEL_GETEKEND : META[e.event_type]) ?? { label: e.event_type, icon: Circle, cls: 'bg-gray-100 text-gray-600' }
        const Icon = m.icon
        const who = e.actor ?? e.actor_email
        const last = i === sorted.length - 1
        return (
          <li key={e.id} className="relative pl-8 pb-4 last:pb-0">
            {!last && <span className="absolute left-[11px] top-6 bottom-0 w-px bg-gray-200" />}
            <span className={`absolute left-0 top-0 h-6 w-6 rounded-full flex items-center justify-center ${m.cls}`}>
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="text-sm font-medium text-gray-900 leading-6">{m.label}</div>
            {detail(e) && <div className="text-xs text-gray-600">{detail(e)}</div>}
            <div className="text-xs text-gray-400">
              {new Date(e.created_at).toLocaleString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              {who ? ` · ${who}` : ''}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
