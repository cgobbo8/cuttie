import type { ReactNode } from "react";
import { easeOut, FONT, GLASS, InstagramGlyph, since, text, TikTokGlyph, TwitchGlyph, YouTubeGlyph, type KitWidgetProps } from "./shared";

/** The streamer's handles, one per platform they filled in, sliding in one by one */
export default function Socials({ props, width, height, currentTime }: KitWidgetProps) {
  const t = since(props, currentTime);
  const all: { key: string; glyph: (size: number) => ReactNode; bg: string; handle: string }[] = [
    { key: "twitch", glyph: (s) => <TwitchGlyph size={s} color="#FFFFFF" />, bg: "#9146FF", handle: text(props, "login") },
    { key: "tiktok", glyph: (s) => <TikTokGlyph size={s} color="#FFFFFF" />, bg: "#111111", handle: text(props, "tiktok") },
    { key: "youtube", glyph: (s) => <YouTubeGlyph size={s} color="#FFFFFF" />, bg: "#FF0033", handle: text(props, "youtube") },
    {
      key: "instagram",
      glyph: (s) => <InstagramGlyph size={s} color="#FFFFFF" />,
      bg: "linear-gradient(45deg, #F58529, #DD2A7B 50%, #8134AF)",
      handle: text(props, "instagram"),
    },
  ];
  const rows = all.filter((r) => r.handle);

  const gap = height * 0.04;
  const rowH = Math.min(height / Math.max(rows.length, 1) - gap, height * 0.34);
  return (
    <div style={{ width, height, display: "flex", flexDirection: "column", justifyContent: "center", gap, fontFamily: FONT }}>
      {rows.map((row, i) => {
        const p = easeOut((t - 0.1 - i * 0.14) / 0.4);
        return (
          <div
            key={row.key}
            style={{
              ...GLASS,
              height: rowH,
              borderRadius: rowH * 0.3,
              display: "flex",
              alignItems: "center",
              gap: rowH * 0.24,
              padding: `0 ${rowH * 0.3}px 0 ${rowH * 0.14}px`,
              opacity: p,
              transform: `translateX(${(1 - p) * 40}px)`,
            }}
          >
            <span style={{ width: rowH * 0.72, height: rowH * 0.72, borderRadius: rowH * 0.2, background: row.bg, display: "grid", placeItems: "center", flex: "none" }}>
              {row.glyph(rowH * 0.44)}
            </span>
            <span style={{ color: "#FFFFFF", fontWeight: 750, fontSize: rowH * 0.36, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {row.handle.replace(/^@?/, "@")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
