import { useState, useEffect, useRef } from "react";

interface Props {
  props: Record<string, unknown>;
  width: number;
  height: number;
  currentTime?: number;
}

const LOOP_DURATION = 5;   // total cycle length in seconds
const HOLD_DURATION = 2;   // hold full text visible
const ERASE_DURATION = 0.4; // quick erase
const PAUSE_DURATION = 0.6; // pause while empty
// TYPE_DURATION fills the rest: 5 - 2 - 0.4 - 0.6 = 2s
const TYPE_DURATION = LOOP_DURATION - HOLD_DURATION - ERASE_DURATION - PAUSE_DURATION;

const TWITCH_ICON = (
  <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28">
    <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
  </svg>
);

/**
 * Typewriter cycle (offset so text is FULL at t=0):
 *   0 → HOLD:  full text visible
 *   HOLD → HOLD+ERASE:  quick erase right-to-left
 *   HOLD+ERASE → HOLD+ERASE+PAUSE:  empty (cursor blinks)
 *   rest → LOOP:  type left-to-right
 */
function computeTypewriter(text: string, currentTime: number) {
  const t = ((currentTime % LOOP_DURATION) + LOOP_DURATION) % LOOP_DURATION;
  const len = text.length;

  if (t < HOLD_DURATION) {
    // Hold: full text, no cursor
    return { chars: len, cursor: false };
  }

  const afterHold = t - HOLD_DURATION;
  if (afterHold < ERASE_DURATION) {
    // Erase phase
    const progress = afterHold / ERASE_DURATION;
    return { chars: Math.max(0, Math.round(len * (1 - progress))), cursor: true };
  }

  const afterErase = afterHold - ERASE_DURATION;
  if (afterErase < PAUSE_DURATION) {
    // Pause: empty, cursor blinks
    const blink = Math.floor(currentTime / 0.5) % 2 === 0;
    return { chars: 0, cursor: blink };
  }

  // Type phase
  const typeProgress = (afterErase - PAUSE_DURATION) / TYPE_DURATION;
  const eased = 1 - (1 - typeProgress) * (1 - typeProgress); // ease-out
  return { chars: Math.min(len, Math.floor(eased * (len + 1))), cursor: true };
}

/**
 * Wall-clock timer that ticks ~30fps when no external currentTime drives the widget.
 * This ensures the animation is visible even when the editor video is paused.
 */
function useWallClock(externalTime: number | undefined) {
  const [tick, setTick] = useState(0);
  const rafRef = useRef(0);
  const startRef = useRef(performance.now());

  const hasExternal = externalTime !== undefined && externalTime > 0;

  useEffect(() => {
    if (hasExternal) return;           // video is driving time — no need for wall clock
    startRef.current = performance.now();
    const loop = () => {
      setTick((performance.now() - startRef.current) / 1000);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [hasExternal]);

  return hasExternal ? externalTime : tick;
}

export default function TwitchSubscribe({ props, width, height, currentTime }: Props) {
  const streamerName = (props.streamerName as string) || "streamer";
  const fullUrl = `twitch.tv/${streamerName}`;
  const time = useWallClock(currentTime);
  const { chars, cursor } = computeTypewriter(fullUrl, time);

  return (
    <div
      style={{
        width,
        height,
        background: "linear-gradient(135deg, #9146FF 0%, #772CE8 50%, #5C16C5 100%)",
        borderRadius: 16,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 24px",
        boxShadow: "0 8px 32px rgba(145,70,255,0.4)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Decorative glow */}
      <div
        style={{
          position: "absolute",
          top: -20,
          right: -20,
          width: 120,
          height: 120,
          background: "rgba(255,255,255,0.08)",
          borderRadius: "50%",
          filter: "blur(30px)",
        }}
      />

      {/* Twitch icon */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          background: "rgba(255,255,255,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        {TWITCH_ICON}
      </div>

      {/* Text */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span
          style={{
            color: "#fff",
            fontSize: Math.max(16, height * 0.2),
            fontWeight: 800,
            fontFamily: "Inter, sans-serif",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          Abonne-toi !
        </span>
        <span
          style={{
            color: "rgba(255,255,255,0.75)",
            fontSize: Math.max(12, height * 0.14),
            fontWeight: 600,
            fontFamily: "'Courier New', monospace",
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            minHeight: "1.2em",
          }}
        >
          {fullUrl.slice(0, chars)}
          {cursor && (
            <span style={{ color: "rgba(255,255,255,0.9)", fontWeight: 400 }}>|</span>
          )}
        </span>
      </div>
    </div>
  );
}
