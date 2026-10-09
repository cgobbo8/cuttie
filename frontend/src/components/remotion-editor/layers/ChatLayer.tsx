import { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer, ChatMessage } from "../../../lib/editorTypes";

function authorColor(name: string): string {
  const COLORS = [
    "#FF4A4A", "#FF7F50", "#FFD700", "#7CFC00", "#00CED1",
    "#1E90FF", "#DA70D6", "#FF69B4", "#00FA9A", "#FFA500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** Ease with a little overshoot, for the bubbles popping in */
function backOut(t: number): number {
  const x = Math.min(1, Math.max(0, t)) - 1;
  return 1 + 2.70158 * x * x * x + 1.70158 * x * x;
}

interface Props {
  layer: Layer;
}

export default function ChatLayer({ layer }: Props) {
  const { chat, transform } = layer;
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  if (!chat) return null;

  const { messages, maxVisible, fontSize, fontFamily, showDuration } = chat;

  const visible: ChatMessage[] = useMemo(() => {
    return messages
      .filter((m) => m.timestamp <= currentTime && m.timestamp + showDuration > currentTime)
      .slice(-maxVisible);
  }, [messages, currentTime, maxVisible, showDuration]);

  // Each message on its own bubble: pops in from its corner, fades before it goes
  if (chat.style === "bubbles") {
    return (
      <div
        style={{
          width: transform.width,
          height: transform.height,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          alignItems: "flex-start",
          gap: Math.round(fontSize * 0.32),
          overflow: "hidden",
        }}
      >
        {visible.map((msg, i) => {
          const age = currentTime - msg.timestamp;
          return (
            <div
              key={`${msg.timestamp}-${i}`}
              style={{
                maxWidth: "100%",
                boxSizing: "border-box",
                padding: `${Math.round(fontSize * 0.3)}px ${Math.round(fontSize * 0.55)}px`,
                borderRadius: Math.round(fontSize * 0.7),
                // Dark with a light rim: reads on the game and on a dark background alike
                background: "rgba(20, 20, 24, 0.86)",
                boxShadow: "inset 0 0 0 2px rgba(255,255,255,0.16), 0 10px 26px rgba(0,0,0,0.45)",
                fontFamily: `"${fontFamily}", sans-serif`,
                fontSize,
                lineHeight: 1.25,
                wordBreak: "break-word",
                transform: `scale(${0.55 + 0.45 * backOut(age / 0.4)})`,
                transformOrigin: "0% 100%",
                opacity: Math.max(0, Math.min(1, age / 0.12, (showDuration - age) / 0.4)),
              }}
            >
              <span style={{ color: authorColor(msg.author), fontWeight: 750 }}>{msg.author}</span>
              <span style={{ color: "#FFFFFF", fontWeight: 550 }}> {msg.text}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div
      style={{
        width: transform.width,
        height: transform.height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        gap: Math.max(2, fontSize * 0.3),
        overflow: "hidden",
      }}
    >
      {visible.map((msg, i) => (
        <div
          key={`${msg.timestamp}-${i}`}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: "0.4em",
            fontFamily: `"${fontFamily}", sans-serif`,
            fontSize,
            lineHeight: 1.3,
            textShadow: "1px 1px 3px rgba(0,0,0,0.9)",
            opacity: 0.95,
          }}
        >
          <span style={{ color: authorColor(msg.author), fontWeight: 700, whiteSpace: "nowrap" }}>
            {msg.author}
          </span>
          <span style={{ color: "#ffffff", fontWeight: 500, wordBreak: "break-word" }}>
            {msg.text}
          </span>
        </div>
      ))}
    </div>
  );
}
