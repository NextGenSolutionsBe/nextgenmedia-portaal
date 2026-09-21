import { Camera, Calendar, Clock, MapPin, FileText } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { ShootFeedback, type Feedback } from './shoot-feedback'
import { ShootIdeas, type Idea } from './shoot-ideas'
import { ShootDocumentKnop } from '@/components/shoot-document-knop'

export type Shoot = {
  id: string
  shoot_date: string | null
  start_time: string | null
  end_time: string | null
  location: string | null
  briefing: string | null
}

export function ShootBriefingView({
  shoots,
  feedbackByShoot = {},
  ideasByShoot = {},
}: {
  shoots: Shoot[]
  feedbackByShoot?: Record<string, Feedback[]>
  ideasByShoot?: Record<string, Idea[]>
}) {
  if (!shoots || shoots.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="font-semibold text-gray-900 flex items-center gap-2">
        <Camera className="h-4 w-4 text-purple-500" />
        Shoot Briefing
      </h2>

      {shoots.map((s) => {
        const time = [s.start_time, s.end_time].filter(Boolean).join(' – ')
        return (
          <div key={s.id} className="card-base space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <Calendar className="h-3.5 w-3.5" /> Shootdatum
                </div>
                <div className="font-semibold">{s.shoot_date ? formatDate(s.shoot_date) : 'Nog te bepalen'}</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <Clock className="h-3.5 w-3.5" /> Tijdstip
                </div>
                <div className="font-semibold">{time || '—'}</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">
                  <MapPin className="h-3.5 w-3.5" /> Locatie
                </div>
                <div className="font-semibold break-words">{s.location || '—'}</div>
              </div>
            </div>

            {s.briefing && (
              <div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1.5">
                  <FileText className="h-3.5 w-3.5" /> Shoot Briefing
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 border border-gray-100 rounded-lg p-3">
                  {s.briefing}
                </p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <ShootDocumentKnop
                href={`/api/portal/social-media/shoot-document?shoot=${s.id}`}
                label="Shootdocument downloaden"
                className="w-full sm:w-auto justify-center"
                title="Print-klare checklist met de scripts en medianotities voor deze shoot"
              />
              <span className="text-xs text-gray-500">PDF om af te drukken en af te vinken tijdens de shoot.</span>
            </div>

            <ShootFeedback shootId={s.id} initialFeedback={feedbackByShoot[s.id] ?? []} />
            <ShootIdeas shootId={s.id} initialIdeas={ideasByShoot[s.id] ?? []} />
          </div>
        )
      })}
    </div>
  )
}
