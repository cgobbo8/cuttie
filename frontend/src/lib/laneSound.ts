/**
 * The live's sound as the timeline draws it.
 *
 * A live is never silent (the game, a music, a voice): measured in decibels, its level sits in the upper half of the
 * scale and a shout is only a little above the rest. Drawn as measured, the lane is a grey band. What matters to
 * whoever cuts is the difference: where it is calm, where it gets loud. So the levels are stretched between the quiet
 * of what is shown and its loudest moment.
 */

/** The lowest a heard moment is drawn (of 100): the lane never disappears under a passage */
const FLOOR = 10;
/** Peaks stand out: a level halfway between calm and loud is drawn lower than halfway */
const BEND = 1.5;
/** Under this many points between calm and loud, the sound is even: drawn flat, at mid height */
const EVEN = 4;

/**
 * `points` are [frame of the video, level 0 to 100], a level of 0 being the edge of a passage (kept at 0).
 * The same points, their levels stretched from the calm of the video (its 5th centile) to its loudest moment.
 */
export function soundHeights(points: [number, number][]): [number, number][] {
  const heard = points.map(([, level]) => level).filter((level) => level > 0).sort((a, b) => a - b);
  if (heard.length === 0) return points;
  const calm = heard[Math.floor((heard.length - 1) * 0.05)];
  const loud = heard[heard.length - 1];
  if (loud - calm < EVEN) return points.map(([frame, level]) => [frame, level > 0 ? 50 : 0]);
  return points.map(([frame, level]) => {
    if (level <= 0) return [frame, 0];
    const share = Math.min(1, Math.max(0, (level - calm) / (loud - calm)));
    return [frame, Math.round(FLOOR + (100 - FLOOR) * share ** BEND)];
  });
}
