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

function buildFallbackMap(words: SubtitleWord[], baseColor: string): Map<string, SpeakerStyle> {
  const map = new Map<string, SpeakerStyle>();
  let idx = 0;
  for (const w of words) {
    if (w.speaker && !map.has(w.speaker)) {
      map.set(w.speaker, {
        color: idx === 0 ? baseColor : SPEAKER_COLORS[(idx - 1) % SPEAKER_COLORS.length],
        textColor: "#FFFFFF",
      });
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

  const showSpeaker = subtitle?.showSpeaker ?? false;
  const chunks = useMemo(
    () => (subtitle ? chunkWords(subtitle.words, 4, 3.0, showSpeaker) : []),
    [subtitle, showSpeaker],
  );
  if (!subtitle) return null;

  const baseColor = subtitle.colorMode === "auto" ? subtitle.autoColor : subtitle.customColor;

  const fallback = useMemo(
    () => showSpeaker ? buildFallbackMap(subtitle.words, baseColor) : new Map(),
    [subtitle.words, showSpeaker, baseColor],
  );
  const highlightColor = tintWhite(baseColor);

  const activeChunk = chunks.find(
    (chunk) => currentTime >= chunk[0].start - 0.05 && currentTime <= chunk[chunk.length - 1].end + 0.05,
  );

  const showPlaceholder = subtitle.words.length === 0 || !activeChunk;

  const chunkSpeaker = showSpeaker && activeChunk?.[0]?.speaker
    ? getSpeakerStyle(activeChunk[0].speaker, subtitle.speakerStyles, fallback)
    : null;

  const fontSize = subtitle.fontSize;
  const padH = Math.round(fontSize * 0.2);
  const padV = Math.round(fontSize * 0.08);
  const radius = Math.round(fontSize * 0.15);

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
          fontSize,
          fontWeight: 700,
          textTransform: subtitle.uppercase ? "uppercase" : "none",
          WebkitTextStroke: chunkSpeaker ? undefined : `${Math.max(2, fontSize / 25)}px black`,
          paintOrder: "stroke fill",
          lineHeight: 1.2,
          margin: 0,
          textShadow: chunkSpeaker ? undefined : "2px 3px 5px rgba(0,0,0,0.6)",
          wordBreak: "break-word",
          ...(chunkSpeaker ? {
            backgroundColor: chunkSpeaker.color,
            color: chunkSpeaker.textColor,
            padding: `${padV}px ${padH}px`,
            borderRadius: radius,
            boxDecorationBreak: "clone" as const,
            WebkitBoxDecorationBreak: "clone" as const,
          } : {}),
        }}
      >
        {showPlaceholder ? null : (
          activeChunk!
            .filter((word) => word.start <= currentTime + 0.2)
            .map((word, i, visible) => {
              const isFilled = currentTime >= word.start;
              const color = chunkSpeaker
                ? (isFilled ? chunkSpeaker.textColor : chunkSpeaker.textColor + "99")
                : (isFilled ? highlightColor : baseColor);
              return (
                <span key={`${word.start}-${i}`} style={{ color }}>
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
