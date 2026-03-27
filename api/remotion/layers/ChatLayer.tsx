import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Layer, ChatMessage } from "../editorTypes";

function authorColor(name: string): string {
  const COLORS = [
    "#FF4A4A", "#FF7F50", "#FFD700", "#7CFC00", "#00CED1",
    "#1E90FF", "#DA70D6", "#FF69B4", "#00FA9A", "#FFA500",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
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
