import { useMemo } from "react";
import type { Layer, SubtitleWord } from "../../lib/editorTypes";

interface Props {
  layer: Layer;
  currentTime: number;
}

function chunkWords(words: SubtitleWord[], maxWords = 4, maxDuration = 3.0): SubtitleWord[][] {
  const chunks: SubtitleWord[][] = [];
  let current: SubtitleWord[] = [];
  for (const w of words) {
    if (current.length > 0) {
      const dur = w.end - current[0].start;
      if (current.length >= maxWords || dur > maxDuration) {
        chunks.push(current);
        current = [];
      }
    }
    current.push(w);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function tintWhite(hex: string, strength = 0.15): string {
  const [r, g, b] = hexToRgb(hex);
  const tr = Math.round(255 * (1 - strength) + r * strength);
  const tg = Math.round(255 * (1 - strength) + g * strength);
  const tb = Math.round(255 * (1 - strength) + b * strength);
  return `rgb(${tr},${tg},${tb})`;
}

export default function SubtitleLayer({ layer, currentTime }: Props) {
  const { subtitle, transform } = layer;
  if (!subtitle) return null;

  const chunks = useMemo(() => chunkWords(subtitle.words), [subtitle.words]);

  const baseColor = subtitle.colorMode === "auto" ? subtitle.autoColor : subtitle.customColor;
  const highlightColor = tintWhite(baseColor);

  // Find active chunk (or show placeholder if no words)
  const activeChunk = chunks.find(
    (chunk) => currentTime >= chunk[0].start - 0.05 && currentTime <= chunk[chunk.length - 1].end + 0.05,
  );

  const showPlaceholder = subtitle.words.length === 0 || !activeChunk;

  return (
    <div
      style={{
        width: transform.width,
        height: transform.height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        overflow: "hidden",
      }}
    >
      <p
        style={{
          fontFamily: `"${subtitle.fontFamily}", sans-serif`,
          fontSize: subtitle.fontSize,
          fontWeight: 700,
          textTransform: subtitle.uppercase ? "uppercase" : "none",
          WebkitTextStroke: `${Math.max(2, subtitle.fontSize / 25)}px black`,
          paintOrder: "stroke fill",
          lineHeight: 1.2,
          margin: 0,
          textShadow: "2px 3px 5px rgba(0,0,0,0.6)",
          wordBreak: "break-word",
        }}
      >
        {showPlaceholder ? (
          <span style={{ color: highlightColor, opacity: 0.5 }}>
            {subtitle.uppercase ? "SOUS-TITRES" : "Sous-titres"}
          </span>
        ) : (
          activeChunk!.map((word, i) => {
            const isFilled = currentTime >= word.start;
            return (
              <span
                key={`${word.start}-${i}`}
                style={{
                  color: isFilled ? highlightColor : baseColor,
                  transition: "color 0.08s",
                }}
              >
                {subtitle.uppercase ? word.word.toUpperCase() : word.word}
                {i < activeChunk!.length - 1 ? " " : ""}
              </span>
            );
          })
        )}
      </p>
    </div>
  );
}
