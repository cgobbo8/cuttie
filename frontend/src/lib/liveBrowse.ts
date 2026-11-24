/**
 * Going through a live by hand to pick a passage: reading a time as a streamer types it, and what
 * a stretch picked between two times can be. Pure: the player and its strip are in LiveBrowser.
 */

/** The longest and the shortest stretch that makes a passage, seconds (the server's own limits) */
export const LONGEST_PICK = 180;
export const SHORTEST_PICK = 1;

/**
 * A time of the live as it is typed: « 3:20:00 », « 3h20 », « 3h20m15 », « 3 h 20 », « 20:15 »
 * (minutes and seconds, as a player writes them), « 95m », « 1200 » (seconds). Null: not a time.
 */
export function parseClock(text: string): number | null {
  const said = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!said) return null;
  // 3:20:00, 20:15
  if (/^\d{1,3}(:\d{1,2}){1,2}$/.test(said)) {
    const parts = said.split(":").map(Number);
    if (parts.slice(1).some((part) => part >= 60)) return null;
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  }
  // 40s
  const seconds = said.match(/^(\d{1,5})s$/);
  if (seconds) return Number(seconds[1]);
  // 3h, 3h20, 3h20m, 3h20m15, 3h20m15s, 95m, 95min, 12m30
  const named = said.match(/^(?:(\d{1,3})h)?(?:(\d{1,3})(?:m|min|mn)?)?(?:(\d{1,2})s?)?$/);
  if (named && /[hm]/.test(said)) {
    const [, h, m, s] = named;
    return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0);
  }
  // A plain number: seconds
  if (/^\d{1,6}$/.test(said)) return Number(said);
  return null;
}

/**
 * The stretch picked between two marks of the live, in order and inside the live. Null while one
 * of them is missing or they are too close to make a passage. `capped`: it was longer than a
 * passage can be, and stops at the longest.
 */
export function pickedRange(start: number | null, end: number | null, duration: number): { start: number; end: number; capped: boolean } | null {
  if (start === null || end === null) return null;
  const last = duration > 0 ? duration : Infinity;
  const a = Math.max(0, Math.min(start, end));
  const b = Math.min(last, Math.max(start, end));
  if (b - a < SHORTEST_PICK) return null;
  const capped = b - a > LONGEST_PICK;
  const round = (seconds: number) => Math.round(seconds * 100) / 100;
  return { start: round(a), end: round(capped ? a + LONGEST_PICK : b), capped };
}

/** How long a stretch is, as it is said: « 12,4 s » under a minute, « 1:32 » from there */
export function spanText(seconds: number, language: string): string {
  const length = Math.max(0, seconds);
  if (length < 59.95) return `${length.toLocaleString(language, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;
  const whole = Math.round(length);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
