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

/**
 * Spoken word "pop": hops up and grows a little, then settles slightly bigger
 * while it's said. It pushes its neighbors as it grows (see popRoom), so wide
 * words (Poppins, Montserrat) don't cover the spaces around them.
 */
function popMotion(sinceStart: number): { scale: number; lift: number } {
  if (sinceStart < 0) return { scale: 1, lift: 0 };
  if (sinceStart < 0.08) {
    const k = sinceStart / 0.08;
    return { scale: 1 + 0.1 * k, lift: -0.12 * k };
  }
  if (sinceStart < 0.24) {
    const k = (sinceStart - 0.08) / 0.16;
    return { scale: 1.1 - 0.06 * k, lift: -0.12 * (1 - k) };
  }
  return { scale: 1.04, lift: 0 };
}

/** Room on each side of a word grown by `scale` (a letter is ~0.62em in the widest clip fonts) */
function popRoom(word: string, scale: number): string {
  return `${(((scale - 1) / 2) * word.length * 0.62).toFixed(3)}em`;
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

/** A voice the diarizer couldn't name (the streamer's is named after the channel) */
const UNNAMED_VOICE = /^SPEAKER_\d+$/;

/** The streamer in white, whoever speaks first; the other voices in color */
function buildFallbackMap(words: SubtitleWord[], baseColor: string): Map<string, SpeakerStyle> {
  const map = new Map<string, SpeakerStyle>();
  const voices = [...new Set(words.map((w) => w.speaker).filter((s): s is string => !!s))];
  const streamer = voices.find((s) => !UNNAMED_VOICE.test(s));
  const ordered = streamer ? [streamer, ...voices.filter((s) => s !== streamer)] : voices;
  ordered.forEach((speaker, idx) => {
    if (idx === 0) {
      map.set(speaker, { color: "#FFFFFF", bgColor: baseColor });
    } else {
      const bg = SPEAKER_COLORS[(idx - 1) % SPEAKER_COLORS.length];
      map.set(speaker, { color: tintWhite(bg), bgColor: bg });
    }
  });
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
          // A little room for the spoken word to grow
          ...(subtitle.pop ? { wordSpacing: "0.12em" } : {}),
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
              const pop = subtitle.pop && speaking ? popMotion(currentTime - word.start) : { scale: 1, lift: 0 };
              return (
                <span key={`${word.start}-${i}`}>
                  <span style={{ color, ...(subtitle.pop ? { display: "inline-block", transform: `translateY(${pop.lift}em) scale(${pop.scale})`, transformOrigin: "50% 70%", marginInline: popRoom(word.word, pop.scale) } : {}) }}>
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
