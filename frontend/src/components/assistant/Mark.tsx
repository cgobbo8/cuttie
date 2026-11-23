/**
 * The assistant's own mark: what it does, drawn. A stretch of sound (four bars) with a cut
 * across it, on a tile of the channel's color set a little askew, like a sticker. While it
 * works the bars move, as a level meter does: it is listening to the live.
 */
export default function AssistantMark({ size = 28, busy = false, className = "" }: { size?: number; busy?: boolean; className?: string }) {
  // (heights of the four bars, out of 24: uneven, the way speech is)
  const bars = [9, 15, 11, 6];
  return (
    <span
      aria-hidden
      className={`assistant-mark ${busy ? "is-busy" : ""} ${className}`}
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.3) }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.72} height={size * 0.72} fill="none">
        {bars.map((height, n) => (
          <rect key={n} className="assistant-mark-bar" style={{ animationDelay: `${n * -0.23}s` }} x={3.2 + n * 5} y={12 - height / 2} width={2.8} height={height} rx={1.4} fill="currentColor" />
        ))}
        {/* The cut: a slanted stroke of the tile's own color, through the sound */}
        <path d="M2.5 17.5 21.5 6.5" stroke="var(--tile)" strokeWidth={2.2} strokeLinecap="round" />
      </svg>
    </span>
  );
}
