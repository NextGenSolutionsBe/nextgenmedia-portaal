// lib/content-planner.ts
// Smart content calendar planning algorithm

import { normaliseerKanalen } from '@/lib/social-platforms'

export type PlannedContentType = 'post' | 'reel' | 'story'

export interface MonthInput {
  year: number
  month: number // 0-based (JS Date convention)
}

export interface PlanInput {
  postsPerMonth: number
  reelsPerMonth: number
  storiesPerMonth: number
  channels: string[]
  niche: string
  months: MonthInput[]
}

export interface PlannedItem {
  planned_date: string // YYYY-MM-DD
  content_type: PlannedContentType
  platform: string
  title: string
  status: 'draft'
}

// ---------------------------------------------------------------------------
// Timing logic
// ---------------------------------------------------------------------------

interface NicheTimes {
  morning: string
  midday: string
  evening: string
}

function getNicheTimes(niche: string): NicheTimes {
  const n = niche.toLowerCase()
  if (/horeca|restaurant|café|bar|food|eten|drinken|catering/.test(n))
    return { morning: '09:00', midday: '12:00', evening: '18:30' }
  if (/fitness|sport|gym|gezondheid|yoga|crossfit/.test(n))
    return { morning: '07:00', midday: '12:00', evening: '18:00' }
  if (/mode|fashion|kleding|beauty|cosmet|haar|kapper|nagel/.test(n))
    return { morning: '10:00', midday: '13:00', evening: '19:00' }
  if (/b2b|zakelijk|consulting|advies|finance|juridisch|accountan/.test(n))
    return { morning: '08:30', midday: '12:00', evening: '16:30' }
  if (/retail|winkel|shop|e-commerce|webshop|online shop/.test(n))
    return { morning: '10:00', midday: '14:00', evening: '19:00' }
  if (/vastgoed|immo|real estate|woning/.test(n))
    return { morning: '09:00', midday: '12:00', evening: '17:00' }
  if (/tech|software|digital|it |saas/.test(n))
    return { morning: '09:00', midday: '12:30', evening: '17:00' }
  return { morning: '10:00', midday: '14:00', evening: '18:30' }
}

function getPlatformPreference(platform: string): 'morning' | 'midday' | 'evening' {
  switch (platform.toLowerCase()) {
    case 'linkedin': return 'morning'
    case 'tiktok': return 'evening'
    case 'pinterest': return 'evening'
    case 'twitter': return 'morning'
    default: return 'midday' // meta
  }
}

function getTypePreference(type: PlannedContentType): 'morning' | 'midday' | 'evening' {
  if (type === 'story') return 'morning'
  if (type === 'reel') return 'evening'
  return 'midday'
}

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(':').map(Number)
  const total = h * 60 + m + mins
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function pickTime(
  platform: string,
  type: PlannedContentType,
  niche: string,
  index: number,
): string {
  const nicheTimes = getNicheTimes(niche)
  const platPref = getPlatformPreference(platform)
  const typePref = getTypePreference(type)

  // Weighted slot decision
  const votes = [platPref, typePref]
  const evening = votes.filter(v => v === 'evening').length
  const morning = votes.filter(v => v === 'morning').length
  const slot: 'morning' | 'midday' | 'evening' =
    evening === 2 ? 'evening' : morning === 2 ? 'morning' : 'midday'

  const base = nicheTimes[slot]
  // Alternate between base time and base+30min to avoid identical timestamps
  return index % 2 === 0 ? base : addMinutes(base, 30)
}

// ---------------------------------------------------------------------------
// Day spreading
// ---------------------------------------------------------------------------

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function getDaysInMonth(year: number, month: number): Date[] {
  const days: Date[] = []
  const d = new Date(year, month, 1)
  while (d.getMonth() === month) {
    days.push(new Date(d))
    d.setDate(d.getDate() + 1)
  }
  return days
}

function spreadAcrossDays(
  slots: { type: PlannedContentType; platform: string }[],
  available: Date[],
): string[] {
  if (slots.length === 0 || available.length === 0) return []

  const usage = new Map<string, number>()
  const result: string[] = []
  const step = Math.max(1, Math.floor(available.length / slots.length))
  let cursor = 0

  for (let i = 0; i < slots.length; i++) {
    let assigned: Date | null = null
    let attempts = 0

    while (attempts < available.length) {
      const candidate = available[cursor % available.length]
      const key = toDateStr(candidate)
      const used = usage.get(key) ?? 0
      if (used < 2) {
        assigned = candidate
        usage.set(key, used + 1)
        cursor += step
        break
      }
      cursor++
      attempts++
    }

    if (!assigned) {
      // Fallback: take any day
      assigned = available[i % available.length]
    }

    result.push(toDateStr(assigned))
  }

  return result
}

// ---------------------------------------------------------------------------
// Core planner
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<PlannedContentType, string> = {
  post: 'Post',
  reel: 'Reel',
  story: 'Story',
}

function generateMonthPlan(
  year: number,
  month: number,
  postsPerMonth: number,
  reelsPerMonth: number,
  storiesPerMonth: number,
  channels: string[],
  niche: string,
): PlannedItem[] {
  const allDays = getDaysInMonth(year, month)
  const weekdays = allDays.filter(d => d.getDay() !== 0 && d.getDay() !== 6)
  // Use weekdays if enough of them, otherwise include weekends
  const preferred = weekdays.length >= 10 ? weekdays : allDays

  // Kanalen normaliseren: 'instagram' en 'facebook' uit een oude klantinstelling
  // worden hier één keer 'meta', anders plant hij dezelfde reel twee keer in.
  const normalized = normaliseerKanalen(channels)
  const videoChannels = normalized.filter(c =>
    ['meta', 'tiktok', 'youtube'].includes(c),
  )
  // Stories bestaan enkel op Meta.
  const storyChannels = normalized.filter(c => c === 'meta')

  // Build flat slot list
  const posts: { type: PlannedContentType; platform: string }[] = Array.from(
    { length: postsPerMonth },
    (_, i) => ({ type: 'post', platform: normalized[i % Math.max(normalized.length, 1)] }),
  )
  const reels: { type: PlannedContentType; platform: string }[] = Array.from(
    { length: reelsPerMonth },
    (_, i) => {
      const pool = videoChannels.length > 0 ? videoChannels : normalized
      return { type: 'reel', platform: pool[i % pool.length] }
    },
  )
  const stories: { type: PlannedContentType; platform: string }[] = Array.from(
    { length: storiesPerMonth },
    (_, i) => {
      const pool = storyChannels.length > 0 ? storyChannels : normalized
      return { type: 'story', platform: pool[i % pool.length] }
    },
  )

  // Interleave types so they spread evenly across the month
  const interleaved: { type: PlannedContentType; platform: string }[] = []
  const maxLen = Math.max(posts.length, reels.length, stories.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < posts.length) interleaved.push(posts[i])
    if (i < reels.length) interleaved.push(reels[i])
    if (i < stories.length) interleaved.push(stories[i])
  }

  if (interleaved.length === 0) return []

  const dates = spreadAcrossDays(interleaved, preferred)

  return interleaved
    .map((slot, i) => {
      const time = pickTime(slot.platform, slot.type, niche, i)
      return {
        planned_date: dates[i] ?? toDateStr(preferred[i % preferred.length]),
        content_type: slot.type,
        platform: slot.platform,
        title: `${TYPE_LABELS[slot.type]} — ${time}`,
        status: 'draft' as const,
      }
    })
    .sort((a, b) => a.planned_date.localeCompare(b.planned_date))
}

export function generatePlan(input: PlanInput): PlannedItem[] {
  const { months, postsPerMonth, reelsPerMonth, storiesPerMonth, channels, niche } = input
  return months.flatMap(({ year, month }) =>
    generateMonthPlan(year, month, postsPerMonth, reelsPerMonth, storiesPerMonth, channels, niche),
  )
}
