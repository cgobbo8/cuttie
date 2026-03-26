import type { Layer } from "../../lib/editorTypes";

interface Props {
  layer: Layer;
  currentTime: number;
}

/** Group words into subtitle chunks (same logic as backend _chunk_words) */
function chunkWords(
  words: { word: string; start: number; end: number }[],
  maxWords = 4,
  maxDuration = 3.0,
): { start: number; end: number; words: typeof words }[] {
  const chunks: { start: number; end: number; words: typeof words }[] = [];
  let current: typeof words = [];

  for (const w of words) {
    if (current.length > 0) {
      const dur = w.end - current[0].start;
      if (current.length >= maxWords || dur > maxDuration) {
        chunks.push({
          start: current[0].start,
          end: current[current.length - 1].end,
          words: current,
        });
        current = [];
      }
    }
    current.push(w);
  }
  if (current.length > 0) {
    chunks.push({
      start: current[0].start,
      end: current[current.length - 1].end,
      words: current,
    });
  }
  return chunks;
}

export default function TextLayer({ layer, currentTime }: Props) {
  const { text, transform } = layer;
  if (!text || text.words.length === 0) return null;

  const chunks = chunkWords(text.words);
  const active = chunks.find((c) => currentTime >= c.start && currentTime < c.end + 0.1);

  if (!active) return null;

  return (
    <div
      style={{
        width: transform.width,
        height: transform.height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexWrap: "wrap",
        gap: "0 12px",
        padding: "0 8px",
      }}
    >
      {active.words.map((w, i) => {
        const isFilled = currentTime >= w.start;
        const isActive = currentTime >= w.start && currentTime < w.end;

        return (
          <span
            key={`${active.start}-${i}`}
            style={{
              fontFamily: text.fontFamily,
              fontSize: text.fontSize,
              fontWeight: "bold",
              textTransform: text.uppercase ? "uppercase" : undefined,
              color: isFilled ? text.color : "rgba(255,255,255,0.3)",
              WebkitTextStroke: `${text.outlineWidth}px ${text.outlineColor}`,
              paintOrder: "stroke fill",
              transition: "color 0.1s",
              textShadow: isActive
                ? "0 0 20px rgba(255,255,255,0.4)"
                : "0 2px 8px rgba(0,0,0,0.8)",
              transform: isActive ? "scale(1.05)" : undefined,
              display: "inline-block",
            }}
          >
            {w.word}
          </span>
        );
      })}
    </div>
  );
}
