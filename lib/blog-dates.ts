// Datum-helpers voor de blogscheduler. Puur (client-safe).
//
// Maand-randgevallen: "31 januari + 1 maand" bestaat niet als 31 februari.
// We klemmen naar de laatste dag van de doelmaand → 28 (of 29) februari.
// Voorbeelden:
//   2025-01-31 + 1 maand → 2025-02-28
//   2024-01-31 + 1 maand → 2024-02-29 (schrikkeljaar)
//   2025-01-30 + 1 maand → 2025-02-28
//   2025-03-31 + 1 maand → 2025-04-30
// Dit is bewust gekozen: de generatiedag schuift nooit ongewild naar de
// volgende maand door overflow.

/** Voegt `months` maanden toe aan 'YYYY-MM-DD' met clamping op maandlengte. */
export function addMonths(dateISO: string, months: number): string {
  const [y, m, d] = dateISO.slice(0, 10).split('-').map(Number)
  const targetMonthIndex = (m - 1) + months
  const targetYear = y + Math.floor(targetMonthIndex / 12)
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12 // 0-11
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate()
  const day = Math.min(d, lastDay)
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Eerste generatie = startdatum + frequentie (gekozen standaard). */
export function firstGenerationDate(startISO: string, frequencyMonths: number): string {
  return addMonths(startISO, Math.max(1, frequencyMonths))
}

/** Volgende generatie na een uitgevoerde cyclus. */
export function nextGenerationDate(currentISO: string, frequencyMonths: number): string {
  return addMonths(currentISO, Math.max(1, frequencyMonths))
}

export function todayISO(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}
