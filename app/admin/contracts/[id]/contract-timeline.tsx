import {
  FileUp, Sparkles, PencilLine, Send, Eye, CheckSquare, PenTool, FileCheck2, Download, RefreshCw, XCircle, Clock, Circle,
} from 'lucide-react'

type Event = { id: string; event_type: string; created_at: string; actor?: string | null; actor_email?: string | null }

const META: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  uploaded:              { label: 'Aangemaakt / geüpload', icon: FileUp,      cls: 'bg-gray-100 text-gray-600' },
  created:               { label: 'Aangemaakt',            icon: FileUp,      cls: 'bg-gray-100 text-gray-600' },
  created_from_template: { label: 'Aangemaakt uit template', icon: FileUp,    cls: 'bg-gray-100 text-gray-600' },
  ai_analyzed:           { label: 'AI geanalyseerd',       icon: Sparkles,    cls: 'bg-purple-100 text-purple-600' },
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
}

export function ContractTimeline({ events }: { events: Event[] }) {
  if (!events || events.length === 0) {
    return <div className="text-sm text-gray-400 py-2 text-center">Nog geen activiteit</div>
  }
  // Oudste eerst voor een logische tijdlijn van boven naar onder.
  const sorted = [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

  return (
    <ol className="relative ml-1">
      {sorted.map((e, i) => {
        const m = META[e.event_type] ?? { label: e.event_type, icon: Circle, cls: 'bg-gray-100 text-gray-600' }
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
