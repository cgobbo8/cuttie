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

function tintWhite(hex: string, strength = 0.15): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const tr = Math.round(255 * (1 - strength) + r * strength);
  const tg = Math.round(255 * (1 - strength) + g * strength);
  const tb = Math.round(255 * (1 - strength) + b * strength);
  return `rgb(${tr},${tg},${tb})`;
}

function resolveSpeakerStyle(
  speaker: string | undefined,
  speakerStyles: Record<string, SpeakerStyle> | undefined,
  fallbackMap: Map<string, string>,
  baseColor: string,
): { textColor: string; bgColor: string } {
  if (!speaker) return { textColor: baseColor, bgColor: "" };
  if (speakerStyles?.[speaker]) return speakerStyles[speaker];
  return { textColor: fallbackMap.get(speaker) ?? baseColor, bgColor: "" };
}

function buildFallbackMap(words: SubtitleWord[]): Map<string, string> {
  const map = new Map<string, string>();
  let idx = 0;
  for (const w of words) {
    if (w.speaker && !map.has(w.speaker)) {
      map.set(w.speaker, SPEAKER_COLORS[idx % SPEAKER_COLORS.length]);
      idx++;
    }
  }
  return map;
}

interface Props {
  layer: Layer;
}

export default function SubtitleLayer({ layer }: Props) {
  const { subtitle, transform } = layer;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  const showSpeaker = subtitle?.showSpeaker ?? false;
  const chunks = useMemo(
    () => (subtitle ? chunkWords(subtitle.words, 4, 3.0, showSpeaker) : []),
    [subtitle, showSpeaker],
  );
  const fallbackMap = useMemo(
    () => showSpeaker && subtitle ? buildFallbackMap(subtitle.words) : new Map(),
    [subtitle, showSpeaker],
  );

  if (!subtitle) return null;

  const baseColor = subtitle.colorMode === "auto" ? subtitle.autoColor : subtitle.customColor;
  const highlightColor = tintWhite(baseColor);

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
        {showPlaceholder ? null : (
          activeChunk!
            .filter((word) => word.start <= currentTime + 0.2)
            .map((word, i, visible) => {
              const isFilled = currentTime >= word.start;
              let color: string;
              let bgColor = "";
              if (showSpeaker && word.speaker) {
                const s = resolveSpeakerStyle(word.speaker, subtitle.speakerStyles, fallbackMap, baseColor);
                color = isFilled ? tintWhite(s.textColor) : s.textColor;
                bgColor = s.bgColor;
              } else {
                color = isFilled ? highlightColor : baseColor;
              }
              return (
                <span
                  key={`${word.start}-${i}`}
                  style={{
                    color,
                    backgroundColor: bgColor || undefined,
                    borderRadius: bgColor ? 4 : undefined,
                    padding: bgColor ? "0 4px" : undefined,
                  }}
                >
                  {subtitle.uppercase ? word.word.toUpperCase() : word.word}
                  {i < visible.length - 1 ? " " : ""}
                </span>
              );
            })
        )}
      </p>
    </div>
  );
}
