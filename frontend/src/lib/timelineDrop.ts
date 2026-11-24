/**
 * Moving things by hand on the video's timeline: where a passage dragged along it lands, and how
 * a place under the pointer reads as a time. Pure: the timeline gives frames, not pixels.
 */

/** A passage on the timeline: where it plays in the whole video, frames */
export interface Span {
  id: string;
  from: number;
  to: number;
}

/** Where a dragged passage would land */
export interface DropPlace {
  /** The part it goes to */
  section: string;
  /** The passage it goes right before (null: at the end of that part) */
  before: string | null;
  /** Where that is on the timeline, frames: where the line is drawn */
  at: number;
}

/**
 * Where a passage dragged along the timeline lands when let go over `frame`: before the passage
 * whose first half is under it, after the one whose second half is. Between two parts it joins
 * the end of the first while still over that part's last passage, the head of the next past it.
 * Null: nowhere new (it would stay where it is, or there is nothing else to go around).
 */
export function dropPlace(marks: Span[], sectionOf: (id: string) => string | undefined, dragged: string, frame: number): DropPlace | null {
  const own = sectionOf(dragged);
  const self = marks.find((mark) => mark.id === dragged);
  const others = marks.filter((mark) => mark.id !== dragged);
  if (!self || others.length === 0 || own === undefined) return null;
  // Still over its own place: it stays
  if (frame >= self.from && frame <= self.to) return null;
  const index = others.filter((mark) => (mark.from + mark.to) / 2 < frame).length;
  const prev = others[index - 1];
  const next = others[index];
  const prevPart = prev ? sectionOf(prev.id) : undefined;
  const nextPart = next ? sectionOf(next.id) : undefined;
  // Before the next passage, unless the pointer is still over the last passage of the part before
  const place: DropPlace | null =
    next && nextPart !== undefined && (!prev || prevPart === nextPart || prevPart === undefined || frame > prev.to)
      ? { section: nextPart, before: next.id, at: next.from }
      : prev && prevPart !== undefined
        ? { section: prevPart, before: null, at: prev.to }
        : null;
  if (!place) return null;
  // Where it already is: right before the passage that follows it in its own part, or at that part's end
  const after = marks[marks.findIndex((mark) => mark.id === dragged) + 1];
  const follows = after && sectionOf(after.id) === own ? after.id : null;
  return place.section === own && place.before === follows ? null : place;
}

/** "0:46.3": a place on the timeline as a time, to the tenth (what scrubbing shows) */
export function scrubClock(seconds: number): string {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${tenths % 10}`;
}

/** The frame under a pointer: its place across the timeline's width, kept inside the video */
export function frameUnder(clientX: number, box: { left: number; width: number }, frames: number): number {
  if (box.width <= 0 || frames <= 1) return 0;
  return Math.round(Math.min(1, Math.max(0, (clientX - box.left) / box.width)) * (frames - 1));
}
