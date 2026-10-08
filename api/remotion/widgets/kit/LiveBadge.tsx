import { FONT, GLASS, since, text, type KitWidgetProps } from "./shared";

/** A pulsing "EN DIRECT" badge, with the channel next to it */
export default function LiveBadge({ props, width, height, currentTime }: KitWidgetProps) {
  const t = Math.max(0, since(props, currentTime));
  const login = text(props, "login");
  const label = text(props, "text", "EN DIRECT");
  const phase = (t % 1.4) / 1.4;
  const dot = height * 0.2;
  const font = Math.round(height * 0.36);
  return (
    <div style={{ width, height, display: "flex", alignItems: "center", fontFamily: FONT, whiteSpace: "nowrap" }}>
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          gap: height * 0.16,
          padding: `0 ${height * 0.3}px`,
          borderRadius: height * 0.22,
          background: "#E5243B",
          boxShadow: "0 12px 30px rgba(229,36,59,0.45)",
          color: "#FFFFFF",
          fontWeight: 850,
          fontSize: font,
          letterSpacing: "0.04em",
          position: "relative",
          zIndex: 1,
        }}
      >
        <span style={{ position: "relative", width: dot, height: dot }}>
          <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "#FFFFFF" }} />
          <span
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              border: `${Math.max(2, dot * 0.18)}px solid #FFFFFF`,
              transform: `scale(${1 + phase * 1.6})`,
              opacity: 1 - phase,
            }}
          />
        </span>
        {label}
      </div>
      {login && (
        <div
          style={{
            ...GLASS,
            height: height * 0.78,
            marginLeft: -height * 0.2,
            display: "flex",
            alignItems: "center",
            padding: `0 ${height * 0.28}px 0 ${height * 0.42}px`,
            borderRadius: `0 ${height * 0.2}px ${height * 0.2}px 0`,
            color: "#FFFFFF",
            fontWeight: 650,
            fontSize: font * 0.92,
          }}
        >
          {login}
        </div>
      )}
    </div>
  );
}
