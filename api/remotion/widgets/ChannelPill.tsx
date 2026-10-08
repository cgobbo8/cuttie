import React from "react";
import { Img } from "remotion";
/**
 * Channel widget: the streamer's logo and twitch.tv/<login> on a white pill.
 * Mirrored in frontend/src/components/editor/widgets/ChannelPill.tsx (keep both in sync;
 * here the logo uses Remotion's <Img> so renders wait for it).
 */

interface Props {
  props: Record<string, unknown>;
  width: number;
  height: number;
}

export default function ChannelPill({ props, width, height }: Props) {
  const login = (props.login as string) || "streamer";
  const avatarUrl = (props.avatarUrl as string) || "";
  const dark = (props.darkColor as string) || "#111317";
  const light = (props.lightColor as string) || "#F5F5F2";
  const pad = Math.round(height * 0.125);
  const avatar = height - pad * 2;
  const font = Math.round(height * 0.375);

  return (
    <div style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          gap: Math.round(height * 0.19),
          padding: `0 ${Math.round(height * 0.36)}px 0 ${pad}px`,
          borderRadius: height / 2,
          background: "#FFFFFF",
          boxShadow: `0 ${Math.round(height * 0.12)}px ${Math.round(height * 0.32)}px rgba(0,0,0,0.42)`,
          whiteSpace: "nowrap",
          fontFamily: '"Geist", "Geist Variable", system-ui, sans-serif',
        }}
      >
        <div style={{ width: avatar, height: avatar, borderRadius: "50%", overflow: "hidden", background: light, flex: "none" }}>
          {avatarUrl && <Img src={avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        </div>
        <span style={{ fontSize: font, fontWeight: 500, color: "#60707C", letterSpacing: "-0.01em" }}>
          twitch.tv/<span style={{ color: dark, fontWeight: 800 }}>{login}</span>
        </span>
      </div>
    </div>
  );
}
