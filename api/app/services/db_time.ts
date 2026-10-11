/**
 * Times as SQLite keeps them. Lucid writes "2026-10-11 09:23:17" (UTC) and reads
 * only that; raw updates once wrote ISO text ("2026-10-10T23:25:06.123Z"), which
 * Lucid then reads as an invalid date. Both are understood here.
 */

/** A stored time as ms since 1970 (NaN when it can't be read) */
export function dbMillis(value: unknown): number {
  if (value === null || value === undefined || value === '') return Number.NaN
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number') return value
  // A Luxon date (NaN when invalid)
  if (typeof (value as { toMillis?: unknown }).toMillis === 'function') return (value as { toMillis: () => number }).toMillis()
  const text = String(value).trim().replace(' ', 'T')
  return Date.parse(/[zZ]$|[+-]\d\d:?\d\d$/.test(text) ? text : `${text}Z`)
}

/** A time as Lucid writes it (UTC), for raw updates of its tables */
export function dbTime(at = new Date()): string {
  return at.toISOString().slice(0, 19).replace('T', ' ')
}
