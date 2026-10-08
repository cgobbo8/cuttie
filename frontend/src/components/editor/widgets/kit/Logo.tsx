import { Avatar, brand, easeOut, since, text, type KitWidgetProps } from "./shared";

/** The channel's logo with a ring in the channel color */
export default function Logo({ props, width, height, currentTime }: KitWidgetProps) {
  const { accent, light } = brand(props);
  const round = text(props, "shape", "squircle") === "round";
  const size = Math.min(width, height);
  const ring = Math.max(3, Math.round(size * 0.05));
  // The ring draws itself around the logo
  const sweep = easeOut((since(props, currentTime) - 0.15) / 0.6);
  return (
    <div style={{ width, height, display: "grid", placeItems: "center" }}>
      <div
        style={{
          width: size,
          height: size,
          padding: ring,
          borderRadius: round ? "50%" : "28%",
          background: `conic-gradient(${accent} ${sweep * 360}deg, rgba(255,255,255,0.25) 0deg)`,
          boxShadow: `0 ${size * 0.06}px ${size * 0.2}px rgba(0,0,0,0.45)`,
        }}
      >
        <Avatar src={text(props, "avatarUrl")} size={size - ring * 2} light={light} round={round} style={{ borderRadius: round ? "50%" : "24%" }} />
      </div>
    </div>
  );
}
