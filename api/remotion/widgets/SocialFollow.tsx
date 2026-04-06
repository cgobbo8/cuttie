import React from "react";

interface Props {
  props: Record<string, unknown>;
  width: number;
  height: number;
}

const PLATFORM_CONFIG: Record<string, { gradient: string; icon: React.ReactNode; label: string }> = {
  twitch: {
    gradient: "linear-gradient(135deg, #9146FF, #772CE8)",
    label: "Twitch",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0 1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z" />
      </svg>
    ),
  },
  youtube: {
    gradient: "linear-gradient(135deg, #FF0000, #CC0000)",
    label: "YouTube",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
      </svg>
    ),
  },
  tiktok: {
    gradient: "linear-gradient(135deg, #000000, #25F4EE)",
    label: "TikTok",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
      </svg>
    ),
  },
  kick: {
    gradient: "linear-gradient(135deg, #53FC18, #3DBD12)",
    label: "Kick",
    icon: (
      <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
        <path d="M1.333 0v24h5.338v-7.997L10.666 12l-3.995-4.003V0zm16 0-5.334 8.003L17.333 16h5.334L17.333 8.003 22.667 0zm-8 8.003V16h5.334V8.003z" />
      </svg>
    ),
  },
};

export default function SocialFollow({ props, width, height }: Props) {
  const platform = (props.platform as string) || "twitch";
  const username = (props.username as string) || "username";
  const config = PLATFORM_CONFIG[platform] ?? PLATFORM_CONFIG.twitch;

  return (
    <div
      style={{
        width,
        height,
        background: config.gradient,
        borderRadius: 14,
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "0 20px",
        boxShadow: "0 6px 24px rgba(0,0,0,0.3)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          bottom: -10,
          left: -10,
          width: 80,
          height: 80,
          background: "rgba(255,255,255,0.06)",
          borderRadius: "50%",
          filter: "blur(20px)",
        }}
      />
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: 10,
          background: "rgba(255,255,255,0.15)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          flexShrink: 0,
        }}
      >
        {config.icon}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
        <span
          style={{
            color: "#fff",
            fontSize: Math.max(14, height * 0.18),
            fontWeight: 800,
            fontFamily: "Inter, sans-serif",
            letterSpacing: "-0.01em",
            lineHeight: 1.1,
          }}
        >
          Follow on {config.label}
        </span>
        <span
          style={{
            color: "rgba(255,255,255,0.7)",
            fontSize: Math.max(11, height * 0.13),
            fontWeight: 600,
            fontFamily: "Inter, sans-serif",
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          @{username}
        </span>
      </div>
      <div
        style={{
          background: "rgba(255,255,255,0.2)",
          borderRadius: 8,
          padding: "6px 14px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: "#fff",
            fontSize: Math.max(11, height * 0.12),
            fontWeight: 700,
            fontFamily: "Inter, sans-serif",
          }}
        >
          Follow
        </span>
      </div>
    </div>
  );
}
