import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer, SubtitleWord, SpeakerStyle } from "../editorTypes";
import { SPEAKER_COLORS } from "../editorTypes";

function chunkWords(words: SubtitleWord[], maxWords = 4, maxDuration = 3.0, splitOnSpeaker = false): SubtitleWord[][] {
  const chunks: SubtitleWord[][] = [];
  let current: SubtitleWord[] = [];
  for (const w of words) {
    if (current.length > 0) {
      const dur = w.end - current[0].start;
      const speakerChanged = splitOnSpeaker && w.speaker !== current[current.length - 1].speaker;
      if (current.length >= maxWords || dur > maxDuration || speakerChanged) {
        chunks.push(current);
        current = [];
      }
    }
    current.push(w);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Spoken word "pop": grows fast, then settles a little bigger while it's said (the words get a bit more room, see wordSpacing) */
function popScale(sinceStart: number): number {
  if (sinceStart < 0) return 1;
  if (sinceStart < 0.08) return 1 + 0.2 * (sinceStart / 0.08);
  if (sinceStart < 0.22) return 1.2 - 0.08 * ((sinceStart - 0.08) / 0.14);
  return 1.12;
}

function tintWhite(hex: string, strength = 0.15): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const tr = Math.round(255 * (1 - strength) + r * strength);
  const tg = Math.round(255 * (1 - strength) + g * strength);
  const tb = Math.round(255 * (1 - strength) + b * strength);
  return `rgb(${tr},${tg},${tb})`;
}

function buildFallbackMap(words: SubtitleWord[], baseColor: string): Map<string, SpeakerStyle> {
  const map = new Map<string, SpeakerStyle>();
  let idx = 0;
  for (const w of words) {
    if (w.speaker && !map.has(w.speaker)) {
      if (idx === 0) {
        map.set(w.speaker, { color: "#FFFFFF", bgColor: baseColor });
      } else {
        const bg = SPEAKER_COLORS[(idx - 1) % SPEAKER_COLORS.length];
        map.set(w.speaker, { color: tintWhite(bg), bgColor: bg });
      }
      idx++;
    }
  }
  return map;
}

function getSpeakerStyle(
  speaker: string | undefined,
  speakerStyles: Record<string, SpeakerStyle> | undefined,
  fallback: Map<string, SpeakerStyle>,
): SpeakerStyle | null {
  if (!speaker) return null;
  if (speakerStyles?.[speaker]) return speakerStyles[speaker];
  return fallback.get(speaker) ?? null;
}

interface Props {
  layer: Layer;
}

export default function SubtitleLayer({ layer }: Props) {
  const { subtitle, transform } = layer;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  if (!subtitle) return null;

  const showSpeaker = subtitle.showSpeaker ?? false;
  const baseColor = subtitle.colorMode === "auto" ? subtitle.autoColor : subtitle.customColor;
  const highlightColor = tintWhite(baseColor);

  const chunks = useMemo(
    () => chunkWords(subtitle.words, subtitle.maxWords ?? 4, 3.0, showSpeaker),
    [subtitle.words, subtitle.maxWords, showSpeaker],
  );
  const fallback = useMemo(
    () => showSpeaker ? buildFallbackMap(subtitle.words, baseColor) : new Map(),
    [subtitle.words, showSpeaker, baseColor],
  );

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
          WebkitTextStroke: subtitle.boxed || subtitle.noStroke ? undefined : `${Math.max(2, subtitle.fontSize / 25)}px black`,
          paintOrder: "stroke fill",
          lineHeight: 1.2,
          margin: 0,
          textShadow: subtitle.boxed ? undefined : subtitle.noStroke ? "0 3px 12px rgba(0,0,0,0.75)" : "2px 3px 5px rgba(0,0,0,0.6)",
          wordBreak: "break-word",
          ...(subtitle.pop ? { wordSpacing: "0.18em" } : {}),
          ...(subtitle.boxed
            ? {
                display: "inline-block",
                padding: `${Math.round(subtitle.fontSize * 0.22)}px ${Math.round(subtitle.fontSize * 0.45)}px`,
                borderRadius: Math.round(subtitle.fontSize * 0.35),
                background: "rgba(0,0,0,0.58)",
              }
            : {}),
        }}
      >
        {showPlaceholder ? null : (
          activeChunk!
            // Karaoke shows the whole line and moves the color; otherwise words appear as they're said
            .filter((word) => subtitle.activeColor || word.start <= currentTime + 0.2)
            .map((word, i, visible) => {
              const isFilled = currentTime >= word.start;
              let color: string;
              const spk = showSpeaker ? getSpeakerStyle(word.speaker, subtitle.speakerStyles, fallback) : null;
              if (subtitle.activeColor && !spk) {
                const speaking = currentTime >= word.start && currentTime <= word.end + 0.05;
                color = speaking ? subtitle.activeColor : subtitle.restColor ?? "#FFFFFF";
              } else if (spk) {
                color = isFilled ? spk.color : spk.bgColor;
              } else {
                color = isFilled ? highlightColor : baseColor;
              }
              const speaking = currentTime >= word.start && currentTime <= word.end + 0.05;
              const scale = subtitle.pop && speaking ? popScale(currentTime - word.start) : 1;
              return (
                <span key={`${word.start}-${i}`}>
                  <span style={{ color, ...(subtitle.pop ? { display: "inline-block", transform: `scale(${scale})`, transformOrigin: "50% 70%" } : {}) }}>
                    {subtitle.uppercase ? word.word.toUpperCase() : word.word}
                  </span>
                  {i < visible.length - 1 ? " " : ""}
                </span>
              );
            })
        )}
      </p>
    </div>
  );
}
